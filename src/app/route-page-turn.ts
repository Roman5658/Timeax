const hostedAuthLayerPaths = new Set(["/", "/login", "/register", "/register/agency"]);

export function routePageTurnPath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

export function shouldTurnRoutePage(previous: string, current: string, hostedAuthPanels: boolean) {
  const from = routePageTurnPath(previous);
  const to = routePageTurnPath(current);
  if (from === to) return false;
  // These hosted routes share the landing page and open/close an existing native book panel.
  return !hostedAuthPanels || !hostedAuthLayerPaths.has(from) || !hostedAuthLayerPaths.has(to);
}
