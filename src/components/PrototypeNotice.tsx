import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { demoMode } from "../modules/auth/supabase-auth";

export function PrototypeNotice({ subtle = false }: { subtle?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`prototype-notice${subtle ? " prototype-notice--subtle" : ""}`} role="note">
      <FlaskConical size={14} aria-hidden="true" />
      <span>{t(demoMode ? "common.prototype" : "auth.previewNotice")}</span>
    </div>
  );
}
