// Exact read-only RPC definitions observed on Frankfurt, 2026-11-24. No new role model.
export const WORKSPACE_ROLE='timeax_workspace_read_login';
export const WORKSPACE_PROFILE='agency-pending-workspace-read-v1';
export const WORKSPACE_FUNCTIONS=Object.freeze([
  {
    "signature": "timeax_api.my_membership(text,text,uuid)",
    "owner": "postgres",
    "sha256": "6a96e037636dfb163ecb9db27be9aeed96274b15010da027ce71de69f8e04466"
  },
  {
    "signature": "timeax_api.my_worksites(text,text,uuid)",
    "owner": "postgres",
    "sha256": "0e396a76f4aed9eecc16b8ceddb88894612c6e61579f5e0650ac79478d65ab07"
  }
]);
