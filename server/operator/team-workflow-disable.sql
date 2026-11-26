BEGIN;
ALTER ROLE timeax_team_login NOLOGIN;
REVOKE EXECUTE ON FUNCTION timeax_api.team_workflow(text,text,text,jsonb,jsonb) FROM timeax_team_login;
REVOKE USAGE ON SCHEMA timeax_api FROM timeax_team_login;
COMMIT;
