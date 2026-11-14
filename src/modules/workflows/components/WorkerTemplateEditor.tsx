import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { DemoTemplate, DemoTemplateBreakType } from "../domain/demo-types";

const templateIcons = ["sun", "coffee", "moon", "zap"] as const;
type TemplateIcon = typeof templateIcons[number];

export function WorkerTemplateEditor({
  open,
  editing,
  name,
  setName,
  icon,
  setIcon,
  start,
  setStart,
  end,
  setEnd,
  breakType,
  setBreakType,
  breakDuration,
  setBreakDuration,
  breakStart,
  setBreakStart,
  breakEnd,
  setBreakEnd,
  enabled,
  setEnabled,
  onSubmit,
  onClose,
}: {
  open: boolean;
  editing?: DemoTemplate;
  name: string;
  setName: (value: string) => void;
  icon: TemplateIcon;
  setIcon: (value: TemplateIcon) => void;
  start: string;
  setStart: (value: string) => void;
  end: string;
  setEnd: (value: string) => void;
  breakType: DemoTemplateBreakType;
  setBreakType: (value: DemoTemplateBreakType) => void;
  breakDuration: number;
  setBreakDuration: (value: number) => void;
  breakStart: string;
  setBreakStart: (value: string) => void;
  breakEnd: string;
  setBreakEnd: (value: string) => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return <div className="modal-backdrop template-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dashboard-panel compact-modal worker-template-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-overview-template-title">
      <div className="panel-heading"><div><span className="eyebrow">{t("workflow.templates.eyebrow")}</span><h2 id="worker-overview-template-title">{editing ? t("workflow.templates.editTitle") : t("workflow.templates.newTitle")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={onClose}>×</button></div>
      <form className="workflow-form" onSubmit={onSubmit}>
        <label className="field-label"><span>{t("workflow.templates.name")}</span><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={40} /></label>
        <label className="field-label"><span>{t("workflow.templates.icon")}</span><select value={icon} onChange={(event) => setIcon(event.target.value as TemplateIcon)}>{templateIcons.map((value) => <option key={value} value={value}>{t(`workflow.templates.icons.${value}`)}</option>)}</select></label>
        <label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={start} onChange={(event) => setStart(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
        <fieldset className="template-break-options field-label--wide"><legend>{t("workflow.breakReport.templateType")}</legend>{(["none", "paid", "unpaid"] as const).map((value) => <label className="template-break-option" key={value}><input type="radio" name="template-break-type" value={value} checked={breakType === value} onChange={() => setBreakType(value)} /><span><strong>{t(value === "none" ? "workflow.breakReport.noBreakTemplate" : value === "paid" ? "workflow.breakReport.paidBreakTemplate" : "workflow.breakReport.unpaidBreakTemplate")}</strong><small>{t(value === "none" ? "workflow.breakReport.templateNoneHelp" : value === "paid" ? "workflow.breakReport.templatePaidHelp" : "workflow.breakReport.templateUnpaidHelp")}</small></span></label>)}</fieldset>
        {breakType !== "none" && <><label className="field-label"><span>{t("workflow.breakReport.durationMinutes")}</span><input type="number" min="0" max="240" value={breakDuration} onChange={(event) => setBreakDuration(Number(event.target.value))} /></label><label className="field-label"><span>{t("workflow.fields.breakStart")}</span><input type="time" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} /></label><label className="field-label"><span>{t("workflow.fields.breakEnd")}</span><input type="time" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} /></label></>}
        <label className="checkbox-field field-label--wide"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>{t("workflow.templates.enabled")}</span></label>
        <div className="form-actions field-label--wide"><button className="button button--primary" type="submit">{t("common.save")}</button><button className="button button--quiet" type="button" onClick={onClose}>{t("common.cancel")}</button></div>
      </form>
    </section>
  </div>;
}
