import { AbsenceClassification } from "../../workflows/components/AbsenceClassification";
import { useState, type FormEvent } from "react";
import { ArrowRight, Building2, FileSpreadsheet, UsersRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { cancelShift, editShiftAsAgency, getActiveMember, getAgencyAbsenceConflictingShifts, getFactory, getPayerSubscriptionSummary, getProductionWorkers, isAgencyVisibleAbsence, respondToShiftChangeRequest, reviewAgencyAbsence, setDemoSubscription, useDemoWorkspace, type ShiftDraft } from "../../workflows/demo-store";
import { formatDate, formatTime } from "../../../shared/formatters";
import { formatDuration, shiftDraft } from "../../workflows/workflow-utils";
import { ShiftHistory } from "../../workflows/components/ShiftHistory";
import { RequiredBreakReview } from "../../workflows/components/RequiredBreakReview";
import { ShiftBreakFields } from "../../workflows/components/ShiftBreakFields";
import { MessageCenter } from "../../workflows/components/MessageCenter";
import { ScheduleCenter } from "../../workflows/components/ScheduleCenter";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { RightDrawer } from "../../workflows/components/RightDrawer";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { useToast } from "../../../app/ToastProvider";

type AgencySection = "overview" | "operations" | "schedule" | "messages" | "subscription";

export function AgencyDashboardPage({ section = "overview" }: { section?: AgencySection }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const active = getActiveMember(workspace);
  const [message, setInlineMessage] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (value) showToast(value, value === t("workflow.errors.permission") ? "error" : "success");
  };
  const [editingShiftId, setEditingShiftId] = useState("");
  const [editDraft, setEditDraft] = useState<ShiftDraft>();
  const [editReason, setEditReason] = useState("");
  const [cancellingShiftId, setCancellingShiftId] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [reviewingAbsenceId, setReviewingAbsenceId] = useState("");
  const [changeResponses, setChangeResponses] = useState<Record<string, string>>({});
  const [absenceReviewNotes, setAbsenceReviewNotes] = useState<Record<string, string>>({});
  const [subscriptionPlanId, setSubscriptionPlanId] = useState(() => workspace.subscriptions?.find((item) => item.payerType === "agency" && item.payerId === workspace.organization.id)?.tierId
    ?? workspace.subscriptionTiers?.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? "");
  const workers = workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "worker");
  const factories = workspace.factories.filter((factory) => factory.organizationId === workspace.organization.id && !factory.archivedAt);
  const subscription = active.role === "agency" ? getPayerSubscriptionSummary("agency", active.organizationId, workspace) : undefined;
  const subscriptionTiers = workspace.subscriptionTiers?.slice().sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
  const selectedTier = subscriptionTiers.find((tier) => tier.id === subscriptionPlanId);
  const shifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id);
  const openChangeRequests = (workspace.changeRequests ?? []).filter((request) => request.organizationId === workspace.organization.id && request.approverType === "agency" && request.state === "open");
  const focusId = searchParams.get("id") ?? "";
  const focusKind = searchParams.get("focus") ?? "";
  const focusFactoryId = searchParams.get("factory") ?? "";
  const focusTargetId = focusFactoryId ? `factory-${focusFactoryId}` : focusKind === "request" ? `request-${focusId}` : focusKind === "shift" ? `agency-shift-${focusId}` : focusKind === "message" ? "" : focusId ? `agency-${focusId}` : "";
  useTargetHighlight(focusTargetId, Boolean(focusTargetId));
  const activeSection = section === "overview" && (Boolean(focusId) || Boolean(focusKind)) ? "operations" : section;
  const pageTitle = activeSection === "overview" ? t("dashboard.agencyTitle")
    : activeSection === "operations" ? t("workflow.agency.operationalEvents")
      : activeSection === "schedule" ? t("workflow.schedule.title")
        : activeSection === "messages" ? t("workflow.messagesCenter.title")
          : t("agencySubscription.title");
  const openDisputes = shifts.filter((record) => !record.shift.deletedAt && record.dispute?.state === "open");
  const absences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && isAgencyVisibleAbsence(workspace, absence))
    .sort((a, b) => b.localDate.localeCompare(a.localDate));

  function reportAction(saved: boolean, successMessage: string) {
    setMessage(saved ? successMessage : t("workflow.errors.permission"));
    return saved;
  }

  function startShiftEdit(recordId: string) {
    const record = shifts.find((item) => item.shift.id === recordId);
    if (!record) return;
    setCancellingShiftId("");
    setReviewingAbsenceId("");
    setEditingShiftId(recordId);
    setEditDraft(shiftDraft(record));
    setEditReason("");
  }

  function submitShiftEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingShiftId || !editDraft) return;
    const saved = editShiftAsAgency(editingShiftId, editDraft, editReason);
    setMessage(saved ? t("workflow.messages.agencyShiftEdited") : t("workflow.errors.permission"));
    if (saved) { setEditingShiftId(""); setEditDraft(undefined); setEditReason(""); }
  }

  function submitShiftCancellation(event: FormEvent) {
    event.preventDefault();
    if (!cancellingShiftId || !window.confirm(t("workflow.shiftCancellation.confirm"))) return;
    const saved = cancelShift(cancellingShiftId, cancellationReason);
    setMessage(t(saved ? "workflow.shiftCancellation.saved" : "workflow.errors.reasonRequired"));
    if (saved) { setCancellingShiftId(""); setCancellationReason(""); }
  }

  function reviewAbsence(absenceId: string, decision: "confirm" | "reject") {
    const saved = reviewAgencyAbsence(absenceId, decision, absenceReviewNotes[absenceId] ?? "");
    setMessage(t(saved ? "workflow.absence.decisionSaved" : "workflow.errors.permission"));
    if (saved) { setReviewingAbsenceId(""); setAbsenceReviewNotes((current) => ({ ...current, [absenceId]: "" })); }
  }

  function closeActionDrawer() {
    setReviewingAbsenceId("");
    setEditingShiftId("");
    setEditDraft(undefined);
    setEditReason("");
    setCancellingShiftId("");
    setCancellationReason("");
  }

  const reviewingAbsence = absences.find((absence) => absence.id === reviewingAbsenceId);
  const editingShift = shifts.find((record) => record.shift.id === editingShiftId);
  const cancellingShift = shifts.find((record) => record.shift.id === cancellingShiftId);
  const conflictsForReview = reviewingAbsence ? getAgencyAbsenceConflictingShifts(reviewingAbsence.id, workspace) : [];
  const editHasUnsavedChanges = Boolean(editDraft && editingShift && JSON.stringify(editDraft) !== JSON.stringify(shiftDraft(editingShift)) || editReason.trim());

  return (
    <PortalShell role="agency">
      <PageHeading eyebrow={workspace.organization.name} title={pageTitle} description={activeSection === "overview" ? t("workflow.agency.lead") : undefined} />
      {activeSection === "overview" && <div className="workflow-stat-grid">
        <Link className="workflow-stat-card workflow-stat-link" to="/agency/workers"><span className="stat-icon stat-icon--mint"><UsersRound size={18} /></span><span>{t("dashboard.statPeople")}</span><strong>{workers.length}</strong></Link>
        <Link className="workflow-stat-card workflow-stat-link" to="/agency/productions"><span className="stat-icon stat-icon--blue"><Building2 size={18} /></span><span>{t("dashboard.statConnections")}</span><strong>{factories.length}</strong></Link>
        <Link className="workflow-stat-card workflow-stat-link" to="/agency/reviews"><span className="stat-icon stat-icon--peach"><FileSpreadsheet size={18} /></span><span>{t("workflow.changeRequests.title")}</span><strong>{openChangeRequests.length}</strong></Link>
      </div>}

      {activeSection === "overview" && subscription && <Link to="/agency/subscription" className="dashboard-panel agency-subscription-preview" id="agency-subscription-preview">
        <div className="panel-heading"><div><span className="eyebrow">{t("agencySubscription.eyebrow")}</span><h2>{t("agencySubscription.title")}</h2></div><span className={`status-pill status-pill--${subscription.status === "test-active" ? "active" : "pending"}`}>{t(`agencySubscription.status.${subscription.status}`)}</span></div>
        <p className="muted-copy">{t("agencySubscription.workers")}: {subscription.usedWorkers}{subscription.status === "test-active" && subscription.availableWorkers !== null ? ` · ${t("agencySubscription.available")}: ${subscription.availableWorkers}` : ""}</p>
      </Link>}

      {subscription && activeSection === "subscription" && <section className="dashboard-panel" id="agency-subscription">
        <div className="panel-heading"><div><span className="eyebrow">{t("agencySubscription.eyebrow")}</span><h2>{t("agencySubscription.title")}</h2></div><span className={`status-pill status-pill--${subscription.status === "test-active" ? "active" : "pending"}`}>{t(`agencySubscription.status.${subscription.status}`)}</span></div>
        <p className="muted-copy">{t("agencySubscription.demoNotice")}</p>
        <div className="monthly-summary-grid">
          <div><span>{t("agencySubscription.workers")}</span><strong>{subscription.usedWorkers}</strong></div>
          {subscription.status === "test-active" && <>
            <div><span>{t("agencySubscription.plan")}</span><strong>{!subscription.tier || subscription.tier.maxWorkers === null ? t("agencySubscription.customTier") : subscription.tier.minWorkers <= 1 ? t("agencySubscription.upTo", { count: subscription.tier.maxWorkers }) : t("agencySubscription.range", { min: subscription.tier.minWorkers, max: subscription.tier.maxWorkers })}</strong></div>
            <div><span>{t("agencySubscription.available")}</span><strong>{subscription.availableWorkers === null ? t("agencySubscription.unlimited") : subscription.availableWorkers}</strong></div>
          </>}
        </div>
        <p className="muted-copy">{t("agencySubscription.payerRule")}</p>
        {subscription.status !== "test-active" ? <div className="workflow-form">
          <label className="field-label"><span>{t("agencySubscription.selectPlan")}</span><select value={subscriptionPlanId} onChange={(event) => setSubscriptionPlanId(event.target.value)}>{subscriptionTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.maxWorkers === null ? t("agencySubscription.customTier") : tier.minWorkers <= 1 ? t("agencySubscription.upTo", { count: tier.maxWorkers }) : t("agencySubscription.range", { min: tier.minWorkers, max: tier.maxWorkers })}</option>)}</select></label>
          <button className="button button--primary button--small" type="button" disabled={!selectedTier || subscription.usedWorkers > (selectedTier.maxWorkers ?? Number.POSITIVE_INFINITY)} onClick={() => { const saved = setDemoSubscription("agency", subscriptionPlanId, true); showToast(t(saved ? "agencySubscription.activated" : "agencySubscription.activationFailed"), saved ? "success" : "error"); }}>{t("agencySubscription.activate")}</button>
          {selectedTier && subscription.usedWorkers > (selectedTier.maxWorkers ?? Number.POSITIVE_INFINITY) && <p className="muted-copy field-label--wide">{t("agencySubscription.capacityReached")}</p>}
        </div> : <button className="button button--outline button--small" type="button" onClick={() => { const saved = setDemoSubscription("agency", subscription.tier?.id ?? "", false); showToast(t(saved ? "agencySubscription.deactivated" : "workflow.errors.permission"), saved ? "success" : "error"); }}>{t("agencySubscription.deactivate")}</button>}
      </section>}

      {message && <p className="sr-only">{message}</p>}      {activeSection === "overview" && <section className="dashboard-panel agency-production-links"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.productions")}</span><h2>{t("workflow.production.overview")}</h2></div><Link className="button button--outline button--small" to="/agency/productions">{t("workflow.production.details")}</Link></div><p className="muted-copy">{t("workflow.production.listLead")}</p><div className="factory-summary-list">{factories.slice(0, 3).map((factory) => <article className="factory-summary-row" id={`factory-${factory.id}`} key={factory.id}><span className="factory-summary-icon"><Building2 size={16} /></span><span><strong>{factory.name}</strong><small>{getProductionWorkers(workspace, factory.id).length} · {t("workflow.agency.workersLabel")}</small></span><div className="factory-summary-actions"><Link className="text-button" to={"/agency/productions/" + factory.id}>{t("workflow.production.details")}</Link><Link className="text-button" to={"/agency/productions/" + factory.id + "/settings"}>{t("workflow.production.settings")}</Link></div></article>)}</div></section>}

      {activeSection === "operations" && <>
      <details id="agency-change-requests-panel" className="dashboard-panel agency-change-requests-panel" open={focusId === "request" || openChangeRequests.some((request) => request.id === focusId)}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.changeRequests.eyebrow")}</span><strong>{t("workflow.changeRequests.title")}</strong></span><span className="panel-period">{openChangeRequests.length}</span></summary>{openChangeRequests.length === 0 ? <p className="muted-copy">{t("workflow.changeRequests.none")}</p> : <div className="change-request-list">{openChangeRequests.map((request) => { const worker = workers.find((member) => member.id === request.workerId); const shift = shifts.find((record) => record.shift.id === request.shiftId)?.shift; const response = changeResponses[request.id] ?? ""; return <article className="change-request-card" key={request.id} id={`request-${request.id}`}><div className="change-request-head">{worker && <WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger>}<span className="status-pill status-pill--pending">{t("workflow.changeRequests.open")}</span></div><p className="muted-copy">{t("workflow.changeRequests.requestedAt", { date: formatDate(new Date(request.requestedAt), { dateStyle: "medium", timeStyle: "short" }) })} · {shift?.factoryId ? getFactory(workspace, shift.factoryId)?.name : ""}</p><div className="change-values-grid"><div><strong>{t("workflow.changeRequests.original")}</strong><span>{request.originalValues.localDate} · {formatTime(new Date(request.originalValues.startAt))}–{formatTime(new Date(request.originalValues.endAt))}</span><small>{formatDuration(request.originalValues.paidDurationMinutes, t)}</small></div><div><strong>{t("workflow.changeRequests.proposed")}</strong><span>{request.proposedValues.localDate} · {formatTime(new Date(request.proposedValues.startAt))}–{formatTime(new Date(request.proposedValues.endAt))}</span><small>{formatDuration(request.proposedValues.paidDurationMinutes, t)}</small></div></div><blockquote>{request.reason}</blockquote><label className="field-label"><span>{t("workflow.changeRequests.response")}</span><textarea rows={2} value={response} onChange={(event) => setChangeResponses((current) => ({ ...current, [request.id]: event.target.value }))} /></label><div className="form-actions"><button type="button" className="button button--primary button--small" onClick={() => { reportAction(respondToShiftChangeRequest(request.id, "approve", response), t("workflow.messages.changeApproved")); }}>{t("workflow.changeRequests.approve")}</button><button type="button" className="button button--outline button--small" disabled={!response.trim()} onClick={() => { reportAction(respondToShiftChangeRequest(request.id, "reject", response), t("workflow.messages.changeRejected")); }}>{t("workflow.changeRequests.reject")}</button></div></article>; })}</div>}</details>

      <details className="dashboard-panel agency-shifts-panel" open={focusId === "shift" || shifts.some((record) => record.shift.id === focusId)}>
        <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("nav.shifts")}</span><strong>{t("workflow.agency.manageShifts")}</strong></span><span className="panel-period">{shifts.length}</span></summary>
        <p className="muted-copy">{t("workflow.agency.editShiftNotice")}</p>
        <div className="agency-shift-list">{shifts.slice().sort((a, b) => b.shift.startAt.localeCompare(a.shift.startAt)).map((record) => {
          const worker = workers.find((item) => item.id === record.shift.workerUid);
          const isEditing = editingShiftId === record.shift.id;
          const isCancelling = cancellingShiftId === record.shift.id;
          return <details className="agency-shift-row" key={record.shift.id} id={`agency-shift-${record.shift.id}`} open={focusId === record.shift.id || isEditing || isCancelling}>
            <summary><span>{worker && <WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger>}<small>{formatDate(new Date(`${record.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))} · {formatDuration(record.shift.paidDurationMinutes, t)}</small></span><span className={`status-pill status-pill--${record.shift.deletedAt ? "cancelled" : record.shift.workerConfirmation}`}>{record.shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${record.shift.workerConfirmation}`)}</span></summary>
            {record.shift.comment && <p className="shift-comment">{record.shift.comment}</p>}
            {record.cancellationReason && <p className="policy-note">{t("workflow.shiftCancellation.reason")}: {record.cancellationReason}</p>}
            <ShiftHistory entries={record.history} />
            <RequiredBreakReview record={record} allowActions />
            {!record.shift.deletedAt && <div className="form-actions">
              <button type="button" className="button button--outline button--small" onClick={() => startShiftEdit(record.shift.id)}>{t("workflow.agency.editShift")}</button>
              <button type="button" className="button button--quiet button--small" onClick={() => { setEditingShiftId(""); setEditDraft(undefined); setReviewingAbsenceId(""); setCancellingShiftId(record.shift.id); setCancellationReason(""); }}>{t("workflow.shiftCancellation.cancel")}</button>
            </div>}
          </details>;
        })}</div>
      </details>
      <details className="dashboard-panel agency-disputes-panel" open={focusKind === "dispute" || openDisputes.some((record) => record.shift.id === focusId)}><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.dispute.eyebrow")}</span><strong>{t("workflow.dispute.queue")}</strong></span><span className="panel-period">{openDisputes.length}</span></summary>{openDisputes.length === 0 ? <p className="muted-copy">{t("workflow.dispute.none")}</p> : openDisputes.map((record) => <article className="dispute-card" id={`agency-${record.shift.id}`} key={record.shift.id}><WorkerProfileTrigger workerId={record.shift.workerUid} className="worker-profile-open">{workers.find((worker) => worker.id === record.shift.workerUid)?.name}</WorkerProfileTrigger><p>{formatDate(new Date(`${record.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))}</p><blockquote>{record.dispute?.reason === "seed-time-question" ? t("workflow.dispute.seedReason") : record.dispute?.reason}</blockquote><ShiftHistory entries={record.history} /></article>)}</details>

      <details id="agency-absences-panel" className="dashboard-panel agency-absences-panel" open={focusKind === "absence" || absences.some((absence) => absence.id === focusId)}>
        <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.absence.eyebrow")}</span><strong>{t("workflow.absence.inbox")}</strong></span><span className="panel-period">{absences.filter((item) => item.state === "reported" || item.state === "clarification-requested").length}</span></summary>
        {absences.length === 0 ? <p className="muted-copy">{t("workflow.absence.none")}</p> : absences.map((absence) => {
          const officialCategory = absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention");
          const pendingReview = absence.state === "reported" || absence.state === "clarification-requested";
          return <article className="absence-inbox-card" id={"agency-" + absence.id} key={absence.id}>
            <div className="absence-inbox-head"><WorkerProfileTrigger workerId={absence.workerId} className="worker-profile-open">{workers.find((worker) => worker.id === absence.workerId)?.name}</WorkerProfileTrigger><span className={"status-pill status-pill--" + absence.state}>{t("workflow.absence.state." + absence.state)}</span></div>
            <p className="absence-meta">{formatDate(new Date(absence.localDate + "T12:00:00"))} · {getFactory(workspace, absence.factoryId)?.name} · {absence.reason ? t("workflow.absence.reasons." + absence.reason) : t("workflow.absence.unreportedTitle")}</p>
            {absence.message && <p>{absence.message}</p>}{absence.agencyCategory && <strong>{t("workflow.absence.agencyCategory." + officialCategory)}</strong>}{absence.agencyNote && <blockquote>{absence.agencyNote}</blockquote>}
            {pendingReview && <div className="absence-review-action">
              <button className="button button--outline button--small" type="button" onClick={() => { setEditingShiftId(""); setCancellingShiftId(""); setReviewingAbsenceId(absence.id); }}>{t("workflow.absence.review")}</button>
            </div>}
            {!["cancelled", "rejected"].includes(absence.state) && <AbsenceClassification absenceId={absence.id} />}{absence.history.length > 1 && <details className="absence-history-details"><summary>{t("workflow.history.open")}</summary>{absence.history.map((event) => <p key={event.id}>{event.actorName} · {t("workflow.absence.historyAction." + event.action)} · {formatDate(new Date(event.occurredAt), { dateStyle: "medium", timeStyle: "short" })}{event.note ? " · " + event.note : ""}</p>)}</details>}
          </article>;
        })}
      </details>
      {(reviewingAbsence || editingShift || cancellingShift) && <RightDrawer eyebrow={reviewingAbsence ? t("workflow.absence.eyebrow") : t("workflow.timekeeping.title")} title={reviewingAbsence ? `${t("workflow.absence.review")} · ${workers.find((worker) => worker.id === reviewingAbsence.workerId)?.name ?? ""}` : t(editingShift ? "workflow.agency.editShift" : "workflow.shiftCancellation.cancel")} titleId="agency-workflow-action-drawer-title" onClose={closeActionDrawer} hasUnsavedChanges={Boolean((reviewingAbsence && absenceReviewNotes[reviewingAbsence.id]?.trim()) || editHasUnsavedChanges || cancellationReason.trim())}>
        {reviewingAbsence && <>
          <p className="absence-meta">{formatDate(new Date(reviewingAbsence.localDate + "T12:00:00"))} · {getFactory(workspace, reviewingAbsence.factoryId)?.name} · {reviewingAbsence.reason ? t("workflow.absence.reasons." + reviewingAbsence.reason) : t("workflow.absence.unreportedTitle")}</p>
          {reviewingAbsence.message && <p>{reviewingAbsence.message}</p>}
          {conflictsForReview.length > 0 && <p className="notice-box notice-box--warm" role="alert">{t("workflow.absence.hoursConflict")}</p>}
          {conflictsForReview.map((record) => <p className="absence-meta" key={record.shift.id}><Link to={"/agency/reviews?focus=shift&id=" + record.shift.id + "#agency-shift-" + record.shift.id}>{t("workflow.absence.openTimeRecord")}</Link> · {formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))} · {formatDuration(record.shift.paidDurationMinutes, t)}</p>)}
          <label className="field-label"><span>{t("workflow.absence.agencyNote")}</span><textarea rows={3} value={absenceReviewNotes[reviewingAbsence.id] ?? ""} onChange={(event) => setAbsenceReviewNotes((current) => ({ ...current, [reviewingAbsence.id]: event.target.value }))} /></label>
          <div className="form-actions"><button className="button button--outline button--small" type="button" disabled={conflictsForReview.length > 0} onClick={() => reviewAbsence(reviewingAbsence.id, "confirm")}>{t("workflow.absence.confirm")}</button><button className="button button--quiet button--small" type="button" disabled={!(absenceReviewNotes[reviewingAbsence.id] ?? "").trim()} onClick={() => reviewAbsence(reviewingAbsence.id, "reject")}>{t("workflow.absence.reject")}</button></div>
          {reviewingAbsence.history.length > 0 && <details className="absence-history-details"><summary>{t("workflow.history.open")}</summary>{reviewingAbsence.history.map((event) => <p key={event.id}>{event.actorName} · {t("workflow.absence.historyAction." + event.action)} · {formatDate(new Date(event.occurredAt), { dateStyle: "medium", timeStyle: "short" })}{event.note ? " · " + event.note : ""}</p>)}</details>}
        </>}
        {editingShift && editDraft && <form className="workflow-form agency-shift-edit-form" onSubmit={submitShiftEdit}>
          <label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={editDraft.localDate} onChange={(event) => setEditDraft((current) => current && ({ ...current, localDate: event.target.value }))} required /></label>
          <label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={editDraft.startTime} onChange={(event) => setEditDraft((current) => current && ({ ...current, startTime: event.target.value }))} required /></label>
          <label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={editDraft.endTime} onChange={(event) => setEditDraft((current) => current && ({ ...current, endTime: event.target.value }))} required /></label>
          <ShiftBreakFields value={editDraft} onChange={(update) => setEditDraft((current) => current && ({ ...current, ...update(current) }))} />
          <label className="field-label"><span>{t("workflow.fields.comment")}</span><textarea rows={2} value={editDraft.comment} onChange={(event) => setEditDraft((current) => current && ({ ...current, comment: event.target.value }))} /></label>
          <label className="field-label"><span>{t("workflow.agency.editReason")}</span><textarea rows={3} value={editReason} onChange={(event) => setEditReason(event.target.value)} required /></label>
          <p className="policy-note">{t("workflow.agency.workerWillBeNotified")}</p>
          <div className="form-actions"><button className="button button--primary" type="submit">{t("common.save")}</button><button className="button button--quiet" type="button" onClick={closeActionDrawer}>{t("common.cancel")}</button></div>
        </form>}
        {cancellingShift && <form className="workflow-form agency-shift-edit-form" onSubmit={submitShiftCancellation}>
          <p className="muted-copy">{workers.find((worker) => worker.id === cancellingShift.shift.workerUid)?.name} · {formatDate(new Date(`${cancellingShift.shift.localStartDate}T12:00:00`))} · {formatTime(new Date(cancellingShift.shift.startAt))}–{formatTime(new Date(cancellingShift.shift.endAt))}</p>
          <label className="field-label"><span>{t("workflow.shiftCancellation.reason")}</span><textarea rows={3} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} required /></label>
          <p className="policy-note">{t("workflow.shiftCancellation.workerNotified")}</p>
          <div className="form-actions"><button className="button button--primary" type="submit">{t("workflow.shiftCancellation.cancel")}</button><button className="button button--quiet" type="button" onClick={closeActionDrawer}>{t("common.cancel")}</button></div>
        </form>}
      </RightDrawer>}
      </>}
      {activeSection === "overview" && <div className="form-actions agency-overview-actions"><Link className="button button--outline button--small" to="/agency/workers">{t("nav.workers")}</Link><Link className="button button--outline button--small" to="/agency/monthly-timesheets">{t("nav.monthlyTimesheets")}</Link><Link className="button button--dark button--small" to="/agency/exports">{t("dashboard.quickExports")} <ArrowRight size={16} /></Link></div>}
      {activeSection === "schedule" && <ScheduleCenter />}
      {activeSection === "messages" && <MessageCenter />}
      <div className="permission-note"><Building2 size={16} /><span>{t("workflow.agency.localDemo", { user: active.name })}</span></div>
    </PortalShell>
  );
}
