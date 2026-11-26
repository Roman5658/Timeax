/** A sign-in destination is navigation context, never an authorization grant. */
export function roleSignInPath(pathname: string) {
  if (/^\/factory(?:\/|$)/.test(pathname)) return "/login/factory";
  if (/^\/worker(?:\/|$)/.test(pathname)) return "/login/worker";
  return "/login";
}
