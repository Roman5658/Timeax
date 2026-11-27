-- Private estimates only. No change to the actual payroll calculation, rates, or publication tables.
BEGIN;
CREATE ROLE timeax_pay_estimate_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 4;
GRANT USAGE ON SCHEMA timeax_api TO timeax_pay_estimate_login;
CREATE TABLE timeax_core.pay_estimate_settings (
 organization_id uuid NOT NULL,
 worker_id uuid NOT NULL,
 effective_month date NOT NULL CHECK(extract(day FROM effective_month)=1 AND extract(year FROM effective_month) BETWEEN 2000 AND 2100),
 basis text NOT NULL CHECK(basis IN ('gross','net')),
 rate_cents integer NOT NULL CHECK(rate_cents BETWEEN 1 AND 1000000),
 deductions jsonb NOT NULL CHECK(jsonb_typeof(deductions)='array' AND jsonb_array_length(deductions)<=20 AND (basis='gross' OR deductions='[]')),
 revision integer NOT NULL CHECK(revision>=1),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,worker_id,effective_month),
 FOREIGN KEY(organization_id,worker_id) REFERENCES timeax_core.memberships(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE timeax_core.pay_estimate_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.pay_estimate_settings FROM PUBLIC,anon,authenticated,service_role,timeax_pay_estimate_login;

CREATE FUNCTION timeax_api.pay_estimates(text,text,text,jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $body$
DECLARE org uuid; actor uuid; worker uuid; month date; mode text; rate integer; deductions_in jsonb; expected integer;
 result timeax_core.pay_estimate_settings; v jsonb; sum_cents bigint:=0;
BEGIN
 IF session_user<>'timeax_pay_estimate_login' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 org:=($4->>'organizationId')::uuid;
 SELECT m.id INTO actor FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id
 JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.identity_issuers s ON s.issuer=i.issuer
 WHERE m.organization_id=org AND m.organization_kind='agency' AND m.role='agency_admin' AND m.state='active'
 AND o.kind='agency' AND o.state='active' AND i.active AND s.active AND i.issuer=$1 AND i.subject=$2 FOR SHARE OF m,o,i,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agency access required' USING ERRCODE='42501'; END IF;
 IF $3='context' THEN
  RETURN jsonb_build_object('organizationId',org,'settings',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('workerId',e.worker_id,'effectiveMonth',to_char(e.effective_month,'YYYY-MM'),'basis',e.basis,
    'rateCents',e.rate_cents,'deductions',e.deductions,'revision',e.revision) ORDER BY e.worker_id,e.effective_month)
   FROM timeax_core.pay_estimate_settings e WHERE e.organization_id=org),'[]'));
 END IF;
 IF $3<>'set' OR jsonb_typeof($4) IS DISTINCT FROM 'object' OR
  NOT ($4 ?& ARRAY['organizationId','workerId','effectiveMonth','basis','rateCents','deductions','revision']) OR
  (SELECT count(*) FROM jsonb_object_keys($4))<>7 OR
  COALESCE($4->>'effectiveMonth','') !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2])$' OR
  jsonb_typeof($4->'rateCents') IS DISTINCT FROM 'number' OR ($4->>'rateCents') !~ '^[0-9]{1,7}$' OR
  jsonb_typeof($4->'revision') IS DISTINCT FROM 'number' OR ($4->>'revision') !~ '^[0-9]{1,9}$' OR
  COALESCE($4->>'basis','') NOT IN ('gross','net') OR jsonb_typeof($4->'deductions') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE='22023'; END IF;
 worker:=($4->>'workerId')::uuid;month:=($4->>'effectiveMonth'||'-01')::date;mode:=$4->>'basis';
 rate:=($4->>'rateCents')::int;deductions_in:=$4->'deductions';expected:=($4->>'revision')::int;
 IF worker IS NULL OR rate NOT BETWEEN 1 AND 1000000 OR jsonb_array_length(deductions_in)>20 OR (mode='net' AND deductions_in<>'[]')
 THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE='22023'; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(deductions_in) LOOP
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT (v ?& ARRAY['name','cents']) OR
   jsonb_typeof(v->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'cents') IS DISTINCT FROM 'number' OR
   (SELECT count(*) FROM jsonb_object_keys(v))<>2 OR char_length(v->>'name') NOT BETWEEN 2 AND 80 OR
   v->>'name'<>btrim(v->>'name') OR (v->>'name') ~ '[[:cntrl:]]' OR
   (v->>'cents') !~ '^[0-9]{1,10}$' OR (v->>'cents')::bigint NOT BETWEEN 1 AND 1000000000
  THEN RAISE EXCEPTION 'Invalid deduction' USING ERRCODE='22023'; END IF;
  sum_cents:=sum_cents+(v->>'cents')::bigint;
 END LOOP;
 IF sum_cents>1000000000 THEN RAISE EXCEPTION 'Invalid total' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id
 WHERE m.id=worker AND m.organization_id=org AND m.organization_kind='agency' AND m.role='worker' AND m.state='active' AND i.active FOR SHARE OF m,i;
 IF NOT FOUND THEN RAISE EXCEPTION 'Worker unavailable' USING ERRCODE='42501'; END IF;
 IF expected=0 THEN
  INSERT INTO timeax_core.pay_estimate_settings(organization_id,worker_id,effective_month,basis,rate_cents,deductions,revision)
  VALUES(org,worker,month,mode,rate,deductions_in,1) ON CONFLICT DO NOTHING RETURNING * INTO result;
 ELSE
  UPDATE timeax_core.pay_estimate_settings e SET basis=mode,rate_cents=rate,deductions=deductions_in,revision=e.revision+1,updated_at=clock_timestamp()
  WHERE e.organization_id=org AND e.worker_id=worker AND e.effective_month=month AND e.revision=expected RETURNING * INTO result;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settings changed' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('workerId',result.worker_id,'effectiveMonth',to_char(result.effective_month,'YYYY-MM'),
  'basis',result.basis,'rateCents',result.rate_cents,'deductions',result.deductions,'revision',result.revision);
END;
$body$;
REVOKE ALL ON FUNCTION timeax_api.pay_estimates(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_api.pay_estimates(text,text,text,jsonb) TO timeax_pay_estimate_login;
COMMIT;
