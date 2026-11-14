import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useToast } from "../../../app/ToastProvider";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { cancelSchedule, createSchedule, getActiveBusinessEntity, getActiveMember, getProductionWorkers, getScheduleOccurrences, getWorkerProductionAssignment, recordScheduleOutcome, updateSchedule, useDemoWorkspace } from "../demo-store";
import type { DemoSchedule, DemoScheduleOutcome } from "../domain/demo-types";
import { todayLocalDate } from "../workflow-utils";
import { WorkerProfileTrigger } from "./WorkerProfile";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const outcomes: DemoScheduleOutcome[] = ["worked", "reported-absence", "unreported-absence", "approved-absence", "cancelled-or-changed"];

export function ScheduleCenter({ openRequest = 0 }: { openRequest?: number }) {
  const { t } = useTranslation();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const entity = member.role === "factory-admin" ? getActiveBusinessEntity(workspace) : undefined;
  const factories = workspace.factories.filter((factory) => member.role === "factory-admin"
    ? Boolean(entity && factory.worksiteId && workspace.worksites?.some((site) => site.id === factory.worksiteId && site.businessEntityId === entity.id)
      && (factory.organizationId === entity.organizationId ? factory.ownerWorkforce
        : (workspace.agencyWorksites ?? []).some((connection) => connection.businessEntityId === entity.id && connection.worksiteId === factory.worksiteId && connection.organizationId === factory.organizationId && connection.state === "active")))
    : factory.organizationId === member.organizationId && (member.role !== "agency" || !factory.worksiteId
      || !workspace.worksites?.some((site) => site.id === factory.worksiteId && site.businessEntityId)
      || (workspace.agencyWorksites ?? []).some((connection) => connection.organizationId === member.organizationId
        && connection.worksiteId === factory.worksiteId
        && connection.businessEntityId === workspace.worksites?.find((site) => site.id === factory.worksiteId)?.businessEntityId
        && connection.state === "active")));
  const initialFactory = member.factoryId && factories.some((factory) => factory.id === member.factoryId) ? member.factoryId : factories[0]?.id ?? "";
  const [factoryId, setFactoryId] = useState(member.role === "agency" ? "" : initialFactory);
  const [worksiteId, setWorksiteId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(todayLocalDate());
  const [endDate, setEndDate] = useState(() => {
    const value = new Date(); value.setDate(value.getDate() + 14);
    return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
  });
  const [startTime, setStartTime] = useState("06:00");
  const [endTime, setEndTime] = useState("14:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [message, setMessage] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [scheduleListOpen, setScheduleListOpen] = useState(true);
  const [scheduleSort, setScheduleSort] = useState<"end" | "start">("end");
  const [filterWorkerId, setFilterWorkerId] = useState("");
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [reviewInputs, setReviewInputs] = useState<Record<string, { workerId: string; date: string; outcome: DemoScheduleOutcome; note: string }>>({});
  const isWorker = member.role === "worker";
  const canPlanSchedule = member.role === "leader";
  const managedFactoryId = member.role === "agency" || member.role === "factory-admin" ? factoryId : member.factoryId ?? "";
  const agencyWorksites = [...new Map(factories.flatMap((factory) => {
    const site = workspace.worksites?.find((item) => item.id === factory.worksiteId);
    return site ? [[site.id, site] as const] : [];
  })).values()];
  const visibleProductionFactories = member.role === "agency"
    ? factories.filter((factory) => !worksiteId || factory.worksiteId === worksiteId)
    : factories;
  const selectedFactoryId = visibleProductionFactories.some((factory) => factory.id === factoryId) ? factoryId : "";
  const agencyFactoryIds = new Set(visibleProductionFactories.filter((factory) => !selectedFactoryId || factory.id === selectedFactoryId).map((factory) => factory.id));
  const groupOptions = workspace.groups.filter((group) => !group.archivedAt && (member.role === "agency"
    ? agencyFactoryIds.has(group.factoryId)
    : group.factoryId === managedFactoryId));
  const agencyWorkerOptions = member.role === "agency"
    ? workspace.members.filter((worker) => worker.role === "worker" && worker.organizationId === member.organizationId
      && [...agencyFactoryIds].some((factoryId) => getWorkerProductionAssignment(workspace, worker.id, factoryId, member.organizationId)))
    : [];
  const workerOptions = member.role === "agency" ? agencyWorkerOptions : getProductionWorkers(workspace, managedFactoryId);
  const availableWorkers = useMemo(
    () => getProductionWorkers(workspace, managedFactoryId)
      .filter((worker) => {
        if (member.role !== "leader" || member.canManageAllWorkers) return true;
        const assignment = getWorkerProductionAssignment(workspace, worker.id, managedFactoryId, workspace.factories.find((factory) => factory.id === managedFactoryId)?.organizationId);
        const groupLeaderId = assignment?.groupId ? workspace.groups.find((group) => group.id === assignment.groupId && group.factoryId === managedFactoryId && !group.archivedAt)?.leaderId : undefined;
        return (assignment?.leaderId ?? groupLeaderId) === member.id;
      })
      .filter((worker) => !groupId || getWorkerProductionAssignment(workspace, worker.id, managedFactoryId)?.groupId === groupId),
    [workspace, managedFactoryId, member.id, member.role, groupId],
  );
  const allowedFactoryIds = new Set(factories.map((factory) => factory.id));
  const schedules = workspace.schedules.filter((schedule) => isWorker
    ? schedule.organizationId === member.organizationId && schedule.workerIds.includes(member.id)
    : member.role === "agency"
      ? schedule.organizationId === member.organizationId && agencyFactoryIds.has(schedule.factoryId)
      : member.role === "factory-admin" ? allowedFactoryIds.has(schedule.factoryId) && schedule.factoryId === factoryId
        : schedule.organizationId === member.organizationId && schedule.factoryId === managedFactoryId)
    .filter((schedule) => (!filterFromDate || schedule.endDate >= filterFromDate) && (!filterToDate || schedule.startDate <= filterToDate)
      && (!filterWorkerId || visibleScheduleWorkerIds(schedule).includes(filterWorkerId))
      && (!groupId || visibleScheduleWorkerIds(schedule).some((workerId) => getWorkerProductionAssignment(workspace, workerId, schedule.factoryId, schedule.organizationId)?.groupId === groupId))
      && (member.role !== "agency" || visibleScheduleWorkerIds(schedule).length > 0))
    .sort((a, b) => scheduleSort === "end" ? a.endTime.localeCompare(b.endTime) || a.startDate.localeCompare(b.startDate) : a.startTime.localeCompare(b.startTime) || a.startDate.localeCompare(b.startDate));
  function visibleScheduleWorkerIds(schedule: DemoSchedule) {
    if (member.role !== "agency") return schedule.workerIds;
    return schedule.workerIds.filter((workerId) => workspace.members.some((worker) => worker.id === workerId
      && worker.role === "worker" && worker.organizationId === member.organizationId)
      && Boolean(getWorkerProductionAssignment(workspace, workerId, schedule.factoryId, member.organizationId)));
  }
  const focusId = searchParams.get("focus") === "schedule" ? searchParams.get("id") : "";
  useTargetHighlight(focusId ? `schedule-${focusId}` : "", Boolean(focusId));

  useEffect(() => {
    if (openRequest > 0 && canPlanSchedule) setPanelOpen(true);
  }, [openRequest, canPlanSchedule]);

  function toggleWorker(id: string) { setWorkerIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function toggleDay(day: number) { setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort()); }
  function submitSchedule(event: FormEvent) {
    event.preventDefault();
    const saved = createSchedule({ factoryId: managedFactoryId, workerIds, startDate, endDate, weekdays, startTime, endTime, plannedBreakStart: breakStart || undefined, plannedBreakEnd: breakEnd || undefined });
    setMessage(saved ? t("workflow.schedule.created") : t("workflow.errors.permission"));
    showToast(saved ? t("workflow.schedule.created") : t("workflow.errors.permission"), saved ? "success" : "error");
    if (saved) { setWorkerIds([]); setPanelOpen(false); setScheduleListOpen(true); }
  }
  function saveSchedule(event: FormEvent, schedule: DemoSchedule, form: HTMLFormElement) {
    event.preventDefault();
    const data = new FormData(form);
    const saved = updateSchedule(schedule.id, { startDate: String(data.get("startDate")), endDate: String(data.get("endDate")), startTime: String(data.get("startTime")), endTime: String(data.get("endTime")), weekdays: schedule.weekdays, plannedBreakStart: String(data.get("plannedBreakStart") || "") || undefined, plannedBreakEnd: String(data.get("plannedBreakEnd") || "") || undefined });
    setMessage(saved ? t("workflow.schedule.updated") : t("workflow.errors.permission"));
    showToast(saved ? t("workflow.schedule.updated") : t("workflow.errors.permission"), saved ? "success" : "error");
  }
  function saveOutcome(event: FormEvent, schedule: DemoSchedule) {
    event.preventDefault();
    const value = reviewInputs[schedule.id];
    const saved = value && recordScheduleOutcome(schedule.id, value.workerId, value.date, value.outcome, value.note);
    setMessage(saved ? t("workflow.schedule.reviewSaved") : t("workflow.errors.permission"));
    showToast(saved ? t("workflow.schedule.reviewSaved") : t("workflow.errors.permission"), saved ? "success" : "error");
  }

  const scheduleListContent = schedules.length === 0 ? <p className="muted-copy">{t("workflow.schedule.empty")}</p> : <div className="schedule-list">{schedules.map((schedule) => {
    const occurrences = getScheduleOccurrences(schedule, isWorker ? todayLocalDate() : schedule.startDate);
    const reviews = workspace.scheduleAttendanceReviews.filter((review) => review.scheduleId === schedule.id);
    const scheduleWorkers = visibleScheduleWorkerIds(schedule);
    const workerNames = scheduleWorkers.map((id) => workspace.members.find((person) => person.id === id)?.name ?? id);
    const groupNames = [...new Set(scheduleWorkers.map((id) => {
      const groupId = getWorkerProductionAssignment(workspace, id, schedule.factoryId, schedule.organizationId)?.groupId;
      return workspace.groups.find((group) => group.id === groupId && group.factoryId === schedule.factoryId && !group.archivedAt)?.name;
    }).filter((name): name is string => Boolean(name)))];
    const factory = workspace.factories.find((item) => item.id === schedule.factoryId && item.organizationId === schedule.organizationId);
    const worksite = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
    return <article className={"schedule-card" + (schedule.state === "cancelled" ? " is-cancelled" : "")} key={schedule.id} id={"schedule-" + schedule.id}>
      <div className="schedule-card-head"><div><strong>{worksite?.name ?? factory?.name ?? t("workflow.schedule.title")}</strong><span>{factory ? `${t("workflow.fields.production")}: ${factory.name} · ` : ""}{schedule.startDate} — {schedule.endDate} · {schedule.startTime}–{schedule.endTime}</span></div><span className={"status-pill status-pill--" + schedule.state}>{t("workflow.schedule.state." + schedule.state)}</span></div>
      <p>{schedule.weekdays.map((day) => t("workflow.schedule.days." + dayKeys[day])).join(", ")}{workerNames.length ? ` · ${t("workflow.schedule.worker")}: ${workerNames.join(", ")}` : ""}</p>
      {groupNames.length > 0 && <small>{t("workflow.groups.title")}: {groupNames.join(", ")}</small>}
      {schedule.plannedBreakStart && <small>{t("workflow.schedule.plannedBreak")}: {schedule.plannedBreakStart}{schedule.plannedBreakEnd ? "–" + schedule.plannedBreakEnd : ""}</small>}
      {isWorker && <><div className="schedule-occurrence-list">{occurrences.slice(0, 12).map((date) => <span key={date}>{date} · {schedule.startTime}–{schedule.endTime}</span>)}</div>{reviews.filter((review) => review.workerId === member.id).map((review) => <small key={review.id}>{review.localDate}: {t("workflow.schedule.outcomes." + review.outcome)}{review.note ? " · " + review.note : ""}</small>)}</>}
      {canPlanSchedule && schedule.state === "active" && <>
        <details className="schedule-edit-details"><summary>{t("workflow.schedule.edit")}</summary><form className="schedule-edit-form" onSubmit={(event) => saveSchedule(event, schedule, event.currentTarget)}><label className="field-label"><span>{t("workflow.schedule.startDate")}</span><input name="startDate" type="date" defaultValue={schedule.startDate} required /></label><label className="field-label"><span>{t("workflow.schedule.endDate")}</span><input name="endDate" type="date" defaultValue={schedule.endDate} required /></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input name="startTime" type="time" defaultValue={schedule.startTime} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input name="endTime" type="time" defaultValue={schedule.endTime} required /></label><label className="field-label"><span>{t("workflow.schedule.plannedBreakStart")}</span><input name="plannedBreakStart" type="time" defaultValue={schedule.plannedBreakStart ?? ""} /></label><label className="field-label"><span>{t("workflow.schedule.plannedBreakEnd")}</span><input name="plannedBreakEnd" type="time" defaultValue={schedule.plannedBreakEnd ?? ""} /></label><button className="button button--outline button--small" type="submit">{t("common.save")}</button></form></details>
        <button className="button button--quiet button--small" type="button" onClick={() => { const saved = cancelSchedule(schedule.id); const text = saved ? t("workflow.schedule.cancelled") : t("workflow.errors.permission"); setMessage(text); showToast(text, saved ? "success" : "error"); }}>{t("workflow.schedule.cancel")}</button>
      </>}
    </article>;
  })}</div>;

  return <div className="schedule-center-stack" id="schedule-center">
    {!isWorker && member.role !== "agency" && <section className="dashboard-panel schedule-center-panel">
      {canPlanSchedule
        ? <button type="button" className="agency-collapsible-heading schedule-plan-launch" onClick={() => setPanelOpen(true)}><span><span className="eyebrow"><CalendarDays size={14} /> {t("workflow.schedule.eyebrow")}</span><strong>{t("workflow.schedule.manage")}</strong></span><span className="panel-period">{schedules.filter((item) => item.state === "active").length}</span></button>
        : <div className="agency-collapsible-heading"><span><span className="eyebrow"><CalendarDays size={14} /> {t("workflow.schedule.eyebrow")}</span><strong>{t("workflow.schedule.savedSchedules")}</strong></span><span className="panel-period">{schedules.filter((item) => item.state === "active").length}</span></div>}
      {member.role === "factory-admin" && <label className="field-label schedule-factory-select"><span>{t("workflow.fields.production")}</span><select value={factoryId} onChange={(event) => { setFactoryId(event.target.value); setGroupId(""); setFilterWorkerId(""); }}>{factories.map((factory) => <option value={factory.id} key={factory.id}>{`${workspace.organizations.find((organization) => organization.id === factory.organizationId)?.name ?? entity?.name} · ${workspace.worksites?.find((site) => site.id === factory.worksiteId)?.name ?? factory.name}`}</option>)}</select></label>}
      <p className="muted-copy">{t("workflow.schedule.plannedDisclaimer")}</p>
      {message && <p className="sr-only">{message}</p>}
    </section>}
    {canPlanSchedule && panelOpen && <div className="modal-backdrop schedule-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPanelOpen(false); }}><aside className="dashboard-panel schedule-drawer" role="dialog" aria-modal="true" aria-labelledby="schedule-drawer-title">
      <div className="panel-heading"><div><span className="eyebrow"><CalendarDays size={14} /> {t("workflow.schedule.eyebrow")}</span><h2 id="schedule-drawer-title">{t("workflow.schedule.manage")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setPanelOpen(false)}><X size={16} /></button></div>
      <p className="muted-copy">{t("workflow.schedule.plannedDisclaimer")}</p>
      {workspace.groups.some((group) => group.factoryId === managedFactoryId && !group.archivedAt) && <label className="field-label schedule-factory-select"><span>{t("workflow.groups.title")}</span><select value={groupId} onChange={(event) => { setGroupId(event.target.value); setWorkerIds([]); }}><option value="">{t("workflow.schedule.allGroups")}</option>{workspace.groups.filter((group) => group.factoryId === managedFactoryId && !group.archivedAt).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <form className="workflow-form schedule-create-form" onSubmit={submitSchedule}>
        <fieldset className="schedule-worker-picks"><legend>{t("workflow.schedule.chooseWorkers")}</legend>{availableWorkers.length === 0 ? <p className="muted-copy">{t("workflow.schedule.noWorkers")}</p> : availableWorkers.map((worker) => <label key={worker.id}><input type="checkbox" checked={workerIds.includes(worker.id)} onChange={() => toggleWorker(worker.id)} /><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger></label>)}</fieldset>
        <label className="field-label"><span>{t("workflow.schedule.startDate")}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.schedule.endDate")}</span><input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label>
        <div className="field-label field-label--wide"><span>{t("workflow.schedule.weekdays")}</span><div className="schedule-weekdays">{dayKeys.map((key, day) => <label key={key}><input type="checkbox" checked={weekdays.includes(day)} onChange={() => toggleDay(day)} /><span>{t("workflow.schedule.days." + key)}</span></label>)}</div></div>
        <label className="field-label"><span>{t("workflow.schedule.plannedBreakStart")}</span><input type="time" value={breakStart} onChange={(event) => setBreakStart(event.target.value)} /></label>
        <label className="field-label"><span>{t("workflow.schedule.plannedBreakEnd")}</span><input type="time" value={breakEnd} onChange={(event) => setBreakEnd(event.target.value)} /></label>
        <div className="form-actions field-label--wide"><button type="submit" className="button button--primary button--small" disabled={!workerIds.length || !weekdays.length}><Send size={14} />{t("workflow.schedule.create")}</button></div>
      </form>
    </aside></div>}
    {member.role === "agency" && <section className="dashboard-panel schedule-center-panel schedule-agency-panel">
      <div className="panel-heading"><div><span className="eyebrow"><CalendarDays size={14} /> {t("workflow.schedule.eyebrow")}</span><h2>{t("workflow.schedule.title")}</h2></div><span className="panel-period">{schedules.filter((item) => item.state === "active").length}</span></div>
      <div className="schedule-readonly-filters">
        <label className="field-label"><span>{t("workflow.schedule.factory")}</span><select value={worksiteId} onChange={(event) => { setWorksiteId(event.target.value); setFactoryId(""); setGroupId(""); setFilterWorkerId(""); }}><option value="">{t("common.all")}</option>{agencyWorksites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
        <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={selectedFactoryId} onChange={(event) => { setFactoryId(event.target.value); setGroupId(""); setFilterWorkerId(""); }}><option value="">{t("common.all")}</option>{visibleProductionFactories.map((factory) => <option value={factory.id} key={factory.id}>{factory.name}</option>)}</select></label>
        {groupOptions.length > 0 && <label className="field-label"><span>{t("workflow.groups.title")}</span><select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">{t("workflow.schedule.allGroups")}</option>{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        <label className="field-label"><span>{t("workflow.schedule.worker")}</span><select value={filterWorkerId} onChange={(event) => setFilterWorkerId(event.target.value)}><option value="">{t("common.all")}</option>{workerOptions.map((worker) => <option value={worker.id} key={worker.id}>{worker.name}</option>)}</select></label>
        <label className="field-label"><span>{t("common.from")}</span><input type="date" value={filterFromDate} onChange={(event) => setFilterFromDate(event.target.value)} /></label>
        <label className="field-label"><span>{t("common.to")}</span><input type="date" value={filterToDate} min={filterFromDate || undefined} onChange={(event) => setFilterToDate(event.target.value)} /></label>
        <label className="field-label"><span>{t("workflow.schedule.sortByEndTime")}</span><select value={scheduleSort} onChange={(event) => setScheduleSort(event.target.value as typeof scheduleSort)}><option value="end">{t("workflow.fields.end")}</option><option value="start">{t("workflow.fields.start")}</option></select></label>
      </div>
      <p className="muted-copy">{t("workflow.schedule.plannedDisclaimer")}</p>
      {scheduleListContent}
    </section>}
    {member.role !== "agency" && <details className="dashboard-panel schedule-saved-panel" id="schedule-list" open={scheduleListOpen || Boolean(focusId)} onToggle={(event) => setScheduleListOpen(event.currentTarget.open)}>
      <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.schedule.eyebrow")}</span><strong>{isWorker ? t("workflow.schedule.mySchedule") : t("workflow.schedule.savedSchedules")}</strong></span><span className="panel-period">{schedules.filter((item) => item.state === "active").length}</span></summary>
      <p className="muted-copy">{t("workflow.schedule.plannedDisclaimer")}</p>
      <div className="team-filter-row"><label className="field-label"><span>{t("workflow.schedule.sortByEndTime")}</span><select value={scheduleSort} onChange={(event) => setScheduleSort(event.target.value as typeof scheduleSort)}><option value="end">{t("workflow.fields.end")}</option><option value="start">{t("workflow.fields.start")}</option></select></label></div>
      {scheduleListContent}
    </details>}
    {canPlanSchedule && <details className="dashboard-panel schedule-attendance-panel">
      <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.schedule.attendanceReview")}</span><strong>{t("workflow.schedule.attendanceReview")}</strong></span><span className="panel-period">{workspace.scheduleAttendanceReviews.length}</span></summary>
      <p className="muted-copy">{t("workflow.schedule.plannedDisclaimer")}</p>
      {schedules.filter((schedule) => schedule.state === "active").map((schedule) => {
        const occurrences = getScheduleOccurrences(schedule, schedule.startDate);
        const reviews = workspace.scheduleAttendanceReviews.filter((review) => review.scheduleId === schedule.id);
        const input = reviewInputs[schedule.id] ?? { workerId: schedule.workerIds[0] ?? "", date: occurrences[0] ?? schedule.startDate, outcome: "worked" as const, note: "" };
        return <form className="schedule-review-form" key={schedule.id} onSubmit={(event) => saveOutcome(event, schedule)}><strong>{workspace.factories.find((factory) => factory.id === schedule.factoryId)?.name} · {schedule.startTime}–{schedule.endTime}</strong><label className="field-label"><span>{t("workflow.schedule.worker")}</span><select value={input.workerId} onChange={(event) => setReviewInputs((current) => ({ ...current, [schedule.id]: { ...input, workerId: event.target.value } }))}>{schedule.workerIds.map((id) => <option value={id} key={id}>{workspace.members.find((person) => person.id === id)?.name ?? id}</option>)}</select></label><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={input.date} min={schedule.startDate} max={schedule.endDate} onChange={(event) => setReviewInputs((current) => ({ ...current, [schedule.id]: { ...input, date: event.target.value } }))} required /></label><label className="field-label"><span>{t("workflow.schedule.outcome")}</span><select value={input.outcome} onChange={(event) => setReviewInputs((current) => ({ ...current, [schedule.id]: { ...input, outcome: event.target.value as DemoScheduleOutcome } }))}>{outcomes.map((outcome) => <option value={outcome} key={outcome}>{t("workflow.schedule.outcomes." + outcome)}</option>)}</select></label><label className="field-label field-label--wide"><span>{t("workflow.schedule.note")}</span><textarea rows={2} value={input.note} onChange={(event) => setReviewInputs((current) => ({ ...current, [schedule.id]: { ...input, note: event.target.value } }))} /></label><button className="button button--outline button--small" type="submit">{t("workflow.schedule.saveOutcome")}</button>{reviews.map((review) => <small key={review.id}>{review.localDate}: {workspace.members.find((person) => person.id === review.workerId)?.name} — {t("workflow.schedule.outcomes." + review.outcome)}{review.note ? " · " + review.note : ""}</small>)}</form>;
      })}
    </details>}
  </div>;
}
