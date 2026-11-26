import { useLayoutEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WorkerProfileProvider } from "../workflows/components/WorkerProfile";
import { setAuthenticatedPreviewAccount } from "../workflows/demo-store";
import { useAuth } from "./AuthProvider";
import { getPortalRole, portalHome, type PortalRole } from "./portal-access";
import { demoMode } from "./supabase-auth";

function AuthenticatedWorkspace({ id, email, role }: { id: string; email?: string; role: PortalRole }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    setAuthenticatedPreviewAccount({ id, email, role });
    setReady(true);
    return () => setAuthenticatedPreviewAccount(undefined);
  }, [id, email, role]);

  return ready ? <WorkerProfileProvider><Outlet /></WorkerProfileProvider> : null;
}

export function ProtectedWorkspace() {
  const auth = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  if (demoMode) return <WorkerProfileProvider><Outlet /></WorkerProfileProvider>;
  if (auth.status === "loading") return <div className="route-loading" role="status" aria-label={t("auth.sessionLoading")} />;
  if (auth.status !== "signed-in") {
    const from = location.pathname + location.search + location.hash;
    return <Navigate replace to="/login" state={{ from }} />;
  }
  if (auth.recovering) return <Navigate replace to="/reset-password" />;
  const { user } = auth;
  const role = getPortalRole(user.app_metadata.timeax_role);
  if (!role) return <Navigate replace to="/login" />;
  return <AuthenticatedWorkspace key={`${user.id}:${role}`} id={user.id} email={user.email} role={role} />;
}

export function RequireRole({ role }: { role: PortalRole }) {
  const auth = useAuth();
  if (demoMode) return <Outlet />;
  if (auth.status !== "signed-in") return null;
  const actual = getPortalRole(auth.user.app_metadata.timeax_role);
  if (!actual) return <Navigate replace to="/login" />;
  return actual === role ? <Outlet /> : <Navigate replace to={portalHome[actual]} />;
}
