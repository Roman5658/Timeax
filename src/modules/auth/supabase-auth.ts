import { AuthClient } from "@supabase/auth-js";

export const demoMode = import.meta.env.DEV && import.meta.env.VITE_TIMEAX_DEMO === "true";

function readSupabaseUrl() {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL?.trim() ?? "");
  } catch {
    return undefined;
  }
}

const url = readSupabaseUrl();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const authClient = !demoMode && url?.protocol === "https:" && /^sb_publishable_[\w-]+$/.test(key)
  ? new AuthClient({
    url: `${url.origin}/auth/v1`,
    headers: { apikey: key },
    storageKey: `timeax-auth-${url.hostname}`,
    flowType: "pkce",
  })
  : undefined;
