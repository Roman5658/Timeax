import { AbsenceClassification } from "../../workflows/components/AbsenceClassification";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CalendarDays, ClipboardCheck, Clock3, MessageCircleWarning, Pencil, Send, UsersRound, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDate, formatTime } from "../../../shared/formatters";
import type { DemoAbsenceDecision, DemoAbsenceReason, DemoShiftRecord } from "../../workflows/domain/demo-types";
import { cancelShift, correctDisputedShift, createLeaderShifts, decideAbsence, declineDispute, getActiveMember, getFactory, getLeaderAccessPermissions, getLeaderProductionMemberships, getLeaderProductionParticipants, getLeaderShiftCreateBlockReason, getProductionWorkflowSettings, getWorkerProductionAssignment, isValidShiftDraft, recordLeaderAbsence, requestAbsenceClarification, respondToShiftChangeRequest, reviewShiftRecord, setActiveMember, useDemoWorkspace, type ShiftDraft } from "../../workflows/demo-store";
import { formatDuration, shiftDraft, shiftHours, todayLocalDate } from "../../workflows/workflow-utils";
import { ShiftHistory } from "../../workflows/components/ShiftHistory";
import { RequiredBreakReview } from "../../workflows/components/RequiredBreakReview";
import { ShiftBreakFields } from "../../workflows/components/ShiftBreakFields";
import { MessageCenter } from "../../workflows/components/MessageCenter";
import { ScheduleCenter } from "../../workflows/components/ScheduleCenter";
import { GroupManager } from "../../workflows/components/GroupManager";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { LeaderProductionSettings } from "../../workflows/components/LeaderProductionSettings";
import { useToast } from "../../../app/ToastProvider";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { LeaderTeamPanel } from "../components/LeaderTeamPanel";

function newDraft(): ShiftDraft {
  return { localDate: todayLocalDate(), startTime: "06:00", endTime: "18:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" };
}

type LeaderSection = "overview" | "team" | "reviews" | "schedule" | "messages";

