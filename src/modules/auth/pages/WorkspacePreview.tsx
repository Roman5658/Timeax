import {ArrowDownRight, Building2, CalendarDays, Clock3, FileSpreadsheet, ShieldCheck} from "lucide-react";
import {useTranslation} from "react-i18next";

export function WorkspacePreview({id}:{id?:string}) {
  const { t } = useTranslation();
  return (
    <div className="preview-scene" id={id} aria-label={t("home.previewTitle")}>
      <div className="preview-orbit preview-orbit--one" />
      <div className="preview-orbit preview-orbit--two" />
      <div className="workspace-card">
        <div className="workspace-card-top">
          <div>
            <span className="workspace-overline">{t("home.previewLabel")}</span>
            <h2>{t("home.previewTitle")}</h2>
          </div>
          <span className="workspace-mark"><CalendarDays size={19} /></span>
        </div>
        <p className="workspace-subtitle">{t("home.previewSub")}</p>
        <div className="workspace-stats">
          <div className="workspace-stat workspace-stat--lime"><Clock3 size={16} /><span>{t("home.cardHours")}</span><strong>—</strong></div>
          <div className="workspace-stat workspace-stat--blue"><ShieldCheck size={16} /><span>{t("home.cardApprovals")}</span><strong>—</strong></div>
          <div className="workspace-stat workspace-stat--peach"><Building2 size={16} /><span>{t("home.cardTeams")}</span><strong>—</strong></div>
        </div>
        <div className="workspace-week">
          <div className="workspace-week-heading"><span>{t("home.weekLabel")}</span><span className="week-dots">•••</span></div>
          <div className="week-grid" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span className={`week-cell${index === 3 ? " week-cell--active" : ""}`} key={index} />)}
          </div>
          <p>{t("home.weekEmpty")}</p>
        </div>
        <div className="workspace-footer"><span className="avatar-stack"><i /><i /><i /></span><span>{t("dashboard.scopeNote")}</span></div>
      </div>
      <div className="floating-chip floating-chip--top"><span className="chip-pulse" />{t("common.planned")}</div>
      <div className="floating-chip floating-chip--bottom"><FileSpreadsheet size={15} /> Excel</div>
      <div className="preview-spark preview-spark--a"><ArrowDownRight size={27} /></div>
    </div>
  );
}
