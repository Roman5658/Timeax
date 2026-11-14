import { useEffect, useState, type FormEvent } from "react";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getActiveMember, getFactory, getLeaderProductionWorkers, getWorkerAccess, setWorkerInputAccess, updateFactoryBreakRule, updateFactoryWorkCalendar, useDemoWorkspace } from "../demo-store";
import type { DemoWorkCalendar, WorkerInputAccess } from "../domain/demo-types";
import { useToast } from "../../../app/ToastProvider";

const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function LeaderProductionSettings({ factoryId }: { factoryId: string }) {
  const { t } = useTranslation();
  const workspace = useDemoWorkspace();
  const leader = getActiveMember(workspace);
  const factory = getFactory(workspace, factoryId);
  const workers = getLeaderProductionWorkers(workspace, leader.id, factoryId);
  const [breakMinutes, setBreakMinutes] = useState(String(factory?.requiredBreakMinutes ?? 0));
  const [breakTreatment, setBreakTreatment] = useState<"paid" | "unpaid">(factory?.requiredBreakTreatment ?? "unpaid");
  const [allowBreakReport, setAllowBreakReport] = useState(factory?.allowActualBreakReport !== false);
  const [calendar, setCalendar] = useState<DemoWorkCalendar>(factory?.workCalendar ?? { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] });
  const [accessWorkerId, setAccessWorkerId] = useState(workers[0]?.id ?? "");
  const [workerAccess, setWorkerAccess] = useState<WorkerInputAccess>(workers[0] ? getWorkerAccess(workspace, workers[0].id, factoryId) : "leader");
  const [message, setInlineMessage] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (value) showToast(value, value === t("workflow.errors.permission") ? "error" : "success");
  };

  useEffect(() => {
    if (!factory) return;
    setBreakMinutes(String(factory.requiredBreakMinutes));
    setBreakTreatment(factory.requiredBreakTreatment ?? "unpaid");
    setAllowBreakReport(factory.allowActualBreakReport !== false);
    setCalendar(factory.workCalendar ?? { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] });
  }, [factory?.id, factory?.requiredBreakMinutes, factory?.requiredBreakTreatment, factory?.allowActualBreakReport, factory?.workCalendar]);

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    const saved = updateFactoryBreakRule(factoryId, Number(breakMinutes), breakTreatment, allowBreakReport)
      && updateFactoryWorkCalendar(factoryId, calendar);
    setMessage(t(saved ? "workflow.production.operationalSaved" : "workflow.errors.permission"));
  }

  function toggleWeekday(day: number) {
    setCalendar((current) => ({ ...current, workingWeekdays: current.workingWeekdays.includes(day) ? current.workingWeekdays.filter((value) => value !== day) : [...current.workingWeekdays, day].sort() }));
  }

  function saveWorkerAccess() {
    const saved = accessWorkerId && setWorkerInputAccess(factoryId, accessWorkerId, workerAccess);
    setMessage(t(saved ? "workflow.production.permissionSaved" : "workflow.errors.permission"));
  }

  if (!factory || leader.role !== "leader" || leader.factoryId !== factoryId) return null;
  return <details className="dashboard-panel leader-production-settings">
    <summary className="agency-collapsible-heading"><span><span className="eyebrow"><Settings2 size={14} /> {t("workflow.production.operationalSettings")}</span><strong>{factory.name}</strong></span><span className="panel-period">{workers.length}</span></summary>
    {message && <p className="sr-only">{message}</p>}
    <form className="workflow-form" onSubmit={saveSettings}>
      <label className="field-label"><span>{t("workflow.production.requiredBreakMinutes")}</span><input type="number" min="0" max="240" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label>
      <label className="field-label"><span>{t("workflow.agency.breakTreatment")}</span><select value={breakTreatment} onChange={(event) => setBreakTreatment(event.target.value as "paid" | "unpaid")}><option value="unpaid">{t("workflow.agency.unpaidBreak")}</option><option value="paid">{t("workflow.agency.paidBreak")}</option></select></label>
      <label className="checkbox-field field-label--wide"><input type="checkbox" checked={allowBreakReport} onChange={(event) => setAllowBreakReport(event.target.checked)} /><span>{t("workflow.production.allowActualBreakReport")}</span></label>
      <fieldset className="leader-working-days field-label--wide"><legend>{t("workflow.production.workdays")}</legend><div>{weekdays.map((day, index) => <label className="checkbox-field" key={day}><input type="checkbox" checked={calendar.workingWeekdays.includes(index)} onChange={() => toggleWeekday(index)} /><span>{t(`workflow.schedule.days.${day}`)}</span></label>)}</div></fieldset>
      <button className="button button--primary button--small field-label--wide" type="submit">{t("common.save")}</button>
    </form>
    <p className="policy-note"><Settings2 size={15} />{t("workflow.production.breakRuleExplanation")}</p>
    {factory.inputMode === "C" && <div className="leader-worker-access"><h3>{t("workflow.production.workerInputAccess")}</h3><p className="muted-copy">{t("workflow.production.workerInputAccessLead")}</p>{workers.length ? <div className="workflow-form"><label className="field-label"><span>{t("workflow.fields.name")}</span><select value={accessWorkerId} onChange={(event) => { setAccessWorkerId(event.target.value); setWorkerAccess(event.target.value ? getWorkerAccess(workspace, event.target.value, factoryId) : "leader"); }}><option value="">{t("common.select")}</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><label className="field-label"><span>{t("workflow.production.workerInputAccess")}</span><select value={workerAccess} onChange={(event) => setWorkerAccess(event.target.value as WorkerInputAccess)}><option value="leader">{t("workflow.agency.access.leader")}</option><option value="self">{t("workflow.agency.access.self")}</option></select></label><button type="button" className="button button--outline button--small" onClick={saveWorkerAccess}>{t("common.save")}</button></div> : <p className="muted-copy">{t("workflow.production.noProductionWorkers")}</p>}</div>}
  </details>;
}