export function LeaderDashboardPage({ section = "overview" }: { section?: LeaderSection }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const leader = getActiveMember(workspace);
  const memberships = getLeaderProductionMemberships(workspace, leader.id);
  const factory = getFactory(workspace, leader.factoryId);
  const leaderPermissions = getLeaderAccessPermissions(leader);
  const participants = leader.factoryId ? getLeaderProductionParticipants(workspace, leader.id, leader.factoryId) : [];
  const activeParticipants = participants.filter((participant) => participant.accessState === "active");
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState("all");
  const [shiftSearch, setShiftSearch] = useState("");
  const [shiftPeriod, setShiftPeriod] = useState<"today" | "future" | "all" | "past">("all");
  const [shiftStatusFilter, setShiftStatusFilter] = useState("all");
  const [shiftFromDate, setShiftFromDate] = useState("");
  const [shiftToDate, setShiftToDate] = useState("");
  const [shiftSort, setShiftSort] = useState<"newest" | "oldest" | "worker">("newest");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [leaderQueueOpen, setLeaderQueueOpen] = useState("");
  const [shiftArchiveOpen, setShiftArchiveOpen] = useState(false);
  const assignmentSubmissionId = useRef<string | undefined>(undefined);
  const [assignmentType, setAssignmentType] = useState<"shift" | "absence">("shift");
  const [draft, setDraft] = useState<ShiftDraft>(newDraft);
  const [absenceReason, setAbsenceReason] = useState<DemoAbsenceReason | "unreported">("unreported");
  const [absenceNote, setAbsenceNote] = useState("");
  const [reviewStep, setReviewStep] = useState(false);
  const [editingDispute, setEditingDispute] = useState<string>();
  const [disputeDraft, setDisputeDraft] = useState<ShiftDraft>(newDraft);
  const [disputeResponse, setDisputeResponse] = useState("");
  const [declineResponse, setDeclineResponse] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [absenceDecisions, setAbsenceDecisions] = useState<Record<string, DemoAbsenceDecision>>({});
  const [cancellingShiftId, setCancellingShiftId] = useState<string>();
  const [cancellationReason, setCancellationReason] = useState("");
  const [message, setInlineMessage] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (!value) return;
    const errors = ["workflow.errors.chooseWorker", "workflow.errors.noteRequired", "workflow.errors.invalidShift", "workflow.errors.permission", "workflow.errors.reasonRequired", ...["wrong-role", "leader-membership", "factory-setting", "factory-archived", "leader-permission", "submission-disabled", "invalid-shift", "choose-worker", "worker-unavailable", "employment", "worker-assignment"].map((reason) => `workflow.leader.shiftCreateErrors.${reason}`)].map((key) => t(key));
    showToast(value, errors.includes(value) ? "error" : "success");
  };
  const [changeResponses, setChangeResponses] = useState<Record<string, string>>({});
  const workers = activeParticipants.map((participant) => participant.worker);
  const groups = workspace.groups.filter((group) => group.organizationId === workspace.organization.id && group.factoryId === leader.factoryId && !group.archivedAt && (!group.leaderId || group.leaderId === leader.id || leader.canManageAllWorkers));
  const workerGroupId = (workerId: string) => getWorkerProductionAssignment(workspace, workerId, leader.factoryId)?.groupId;
  const assignments = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.factoryId === leader.factoryId && workers.some((worker) => worker.id === record.shift.workerUid));
  const visibleAssignments = assignments.filter((record) => (shiftPeriod === "all" || shiftPeriod === "today" && record.shift.localStartDate === todayLocalDate() || shiftPeriod === "future" && record.shift.localStartDate > todayLocalDate() || shiftPeriod === "past" && record.shift.localStartDate < todayLocalDate())
    && (groupFilter === "all" || groupFilter === "none" && !workerGroupId(record.shift.workerUid) || workerGroupId(record.shift.workerUid) === groupFilter)
    && (shiftStatusFilter === "all" || !record.shift.deletedAt && record.shift.workerConfirmation === shiftStatusFilter)
    && (!shiftFromDate || record.shift.localStartDate >= shiftFromDate) && (!shiftToDate || record.shift.localStartDate <= shiftToDate)
    && (workspace.members.find((worker) => worker.id === record.shift.workerUid)?.name.toLowerCase().includes(shiftSearch.trim().toLowerCase()) ?? false))
    .sort((a, b) => shiftSort === "oldest" ? a.shift.startAt.localeCompare(b.shift.startAt) : shiftSort === "worker" ? (workspace.members.find((worker) => worker.id === a.shift.workerUid)?.name ?? "").localeCompare(workspace.members.find((worker) => worker.id === b.shift.workerUid)?.name ?? "") : b.shift.startAt.localeCompare(a.shift.startAt));
  const openDisputes = assignments.filter((record) => !record.shift.deletedAt && record.dispute?.state === "open");
  const pending = assignments.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "pending").length;
  const reportedAbsences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && absence.factoryId === leader.factoryId && workers.some((worker) => worker.id === absence.workerId)).sort((a, b) => b.localDate.localeCompare(a.localDate));
  const today = todayLocalDate();
  const daysWorked = new Set(assignments.filter((record) => !record.shift.deletedAt && record.shift.localStartDate === today).map((record) => record.shift.workerUid)).size;
  const incomingChangeRequests = (workspace.changeRequests ?? []).filter((request) => request.organizationId === workspace.organization.id && request.approverType === "leader" && request.approverId === leader.id && request.state === "open" && workspace.shifts.some((record) => record.shift.id === request.shiftId && record.shift.factoryId === leader.factoryId) && workers.some((worker) => worker.id === request.workerId));
  const focusId = searchParams.get("id") ?? "";
  const focusKind = searchParams.get("focus") ?? "";
  const activeSection = section === "overview" && (focusKind === "new-workers" ? true : Boolean(focusId || focusKind))
    ? focusKind === "new-workers" ? "team" : "reviews"
    : section;
  const orderedSelected = selectedWorkers.map((id) => workers.find((worker) => worker.id === id)).filter((worker): worker is NonNullable<typeof worker> => Boolean(worker));
  const duration = useMemo(() => shiftHours(draft.startTime, draft.endTime, draft.localDate, workspace.organization.timezone), [draft.startTime, draft.endTime, draft.localDate, workspace.organization.timezone]);
  const breakDuration = useMemo(() => {
    if (draft.breakStatus !== "taken") return 0;
    if (draft.breakStartTime && draft.breakEndTime) {
      const minute = (value: string) => { const [hour, minutes] = value.split(":").map(Number); return hour * 60 + minutes; };
      const difference = minute(draft.breakEndTime) - minute(draft.breakStartTime);
      return difference > 0 ? difference : difference + 24 * 60;
    }
    return Number(draft.breakDurationMinutes ?? 0);
  }, [draft.breakStatus, draft.breakStartTime, draft.breakEndTime, draft.breakDurationMinutes]);
  const paidDuration = Math.max(0, duration - (draft.breakStatus === "taken" && draft.breakTreatment === "unpaid" ? breakDuration : 0));

  useEffect(() => {
    setSelectedWorkers([]);
    setAssignmentOpen(false);
    setReviewStep(false);
  }, [leader.organizationId, leader.factoryId]);

  const focusTargetId = focusKind === "absence" ? `leader-absence-${focusId}` : focusKind === "request" ? `leader-request-${focusId}` : focusKind === "dispute" ? `leader-dispute-${focusId}` : focusKind === "shift" ? `leader-shift-${focusId}` : focusKind === "new-workers" ? `leader-worker-${leader.id}-${focusId}` : "";
  useTargetHighlight(focusTargetId, Boolean(focusTargetId && focusId));
  const pageTitle = activeSection === "overview" ? t("dashboard.leaderTitle")
    : activeSection === "team" ? t("nav.teams")
      : activeSection === "reviews" ? t("nav.reviews")
        : activeSection === "schedule" ? t("workflow.schedule.title")
          : t("workflow.messagesCenter.title");
  const pageAction = activeSection === "overview"
    ? <div className="leader-action-buttons"><Link className="button button--outline button--small" to="/leader/schedule"><CalendarDays size={15} />{t("workflow.schedule.planShifts")}</Link><Link className="button button--primary button--small" to="/leader/reviews"><ClipboardCheck size={15} />{t("workflow.leader.attendance")}</Link></div>
    : activeSection === "reviews"
      ? <div className="leader-action-buttons"><button className="button button--primary button--small" type="button" onClick={openAttendanceForm}><ClipboardCheck size={15} />{t("workflow.leader.attendance")}</button><button className="button button--quiet button--small" type="button" onClick={() => beginAssignment("absence")}><MessageCircleWarning size={15} />{t("workflow.leader.markAbsence")}</button></div>
      : undefined;

  function toggleWorker(workerId: string) {
    setSelectedWorkers((current) => current.includes(workerId) ? current.filter((id) => id !== workerId) : [...current, workerId]);
    setReviewStep(false);
    setMessage("");
  }

  function beginAssignment(type: "shift" | "absence") {
    assignmentSubmissionId.current = `leader-submit-${crypto.randomUUID()}`;
    setAssignmentType(type);
    setDraft(newDraft());
    setAbsenceNote("");
    setAbsenceReason("unreported");
    setReviewStep(false);
    setAssignmentOpen(true);
    setMessage("");
  }

  function openAttendanceForm() {
    const reason = !leader.factoryId || !factory ? "leader-membership"
      : factory.archivedAt ? "factory-archived"
        : !leaderPermissions.canRecordHours ? "leader-permission"
          : !getProductionWorkflowSettings(factory).leaderCanRecordHours ? "factory-setting"
            : factory.allowTimeDataSubmission === false ? "submission-disabled" : undefined;
    if (reason) { setMessage(t(`workflow.leader.shiftCreateErrors.${reason}`)); return; }
    beginAssignment("shift");
  }

  function finishAssignment(event: FormEvent) {
    event.preventDefault();
    if (selectedWorkers.length === 0) { setMessage(t("workflow.errors.chooseWorker")); return; }
    if (assignmentType === "absence" && (absenceReason === "unreported" || absenceReason === "other") && !absenceNote.trim()) { setMessage(t("workflow.errors.noteRequired")); return; }
    if (assignmentType === "shift" && !isValidShiftDraft({ ...draft, factoryId: leader.factoryId })) { setMessage(t("workflow.errors.invalidShift")); return; }
    setReviewStep(true);
  }

  function confirmAssignment() {
    let result = 0;
    if (assignmentType === "shift") result = createLeaderShifts(selectedWorkers, draft, assignmentSubmissionId.current);
    else result = selectedWorkers.filter((workerId) => recordLeaderAbsence(workerId, draft.localDate, absenceReason, absenceNote)).length;
    const blockReason = assignmentType === "shift" && !result ? getLeaderShiftCreateBlockReason(selectedWorkers, draft) : undefined;
    setMessage(result ? t(assignmentType === "shift" ? "workflow.messages.shiftsAssigned" : "workflow.messages.unreportedSaved", { total: result }) : blockReason ? t(`workflow.leader.shiftCreateErrors.${blockReason}`) : t("workflow.errors.permission"));
    if (result) {
      setAssignmentOpen(false);
      setReviewStep(false);
      setSelectedWorkers([]);
    }
  }

  function startCorrection(record: DemoShiftRecord) {
    setEditingDispute(record.shift.id);
    setDisputeDraft(shiftDraft(record));
    setDisputeResponse("");
    setDeclineResponse("");
  }

  function submitShiftCancellation(event: FormEvent, shiftId: string) {
    event.preventDefault();
    if (!window.confirm(t("workflow.shiftCancellation.confirm"))) return;
    const saved = cancelShift(shiftId, cancellationReason);
    setMessage(t(saved ? "workflow.shiftCancellation.saved" : "workflow.errors.reasonRequired"));
    if (saved) { setCancellingShiftId(undefined); setCancellationReason(""); }
  }

  return (
    <PortalShell role="leader">
      <PageHeading eyebrow={workspace.organization.name} title={pageTitle} description={activeSection === "overview" ? t("workflow.leader.lead") : undefined} action={pageAction} />

      {activeSection === "overview" && <>
      <section className="dashboard-panel leader-context-panel"><div><span className="eyebrow">{workspace.organization.name}</span><strong>{factory?.name ?? t("workflow.leader.eyebrow")}</strong><p className="muted-copy">{t("workflow.production.worksite")}: {workspace.worksites?.find((site) => site.id === factory?.worksiteId)?.name ?? factory?.name ?? "—"}</p></div>{memberships.length > 1 && <label className="field-label"><span>{t("workflow.leader.switchProduction")}</span><select aria-label={t("workflow.leader.switchProduction")} value={leader.id} onChange={(event) => setActiveMember(event.target.value)}>{memberships.map((membership) => { const organization = workspace.organizations.find((item) => item.id === membership.organizationId); const membershipFactory = workspace.factories.find((item) => item.id === membership.factoryId && item.organizationId === membership.organizationId); return <option value={membership.id} key={membership.id}>{organization?.name ?? membership.organizationId} · {membershipFactory?.name ?? membership.factoryId}</option>; })}</select></label>}</section>

      <div className="workflow-stat-grid workflow-stat-grid--four">
        <Link className="workflow-stat-card workflow-stat-link" to="/leader/team"><span className="stat-icon stat-icon--mint"><UsersRound size={18} /></span><span>{t("dashboard.statPeople")}</span><strong>{workers.length}</strong></Link>
        <Link className="workflow-stat-card workflow-stat-link" to="/leader/reviews"><span className="stat-icon stat-icon--blue"><ClipboardCheck size={18} /></span><span>{t("workflow.leader.waiting")}</span><strong>{pending}</strong></Link>
        <Link className="workflow-stat-card workflow-stat-link" to="/leader/reviews"><span className="stat-icon stat-icon--peach"><AlertCircle size={18} /></span><span>{t("workflow.leader.disputes")}</span><strong>{openDisputes.length}</strong></Link>
        <Link className="workflow-stat-card workflow-stat-link" to="/leader/reviews"><span className="stat-icon stat-icon--violet"><Clock3 size={18} /></span><span>{t("workflow.leader.onShiftToday")}</span><strong>{daysWorked}</strong></Link>
      </div>
      </>}

      {message && <p className="sr-only">{message}</p>}

      {activeSection === "reviews" && assignmentOpen && <div className="modal-backdrop attendance-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAssignmentOpen(false); setReviewStep(false); } }}><section className="dashboard-panel compact-modal workflow-form-panel leader-assignment-panel" role="dialog" aria-modal="true" aria-labelledby="leader-assignment-title">
          <div className="panel-heading"><div><span className="eyebrow">{t("workflow.leader.bulkEyebrow")}</span><h2 id="leader-assignment-title">{assignmentType === "shift" ? t("workflow.leader.attendance") : t("workflow.leader.absenceTitle")}</h2><p className="muted-copy">{t(assignmentType === "shift" ? "workflow.leader.attendanceHint" : "workflow.leader.absenceHint")}</p></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => { setAssignmentOpen(false); setReviewStep(false); }}><X size={16} /></button></div>
        {!reviewStep ? <>
          <div className="selected-worker-strip"><strong>{t("workflow.leader.selected", { total: selectedWorkers.length })}</strong>{orderedSelected.length > 0 && <div>{orderedSelected.map((worker) => <button key={worker.id} type="button" className="selected-worker-chip" onClick={() => toggleWorker(worker.id)}>{worker.name}<X size={13} /></button>)}</div>}</div>
          <form className="workflow-form" onSubmit={finishAssignment}>
            <fieldset className="attendance-worker-picker field-label--wide"><legend>{t("workflow.leader.teamList")}</legend>{workers.length === 0 ? <p className="muted-copy">{t("workflow.schedule.noWorkers")}</p> : workers.map((worker) => <label className="checkbox-field" key={worker.id}><input type="checkbox" checked={selectedWorkers.includes(worker.id)} onChange={() => toggleWorker(worker.id)} /><span>{worker.name}</span></label>)}</fieldset>
            <label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={draft.localDate} onChange={(event) => setDraft((current) => ({ ...current, localDate: event.target.value }))} required /></label>
            {assignmentType === "shift" ? <><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={draft.startTime} onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={draft.endTime} onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))} required /></label><ShiftBreakFields value={draft} onChange={(update) => setDraft((current) => ({ ...current, ...update(current) }))} /><label className="field-label field-label--wide"><span>{t("workflow.fields.comment")}</span><textarea value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} rows={2} /></label><div className="duration-preview field-label--wide"><span><small>{t("workflow.fields.gross")}</small><strong>{formatDuration(duration, t)}</strong></span><span><small>{t("workflow.fields.breakDuration")}</small><strong>{formatDuration(breakDuration, t)}</strong></span><span><small>{t("workflow.fields.paid")}</small><strong>{formatDuration(paidDuration, t)}</strong></span><span><small>{t("workflow.fields.confirmation")}</small><strong>{t("workflow.shiftStatus.pending")}</strong></span></div></> : <><label className="field-label"><span>{t("workflow.leader.absenceKind")}</span><select value={absenceReason} onChange={(event) => setAbsenceReason(event.target.value as DemoAbsenceReason | "unreported")}><option value="day-off">{t("workflow.absence.reasons.day-off")}</option><option value="vacation">{t("workflow.absence.reasons.vacation")}</option><option value="illness">{t("workflow.absence.reasons.illness")}</option><option value="other">{t("workflow.absence.reasons.other")}</option><option value="unreported">{t("workflow.absence.unreportedTitle")}</option></select></label><label className="field-label field-label--wide"><span>{t("workflow.fields.comment")}</span><textarea value={absenceNote} onChange={(event) => setAbsenceNote(event.target.value)} required={absenceReason === "other" || absenceReason === "unreported"} rows={3} placeholder={t("workflow.leader.unreportedPlaceholder")} /></label></>}
            <div className="form-actions field-label--wide"><button className="button button--primary" type="submit">{t("workflow.leader.reviewBeforeSend")}</button><button className="button button--quiet" type="button" onClick={() => setAssignmentOpen(false)}>{t("common.cancel")}</button></div>
          </form>
        </> : <div className="assignment-confirmation"><div className="assignment-summary-icon">{assignmentType === "shift" ? <CalendarDays size={20} /> : <MessageCircleWarning size={20} />}</div><h3>{t("workflow.leader.confirmTitle")}</h3><p>{assignmentType === "shift" ? t("workflow.leader.confirmShiftBody", { total: orderedSelected.length, date: draft.localDate, start: draft.startTime, end: draft.endTime, breakStart: draft.breakStatus !== "taken" ? t("workflow.breakReport.none") : t(draft.breakTreatment === "paid" ? "workflow.breakReport.paidChoice" : "workflow.breakReport.unpaidChoice"), breakEnd: draft.breakTreatment === "paid" ? 0 : breakDuration }) : t("workflow.leader.confirmAbsenceBody", { total: orderedSelected.length, date: draft.localDate })}</p>{assignmentType === "absence" && <p>{absenceReason === "unreported" ? t("workflow.absence.unreportedTitle") : t(`workflow.absence.reasons.${absenceReason}`)}</p>}<div className="confirmation-worker-list">{orderedSelected.map((worker) => <span key={worker.id}>{worker.name}<button type="button" aria-label={t("workflow.leader.removeWorker")} onClick={() => toggleWorker(worker.id)}><X size={12} /></button></span>)}</div>{assignmentType === "absence" && absenceNote && <blockquote>{absenceNote}</blockquote>}<div className="form-actions"><button className="button button--primary" type="button" disabled={selectedWorkers.length === 0} onClick={confirmAssignment}><Send size={15} />{t("workflow.leader.confirmSend")}</button><button className="button button--outline" type="button" onClick={() => setReviewStep(false)}>{t("workflow.leader.backToEdit")}</button></div></div>}
      </section></div>}

      
      {activeSection === "team" && leader.factoryId && <section className="dashboard-panel"><GroupManager factoryId={leader.factoryId} /></section>}
      {activeSection === "team" && leader.factoryId && <LeaderProductionSettings key={leader.factoryId} factoryId={leader.factoryId} />}
      {activeSection === "team" && leader.factoryId && <LeaderTeamPanel />}
      {activeSection === "reviews" && <>
      <details className="leader-service-queue" open={leaderQueueOpen === "pending" || focusKind === "pending"} onToggle={(event) => setLeaderQueueOpen(event.currentTarget.open ? "pending" : "")}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.leader.pendingTitle")}</span><strong>{t("workflow.leader.pendingTitle")}</strong></span><span className="panel-period">{pending}</span></summary><section className="dashboard-panel" id="leader-pending"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.leader.waiting")}</span><h2>{t("workflow.leader.pendingTitle")}</h2></div><span className="panel-period">{pending}</span></div>{pending === 0 ? <p className="muted-copy">{t("workflow.leader.nonePending")}</p> : <div className="factory-queue-list">{assignments.filter((record) => record.shift.workerConfirmation === "pending").map((record) => <article className="factory-queue-row" id={`leader-pending-${record.shift.id}`} key={record.shift.id}><span><WorkerProfileTrigger workerId={record.shift.workerUid} className="worker-profile-open">{workers.find((worker) => worker.id === record.shift.workerUid)?.name}</WorkerProfileTrigger><small>{formatDate(new Date(`${record.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))}</small></span><span className="status-pill status-pill--pending">{t("workflow.shiftStatus.pending")}</span></article>)}</div>}</section></details>
      <details className="dashboard-panel leader-all-shifts" id="leader-all-shifts" open={shiftArchiveOpen || focusKind === "shift" && assignments.some((record) => record.shift.id === focusId)} onToggle={(event) => setShiftArchiveOpen(event.currentTarget.open)}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("nav.shifts")}</span><strong>{t("workflow.leader.allShifts")}</strong></span><span className="panel-period">{visibleAssignments.length}</span></summary><div className="team-filter-row shift-archive-filters"><label className="field-label"><span>{t("workflow.leader.shiftPeriod.label")}</span><select value={shiftPeriod} onChange={(event) => setShiftPeriod(event.target.value as typeof shiftPeriod)}><option value="today">{t("workflow.leader.shiftPeriod.today")}</option><option value="future">{t("workflow.leader.shiftPeriod.future")}</option><option value="all">{t("workflow.leader.shiftPeriod.all")}</option><option value="past">{t("workflow.leader.shiftPeriod.past")}</option></select></label><label className="field-label"><span>{t("workflow.groups.title")}</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">{t("common.all")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label className="field-label"><span>{t("workflow.leader.searchWorkers")}</span><input value={shiftSearch} onChange={(event) => setShiftSearch(event.target.value)} /></label><label className="field-label"><span>{t("workflow.leader.statusFilter")}</span><select value={shiftStatusFilter} onChange={(event) => setShiftStatusFilter(event.target.value as typeof shiftStatusFilter)}><option value="all">{t("common.all")}</option><option value="pending">{t("workflow.shiftStatus.pending")}</option><option value="confirmed">{t("workflow.shiftStatus.confirmed")}</option><option value="disputed">{t("workflow.shiftStatus.disputed")}</option></select></label><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={shiftFromDate} onChange={(event) => setShiftFromDate(event.target.value)} /></label><label className="field-label"><span>{t("common.to")}</span><input type="date" value={shiftToDate} onChange={(event) => setShiftToDate(event.target.value)} /></label><label className="field-label"><span>{t("workflow.leader.sort")}</span><select value={shiftSort} onChange={(event) => setShiftSort(event.target.value as typeof shiftSort)}><option value="newest">{t("workflow.leader.newest")}</option><option value="oldest">{t("workflow.leader.oldest")}</option><option value="worker">{t("workflow.leader.sortByWorker")}</option></select></label></div>{visibleAssignments.length === 0 ? <p className="muted-copy">{t("workflow.worker.noShifts")}</p> : <div className="factory-queue-list">{visibleAssignments.map((record) => <article className="factory-queue-row leader-shift-archive-row" id={`leader-shift-${record.shift.id}`} key={record.shift.id}><details open={cancellingShiftId === record.shift.id || focusId === record.shift.id}><summary><span><WorkerProfileTrigger workerId={record.shift.workerUid} className="worker-profile-open">{workers.find((worker) => worker.id === record.shift.workerUid)?.name}</WorkerProfileTrigger><small>{formatDate(new Date(`${record.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))} · {formatDuration(record.shift.paidDurationMinutes, t)}</small></span><span className={`status-pill status-pill--${record.shift.deletedAt ? "cancelled" : record.shift.workerConfirmation}`}>{record.shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${record.shift.workerConfirmation}`)}</span></summary>{record.cancellationReason && <p className="policy-note">{t("workflow.shiftCancellation.reason")}: {record.cancellationReason}</p>}<ShiftHistory entries={record.history} /><RequiredBreakReview record={record} allowActions />{!record.shift.deletedAt && record.shift.reviewState === "pending" && factory && getProductionWorkflowSettings(factory).leaderMustReviewShifts && leaderPermissions.canReviewShifts && !(record.shift.breakPolicySnapshot.required && record.shift.actualBreak.reviewState === "pending") && <button className="button button--outline button--small" type="button" onClick={() => setMessage(t(reviewShiftRecord(record.shift.id, "approve") ? "workflow.production.shiftReviewed" : "workflow.errors.permission"))}>{t("workflow.production.reviewShift")}</button>}{!record.shift.deletedAt && cancellingShiftId === record.shift.id && <form className="workflow-form" onSubmit={(event) => submitShiftCancellation(event, record.shift.id)}><label className="field-label field-label--wide"><span>{t("workflow.shiftCancellation.reason")}</span><textarea rows={2} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} required /></label><div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit">{t("workflow.shiftCancellation.cancel")}</button><button className="button button--quiet button--small" type="button" onClick={() => setCancellingShiftId(undefined)}>{t("common.cancel")}</button></div></form>}</details>{!record.shift.deletedAt && <button className="button button--quiet button--small" type="button" onClick={() => { setCancellingShiftId(record.shift.id); setCancellationReason(""); }}>{t("workflow.shiftCancellation.cancel")}</button>}</article>)}</div>}</details>
      <div className="leader-content-grid">
        

        <details className="leader-service-queue" open={leaderQueueOpen === "absences" || focusKind === "absence"} onToggle={(event) => setLeaderQueueOpen(event.currentTarget.open ? "absences" : "")}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.absence.inbox")}</span><strong>{t("workflow.absence.inbox")}</strong></span><span className="panel-period">{reportedAbsences.filter((absence) => absence.state === "reported" || absence.state === "clarification-requested").length}</span></summary><section className="dashboard-panel leader-absence-panel" id="leader-absence-inbox"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.absence.eyebrow")}</span><h2>{t("workflow.absence.inbox")}</h2></div><span className="panel-period">{reportedAbsences.filter((absence) => absence.state === "reported" || absence.state === "clarification-requested").length}</span></div>{reportedAbsences.length === 0 ? <p className="muted-copy">{t("workflow.absence.none")}</p> : <div className="absence-inbox-list">{reportedAbsences.map((absence) => { const worker = workers.find((item) => item.id === absence.workerId); const group = groups.find((item) => item.id === absence.groupId); const note = reviewNotes[absence.id] ?? ""; const decision = absenceDecisions[absence.id] ?? "confirmed-no-hours"; const needsReview = absence.state === "reported" || absence.state === "clarification-requested"; return <article className="absence-inbox-card" id={`leader-absence-${absence.id}`} key={absence.id}><div className="absence-inbox-head"><WorkerProfileTrigger workerId={absence.workerId} className="worker-profile-open">{worker?.name}</WorkerProfileTrigger><span className={`status-pill status-pill--${absence.state}`}>{t(`workflow.absence.state.${absence.state}`)}</span></div><p className="absence-meta">{formatDate(new Date(`${absence.localDate}T12:00:00`))} · {group?.name ?? factory?.name ?? "—"} · {absence.reason ? t(`workflow.absence.reasons.${absence.reason}`) : t("workflow.absence.unreportedTitle")}</p>{absence.message && <blockquote>{absence.message}</blockquote>}{absence.clarificationRequest && <p className="absence-leader-note"><strong>{t("workflow.absence.clarificationRequested")}: </strong>{absence.clarificationRequest}</p>}{absence.clarificationReply && <blockquote>{absence.clarificationReply}</blockquote>}{absence.reportedAt && <small className="absence-timestamp">{t("workflow.absence.reportedAt", { date: formatDate(new Date(absence.reportedAt), { dateStyle: "medium", timeStyle: "short" }) })}</small>}{absence.leaderNote && <p className="absence-leader-note"><strong>{t("workflow.absence.leaderNote")}: </strong>{absence.leaderNote}</p>}{absence.agencyCategory && <p className="absence-leader-note"><strong>{t(`workflow.absence.agencyCategory.${absence.agencyCategory}`)}</strong>{absence.agencyNote ? ` · ${absence.agencyNote}` : ""}</p>}{needsReview && <div className="absence-review-action"><label className="field-label"><span>{t("workflow.absence.decision")}</span><select value={decision} onChange={(event) => setAbsenceDecisions((current) => ({ ...current, [absence.id]: event.target.value as DemoAbsenceDecision }))}><option value="confirmed-no-hours">{t("workflow.absence.decisions.confirmed-no-hours")}</option><option value="urlop-na-zadanie">{t("workflow.absence.decisions.urlop-na-zadanie")}</option><option value="unreported">{t("workflow.absence.decisions.unreported")}</option><option value="send-agency">{t("workflow.absence.decisions.send-agency")}</option></select></label>{decision === "urlop-na-zadanie" && <p className="muted-copy">{t("workflow.absence.urlopHint")}</p>}<label className="field-label"><span>{t(decision === "send-agency" || decision === "unreported" ? "workflow.absence.agencyNote" : "workflow.absence.leaderComment")}</span><textarea rows={2} value={note} onChange={(event) => setReviewNotes((current) => ({ ...current, [absence.id]: event.target.value }))} required={decision === "send-agency" || decision === "unreported"} /></label><div className="form-actions"><button className="button button--outline button--small" type="button" onClick={() => { const saved = decideAbsence(absence.id, decision, note); setMessage(t(saved ? "workflow.absence.decisionSaved" : "workflow.errors.permission")); }}>{t("workflow.absence.applyDecision")}</button><button className="button button--quiet button--small" type="button" disabled={!note.trim()} onClick={() => { const saved = requestAbsenceClarification(absence.id, note); setMessage(t(saved ? "workflow.absence.clarificationRequested" : "workflow.errors.permission")); }}>{t("workflow.absence.requestClarification")}</button></div></div>}{!["cancelled", "rejected"].includes(absence.state) && <AbsenceClassification absenceId={absence.id} />}{absence.history.length > 1 && <details className="absence-history-details"><summary>{t("workflow.history.open")}</summary>{absence.history.map((event) => <p key={event.id}>{event.actorName} · {t(`workflow.absence.historyAction.${event.action}`)} · {formatDate(new Date(event.occurredAt), { dateStyle: "medium", timeStyle: "short" })}{event.note ? ` · ${event.note}` : ""}</p>)}</details>}</article>; })}</div>}</section></details>
      </div>

      <details className="leader-service-queue" open={leaderQueueOpen === "disputes" || focusKind === "dispute"} onToggle={(event) => setLeaderQueueOpen(event.currentTarget.open ? "disputes" : "")}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.dispute.queue")}</span><strong>{t("workflow.dispute.queue")}</strong></span><span className="panel-period">{openDisputes.length}</span></summary><section className="dashboard-panel dispute-queue-panel" id="leader-disputes"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.dispute.eyebrow")}</span><h2>{t("workflow.dispute.queue")}</h2></div><span className="panel-period">{openDisputes.length}</span></div>{openDisputes.length === 0 ? <p className="muted-copy">{t("workflow.dispute.none")}</p> : <div className="dispute-list">{openDisputes.map((record) => { const worker = workers.find((item) => item.id === record.shift.workerUid); const isEditing = editingDispute === record.shift.id; return <article className="dispute-card" id={`leader-dispute-${record.shift.id}`} key={record.shift.id}><div className="dispute-card-top"><div><WorkerProfileTrigger workerId={record.shift.workerUid} className="worker-profile-open">{worker?.name}</WorkerProfileTrigger><span>{formatDate(new Date(`${record.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))}</span></div><span className="status-pill status-pill--disputed">{t("workflow.shiftStatus.disputed")}</span></div><blockquote>{record.dispute?.reason === "seed-time-question" ? t("workflow.dispute.seedReason") : record.dispute?.reason}</blockquote><details className="dispute-history-details"><summary>{t("workflow.history.open")}</summary><ShiftHistory entries={record.history} /></details>{!isEditing ? <button className="button button--outline button--small" type="button" onClick={() => startCorrection(record)}><Pencil size={14} />{t("workflow.dispute.review")}</button> : <div className="dispute-resolution"><form className="workflow-form" onSubmit={(event) => { event.preventDefault(); if (correctDisputedShift(record.shift.id, disputeDraft, disputeResponse)) { setEditingDispute(undefined); setMessage(t("workflow.messages.shiftCorrected")); } else setMessage(t("workflow.errors.permission")); }}><h3>{t("workflow.dispute.correctTitle")}</h3><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={disputeDraft.localDate} onChange={(event) => setDisputeDraft((current) => ({ ...current, localDate: event.target.value }))} required /></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={disputeDraft.startTime} onChange={(event) => setDisputeDraft((current) => ({ ...current, startTime: event.target.value }))} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={disputeDraft.endTime} onChange={(event) => setDisputeDraft((current) => ({ ...current, endTime: event.target.value }))} required /></label><ShiftBreakFields value={disputeDraft} onChange={(update) => setDisputeDraft((current) => ({ ...current, ...update(current) }))} /><label className="field-label field-label--wide"><span>{t("workflow.dispute.response")}</span><textarea value={disputeResponse} onChange={(event) => setDisputeResponse(event.target.value)} rows={2} /></label><div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit">{t("workflow.dispute.saveCorrection")}</button><button className="button button--quiet button--small" type="button" onClick={() => setEditingDispute(undefined)}>{t("common.cancel")}</button></div></form><form className="decline-dispute-form" onSubmit={(event) => { event.preventDefault(); if (declineDispute(record.shift.id, declineResponse)) { setEditingDispute(undefined); setMessage(t("workflow.messages.disputeDeclined")); } else setMessage(t("workflow.errors.reasonRequired")); }}><label className="field-label"><span>{t("workflow.dispute.declineExplanation")}</span><textarea value={declineResponse} onChange={(event) => setDeclineResponse(event.target.value)} rows={2} required /></label><button className="button button--outline button--small" type="submit">{t("workflow.dispute.declineKeep")}</button></form></div>}{!record.shift.deletedAt && <button className="button button--quiet button--small" type="button" onClick={() => { setCancellingShiftId(record.shift.id); setCancellationReason(""); }}>{t("workflow.shiftCancellation.cancel")}</button>}{cancellingShiftId === record.shift.id && <form className="workflow-form" onSubmit={(event) => submitShiftCancellation(event, record.shift.id)}><label className="field-label field-label--wide"><span>{t("workflow.shiftCancellation.reason")}</span><textarea rows={2} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} required /></label><div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit">{t("workflow.shiftCancellation.cancel")}</button><button className="button button--quiet button--small" type="button" onClick={() => setCancellingShiftId(undefined)}>{t("common.cancel")}</button></div></form>}</article>; })}</div>}</section></details>

      <details className="leader-service-queue" open={leaderQueueOpen === "requests" || focusKind === "request"} onToggle={(event) => setLeaderQueueOpen(event.currentTarget.open ? "requests" : "")}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.changeRequests.title")}</span><strong>{t("workflow.changeRequests.title")}</strong></span><span className="panel-period">{incomingChangeRequests.length}</span></summary><section className="dashboard-panel leader-change-requests" id="leader-change-requests"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.changeRequests.eyebrow")}</span><h2>{t("workflow.changeRequests.title")}</h2></div><span className="panel-period">{incomingChangeRequests.length}</span></div>{incomingChangeRequests.length === 0 ? <p className="muted-copy">{t("workflow.changeRequests.none")}</p> : <div className="change-request-list">{incomingChangeRequests.map((request) => { const record = assignments.find((item) => item.shift.id === request.shiftId); const reply = changeResponses[request.id] ?? ""; return <article className="change-request-card" id={`leader-request-${request.id}`} key={request.id}><WorkerProfileTrigger workerId={request.workerId} className="worker-profile-open">{workers.find((worker) => worker.id === request.workerId)?.name}</WorkerProfileTrigger><p>{t("workflow.changeRequests.requestedAt", { date: formatDate(new Date(request.requestedAt), { dateStyle: "medium", timeStyle: "short" }) })}</p><div className="change-values-grid"><div><strong>{t("workflow.changeRequests.original")}</strong><span>{request.originalValues.localDate} · {formatTime(new Date(request.originalValues.startAt))}–{formatTime(new Date(request.originalValues.endAt))}</span><small>{formatDuration(request.originalValues.paidDurationMinutes, t)}</small></div><div><strong>{t("workflow.changeRequests.proposed")}</strong><span>{request.proposedValues.localDate} · {formatTime(new Date(request.proposedValues.startAt))}–{formatTime(new Date(request.proposedValues.endAt))}</span><small>{formatDuration(request.proposedValues.paidDurationMinutes, t)}</small></div></div><blockquote>{request.reason}</blockquote>{record && <details><summary>{t("workflow.history.open")}</summary><ShiftHistory entries={record.history} /></details>}<label className="field-label"><span>{t("workflow.changeRequests.response")}</span><textarea rows={2} value={reply} onChange={(event) => setChangeResponses((current) => ({ ...current, [request.id]: event.target.value }))} /></label><div className="form-actions"><button type="button" className="button button--primary button--small" onClick={() => { const saved = respondToShiftChangeRequest(request.id, "approve", reply); setMessage(t(saved ? "workflow.messages.changeApproved" : "workflow.errors.permission")); }}>{t("workflow.changeRequests.approve")}</button><button type="button" className="button button--outline button--small" disabled={!reply.trim()} onClick={() => { const saved = respondToShiftChangeRequest(request.id, "reject", reply); setMessage(t(saved ? "workflow.messages.changeRejected" : "workflow.errors.permission")); }}>{t("workflow.changeRequests.reject")}</button></div></article>; })}</div>}</section></details>

      </>}
      {activeSection === "schedule" && <ScheduleCenter />}
      {activeSection === "messages" && <MessageCenter />}
      <div className="permission-note"><AlertCircle size={16} /><span>{t("workflow.demoSecurityNote")}</span></div>
    </PortalShell>
  );
}
