import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { AlertCircle, ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, ChevronUp, Clock3, Coffee, GripVertical, MessageCircleWarning, Moon, Pencil, Plus, ShieldCheck, Sun, Trash2, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDate, formatTime } from "../../../shared/formatters";
import type { DemoShiftRecord, DemoTemplate, DemoTemplateBreakType } from "../../workflows/domain/demo-types";
import { cancelOwnAbsenceReport, confirmShift, createWorkerShift, deleteTemplate, disputeShift, editOwnAbsenceReport, editWorkerShift, getActiveMember, getFactory, getProductionWorkflowSettings, getWorkerAccess, getWorkerAccountMemberships, getWorkerProductionAssignments, isValidShiftDraft, reorderTemplate, reportAbsence, reportShiftBreak, replyToAbsenceClarification, saveTemplate, submitShiftChangeRequest, useDemoWorkspace, type ShiftDraft } from "../../workflows/demo-store";
import { breakMinutes, formatDuration, shiftDraft, shiftHours, todayLocalDate } from "../../workflows/workflow-utils";
import { ShiftHistory } from "../../workflows/components/ShiftHistory";
import { RequiredBreakReview } from "../../workflows/components/RequiredBreakReview";
import { ShiftBreakFields } from "../../workflows/components/ShiftBreakFields";
import { MessageCenter } from "../../workflows/components/MessageCenter";
import { ScheduleCenter } from "../../workflows/components/ScheduleCenter";
import { WorkerWorkSummary } from "../../workflows/components/WorkerWorkSummary";
import { WorkerHistoryMonthPicker } from "../../workflows/components/WorkerHistoryMonthPicker";
import { WorkerTemplateEditor } from "../../workflows/components/WorkerTemplateEditor";
import { RightDrawer } from "../../workflows/components/RightDrawer";
import { buildWorkerHistory } from "../../workflows/worker-history";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { useToast } from "../../../app/ToastProvider";

const templateIcon = { sun: Sun, coffee: Coffee, moon: Moon, zap: Zap } as const;
type TemplateIconName = keyof typeof templateIcon;

function blankDraft(date = todayLocalDate()): ShiftDraft {
  return { localDate: date, startTime: "06:00", endTime: "14:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid", breakDurationMinutes: 0, breakStartTime: "", breakEndTime: "" };
}

function monthDays(value: Date): Array<Date | null> {
  const first = new Date(value.getFullYear(), value.getMonth(), 1);
  const count = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
  const mondayOffset = (first.getDay() + 6) % 7;
  return [...Array.from({ length: mondayOffset }, () => null), ...Array.from({ length: count }, (_, index) => new Date(value.getFullYear(), value.getMonth(), index + 1))];
}

