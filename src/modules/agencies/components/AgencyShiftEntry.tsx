import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createAgencyShift, recordAgencyAbsence, getWorkerProductionAssignment, useDemoWorkspace } from "../../workflows/demo-store";
import { todayLocalDate } from "../../workflows/workflow-utils";

export function AgencyShiftEntry() {
  const { t } = useTranslation();
  const workspace = useDemoWorkspace();
  const factories = workspace.factories.filter((factory) => factory.organizationId === workspace.organization.id && !factory.archivedAt
    && !workspace.worksites?.find((site) => site.id === factory.worksiteId)?.businessEntityId);
  const [factoryId, setFactoryId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [date, setDate] = useState(todayLocalDate());
  const [start, setStart] = useState("06:00");
  const [end, setEnd] = useState("14:00");
  const [breakMinutes, setBreakMinutes] = useState("0");
  const [absenceNote, setAbsenceNote] = useState("");
  const [message, setMessage] = useState("");
  const workers = workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "worker" && getWorkerProductionAssignment(workspace, member.id, factoryId));
  return <details className="dashboard-panel"><summary>{t("payroll.agencyEntry")}</summary><p>{t("payroll.agencyEntryHint")}</p><p className="muted-copy">{t("payroll.timeZoneHint")}</p><form className="workflow-form" onSubmit={(event) => { event.preventDefault(); const saved = createAgencyShift(workerId, { factoryId, localDate: date, startTime: start, endTime: end, comment: "", breakStatus: Number(breakMinutes) ? "taken" : "not-taken", breakTreatment: "unpaid", breakDurationMinutes: Number(breakMinutes) }); setMessage(t(saved ? "payroll.entrySaved" : "payroll.entryFailed")); }}>
    <label className="field-label"><span>{t("workflow.fields.production")}</span><select required value={factoryId} onChange={(event) => { setFactoryId(event.target.value); setWorkerId(""); setMessage(""); }}><option value="">{t("common.select")}</option>{factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label>
    <label className="field-label"><span>{t("workflow.fields.worker")}</span><select required value={workerId} onChange={(event) => { setWorkerId(event.target.value); setMessage(""); }}><option value="">{t("common.select")}</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
    <label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
    <label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
    <label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" required value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    <label className="field-label"><span>{t("payroll.unpaidMinutes")}</span><input type="number" min="0" max="720" step="1" required value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label>
    <button type="submit" className="button button--primary" disabled={!workerId || !factoryId}>{t("common.save")}</button>{message && <p role="status">{message}</p>}
  </form><details><summary>{t("payroll.absenceDecision")}</summary><p>{t("payroll.absenceEntryHint")}</p><p className="muted-copy">{t("payroll.absenceHint")}</p><label className="field-label"><span>{t("workflow.absence.agencyNote")}</span><textarea value={absenceNote} maxLength={500} onChange={(event) => setAbsenceNote(event.target.value)} /></label><div className="form-actions">{(["unreported", "agreed-day-off"] as const).map((category) => <button type="button" className="button button--outline" key={category} disabled={!workerId || !factoryId || !date || !absenceNote.trim()} onClick={() => setMessage(t(recordAgencyAbsence(workerId, factoryId, date, category, absenceNote) ? "workflow.absence.decisionSaved" : "payroll.absenceFailed"))}>{t(`workflow.absence.agencyCategory.${category}`)}</button>)}</div>{message && <p role="status">{message}</p>}</details></details>;
}
