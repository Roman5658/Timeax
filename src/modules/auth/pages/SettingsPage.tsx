import { Database, Languages, MoonStar, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import { PageHeading } from "../../../components/PageHeading";
import { ThemeToggle } from "../../../components/ThemeToggle";
import { PortalShell } from "../../../app/PortalShell";
import { useAuth } from "../AuthProvider";
import { getPortalRole } from "../portal-access";
import { demoMode } from "../supabase-auth";
import { getActiveMember, isDemoStorageProtected, resetDemoWorkspace, useDemoWorkspace } from "../../workflows/demo-store";

export function SettingsPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const role = auth.status === "signed-in" ? getPortalRole(auth.user.app_metadata.timeax_role) ?? member.role : member.role;
  const agencyName = workspace.organizations.find((organization) => organization.id === member.organizationId)?.name ?? member.name;
  const [resetResult, setResetResult] = useState<"success" | "error">();
  const storageProtected = isDemoStorageProtected();
  return (
    <PortalShell role={role}>
      <div className="content-page content-page--narrow">
        <PageHeading eyebrow={t("nav.profile")} title={t("settings.title")} description={t("settings.lead")} />
        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-heading"><span className="settings-icon settings-icon--mint"><Languages size={19} /></span><div><span className="eyebrow">TIMEAX</span><h2>{t("settings.languageTitle")}</h2></div></div>
            <LanguageSwitcher />
          </section>
          <section className="settings-card settings-card--appearance">
            <div className="settings-card-heading"><span className="settings-icon settings-icon--blue"><MoonStar size={19} /></span><div><span className="eyebrow">TIMEAX</span><h2>{t("settings.themeTitle")}</h2></div></div>
            <div className="theme-setting"><span>{t("common.theme")}</span><ThemeToggle expanded /></div>
          </section>
          <section className="settings-card settings-card--wide">
            <div className="settings-card-heading"><span className="settings-icon settings-icon--peach"><UserRound size={19} /></span><div><span className="eyebrow">{t("common.account")}</span><h2>{t("settings.profileTitle")}</h2></div></div>
            <p><strong>{member.name}</strong></p><p>{agencyName}</p>
          </section>
          {demoMode && member.role === "agency" && <section className="settings-card settings-card--wide">
            <div className="settings-card-heading"><span className="settings-icon settings-icon--violet"><Database size={19} /></span><div><span className="eyebrow">TIMEAX</span><h2>{t("settings.demoDataTitle")}</h2></div></div>
            <p>{t("settings.demoDataLead", { agencyName })}</p>
            {storageProtected && <p className="notice-box notice-box--warm">{t("settings.demoStorageProtected")}</p>}
            {member.role === "agency" && <button className="button button--outline" type="button" onClick={() => {
              if (!window.confirm(t("settings.resetDemoConfirm", { agencyName }))) return;
              setResetResult(resetDemoWorkspace(true) ? "success" : "error");
            }}>{t("settings.resetDemoData")}</button>}
            {resetResult && <small role="status">{t(resetResult === "success" ? "settings.resetDemoDone" : "settings.resetDemoFailed")}</small>}
          </section>}
        </div>
      </div>
    </PortalShell>
  );
}
