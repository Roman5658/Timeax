import { Building2, LifeBuoy, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";

export function SuperAdminPage() {
  const { t } = useTranslation();
  return (
    <PortalShell role="admin">
      <PageHeading eyebrow={t("common.preview")} title={t("dashboard.adminTitle")} description={t("dashboard.adminLead")} />
      <div className="stat-grid stat-grid--two">
        <div className="stat-card"><span className="stat-icon stat-icon--mint"><Building2 size={18} /></span><span>{t("dashboard.statConnections")}</span><strong>—</strong></div>
        <div className="stat-card"><span className="stat-icon stat-icon--peach"><LifeBuoy size={18} /></span><span>{t("dashboard.statSupport")}</span><strong>—</strong></div>
      </div>
      <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("nav.adminHome")}</span><h2>{t("common.status")}</h2></div><ShieldCheck size={18} /></div><EmptyState title={t("dashboard.emptyAdminTitle")} description={t("dashboard.emptyAdminBody")} /></section>
    </PortalShell>
  );
}
