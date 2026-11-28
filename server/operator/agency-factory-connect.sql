-- Run after the canonical factory registration migration. No organizations or access grants are created here.
BEGIN;
ALTER TABLE timeax_core.agency_factory_connection_invitations
 ADD COLUMN proposed_name text CHECK(length(proposed_name) BETWEEN 1 AND 120),
 ADD COLUMN proposed_address text CHECK(length(proposed_address) BETWEEN 1 AND 200),
 ADD COLUMN registration_request_id uuid REFERENCES timeax_core.factory_registration_requests(id),
 ADD CONSTRAINT factory_invitation_draft_complete CHECK((proposed_name IS NULL)=(proposed_address IS NULL));
ALTER TABLE timeax_core.factory_registration_requests ADD COLUMN invited_address text CHECK(length(invited_address) BETWEEN 1 AND 200);

DO $patch$
DECLARE
 f regprocedure:='timeax_api.factory_registration(text,text,text,jsonb)'::regprocedure;
 original text:=pg_get_functiondef(f);
 ddl text;
 anchor constant text:=$a$ IF p_action='submit' THEN$a$;
 context_site constant text:=$a$'siteName',r.site_name,'state',r.state$a$;
 context_address constant text:=$a$'siteName',r.site_name,'address',r.invited_address,'state',r.state$a$;
 list_expiry constant text:=$a$WHEN v.connection_id IS NOT NULL THEN 'claimed' WHEN v.expires_at<=statement_timestamp() THEN 'expired'$a$;
 list_guard constant text:=$a$WHEN v.connection_id IS NOT NULL THEN 'claimed' WHEN v.expires_at<=statement_timestamp() AND v.registration_request_id IS NULL THEN 'expired'$a$;
 claim_expiry constant text:=$a$  IF invitation.expires_at<=statement_timestamp() THEN RAISE EXCEPTION 'invitation expired' USING ERRCODE='42501';END IF;$a$;
 claim_guard constant text:=$a$  IF invitation.registration_request_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM timeax_core.factory_registration_requests r WHERE r.id=invitation.registration_request_id AND r.identity_id=principal AND r.organization_id=site.owner_organization_id
  ) THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';END IF;
  IF invitation.expires_at<=statement_timestamp() AND invitation.registration_request_id IS NULL THEN RAISE EXCEPTION 'invitation expired' USING ERRCODE='42501';END IF;$a$;
 inject constant text:=$body$
 IF p_action IN ('lookup-factory','prepare-factory','preview-factory-invitation','submit-invited-factory') THEN
  DECLARE
   target_nip text; agency_id uuid; confirmed_factory record; result jsonb;
   input_name text; input_address text;
  BEGIN
   IF p_action IN ('lookup-factory','prepare-factory') THEN
    agency_id:=(p_input->>'agencyId')::uuid;
    actor:=timeax_core.setup_admin(p_issuer,p_subject,agency_id,'agency');
    target_nip:=p_input->>'factoryNip';
   ELSE
    IF NOT COALESCE(p_input->>'code' ~ '^[0-9a-f]{64}$',false) THEN
     RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';
    END IF;
    SELECT * INTO invitation FROM timeax_core.agency_factory_connection_invitations
    WHERE code_digest=sha256(convert_to(p_input->>'code','UTF8')) AND NOT revoked FOR UPDATE;
    IF NOT FOUND OR (invitation.expires_at<=statement_timestamp() AND invitation.registration_request_id IS NULL) THEN
     RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';
    END IF;
    IF invitation.registration_request_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM timeax_core.factory_registration_requests r WHERE r.id=invitation.registration_request_id AND r.identity_id=principal
    ) THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';END IF;
    PERFORM 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id
     JOIN timeax_core.organizations o ON o.id=m.organization_id
    WHERE m.id=invitation.issued_by AND m.role='agency_admin' AND m.state='active' AND i.active AND o.state='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';END IF;
    target_nip:=invitation.factory_nip;
    IF invitation.proposed_name IS NULL THEN
     IF p_action='preview-factory-invitation' THEN RETURN jsonb_build_object('state','legacy');END IF;
     RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';
    END IF;
   END IF;
   IF NOT COALESCE(target_nip ~ '^[0-9]{10}$',false) THEN RAISE EXCEPTION 'invalid NIP' USING ERRCODE='22023';END IF;
   IF p_action='submit-invited-factory' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('factory-nip/'||target_nip,0));
   END IF;
   SELECT r.organization_id,o.name,r.invited_address INTO confirmed_factory
    FROM timeax_core.factory_registration_requests r JOIN timeax_core.organizations o ON o.id=r.organization_id
    WHERE r.nip=target_nip AND r.state='approved' AND o.kind='factory';
   IF p_action='lookup-factory' THEN
    RETURN CASE WHEN confirmed_factory.organization_id IS NULL THEN jsonb_build_object('state','new')
     ELSE jsonb_build_object('state','registered','name',confirmed_factory.name,'address',confirmed_factory.invited_address) END;
   END IF;
   IF p_action='prepare-factory' THEN
    input_name:=btrim(p_input->>'name');input_address:=btrim(p_input->>'address');
    IF NOT COALESCE(length(input_name) BETWEEN 1 AND 120 AND length(input_address) BETWEEN 1 AND 200,false)
     OR input_name ~ '[[:cntrl:]]' OR input_address ~ '[[:cntrl:]]' THEN
     RAISE EXCEPTION 'invalid factory details' USING ERRCODE='22023';
    END IF;
    code:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
    INSERT INTO timeax_core.agency_factory_connection_invitations(agency_id,issued_by,factory_nip,code_digest,expires_at,proposed_name,proposed_address)
    VALUES(agency_id,actor,target_nip,sha256(convert_to(code,'UTF8')),clock_timestamp()+interval '7 days',
     COALESCE(confirmed_factory.name,input_name),input_address) RETURNING * INTO invitation;
    RETURN jsonb_build_object('id',invitation.id,'code',code,'expiresAt',invitation.expires_at);
   END IF;
   IF p_action='preview-factory-invitation' THEN
    IF confirmed_factory.organization_id IS NOT NULL THEN
     RETURN jsonb_build_object('state','registered','name',confirmed_factory.name,'organizationId',
      CASE WHEN EXISTS(SELECT 1 FROM timeax_api.my_membership(p_issuer,p_subject,confirmed_factory.organization_id) m WHERE m.role='factory_admin')
       THEN confirmed_factory.organization_id END);
    END IF;
    RETURN jsonb_build_object('state','new','name',invitation.proposed_name,'nip',target_nip,'address',invitation.proposed_address);
   END IF;
   IF confirmed_factory.organization_id IS NOT NULL OR p_input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'registered factory or missing declaration' USING ERRCODE='22023';
   END IF;
   result:=timeax_api.factory_registration(p_issuer,p_subject,'submit',jsonb_build_object(
    'name',invitation.proposed_name,'nip',target_nip,'siteName',invitation.proposed_name,'confirmed',true));
   UPDATE timeax_core.factory_registration_requests SET invited_address=invitation.proposed_address
    WHERE id=(result->>'id')::uuid AND state='pending' AND invited_address IS NULL;
   UPDATE timeax_core.agency_factory_connection_invitations SET registration_request_id=(result->>'id')::uuid WHERE id=invitation.id;
   RETURN result;
  END;
 END IF;
$body$;
BEGIN
 IF (SELECT proowner FROM pg_proc WHERE oid=f) IS DISTINCT FROM 'timeax_factory_registration_owner'::regrole::oid
 OR NOT position('SECURITY DEFINER' in original)>0 OR position('lookup-factory' in original)>0
 OR length(original)-length(replace(original,anchor,''))<>length(anchor)
 OR length(original)-length(replace(original,context_site,''))<>length(context_site)
 OR length(original)-length(replace(original,list_expiry,''))<>length(list_expiry)
 OR length(original)-length(replace(original,claim_expiry,''))<>length(claim_expiry)
 THEN RAISE EXCEPTION 'Unexpected factory registration definition';END IF;
 ddl:=replace(original,anchor,inject||anchor);
 ddl:=replace(ddl,claim_expiry,claim_guard);
 ddl:=replace(ddl,context_site,context_address);
 ddl:=replace(ddl,list_expiry,list_guard);
 EXECUTE ddl;
END
$patch$;
COMMIT;
