-- Read-only verification. No values from identities, messages or invitations.
SELECT rolname,NOT rolcanlogin AS remains_nologin,
 NOT(rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS narrow_flags
FROM pg_roles WHERE rolname IN ('timeax_team_owner','timeax_team_login') ORDER BY rolname;
SELECT n.nspname,c.relname,c.relrowsecurity,pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='timeax_team' AND c.relkind='r' ORDER BY c.relname;
SELECT n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' AS signature,
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS sha256
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='timeax_team' OR n.nspname='timeax_api' AND p.proname='team_workflow' ORDER BY signature;
SELECT NOT has_schema_privilege('timeax_team_login','timeax_core','USAGE,CREATE')
 AND NOT has_schema_privilege('timeax_team_login','timeax_team','USAGE,CREATE') AS private_schemas_inaccessible;