function localDate(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

type WorkerSection = "overview" | "shifts" | "work" | "schedule" | "messages";

export function WorkerDashboardPage({ section = "overview" }: { section?: WorkerSection }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const productionAssignments = getWorkerProductionAssignments(workspace, member.id);
  const accountMemberships = useMemo(() => getWorkerAccountMemberships(workspace, member.id), [workspace, member.id]);
  const accountWorkerIds = useMemo(() => new Set(accountMemberships.map((item) => item.id)), [accountMemberships]);
  const employmentPeriods = workspace.employmentPeriods.filter((period) => period.accountUid === (member.accountUid ?? member.id)
    || accountMemberships.some((item) => item.organizationId === period.organizationId && item.id === period.workerId)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const activeEmployment = employmentPeriods.find((period) => period.organizationId === workspace.organization.id && period.workerId === member.id && period.state === "active");
  const latestEndedEmployment = employmentPeriods.find((period) => period.state === "ended");
  const [selectedFactoryId, setSelectedFactoryId] = useState(() => member.factoryId ?? productionAssignments[0]?.factoryId ?? "");
  const [absenceFactoryId, setAbsenceFactoryId] = useState(() => member.factoryId ?? productionAssignments[0]?.factoryId ?? "");
  const effectiveFactoryId = productionAssignments.some((assignment) => assignment.factoryId === selectedFactoryId) ? selectedFactoryId : productionAssignments[0]?.factoryId ?? "";
  const effectiveAbsenceFactoryId = productionAssignments.some((assignment) => assignment.factoryId === absenceFactoryId) ? absenceFactoryId : effectiveFactoryId;
  const factory = getFactory(workspace, effectiveFactoryId);
  const access = getWorkerAccess(workspace, member.id, effectiveFactoryId);
  const [month, setMonth] = useState(() => {
    const initialDate = searchParams.get("date");
    const date = initialDate ? new Date(`${initialDate}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => searchParams.get("date") ?? todayLocalDate());
  const [selectedHistoryMonth, setSelectedHistoryMonth] = useState(() => searchParams.get("month") ?? searchParams.get("date")?.slice(0, 7) ?? todayLocalDate().slice(0, 7));
  const [editingShiftId, setEditingShiftId] = useState<string>();
  const [breakReportShiftId, setBreakReportShiftId] = useState<string>();
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [shiftConflict, setShiftConflict] = useState<"duplicate" | "overlap">();
  const [isShiftSaving, setIsShiftSaving] = useState(false);
  const shiftSaveLock = useRef(false);
  const shiftSubmissionId = useRef<string | undefined>(undefined);
  const [draft, setDraft] = useState<ShiftDraft>(blankDraft);
  const [disputeId, setDisputeId] = useState<string>();
  const [disputeReason, setDisputeReason] = useState("");
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const absenceMessageRef = useRef<HTMLTextAreaElement>(null);
  const [absenceReplies, setAbsenceReplies] = useState<Record<string, string>>({});
  const [absenceDate, setAbsenceDate] = useState(todayLocalDate());
  const [absenceReason, setAbsenceReason] = useState<"illness" | "family" | "personal" | "other">("illness");
  const [absenceMessage, setAbsenceMessage] = useState("");
  const [editingAbsenceId, setEditingAbsenceId] = useState("");
  const [absenceDrafts, setAbsenceDrafts] = useState<Record<string, { localDate: string; reason: "illness" | "family" | "personal" | "other"; message: string }>>({});
  const [templateEditing, setTemplateEditing] = useState<DemoTemplate>();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateIconName, setTemplateIcon] = useState<TemplateIconName>("sun");
  const [templateStart, setTemplateStart] = useState("06:00");
  const [templateEnd, setTemplateEnd] = useState("14:00");
  const [templateBreakStart, setTemplateBreakStart] = useState("10:00");
  const [templateBreakEnd, setTemplateBreakEnd] = useState("10:20");
  const [templateEnabled, setTemplateEnabled] = useState(true);
  const [draggingTemplate, setDraggingTemplate] = useState<string>();
  const [message, setInlineMessage] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (!value) return;
    const errors = ["workflow.errors.invalidShift", "workflow.errors.permission", "workflow.errors.messageRequired", "workflow.errors.invalidTemplate", "workflow.errors.reasonRequired", "workflow.changeRequests.alreadyOpen", "workflow.changeRequests.conflict"].map((key) => t(key));
    showToast(value, errors.includes(value) ? "error" : "success");
  };
  const [calendarCollapsed, setCalendarCollapsed] = useState(false);
  const [templateBreakType, setTemplateBreakType] = useState<DemoTemplateBreakType>("none");
  const [templateBreakDuration, setTemplateBreakDuration] = useState(20);
  const [requestShiftId, setRequestShiftId] = useState<string>();
  const [requestDraft, setRequestDraft] = useState<ShiftDraft>(blankDraft);
  const [requestReason, setRequestReason] = useState("");
  const [requestApprover, setRequestApprover] = useState<"agency" | "leader">("agency");
  const [focusId, setFocusId] = useState("");
  const urlFocus = searchParams.get("focus");
  const urlFocusId = searchParams.get("id") ?? "";
  const focusTargetId = urlFocus === "absence" ? "worker-absence-form" : urlFocus === "absence-report" || urlFocus === "absence-clarification" ? `worker-absence-${urlFocusId}` : urlFocus === "request" ? `request-${urlFocusId}` : urlFocus === "shift" || urlFocus === "dispute" ? `shift-${urlFocusId}` : "";
  useTargetHighlight(focusTargetId, Boolean(focusTargetId));
  useTargetHighlight("worker-absence-form", absenceOpen);

  const shifts = useMemo(() => workspace.shifts.filter((entry) => accountWorkerIds.has(entry.shift.workerUid)
    && accountMemberships.some((item) => item.id === entry.shift.workerUid && item.organizationId === entry.organizationId)).slice().sort((a, b) => b.shift.startAt.localeCompare(a.shift.startAt)), [workspace.shifts, accountWorkerIds, accountMemberships]);
  const ownAbsences = useMemo(() => workspace.absences.filter((absence) => accountWorkerIds.has(absence.workerId)
    && accountMemberships.some((item) => item.id === absence.workerId && item.organizationId === absence.organizationId)).sort((a, b) => b.localDate.localeCompare(a.localDate)), [workspace.absences, accountWorkerIds, accountMemberships]);
  const workerSchedules = useMemo(() => workspace.schedules.filter((schedule) => schedule.workerIds.some((workerId) => accountMemberships.some((item) => item.id === workerId && item.organizationId === schedule.organizationId))), [workspace.schedules, accountMemberships]);
  const workerAttendanceReviews = useMemo(() => workspace.scheduleAttendanceReviews.filter((review) => accountMemberships.some((item) => item.id === review.workerId && item.organizationId === review.organizationId)), [workspace.scheduleAttendanceReviews, accountMemberships]);
  const historyMonths = useMemo(() => buildWorkerHistory({ shifts, absences: ownAbsences, schedules: workerSchedules, attendanceReviews: workerAttendanceReviews, today: todayLocalDate() }), [shifts, ownAbsences, workerSchedules, workerAttendanceReviews]);
  const activeHistoryMonth = historyMonths.find((item) => item.key === selectedHistoryMonth) ?? historyMonths[0];
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const monthShifts = shifts.filter((entry) => !entry.shift.deletedAt && entry.shift.localStartDate.startsWith(monthKey));
  const monthPending = monthShifts.filter((entry) => entry.shift.workerConfirmation === "pending").length;
  const monthDisputed = monthShifts.filter((entry) => entry.shift.workerConfirmation === "disputed").length;
  const paidMinutes = monthShifts.reduce((total, entry) => total + entry.shift.paidDurationMinutes, 0);
  const confirmedPaidMinutes = monthShifts.filter((entry) => entry.shift.workerConfirmation === "confirmed").reduce((total, entry) => total + entry.shift.paidDurationMinutes, 0);
  const templates = workspace.templates.filter((template) => template.organizationId === workspace.organization.id && template.workerId === member.id).slice().sort((a, b) => a.order - b.order);
  const changeRequests = (workspace.changeRequests ?? []).filter((request) => request.organizationId === workspace.organization.id && request.workerId === member.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const days = useMemo(() => monthDays(month), [month]);
  const dayHeaders = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const selectedDayShifts = shifts.filter((entry) => !entry.shift.deletedAt && entry.shift.localStartDate === selectedDate);
  const selectedDayAbsences = ownAbsences.filter((absence) => absence.localDate === selectedDate && absence.state !== "cancelled");
  const knownHistoryMonth = historyMonths.some((item) => item.key === selectedHistoryMonth);
  const visibleShifts = activeHistoryMonth?.days.flatMap((day) => day.shifts) ?? [];
  const monthGroups = visibleShifts.reduce<Record<string, DemoShiftRecord[]>>((groups, record) => {
    const key = record.shift.localStartDate.slice(0, 7);
    (groups[key] ??= []).push(record);
    return groups;
  }, {});

  useEffect(() => {
    const id = searchParams.get("id") ?? "";
    const focus = searchParams.get("focus");
    if (focus === "absence") setAbsenceOpen(true);
    if (!id) return;
    if (focus === "request") {
      const request = changeRequests.find((item) => item.id === id);
      if (request) {
        setFocusId(request.shiftId);
        setSelectedDate(request.originalValues.localDate);
        setSelectedHistoryMonth(request.originalValues.localDate.slice(0, 7));
        const targetMonth = new Date(`${request.originalValues.localDate}T12:00:00`);
        setMonth((current) => current.getFullYear() === targetMonth.getFullYear() && current.getMonth() === targetMonth.getMonth() ? current : targetMonth);
      }
      return;
    }
    if (focus === "shift" || focus === "dispute") {
      const record = shifts.find((item) => item.shift.id === id);
      if (record) {
        setFocusId(id);
        setSelectedDate(record.shift.localStartDate);
        setSelectedHistoryMonth(record.shift.localStartDate.slice(0, 7));
        const targetMonth = new Date(`${record.shift.localStartDate}T12:00:00`);
        setMonth((current) => current.getFullYear() === targetMonth.getFullYear() && current.getMonth() === targetMonth.getMonth() ? current : targetMonth);
      }
    }
  }, [searchParams, workspace.shifts, workspace.changeRequests]);

  useEffect(() => {
    if (historyMonths.length && !knownHistoryMonth) setSelectedHistoryMonth(historyMonths[0].key);
  }, [historyMonths, knownHistoryMonth]);

  useEffect(() => {
    if (!absenceOpen) return;
    requestAnimationFrame(() => {
      document.getElementById("worker-absence-form")?.scrollIntoView({ block: "center", behavior: "smooth" });
      absenceMessageRef.current?.focus({ preventScroll: true });
    });
  }, [absenceOpen]);

  function openNewShift(template?: DemoTemplate) {
    const next = blankDraft(selectedDate || todayLocalDate());
    next.factoryId = effectiveFactoryId;
    if (template) {
      next.startTime = template.startTime;
      next.endTime = template.endTime;
      next.breakStatus = "not-reported";
      next.breakTreatment = template.breakType === "paid" ? "paid" : "unpaid";
      next.breakDurationMinutes = template.breakDurationMinutes ?? (template.breakType === "none" ? 0 : 20);
      next.breakStartTime = "";
      next.breakEndTime = "";
      next.plannedBreakStart = template.breakType === "none" ? "" : template.breakStart ?? "";
      next.plannedBreakEnd = template.breakType === "none" ? "" : template.breakEnd ?? "";
      next.plannedBreakTreatment = template.breakType === "none" ? undefined : template.breakType;
      next.plannedBreakDurationMinutes = template.breakType === "none" ? 0 : template.breakDurationMinutes ?? 0;
    }
    setDraft(next);
    setShiftConflict(undefined);
    shiftSubmissionId.current = undefined;
    setEditingShiftId(undefined);
    setBreakReportShiftId(undefined);
    setShowShiftForm(true);
    setMessage("");
  }

  function openChangeRequest(record: DemoShiftRecord) {
    const next = shiftDraft(record);
    setSelectedFactoryId(record.shift.factoryId ?? effectiveFactoryId);
    setRequestDraft(next);
    setRequestReason("");
    const factoryForShift = getFactory(workspace, record.shift.factoryId);
    const settings = factoryForShift && getProductionWorkflowSettings(factoryForShift);
    const agencyCanReview = Boolean(settings?.agencyMustReviewShifts);
    setRequestApprover(agencyCanReview ? "agency" : "leader");
    setRequestShiftId(record.shift.id);
  }

  function submitChangeRequest(event: FormEvent) {
    event.preventDefault();
    if (!requestShiftId) return;
    const record = workspace.shifts.find((item) => item.shift.id === requestShiftId && item.organizationId === workspace.organization.id);
    if (!record || !isValidShiftDraft({ ...requestDraft, factoryId: record.shift.factoryId })) {
      setMessage(t("workflow.errors.invalidShift"));
      return;
    }
    const alreadyOpen = changeRequests.some((request) => request.shiftId === requestShiftId && request.state === "open");
    const success = submitShiftChangeRequest(requestShiftId, requestDraft, requestReason, requestApprover);
    setMessage(success ? t("workflow.messages.changeRequestSent") : t(alreadyOpen ? "workflow.changeRequests.alreadyOpen" : "workflow.changeRequests.conflict"));
    if (success) setRequestShiftId(undefined);
  }

  function openEditShift(record: DemoShiftRecord) {
    setSelectedFactoryId(record.shift.factoryId ?? effectiveFactoryId);
    setDraft(shiftDraft(record));
    setShiftConflict(undefined);
    shiftSubmissionId.current = undefined;
    setEditingShiftId(record.shift.id);
    setBreakReportShiftId(undefined);
    setShowShiftForm(true);
    setMessage("");
  }

  function openBreakReport(record: DemoShiftRecord) {
    const next = shiftDraft(record);
    setSelectedFactoryId(record.shift.factoryId ?? effectiveFactoryId);
    next.breakStatus = "not-reported";
    setDraft(next);
    setShiftConflict(undefined);
    shiftSubmissionId.current = undefined;
    setEditingShiftId(undefined);
    setBreakReportShiftId(record.shift.id);
    setShowShiftForm(true);
    setMessage("");
  }

  function updateShiftTime(field: "localDate" | "startTime" | "endTime" | "factoryId", value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setShiftConflict(undefined);
    shiftSubmissionId.current = undefined;
  }

  function closeShiftForm() {
    setShowShiftForm(false);
    setShiftConflict(undefined);
    shiftSubmissionId.current = undefined;
  }

  function persistShift(confirmation?: "overlap") {
    if (shiftSaveLock.current) return;
    const actualBreakDuration = draft.breakStartTime && draft.breakEndTime ? breakMinutes(draft.breakStartTime, draft.breakEndTime) : Number(draft.breakDurationMinutes ?? 0);
    if (draft.startTime === draft.endTime || (draft.breakStatus === "taken" && draft.breakTreatment !== "paid" && actualBreakDuration <= 0)) {
      setMessage(t("workflow.errors.invalidShift"));
      return;
    }
    shiftSaveLock.current = true;
    setIsShiftSaving(true);
    try {
      let success: boolean;
      if (breakReportShiftId) success = reportShiftBreak(breakReportShiftId, draft);
      else if (editingShiftId) success = editWorkerShift(editingShiftId, draft);
      else {
        const submissionId = shiftSubmissionId.current ?? (shiftSubmissionId.current = crypto.randomUUID());
        const result = createWorkerShift(draft, {
          submissionId,
          confirmOverlap: confirmation === "overlap",
        });
        if (result === "duplicate" || result === "overlap") {
          setShiftConflict(result);
          return;
        }
        success = result === "created";
      }
      setMessage(success ? t("workflow.messages.shiftSaved") : t("workflow.errors.permission"));
      if (success) {
        setShowShiftForm(false);
        setShiftConflict(undefined);
        shiftSubmissionId.current = undefined;
        setEditingShiftId(undefined);
        setBreakReportShiftId(undefined);
        setSelectedDate(draft.localDate);
      setSelectedHistoryMonth(draft.localDate.slice(0, 7));
      if (section === "shifts") navigate(`/worker/shifts?month=${encodeURIComponent(draft.localDate.slice(0, 7))}`, { replace: true });
      }
    } finally {
      shiftSaveLock.current = false;
      setIsShiftSaving(false);
    }
  }

  function submitShift(event: FormEvent) {
    event.preventDefault();
    persistShift();
  }

  function selectHistoryMonth(monthValue: string) {
    setSelectedHistoryMonth(monthValue);
    navigate(`/worker/shifts?month=${encodeURIComponent(monthValue)}`, { replace: true });
  }

  function submitAbsence(event: FormEvent) {
    event.preventDefault();
    const success = reportAbsence(absenceDate, absenceReason, absenceMessage, effectiveAbsenceFactoryId);
    setMessage(success ? t("workflow.messages.absenceSent") : t("workflow.errors.messageRequired"));
    if (success) { setAbsenceMessage(""); setAbsenceOpen(false); }
  }

  function submitAbsenceEdit(event: FormEvent, absenceId: string) {
    event.preventDefault();
    const draft = absenceDrafts[absenceId];
    if (!draft) return;
    const saved = editOwnAbsenceReport(absenceId, draft.localDate, draft.reason, draft.message);
    setMessage(t(saved ? "workflow.absence.edited" : "workflow.errors.permission"));
    if (saved) setEditingAbsenceId("");
  }

  function beginTemplateEdit(template?: DemoTemplate) {
    setTemplateEditing(template);
    setTemplateName(template?.name ?? "");
    setTemplateIcon(template?.icon ?? "sun");
    setTemplateStart(template?.startTime ?? "06:00");
    setTemplateEnd(template?.endTime ?? "14:00");
    setTemplateBreakStart(template?.breakStart ?? "10:00");
    setTemplateBreakEnd(template?.breakEnd ?? "10:20");
    setTemplateBreakType(template?.breakType ?? (template?.breakStart ? "unpaid" : "none"));
    setTemplateBreakDuration(template?.breakDurationMinutes ?? 20);
    setTemplateEnabled(template?.enabled ?? true);
    setTemplateOpen(true);
  }

  function submitTemplate(event: FormEvent) {
    event.preventDefault();
    const success = saveTemplate({ name: templateName, icon: templateIconName, startTime: templateStart, endTime: templateEnd, breakType: templateBreakType, breakDurationMinutes: templateBreakType === "none" ? 0 : templateBreakDuration, breakStart: templateBreakType === "none" ? "" : templateBreakStart, breakEnd: templateBreakType === "none" ? "" : templateBreakEnd, enabled: templateEnabled }, templateEditing?.id);
    setMessage(success ? t("workflow.messages.templateSaved") : t("workflow.errors.invalidTemplate"));
    if (success) setTemplateOpen(false);
  }

  function removeTemplate(templateId: string) {
    const deleted = deleteTemplate(templateId);
    setMessage(deleted ? t("workflow.messages.templateDeleted") : t("workflow.errors.permission"));
  }

  const formGross = shiftHours(draft.startTime, draft.endTime);
  const formBreak = draft.breakStatus === "taken" ? (draft.breakStartTime && draft.breakEndTime ? breakMinutes(draft.breakStartTime, draft.breakEndTime) : Number(draft.breakDurationMinutes ?? 0)) : 0;
  const formPaid = Math.max(0, formGross - (draft.breakStatus === "taken" && draft.breakTreatment === "unpaid" ? formBreak : 0));
  const requestFormGross = shiftHours(requestDraft.startTime, requestDraft.endTime);
  const requestFormBreak = requestDraft.breakStatus === "taken" ? (requestDraft.breakStartTime && requestDraft.breakEndTime ? breakMinutes(requestDraft.breakStartTime, requestDraft.breakEndTime) : Number(requestDraft.breakDurationMinutes ?? 0)) : 0;
  const requestFormPaid = Math.max(0, requestFormGross - (requestDraft.breakStatus === "taken" && requestDraft.breakTreatment === "unpaid" ? requestFormBreak : 0));
  const formValid = isValidShiftDraft({ ...draft, factoryId: effectiveFactoryId });
  const isBreakReportOnly = Boolean(breakReportShiftId);
  const canEnter = member.role === "worker" && access === "self" && factory?.allowTimeDataSubmission !== false;
  const sectionTitle = section === "overview" ? t("dashboard.workerTitle")
    : section === "work" ? t("nav.myWork")
      : t(`nav.${section}`);

  const overviewShiftEntry = section === "overview" && showShiftForm && <RightDrawer
    eyebrow={t("workflow.worker.quickEntry")}
    title={editingShiftId ? t("workflow.worker.editShift") : t("workflow.worker.newShift")}
    titleId="worker-overview-shift-title"
    onClose={closeShiftForm}
  >
    <form className="workflow-form worker-quick-entry-form" onSubmit={submitShift}>
      {productionAssignments.length > 1 && <label className="field-label field-label--wide"><span>{t("workflow.fields.production")}</span><select value={draft.factoryId ?? effectiveFactoryId} onChange={(event) => { setSelectedFactoryId(event.target.value); updateShiftTime("factoryId", event.target.value); }} required>{productionAssignments.map((assignment) => <option key={assignment.factoryId} value={assignment.factoryId}>{getFactory(workspace, assignment.factoryId)?.name ?? assignment.factoryId}</option>)}</select></label>}
      <label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={draft.localDate} onChange={(event) => updateShiftTime("localDate", event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={draft.startTime} onChange={(event) => updateShiftTime("startTime", event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={draft.endTime} onChange={(event) => updateShiftTime("endTime", event.target.value)} required /></label>
      <fieldset className="break-entry-fieldset field-label--wide" disabled={factory?.allowActualBreakReport === false}><legend>{t("workflow.breakReport.actual")}</legend><div className="workflow-form"><ShiftBreakFields value={draft} onChange={(update) => setDraft((current) => ({ ...current, ...update(current) }))} /></div></fieldset>
      {factory?.allowActualBreakReport === false && <p className="policy-note field-label--wide"><ShieldCheck size={15} />{t("workflow.breakReport.reportingDisabled")}</p>}
      <label className="field-label field-label--wide"><span>{t("workflow.fields.comment")}</span><textarea value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} rows={2} /></label>
      <div className="duration-preview field-label--wide"><span><small>{t("workflow.fields.gross")}</small><strong>{formatDuration(formGross, t)}</strong></span><span><small>{t("workflow.fields.breakDuration")}</small><strong>{draft.breakStatus === "taken" ? formatDuration(formBreak, t) : t("workflow.breakReport.none")}</strong></span><span><small>{t("workflow.fields.paid")}</small><strong>{formatDuration(formPaid, t)}</strong></span></div>
          {shiftConflict && <div className={`inline-notice shift-conflict-notice shift-conflict-notice--${shiftConflict} field-label--wide`} role="alert"><AlertCircle size={17} /><span>{t(`workflow.shiftConflicts.${shiftConflict}`)}</span><div className="form-actions">{shiftConflict === "overlap" && <button className="button button--primary button--small" type="button" disabled={isShiftSaving} onClick={() => persistShift("overlap")}>{t("workflow.shiftConflicts.confirmOverlap")}</button>}<button className="button button--quiet button--small" type="button" onClick={() => { setShiftConflict(undefined); shiftSubmissionId.current = undefined; }}>{t("common.cancel")}</button></div></div>}
      <div className="form-actions field-label--wide"><button className="button button--primary" type="submit" disabled={isShiftSaving || !formValid}>{t("workflow.worker.submitShift")}</button><button className="button button--quiet" type="button" onClick={closeShiftForm}>{t("common.cancel")}</button></div>
    </form>
  </RightDrawer>;

  const overviewAbsenceEntry = section === "overview" && absenceOpen && <RightDrawer
    eyebrow={t("workflow.absence.eyebrow")}
    title={t("workflow.absence.reportTitle")}
    titleId="worker-overview-absence-title"
    onClose={() => setAbsenceOpen(false)}
  >
    <div id="worker-absence-form"><p className="muted-copy">{t("workflow.absence.noShiftNote")}</p><form className="workflow-form" onSubmit={submitAbsence}>
      {productionAssignments.length > 1 && <label className="field-label field-label--wide"><span>{t("workflow.fields.production")}</span><select value={effectiveAbsenceFactoryId} onChange={(event) => setAbsenceFactoryId(event.target.value)} required>{productionAssignments.map((assignment) => <option key={assignment.factoryId} value={assignment.factoryId}>{getFactory(workspace, assignment.factoryId)?.name ?? assignment.factoryId}</option>)}</select></label>}
      <label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={absenceDate} onChange={(event) => setAbsenceDate(event.target.value)} required /></label>
      <label className="field-label"><span>{t("workflow.absence.reason")}</span><select value={absenceReason} onChange={(event) => setAbsenceReason(event.target.value as typeof absenceReason)}>{(["illness", "family", "personal", "other"] as const).map((reason) => <option key={reason} value={reason}>{t(`workflow.absence.reasons.${reason}`)}</option>)}</select></label>
      <label className="field-label field-label--wide"><span>{t("workflow.absence.message")}</span><textarea ref={absenceMessageRef} value={absenceMessage} onChange={(event) => setAbsenceMessage(event.target.value)} rows={3} /></label>
      <button className="button button--primary field-label--wide" type="submit">{t("workflow.absence.send")}</button>
    </form></div>
  </RightDrawer>;

  const overviewTemplateEditor = section === "overview" && <WorkerTemplateEditor
    open={templateOpen}
    editing={templateEditing}
    name={templateName} setName={setTemplateName}
    icon={templateIconName} setIcon={setTemplateIcon}
    start={templateStart} setStart={setTemplateStart}
    end={templateEnd} setEnd={setTemplateEnd}
    breakType={templateBreakType} setBreakType={setTemplateBreakType}
    breakDuration={templateBreakDuration} setBreakDuration={setTemplateBreakDuration}
    breakStart={templateBreakStart} setBreakStart={setTemplateBreakStart}
    breakEnd={templateBreakEnd} setBreakEnd={setTemplateBreakEnd}
    enabled={templateEnabled} setEnabled={setTemplateEnabled}
    onSubmit={submitTemplate}
    onClose={() => setTemplateOpen(false)}
  />;

  return (
    <PortalShell role="worker">
      <PageHeading eyebrow={factory?.name ?? workspace.organization.name} title={sectionTitle} description={section === "overview" ? t("workflow.workerLead") : undefined} />
      {section === "overview" && <p className="muted-copy worker-account-id">{t("workflow.employment.accountUid")}: {member.accountUid ?? member.id}</p>}
      {(section === "overview" || section === "shifts") && activeEmployment && factory && <div className="inline-notice employment-state-notice"><ShieldCheck size={16} /><span>{access === "self" ? t("workflow.employmentNotice.selfInput") : t("workflow.employmentNotice.leaderInput")}</span></div>}
      {(section === "overview" || section === "shifts") && !activeEmployment && latestEndedEmployment && <div className="inline-notice employment-state-notice"><ShieldCheck size={16} /><span>{t("workflow.employmentNotice.ended", { date: latestEndedEmployment.endDate ?? latestEndedEmployment.startDate })}</span></div>}
      {(section === "overview" || section === "shifts") && factory?.allowTimeDataSubmission === false && <div className="inline-notice employment-state-notice"><ShieldCheck size={16} /><span>{t("workflow.permission.timeDataDisabled")}</span></div>}
      {overviewShiftEntry}
      {overviewAbsenceEntry}
      {overviewTemplateEditor}

      {section === "overview" && <>
        <div className="workflow-stat-grid workflow-stat-grid--four">
          <Link to="/worker/work" className="workflow-stat-card workflow-stat-link"><span className="stat-icon stat-icon--mint"><Clock3 size={18} /></span><span>{t("dashboard.statHours")}</span><strong>{formatDuration(confirmedPaidMinutes, t)}</strong></Link>
          <Link to="/worker/shifts" className="workflow-stat-card workflow-stat-link"><span className="stat-icon stat-icon--blue"><CalendarDays size={18} /></span><span>{t("dashboard.statShifts")}</span><strong>{monthShifts.length}</strong></Link>
          <Link to="/worker/shifts" className="workflow-stat-card workflow-stat-link"><span className="stat-icon stat-icon--peach"><MessageCircleWarning size={18} /></span><span>{t("workflow.worker.pendingStatus")}</span><strong>{monthPending}</strong></Link>
          <Link to="/worker/shifts" className="workflow-stat-card workflow-stat-link"><span className="stat-icon stat-icon--peach"><AlertCircle size={18} /></span><span>{t("workflow.dispute.eyebrow")}</span><strong>{monthDisputed}</strong></Link>
        </div>
        <section className="dashboard-panel worker-calendar-panel">
          <div className="panel-heading"><div><span className="eyebrow">{t("workflow.calendar.title")}</span><h2>{formatDate(month, { month: "long", year: "numeric" })}</h2></div><div className="calendar-nav"><button type="button" className="text-button calendar-collapse-toggle" aria-label={t(calendarCollapsed ? "workflow.calendar.expand" : "workflow.calendar.collapse")} title={t(calendarCollapsed ? "workflow.calendar.expand" : "workflow.calendar.collapse")} onClick={() => setCalendarCollapsed((value) => !value)}><span className="calendar-collapse-label">{t(calendarCollapsed ? "workflow.calendar.expand" : "workflow.calendar.collapse")}</span><span className="calendar-collapse-icon" aria-hidden="true">{calendarCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span></button><button type="button" className="icon-button" aria-label={t("workflow.calendar.previous")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button><button type="button" className="icon-button" aria-label={t("workflow.calendar.next")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></div></div>
          {!calendarCollapsed && <><div className="worker-calendar" role="grid" aria-label={t("workflow.calendar.title")}>
            {dayHeaders.map((key) => <span className="calendar-weekday" key={key}>{t(`workflow.calendar.days.${key}`)}</span>)}
            {days.map((day, index) => {
              if (!day) return <span className="calendar-blank" key={`blank-${index}`} />;
              const date = localDate(day);
              const count = shifts.filter((entry) => !entry.shift.deletedAt && entry.shift.localStartDate === date).length;
              const hasAbsence = ownAbsences.some((absence) => absence.localDate === date && absence.state !== "cancelled");
              const isToday = date === todayLocalDate();
              const dayLabel = [formatDate(day), count > 0 ? t("workflow.calendar.shiftCount", { total: count }) : "", hasAbsence ? t("workflow.worker.reportedAbsence") : ""].filter(Boolean).join(", ");
              return <button type="button" className={`calendar-day${isToday ? " is-today" : ""}${selectedDate === date ? " is-selected" : ""}${count ? " has-work-record" : ""}${hasAbsence ? " has-reported-absence" : ""}`} key={date} aria-label={dayLabel} aria-pressed={selectedDate === date} onClick={() => setSelectedDate(date)}><span>{day.getDate()}</span>{count > 0 && <i aria-hidden="true">{count}</i>}{hasAbsence && <b className="calendar-day-marker calendar-day-marker--absence" aria-hidden="true" />}</button>;
            })}
          </div><div className="calendar-legend"><span><i />{t("workflow.calendar.legendShifts")}</span><span className="calendar-legend-absence"><i />{t("workflow.worker.reportedAbsence")}</span><span>{t("workflow.calendar.periodHours", { hours: formatDuration(paidMinutes, t) })}</span></div></>}
          <section className="worker-selected-day" aria-live="polite">
            <div className="worker-selected-day-heading"><div><span className="eyebrow">{t("workflow.worker.dayInfoTitle")}</span><h3>{formatDate(new Date(`${selectedDate}T12:00:00`))}</h3></div><div className="form-actions"><button className="button button--primary button--small" type="button" disabled={!canEnter} onClick={() => openNewShift()}><Plus size={15} />{t("workflow.worker.recordForDate")}</button><button className="button button--quiet button--small" type="button" onClick={() => { setAbsenceFactoryId(effectiveFactoryId); setAbsenceDate(selectedDate); setAbsenceOpen(true); }}><MessageCircleWarning size={15} />{t("workflow.absence.reportButton")}</button></div></div>
            {selectedDayShifts.length === 0 && selectedDayAbsences.length === 0 && <p className="muted-copy">{t("workflow.worker.dayInfoEmpty")}</p>}
            {selectedDayShifts.length > 0 && <div className="worker-selected-day-items"><strong>{t("workflow.worker.recordedShifts")}</strong>{selectedDayShifts.map((record) => <Link key={record.shift.id} to={`/worker/shifts?month=${encodeURIComponent(record.shift.localStartDate.slice(0, 7))}`}><span>{formatTime(new Date(record.shift.startAt))}–{formatTime(new Date(record.shift.endAt))}</span><span>{formatDuration(record.shift.paidDurationMinutes, t)}</span><span className={`status-pill status-pill--${record.shift.workerConfirmation}`}>{t(`workflow.shiftStatus.${record.shift.workerConfirmation}`)}</span></Link>)}</div>}
            {selectedDayAbsences.length > 0 && <div className="worker-selected-day-items"><strong>{t("workflow.worker.reportedAbsence")}</strong>{selectedDayAbsences.map((absence) => <span key={absence.id}>{t(`workflow.absence.state.${absence.state}`)} · {absence.reason ? t(`workflow.absence.reasons.${absence.reason}`) : t("workflow.worker.historyNoReason")}</span>)}</div>}
          </section>
        </section>
      </>}

      {section === "overview" && <div className="worker-overview-templates"><section className="dashboard-panel quick-template-panel">
          <div className="panel-heading"><div><span className="eyebrow">{t("workflow.templates.eyebrow")}</span><h2>{t("workflow.templates.title")}</h2></div>{canEnter && <button className="icon-button" type="button" aria-label={t("workflow.templates.add")} onClick={() => beginTemplateEdit()}><Plus size={17} /></button>}</div>
          {!canEnter && <p className="inline-notice"><ShieldCheck size={16} />{t("workflow.permission.selfEntryDisabled")}</p>}
          <div className="quick-template-list" onDragOver={(event) => event.preventDefault()}>
            {templates.map((template, index) => {
              const Icon = templateIcon[template.icon as TemplateIconName];
              return <div className={`quick-template-card${template.enabled ? "" : " is-disabled"}`} key={template.id} draggable={canEnter} onDragStart={() => setDraggingTemplate(template.id)} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); if (draggingTemplate) { const from = templates.findIndex((item) => item.id === draggingTemplate); const to = templates.findIndex((item) => item.id === template.id); const target = templates[Math.max(0, Math.min(templates.length - 1, from < to ? to + 1 : to - 1))]; if (target) reorderTemplate(draggingTemplate, target.id); } setDraggingTemplate(undefined); }}>
                <button type="button" className="template-apply" disabled={!canEnter || !template.enabled} onClick={() => openNewShift(template)}><span className="template-icon"><Icon size={17} /></span><span className="template-main"><strong>{template.name}</strong><small>{template.startTime}–{template.endTime} · {t(template.breakType === "paid" ? "workflow.breakReport.paidBreakTemplate" : template.breakType === "unpaid" ? "workflow.breakReport.unpaidBreakTemplate" : "workflow.breakReport.noBreakTemplate")}</small></span><span className="template-go">{t("workflow.templates.apply")}</span></button>
                {canEnter && <div className="template-tools"><span className="template-drag" title={t("workflow.templates.drag")}><GripVertical size={15} /></span><button type="button" aria-label={t("workflow.templates.moveUp")} disabled={index === 0} onClick={() => { const target = templates[index - 1]; if (target) reorderTemplate(template.id, target.id); }}><ArrowUp size={14} /></button><button type="button" aria-label={t("workflow.templates.moveDown")} disabled={index === templates.length - 1} onClick={() => { const target = templates[index + 1]; if (target) reorderTemplate(template.id, target.id); }}><ArrowDown size={14} /></button><button type="button" aria-label={t("workflow.templates.edit")} onClick={() => beginTemplateEdit(template)}><Pencil size={14} /></button><button type="button" aria-label={t("workflow.templates.delete")} onClick={() => removeTemplate(template.id)}><Trash2 size={14} /></button></div>}
              </div>;
            })}
            {templates.length === 0 && <p className="muted-copy">{t("workflow.templates.empty")}</p>}
          </div>
          {canEnter && <button className="button button--outline button--small template-create" type="button" onClick={() => beginTemplateEdit()}><Plus size={15} />{t("workflow.templates.add")}</button>}
        </section></div>}

      {section === "shifts" && <>
      {message && <p className="sr-only">{message}</p>}

      {absenceOpen && <section className="dashboard-panel workflow-form-panel" id="worker-absence-form"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.absence.eyebrow")}</span><h2>{t("workflow.absence.reportTitle")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setAbsenceOpen(false)}>×</button></div><p className="muted-copy">{t("workflow.absence.noShiftNote")}</p><form className="workflow-form" onSubmit={submitAbsence}>{productionAssignments.length > 1 && <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={effectiveAbsenceFactoryId} onChange={(event) => setAbsenceFactoryId(event.target.value)} required>{productionAssignments.map((assignment) => <option key={assignment.factoryId} value={assignment.factoryId}>{getFactory(workspace, assignment.factoryId)?.name ?? assignment.factoryId}</option>)}</select></label>}<label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={absenceDate} onChange={(event) => setAbsenceDate(event.target.value)} required /></label><label className="field-label"><span>{t("workflow.absence.reason")}</span><select value={absenceReason} onChange={(event) => setAbsenceReason(event.target.value as typeof absenceReason)}>{(["illness", "family", "personal", "other"] as const).map((reason) => <option key={reason} value={reason}>{t(`workflow.absence.reasons.${reason}`)}</option>)}</select></label><label className="field-label field-label--wide"><span>{t("workflow.absence.message")}</span><textarea ref={absenceMessageRef} value={absenceMessage} onChange={(event) => setAbsenceMessage(event.target.value)} rows={3} /></label><button className="button button--primary" type="submit">{t("workflow.absence.send")}</button></form></section>}

      {templateOpen && <div className="modal-backdrop template-form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateOpen(false); }}><section className="dashboard-panel compact-modal worker-template-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-template-title"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.templates.eyebrow")}</span><h2 id="worker-template-title">{templateEditing ? t("workflow.templates.editTitle") : t("workflow.templates.newTitle")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setTemplateOpen(false)}>×</button></div><form className="workflow-form" onSubmit={submitTemplate}><label className="field-label"><span>{t("workflow.templates.name")}</span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} required maxLength={40} /></label><label className="field-label"><span>{t("workflow.templates.icon")}</span><select value={templateIconName} onChange={(event) => setTemplateIcon(event.target.value as TemplateIconName)}>{(["sun", "coffee", "moon", "zap"] as const).map((icon) => <option key={icon} value={icon}>{t("workflow.templates.icons." + icon)}</option>)}</select></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={templateStart} onChange={(event) => setTemplateStart(event.target.value)} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={templateEnd} onChange={(event) => setTemplateEnd(event.target.value)} required /></label><fieldset className="template-break-options field-label--wide"><legend>{t("workflow.breakReport.templateType")}</legend>{(["none", "paid", "unpaid"] as const).map((breakType) => <label className="template-break-option" key={breakType}><input type="radio" name="template-break-type" value={breakType} checked={templateBreakType === breakType} onChange={() => setTemplateBreakType(breakType)} /><span><strong>{t(breakType === "none" ? "workflow.breakReport.noBreakTemplate" : breakType === "paid" ? "workflow.breakReport.paidBreakTemplate" : "workflow.breakReport.unpaidBreakTemplate")}</strong><small>{t(breakType === "none" ? "workflow.breakReport.templateNoneHelp" : breakType === "paid" ? "workflow.breakReport.templatePaidHelp" : "workflow.breakReport.templateUnpaidHelp")}</small></span></label>)}</fieldset>{templateBreakType !== "none" && <><label className="field-label"><span>{t("workflow.breakReport.durationMinutes")}</span><input type="number" min="0" max="240" value={templateBreakDuration} onChange={(event) => setTemplateBreakDuration(Number(event.target.value))} /></label><label className="field-label"><span>{t("workflow.fields.breakStart")}</span><input type="time" value={templateBreakStart} onChange={(event) => setTemplateBreakStart(event.target.value)} /></label><label className="field-label"><span>{t("workflow.fields.breakEnd")}</span><input type="time" value={templateBreakEnd} onChange={(event) => setTemplateBreakEnd(event.target.value)} /></label></>}<label className="checkbox-field field-label--wide"><input type="checkbox" checked={templateEnabled} onChange={(event) => setTemplateEnabled(event.target.checked)} /><span>{t("workflow.templates.enabled")}</span></label><div className="form-actions field-label--wide"><button className="button button--primary" type="submit">{t("common.save")}</button><button className="button button--quiet" type="button" onClick={() => setTemplateOpen(false)}>{t("common.cancel")}</button></div></form></section></div>}

      {showShiftForm && <section className="dashboard-panel workflow-form-panel" id="shift-form"><div className="panel-heading"><div><span className="eyebrow">{isBreakReportOnly ? t("workflow.breakReport.eyebrow") : t("workflow.worker.quickEntry")}</span><h2>{isBreakReportOnly ? t("workflow.breakReport.title") : editingShiftId ? t("workflow.worker.editShift") : t("workflow.worker.newShift")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={closeShiftForm}>×</button></div><form className="workflow-form" onSubmit={submitShift}>
          {!editingShiftId && !isBreakReportOnly && productionAssignments.length > 1 && <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={draft.factoryId ?? effectiveFactoryId} onChange={(event) => { setSelectedFactoryId(event.target.value); updateShiftTime("factoryId", event.target.value); }} required>{productionAssignments.map((assignment) => <option key={assignment.factoryId} value={assignment.factoryId}>{getFactory(workspace, assignment.factoryId)?.name ?? assignment.factoryId}</option>)}</select></label>}
          {!isBreakReportOnly && <><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={draft.localDate} onChange={(event) => updateShiftTime("localDate", event.target.value)} required /></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={draft.startTime} onChange={(event) => updateShiftTime("startTime", event.target.value)} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={draft.endTime} onChange={(event) => updateShiftTime("endTime", event.target.value)} required /></label></>}
          <fieldset className="break-entry-fieldset field-label--wide" disabled={factory?.allowActualBreakReport === false}><legend>{t("workflow.breakReport.actual")}</legend><div className="workflow-form"><ShiftBreakFields value={draft} onChange={(update) => setDraft((current) => ({ ...current, ...update(current) }))} /></div></fieldset>
          {(draft.plannedBreakTreatment || (draft.plannedBreakStart && draft.plannedBreakEnd)) && <p className="policy-note field-label--wide">{t("workflow.breakReport.templatePlan", { plan: draft.plannedBreakStart && draft.plannedBreakEnd ? `${draft.plannedBreakStart}–${draft.plannedBreakEnd}` : draft.plannedBreakDurationMinutes ? formatDuration(draft.plannedBreakDurationMinutes, t) : t(draft.plannedBreakTreatment === "paid" ? "workflow.agency.paidBreak" : "workflow.agency.unpaidBreak"), treatment: t(draft.plannedBreakTreatment === "paid" ? "workflow.agency.paidBreak" : "workflow.agency.unpaidBreak") })}</p>}
          {factory?.allowActualBreakReport === false && <p className="policy-note field-label--wide"><ShieldCheck size={15} />{t("workflow.breakReport.reportingDisabled")}</p>}
          {!isBreakReportOnly && <label className="field-label field-label--wide"><span>{t("workflow.fields.comment")}</span><textarea value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} rows={2} /></label>}
          {draft.breakStatus === "taken" && <p className="policy-note field-label--wide">{t("workflow.breakReport.durationMinutes")}: {formatDuration(formBreak, t)}</p>}{draft.breakStatus === "taken" && !formValid && <p className="inline-notice field-label--wide" role="alert">{t("workflow.errors.invalidShift")}</p>}<div className="duration-preview field-label--wide"><span><small>{t("workflow.fields.gross")}</small><strong>{formatDuration(formGross, t)}</strong></span><span><small>{t("workflow.fields.breakDuration")}</small><strong>{draft.breakStatus === "taken" ? formatDuration(formBreak, t) : t("workflow.breakReport.none")}</strong></span><span><small>{t("workflow.fields.paid")}</small><strong>{formatDuration(formPaid, t)}</strong></span></div>
          {factory?.requiredBreakMinutes && <div className="policy-note field-label--wide"><ShieldCheck size={15} />{t("workflow.breakReport.policy", { minutes: factory.requiredBreakMinutes })}</div>}
          {shiftConflict && <div className={`inline-notice shift-conflict-notice shift-conflict-notice--${shiftConflict} field-label--wide`} role="alert"><AlertCircle size={17} /><span>{t(`workflow.shiftConflicts.${shiftConflict}`)}</span><div className="form-actions">{shiftConflict === "overlap" && <button className="button button--primary button--small" type="button" disabled={isShiftSaving} onClick={() => persistShift("overlap")}>{t("workflow.shiftConflicts.confirmOverlap")}</button>}<button className="button button--quiet button--small" type="button" onClick={() => { setShiftConflict(undefined); shiftSubmissionId.current = undefined; }}>{t("common.cancel")}</button></div></div>}
          <div className="form-actions field-label--wide"><button className="button button--primary" type="submit" disabled={isShiftSaving || !formValid}>{editingShiftId ? t("common.save") : t("workflow.worker.submitShift")}</button><button className="button button--quiet" type="button" onClick={closeShiftForm}>{t("common.cancel")}</button></div>
        </form></section>}

      <div className="worker-history-layout">
      <WorkerHistoryMonthPicker months={historyMonths} selectedMonth={activeHistoryMonth?.key} onSelect={selectHistoryMonth} openOnMobile={!focusTargetId} />
      <section className="dashboard-panel worker-shifts-panel" id="worker-shifts">
        <div className="panel-heading"><div><span className="eyebrow">{t("nav.shifts")}</span><h2>{activeHistoryMonth ? formatDate(new Date(`${activeHistoryMonth.key}-01T12:00:00`), { month: "long", year: "numeric" }) : t("nav.shifts")}</h2></div>{canEnter && <button className="button button--primary button--small" type="button" onClick={() => openNewShift()}><Plus size={15} />{t("workflow.worker.newShift")}</button>}</div>
        {activeHistoryMonth && <div className="worker-history-period-stats worker-history-month-stats"><span>{t("workflow.timekeeping.shifts")}: <strong>{activeHistoryMonth.workedShiftCount}</strong></span><span>{t("workflow.fields.paid")}: <strong>{formatDuration(activeHistoryMonth.paidMinutes, t)}</strong></span><span>{t("workflow.worker.historyMissed")}: <strong>{activeHistoryMonth.missedDayCount}</strong></span><span>{t("workflow.worker.historyDayOff")}: <strong>{activeHistoryMonth.restDayCount}</strong></span></div>}
        {!canEnter && <div className="inline-notice"><ShieldCheck size={16} /><span>{t("workflow.permission.managerEntry", { factory: factory?.name ?? "" })}</span></div>}
        {!activeHistoryMonth && <p className="muted-copy">{t("workflow.worker.historyEmpty")}</p>}
        {activeHistoryMonth?.days.length === 0 && <p className="muted-copy">{t("workflow.worker.historyMonthEmpty")}</p>}
        {activeHistoryMonth && <div className="worker-history-status-list">{activeHistoryMonth.days.filter((day) => day.absences.length > 0 || day.attendanceReviews.length > 0 || day.isConfirmedRestDay).map((day) => {
          const hasWorkedShift = day.shifts.some((record) => !record.shift.deletedAt);
          const explicitMiss = !hasWorkedShift && (day.absences.some((absence) => absence.state === "unreported") || day.attendanceReviews.some((review) => review.outcome === "unreported-absence"));
          const visibleReviews = day.attendanceReviews.filter((review) => !day.absences.some((absence) => absence.state !== "cancelled")
            || !["reported-absence", "unreported-absence", "approved-absence"].includes(review.outcome));
          const reviewStatuses: Record<string, string> = { "reported-absence": t("workflow.worker.historyAbsence"), "unreported-absence": t("workflow.worker.historyMissed"), "approved-absence": t("workflow.worker.historyAbsence"), "worked": t("workflow.worker.historyAttendanceNote"), "cancelled-or-changed": t("workflow.worker.historyScheduleChanged") };
          const summary = explicitMiss ? t("workflow.worker.historyMissed") : day.isConfirmedRestDay ? t("workflow.worker.historyDayOff") : day.absences.length ? t("workflow.worker.historyAbsence") : t("workflow.worker.historyAttendanceNote");
          return <article className={`worker-history-day${explicitMiss ? " worker-history-day--missed" : day.isConfirmedRestDay ? " worker-history-day--rest" : " worker-history-day--absence"}`} key={day.date}>
            <div className="worker-history-day-heading"><strong>{formatDate(new Date(`${day.date}T12:00:00`), { weekday: "short", day: "numeric", month: "short" })}</strong><span className={`status-pill status-pill--${explicitMiss ? "unreported" : day.isConfirmedRestDay ? "cancelled" : "pending"}`}>{summary}</span></div>
            {day.absences.map((absence) => <div className="worker-history-day-detail" key={absence.id}><strong>{absence.reason ? t(`workflow.absence.reasons.${absence.reason}`) : t("workflow.worker.historyNoReason")}</strong><span>{t(`workflow.absence.state.${absence.state}`)}</span>{(absence.message || absence.leaderNote || absence.agencyNote) && <small>{absence.message || absence.leaderNote || absence.agencyNote}</small>}</div>)}
            {visibleReviews.map((review) => {
              const schedule = workerSchedules.find((item) => item.id === review.scheduleId);
              const reviewFactory = schedule ? getFactory(workspace, schedule.factoryId) : undefined;
              return <div className="worker-history-day-detail" key={review.id}><strong>{reviewStatuses[review.outcome] ?? t("workflow.worker.historyAttendanceNote")}</strong><span>{schedule ? `${schedule.startTime}–${schedule.endTime} · ${reviewFactory?.name ?? ""}` : t(`workflow.schedule.outcomes.${review.outcome}`)}</span>{review.note && <small>{review.note}</small>}</div>;
            })}
            {day.isConfirmedRestDay && <p className="worker-history-day-note">{t("workflow.worker.historyDayOff")}</p>}
          </article>;
        })}</div>}
        {visibleShifts.length > 0 && <div className="worker-month-list">{Object.entries(monthGroups).sort(([a], [b]) => b.localeCompare(a)).map(([key, records]) => {
          const [year, monthNumber] = key.split("-").map(Number);
          const monthDate = new Date(year, monthNumber - 1, 1);
          const totalPaid = records.reduce((total, record) => total + record.shift.paidDurationMinutes, 0);
          return <details className="worker-month-group" key={key} open>
            <summary><span><strong>{formatDate(monthDate, { month: "long", year: "numeric" })}</strong><small>{t("workflow.calendar.shiftCount", { total: records.length })}</small></span><span className="month-paid-total">{formatDuration(totalPaid, t)}</span></summary>
            <div className="shift-record-list">{records.map((record) => {
              const shift = record.shift;
              const day = new Date(`${shift.localStartDate}T12:00:00`);
              const openRequest = changeRequests.find((request) => request.shiftId === shift.id && request.state === "open");
              const ownRequests = changeRequests.filter((request) => request.shiftId === shift.id);
              const shiftFactory = workspace.factories.find((item) => item.id === shift.factoryId && item.organizationId === record.organizationId);
              const shiftWorkflow = shiftFactory ? getProductionWorkflowSettings(shiftFactory) : undefined;
              const canInteract = record.organizationId === workspace.organization.id && shift.workerUid === member.id;
              const hasAgencyApprover = Boolean(shiftWorkflow?.agencyMustReviewShifts);
              const hasLeaderApprover = Boolean(shiftWorkflow?.leaderMustReviewShifts && workspace.members.some((item) => item.role === "leader" && item.factoryId === shift.factoryId && item.organizationId === record.organizationId && item.accessState !== "suspended" && item.accessState !== "revoked" && (item.permissions?.canReviewShifts ?? true)));
              const canRequestChange = Boolean(canInteract && shiftWorkflow?.workerCanDisputeShifts && (hasAgencyApprover || hasLeaderApprover));
              const canEditThisShift = Boolean(canInteract && shiftWorkflow?.workerCanRecordHours && getWorkerAccess(workspace, member.id, shift.factoryId) === "self");
              return <article className="shift-record" key={shift.id} id={`shift-${shift.id}`}>
                <div className="shift-record-main">
                  <div className="shift-date-block"><strong>{formatDate(day, { day: "2-digit" })}</strong><span>{formatDate(day, { month: "short" })}</span><small>{formatDate(day, { weekday: "short" })}</small></div>
                  <div className="shift-record-info">
                    <div className="shift-time-line"><strong>{formatTime(new Date(shift.startAt))}–{formatTime(new Date(shift.endAt))}</strong><span className={`status-pill status-pill--${shift.deletedAt ? "cancelled" : shift.workerConfirmation}`}>{shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${shift.workerConfirmation}`)}</span></div>
                    <div className="shift-meta-line"><span>{t("workflow.fields.paid")}: {formatDuration(shift.paidDurationMinutes, t)}</span></div>
                  </div>
                  <details className="shift-details" open={focusId === shift.id}><summary>{t("workflow.history.open")}</summary><div className="shift-details-content">
                    <div className="shift-additional-meta"><span>{t("workflow.fields.gross")}: {formatDuration(shift.grossDurationMinutes, t)}</span><span>{t("workflow.fields.breakDuration")}: {formatDuration(shift.totalBreakDurationMinutes, t)}</span><span>{workspace.organizations.find((item) => item.id === record.organizationId)?.name} · {shiftFactory?.name ?? ""}</span>{record.plannedBreak && <span>{t("workflow.breakReport.planned")}: {record.plannedBreak.startTime && record.plannedBreak.endTime ? `${record.plannedBreak.startTime}–${record.plannedBreak.endTime}` : formatDuration(record.plannedBreak.durationMinutes ?? 0, t)}</span>}</div>
                    {shift.comment && <p className="shift-comment">{shift.comment}</p>}{record.cancellationReason && <p className="policy-note">{t("workflow.shiftCancellation.reason")}: {record.cancellationReason}</p>}{record.dispute && <div className="dispute-message"><strong>{t("workflow.dispute.reasonLabel")}</strong><p>{record.dispute.reason === "seed-time-question" ? t("workflow.dispute.seedReason") : record.dispute.reason}</p>{record.dispute.leaderResponse && <><strong>{t("workflow.dispute.answerLabel")}</strong><p>{record.dispute.leaderResponse}</p></>}</div>}<ShiftHistory entries={record.history} /><RequiredBreakReview record={record} />
                {canInteract && !shift.deletedAt && ((shift.workerConfirmation === "pending" && shiftWorkflow?.workerMustConfirmShifts) || shiftWorkflow?.workerCanDisputeShifts && shift.workerConfirmation !== "disputed") && <><p className="muted-copy">{shift.workerConfirmation === "pending" && shiftWorkflow?.workerMustConfirmShifts ? t("workflow.worker.confirmationHint") : ""}</p><div className="worker-shift-actions">{shift.workerConfirmation === "pending" && shiftWorkflow?.workerMustConfirmShifts && <button type="button" className="button button--primary button--small" onClick={() => { const confirmed = confirmShift(shift.id); setMessage(confirmed ? t("workflow.messages.shiftConfirmed") : t("workflow.errors.permission")); }}><Check size={15} />{t("workflow.worker.confirm")}</button>}{shiftWorkflow?.workerCanDisputeShifts && <button type="button" className="button button--outline button--small" onClick={() => { setDisputeId(disputeId === shift.id ? undefined : shift.id); setDisputeReason(""); }}><AlertCircle size={15} />{t("workflow.worker.dispute")}</button>}</div></>}
                {disputeId === shift.id && shiftWorkflow?.workerCanDisputeShifts && <form className="dispute-form" onSubmit={(event) => { event.preventDefault(); if (disputeShift(shift.id, disputeReason)) { setMessage(t("workflow.messages.disputeSent")); setDisputeId(undefined); } else setMessage(t("workflow.errors.reasonRequired")); }}><label className="field-label"><span>{t("workflow.dispute.reasonLabel")}</span><textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} required rows={2} /></label><button className="button button--primary button--small" type="submit">{t("workflow.worker.sendDispute")}</button></form>}
                {canInteract && shiftWorkflow?.workerCanRecordHours && shift.actualBreak.status === "not-reported" && shiftFactory?.allowActualBreakReport !== false && <button className="button button--outline button--small" type="button" onClick={() => openBreakReport(record)}><Coffee size={15} />{t("workflow.breakReport.report")}</button>}
                {!shift.deletedAt && canEditThisShift && shift.workerConfirmation === "pending" && <button className="button button--quiet button--small" type="button" onClick={() => openEditShift(record)}><Pencil size={14} />{t("workflow.worker.editShift")}</button>}
                {ownRequests.map((request) => <div className={`worker-change-request worker-change-request--${request.state}`} key={request.id} id={`request-${request.id}`}><strong>{t("workflow.changeRequests.stateLabel")}: {t(`workflow.changeRequests.${request.state}`)}</strong><span>{t("workflow.changeRequests.requestedAt", { date: formatDate(new Date(request.requestedAt), { dateStyle: "medium", timeStyle: "short" }) })}</span><span>{t("workflow.history.before")}: {formatDate(new Date(`${request.originalValues.localDate}T12:00:00`))} · {formatTime(new Date(request.originalValues.startAt))}–{formatTime(new Date(request.originalValues.endAt))} · {formatDuration(request.originalValues.paidDurationMinutes, t)} · {formatDuration(request.originalValues.totalBreakDurationMinutes ?? request.originalValues.unpaidBreakDurationMinutes, t)}</span><span>{t("workflow.history.after")}: {formatDate(new Date(`${request.proposedValues.localDate}T12:00:00`))} · {formatTime(new Date(request.proposedValues.startAt))}–{formatTime(new Date(request.proposedValues.endAt))} · {formatDuration(request.proposedValues.paidDurationMinutes, t)} · {formatDuration(request.proposedValues.totalBreakDurationMinutes ?? request.proposedValues.unpaidBreakDurationMinutes, t)}</span>{request.response && <p>{request.response}</p>}</div>)}
                {!shift.deletedAt && canRequestChange && !openRequest && <button type="button" className="button button--outline button--small" onClick={() => openChangeRequest(record)}>{t("workflow.changeRequests.request")}</button>}
                {requestShiftId === shift.id && canRequestChange && <form className="change-request-form" onSubmit={submitChangeRequest}><h3>{t("workflow.changeRequests.requestTitle")}</h3><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={requestDraft.localDate} onChange={(event) => setRequestDraft((current) => ({ ...current, localDate: event.target.value }))} required /></label><label className="field-label"><span>{t("workflow.fields.start")}</span><input type="time" value={requestDraft.startTime} onChange={(event) => setRequestDraft((current) => ({ ...current, startTime: event.target.value }))} required /></label><label className="field-label"><span>{t("workflow.fields.end")}</span><input type="time" value={requestDraft.endTime} onChange={(event) => setRequestDraft((current) => ({ ...current, endTime: event.target.value }))} required /></label><fieldset className="break-entry-fieldset field-label--wide" disabled={shiftFactory?.allowActualBreakReport === false}><legend>{t("workflow.breakReport.actual")}</legend><div className="workflow-form"><ShiftBreakFields value={requestDraft} onChange={(update) => setRequestDraft((current) => ({ ...current, ...update(current) }))} /></div></fieldset><div className="change-values-grid field-label--wide"><div><span>{t("workflow.history.before")}</span><strong>{formatDate(new Date(`${shift.localStartDate}T12:00:00`))} · {formatTime(new Date(shift.startAt))}–{formatTime(new Date(shift.endAt))} · {formatDuration(shift.paidDurationMinutes, t)} · {formatDuration(shift.totalBreakDurationMinutes, t)}</strong></div><div><span>{t("workflow.history.after")}</span><strong>{requestDraft.localDate} · {requestDraft.startTime}–{requestDraft.endTime} · {formatDuration(requestFormPaid, t)} · {formatDuration(requestFormBreak, t)}</strong></div></div><label className="field-label"><span>{t("workflow.changeRequests.approver")}</span><select value={requestApprover} onChange={(event) => setRequestApprover(event.target.value as "agency" | "leader")}><>{hasAgencyApprover && <option value="agency">{t("workflow.changeRequests.agency")}</option>}{hasLeaderApprover && <option value="leader">{t("workflow.changeRequests.leader")}</option>}</></select></label><label className="field-label field-label--wide"><span>{t("workflow.fields.comment")}</span><textarea rows={2} value={requestDraft.comment} onChange={(event) => setRequestDraft((current) => ({ ...current, comment: event.target.value }))} /></label><label className="field-label field-label--wide"><span>{t("workflow.changeRequests.reason")}</span><textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} rows={2} required /></label><div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit">{t("workflow.changeRequests.submit")}</button><button className="button button--quiet button--small" type="button" onClick={() => setRequestShiftId(undefined)}>{t("common.cancel")}</button></div></form>}
              </div></details></div>
              </article>;
            })}</div>
          </details>;
        })}</div>}
      </section>
      </div>

      {ownAbsences.length > 0 && <details className="dashboard-panel worker-absence-reports"><summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.absence.eyebrow")}</span><strong>{t("workflow.absence.myReports")}</strong></span><span className="panel-period">{ownAbsences.length}</span></summary><div className="absence-history-list">{ownAbsences.map((absence) => {
        const editableReason = absence.reason && ["illness", "family", "personal", "other"].includes(absence.reason) ? absence.reason as "illness" | "family" | "personal" | "other" : "other";
        const editable = absence.organizationId === workspace.organization.id && absence.workerId === member.id && ["reported", "clarification-requested", "rejected"].includes(absence.state);
        const currentDraft = absenceDrafts[absence.id] ?? { localDate: absence.localDate, reason: editableReason, message: absence.message ?? "" };
        return <article className="absence-row" id={"worker-absence-" + absence.id} key={absence.id}>
          <span className={"absence-state-dot absence-state-dot--" + absence.state} />
          <div><strong>{formatDate(new Date(absence.localDate + "T12:00:00"))} · {workspace.organizations.find((item) => item.id === absence.organizationId)?.name} · {absence.reason ? t("workflow.absence.reasons." + absence.reason) : t("workflow.absence.unreportedTitle")}</strong><span>{absence.message || absence.leaderNote || t("workflow.absence.noShiftNote")}</span>{absence.clarificationRequest && <blockquote>{absence.clarificationRequest}</blockquote>}{absence.agencyNote && <blockquote>{absence.agencyNote}</blockquote>}
            {editingAbsenceId === absence.id && <form className="workflow-form absence-edit-form" onSubmit={(event) => submitAbsenceEdit(event, absence.id)}><label className="field-label"><span>{t("workflow.fields.date")}</span><input type="date" value={currentDraft.localDate} onChange={(event) => setAbsenceDrafts((current) => ({ ...current, [absence.id]: { ...currentDraft, localDate: event.target.value } }))} required /></label><label className="field-label"><span>{t("workflow.absence.reason")}</span><select value={currentDraft.reason} onChange={(event) => setAbsenceDrafts((current) => ({ ...current, [absence.id]: { ...currentDraft, reason: event.target.value as typeof currentDraft.reason } }))}>{(["illness", "family", "personal", "other"] as const).map((reason) => <option key={reason} value={reason}>{t("workflow.absence.reasons." + reason)}</option>)}</select></label><label className="field-label field-label--wide"><span>{t("workflow.absence.message")}</span><textarea rows={2} value={currentDraft.message} onChange={(event) => setAbsenceDrafts((current) => ({ ...current, [absence.id]: { ...currentDraft, message: event.target.value } }))} /></label><div className="form-actions field-label--wide"><button className="button button--primary button--small" type="submit">{t("common.save")}</button><button className="button button--quiet button--small" type="button" onClick={() => setEditingAbsenceId("")}>{t("common.cancel")}</button></div></form>}
          </div>
          <span className={"status-pill status-pill--" + absence.state}>{t("workflow.absence.state." + absence.state)}</span>
          {editable && <div className="absence-worker-actions"><button className="button button--outline button--small" type="button" onClick={() => { setAbsenceDrafts((current) => ({ ...current, [absence.id]: currentDraft })); setEditingAbsenceId(absence.id); }}>{t("workflow.absence.editReport")}</button><button className="button button--quiet button--small" type="button" onClick={() => { const saved = cancelOwnAbsenceReport(absence.id); setMessage(t(saved ? "workflow.absence.cancelled" : "workflow.errors.permission")); if (saved) setEditingAbsenceId(""); }}>{t("workflow.absence.cancelReport")}</button></div>}
          {absence.organizationId === workspace.organization.id && absence.state === "clarification-requested" && <form className="absence-clarification-reply" onSubmit={(event) => { event.preventDefault(); const text = absenceReplies[absence.id] ?? ""; const saved = replyToAbsenceClarification(absence.id, text); setMessage(t(saved ? "workflow.absence.clarificationSent" : "workflow.errors.messageRequired")); if (saved) setAbsenceReplies((current) => ({ ...current, [absence.id]: "" })); }}><label className="field-label"><span>{t("workflow.absence.clarificationReply")}</span><textarea value={absenceReplies[absence.id] ?? ""} onChange={(event) => setAbsenceReplies((current) => ({ ...current, [absence.id]: event.target.value }))} rows={2} required /></label><button className="button button--outline button--small" type="submit">{t("workflow.absence.sendClarification")}</button></form>}
          {absence.history.length > 1 && <details className="absence-history-details"><summary>{t("workflow.history.open")}</summary>{absence.history.map((entry) => <p key={entry.id}>{entry.actorName} · {t("workflow.absence.historyAction." + entry.action)} · {formatDate(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}{entry.note ? " · " + entry.note : ""}</p>)}</details>}
        </article>;
      })}</div></details>}
      </>}
      {section === "work" && <WorkerWorkSummary />}
      {section === "schedule" && <ScheduleCenter />}
      {section === "messages" && <MessageCenter />}

      {section === "shifts" && templateOpen && <div className="sr-only" aria-live="polite">{templateEditing ? t("workflow.templates.editTitle") : t("workflow.templates.newTitle")}</div>}
    </PortalShell>
  );
}
