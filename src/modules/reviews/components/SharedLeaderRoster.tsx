import { useMemo, useState } from "react";
import { ClipboardCheck, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isInternalAgencyFactory, confirmShiftForWorker, setLeaderWorkerInputAccess, getWorkerAccess, createLeaderShiftBatch, getActiveMember, getLeaderAccessPermissions, getLeaderAccessibleWorkers, getLeaderProductionMemberships, getProductionWorkflowSettings, reviewShiftRecord, useDemoWorkspace } from "../../workflows/demo-store";
import { todayLocalDate } from "../../workflows/workflow-utils";
import { useToast } from "../../../app/ToastProvider";
import { filterLeaderRoster } from "../../workflows/domain/access";

type ShiftFilter = "all" | "with-shift" | "without-shift" | "pending" | "disputed";
type WorkerFilter = "all" | "active" | "away";

export function SharedLeaderRoster() {
  const { t } = useTranslation();
  const workspace = useDemoWorkspace();
  const actor = getActiveMember(workspace);
  const memberships = getLeaderProductionMemberships(workspace, actor.id);
  const entries = getLeaderAccessibleWorkers(workspace, actor.id, todayLocalDate());
  const showToast = useToast();
  const [search, setSearch] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [workerFilter, setWorkerFilter] = useState<WorkerFilter>("active");
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [localDate, setLocalDate] = useState(todayLocalDate());
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("14:00");

  const visible = useMemo(() => filterLeaderRoster(entries, { organizationId: agencyFilter === "all" ? undefined : agencyFilter, groupId: groupFilter, workerState: workerFilter, attentionOnly, shiftState: shiftFilter, search }), [entries, agencyFilter, groupFilter, workerFilter, attentionOnly, shiftFilter, search]);

  const groupOptions = [...new Map(entries.filter((entry) => entry.groupName && entry.assignment.groupId).map((entry) => [entry.assignment.groupId!, { id: entry.assignment.groupId!, name: `${entry.organizationName} · ${entry.groupName}` }])).values()];
  const selectedEntries = entries.filter((entry) => selected.includes(entry.key));
  const eligibleEntries = selectedEntries.filter((entry) => {
    const membership = memberships.find((item) => item.id === entry.leaderMembershipId);
    const factory = workspace.factories.find((item) => item.id === entry.factory.id && item.organizationId === entry.organizationId);
    return Boolean(membership && factory && getLeaderAccessPermissions(membership).canRecordHours && getProductionWorkflowSettings(factory).leaderCanRecordHours);
  });

  function toggle(key: string) {
    setSelected((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  function toggleVisible() {
    const visibleKeys = visible.map((entry) => entry.key);
    const allSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selected.includes(key));
    setSelected((current) => allSelected ? current.filter((key) => !visibleKeys.includes(key)) : [...new Set([...current, ...visibleKeys])]);
  }

  function recordSelectedShift() {
    if (!eligibleEntries.length) return;
    const saved = createLeaderShiftBatch(eligibleEntries.map((entry) => ({ organizationId: entry.organizationId, factoryId: entry.factory.id, workerId: entry.worker.id, employmentId: entry.employmentId })), {
      localDate, startTime, endTime, comment: "", breakStatus: "not-reported", breakTreatment: "unpaid",
    }, `leader-batch-${crypto.randomUUID()}`);
    showToast(t(saved ? "workflow.leader.roster.saved" : "workflow.errors.permission", { total: saved }), saved ? "success" : "error");
    if (saved) setSelected([]);
  }

  return <section className="dashboard-panel leader-shared-roster" id="leader-shared-roster">
    <div className="panel-heading"><div><span className="eyebrow">{t("workflow.leader.roster.eyebrow")}</span><h2>{t("workflow.leader.roster.title")}</h2><p className="muted-copy">{t("workflow.leader.roster.description")}</p></div><span className="panel-period">{visible.length} / {entries.length}</span></div>
    <div className="team-filter-row">
      <label className="field-label"><span>{t("workflow.leader.searchWorkers")}</span><span className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} /></span></label>
      <label className="field-label"><span>{t("workflow.leader.roster.agency")}</span><select value={agencyFilter} onChange={(event) => setAgencyFilter(event.target.value)}><option value="all">{t("common.all")}</option>{[...new Map(entries.map((entry) => [entry.organizationId, entry.organizationName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.leader.groupFilter")}</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">{t("workflow.leader.allGroups")}</option><option value="none">{t("workflow.leader.roster.noGroup")}</option>{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.leader.statusFilter")}</span><select value={workerFilter} onChange={(event) => setWorkerFilter(event.target.value as WorkerFilter)}><option value="all">{t("common.all")}</option><option value="active">{t("workflow.memberState.active")}</option><option value="away">{t("workflow.memberState.away")}</option></select></label>
      <label className="field-label"><span>{t("workflow.leader.roster.shiftFilter")}</span><select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value as ShiftFilter)}><option value="all">{t("common.all")}</option><option value="with-shift">{t("workflow.leader.roster.withShift")}</option><option value="without-shift">{t("workflow.leader.roster.withoutShift")}</option><option value="pending">{t("workflow.shiftStatus.pending")}</option><option value="disputed">{t("workflow.shiftStatus.disputed")}</option></select></label>
      <label className="checkbox-field"><input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} /><span>{t("workflow.leader.roster.attentionOnly")}</span></label>
    </div>
    <div className="panel-heading-side roster-selection-bar"><span className="panel-period">{t("workflow.leader.selected", { total: selected.length })}</span><button type="button" className="text-button" onClick={toggleVisible}>{t("workflow.leader.selectVisible")}</button></div>
    {visible.length === 0 ? <p className="muted-copy">{t("workflow.leader.roster.empty")}</p> : <div className="leader-shared-list">{visible.map((entry) => {
      const membership = memberships.find((item) => item.id === entry.leaderMembershipId);
      const permissions = membership ? getLeaderAccessPermissions(membership) : undefined;
      const canRecord = Boolean(permissions?.canRecordHours && getProductionWorkflowSettings(entry.factory).leaderCanRecordHours);
      const shift = entry.currentShift?.shift;
      const workflow = getProductionWorkflowSettings(entry.factory);
      const canReview = Boolean(permissions?.canReviewShifts && workflow.leaderMustReviewShifts && shift?.reviewState === "pending" && !(shift.breakPolicySnapshot.required && shift.actualBreak.reviewState === "pending"));
      const canConfirm = Boolean(permissions?.canConfirmShifts && workflow.workerMustConfirmShifts && shift?.workerConfirmation === "pending");
      const shiftDescription = shift ? `${shift.localStartDate} · ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(shift.startAt))}–${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(shift.endAt))}` : t("workflow.leader.roster.noShift");
      return <article className="leader-shared-row" key={entry.key}>
        <input aria-label={entry.worker.name} type="checkbox" checked={selected.includes(entry.key)} onChange={() => toggle(entry.key)} disabled={!canRecord} />
        <div className="leader-shared-worker"><strong>{entry.worker.name}</strong><small>{entry.organizationName} · {entry.factory.name}</small></div>
        <span>{entry.groupName ?? t("workflow.leader.roster.noGroup")}</span>
        {!isInternalAgencyFactory(workspace, entry.factory.id) && <label className="checkbox-field"><input type="checkbox" disabled={!permissions?.canManageGroups} checked={getWorkerAccess({ ...workspace, organization: workspace.organizations.find((org) => org.id === entry.organizationId)! }, entry.worker.id, entry.factory.id) === "self"} onChange={(event) => { const saved = setLeaderWorkerInputAccess(entry.leaderMembershipId, entry.worker.id, event.target.checked ? "self" : "leader"); showToast(t(saved ? "workflow.production.permissionSaved" : "workflow.errors.permission"), saved ? "success" : "error"); }} /><span>{t("payroll.selfEntry")}</span></label>}
        <span>{shiftDescription}</span>
        <span className={`status-pill status-pill--${shift?.workerConfirmation ?? "not-required"}`}>{shift ? t(`workflow.shiftStatus.${shift.workerConfirmation}`) : "—"}</span>
        <span className={entry.attention ? "roster-attention" : "muted-copy"}>{entry.attention ? t("workflow.leader.roster.attention") : t("workflow.memberState.active")}</span>
        {(canReview || canConfirm) && shift && <div className="leader-roster-actions">{canReview && <button type="button" className="button button--outline button--small" onClick={() => showToast(t(reviewShiftRecord(shift.id, "approve") ? "workflow.leader.roster.shiftReviewed" : "workflow.errors.permission"))}>{t("workflow.leader.roster.reviewShift")}</button>}{canConfirm && <button type="button" className="button button--outline button--small" onClick={() => showToast(t(confirmShiftForWorker(shift.id) ? "workflow.leader.roster.shiftConfirmedByLeader" : "workflow.errors.permission"))}>{t("workflow.leader.roster.confirmForWorker")}</button>}</div>}
      </article>;
    })}</div>}
    {eligibleEntries.length > 0 && <div className="leader-roster-batch"><div className="scope-controls"><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div><button type="button" className="button button--primary button--small" disabled={!eligibleEntries.length} onClick={recordSelectedShift}><ClipboardCheck size={15} />{t("workflow.leader.roster.recordHours", { total: eligibleEntries.length })}</button><small>{t("workflow.leader.roster.separateRecords")}</small></div>}
  </section>;
}
