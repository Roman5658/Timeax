import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isAuthSessionMissingError, type User } from "@supabase/auth-js";
import { authClient } from "./supabase-auth";

type AuthState =
  | { status: "unconfigured" | "loading" | "signed-out" | "unavailable" }
  | { status: "signed-in"; user: User; recovering: boolean };

const AuthContext = createContext<AuthState>({ status: "unconfigured" });
const recoveryKey = "timeax-password-recovery";

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: authClient ? "loading" : "unconfigured" });

  useEffect(() => {
    const client = authClient;
    if (!client) return;

    let timer: number | undefined;
    let revision = 0;
    let verifiedToken: string | undefined;
    let recoveryUserId: string | null = null;
    try {
      recoveryUserId = window.sessionStorage.getItem(recoveryKey);
    } catch {
      // The current tab can still complete recovery when storage is unavailable.
    }

    const { data: { subscription } } = client.onAuthStateChange((event, session) => {
      const token = session?.access_token;
      if (event === "PASSWORD_RECOVERY" || !session) {
        recoveryUserId = session?.user.id ?? null;
        try {
          if (recoveryUserId) window.sessionStorage.setItem(recoveryKey, recoveryUserId);
          else window.sessionStorage.removeItem(recoveryKey);
        } catch {
          // Keep the recovery state in memory for this tab.
        }
      }
      if (token && token === verifiedToken && event !== "USER_UPDATED" && event !== "PASSWORD_RECOVERY") return;

      const request = ++revision;
      window.clearTimeout(timer);
      if (!token || !session) {
        verifiedToken = undefined;
        setState({ status: "signed-out" });
        return;
      }

      const recovering = session.user.id === recoveryUserId;
      setState((current) => current.status === "signed-in" && current.user.id === session.user.id
        && current.recovering === recovering ? current : { status: "loading" });

      // Defer verification until the Auth SDK releases its session lock.
      timer = window.setTimeout(async () => {
        try {
          const { data: { user }, error } = await client.getUser(token);
          if (request !== revision) return;
          if (user && !error) {
            verifiedToken = token;
            setState({ status: "signed-in", user, recovering });
          } else if (isAuthSessionMissingError(error) || error?.status === 401 || error?.status === 403) {
            setState({ status: "signed-out" });
          } else {
            setState({ status: "unavailable" });
          }
        } catch {
          if (request === revision) setState({ status: "unavailable" });
        }
      }, 0);
    });

    return () => {
      revision++;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
