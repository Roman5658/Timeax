BEGIN;
DO $migration$
DECLARE
 rpc regprocedure := 'timeax_api.inbox(text,text,text,jsonb)'::regprocedure;
 original text := pg_get_functiondef(rpc);
 patched text;
BEGIN
 IF encode(sha256(convert_to(original,'UTF8')),'hex') <> 'e69f5e968803ecf74e5a1c2748603e42a8ccce73e6562839d2f01ff3d5ac425a'
 THEN RAISE EXCEPTION 'Unexpected inbox definition'; END IF;
 -- The read receipt key is the reader's organization membership, not an identity id.
 patched := replace(original,'r.reader_id=m.identity_id','r.reader_id=m.id');
 IF encode(sha256(convert_to(patched,'UTF8')),'hex') <> '1d3cf474b619e7205682c6211313d43c998068f9da7cf4f322a27c6dcbdd4923'
 THEN RAISE EXCEPTION 'Unexpected amended inbox definition'; END IF;
 EXECUTE patched;
END
$migration$;
COMMIT;
