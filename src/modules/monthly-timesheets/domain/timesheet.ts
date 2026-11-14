import type {
  DemoAbsenceAgencyCategory,
  DemoMonthlyTimesheetRow,
  DemoMonthlyTimesheetTotals,
  DemoShiftRecord,
  DemoWorkspace,
} from "../../workflows/domain/demo-types";
import { workerHasProductionOnDate } from "../../exports/domain/employment-scope.ts";

export type MonthlyRecordFlag = "ready" | "check" | "problem" | "absence";

export interface MonthlyTimesheetSnapshot {
  rows: DemoMonthlyTimesheetRow[];
  totals: DemoMonthlyTimesheetTotals;
}

export function factualShiftFingerprint(record: Pick<DemoShiftRecord, "organizationId" | "shift">): string | undefined {
  const shift = record.shift;
  if (shift.deletedAt) return undefined;
  return JSON.stringify([
    record.organizationId,
    shift.workerUid,
    shift.factoryId ?? "",
    shift.localStartDate,
    shift.startAt,
    shift.endAt,
  ]);
}

function factualRecordPriority(record: DemoShiftRecord) {
  const shift = record.shift;
  return Number(shift.workerConfirmation === "confirmed" || shift.workerConfirmation === "not-required") * 8
    + Number(shift.reviewState === "approved" || shift.reviewState === "not-submitted") * 4
    + Number(shift.actualBreak.status !== "not-reported") * 2
    + Number(shift.actualBreak.segments.length > 0)
    + shift.revision / 1000;
}

export function uniqueFactualShiftRecords(records: DemoShiftRecord[]): DemoShiftRecord[] {
  const unique = new Map<string, DemoShiftRecord>();
  for (const record of records) {
    const key = factualShiftFingerprint(record) ?? `record:${record.shift.id}`;
    const current = unique.get(key);
    if (!current || factualRecordPriority(record) > factualRecordPriority(current)
      || factualRecordPriority(record) === factualRecordPriority(current) && record.shift.updatedAt > current.shift.updatedAt) unique.set(key, record);
  }
  return [...unique.values()];
}

type MonthlyAttentionCode = NonNullable<DemoMonthlyTimesheetRow["attentionReasons"]>[number]["code"];
type MonthlyAttentionReason = NonNullable<DemoMonthlyTimesheetRow["attentionReasons"]>[number];

const classificationCache = new Map<string, Pick<DemoMonthlyTimesheetRow,
  "ordinaryDurationMinutes" | "nightDurationMinutes" | "nonWorkingDayDurationMinutes" | "holidayDurationMinutes">>();

function dateFromIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || monthNumber < 1 || monthNumber > 12) return undefined;
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { start, end: `${year}-${String(monthNumber).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

function overlap(startA: string, endA: string, startB: string, endB?: string) {
  return startA <= (endB ?? "9999-12-31") && endA >= startB;
}

function classifyShift(record: DemoShiftRecord, workingWeekdays?: number[], exceptions: Array<{ localDate: string; isWorkingDay: boolean; label?: string }> = []) {
  const shift = record.shift;
  const unpaidSegments = shift.actualBreak.segments.filter((segment) => segment.treatment === "unpaid");
  const breakIntervals = unpaidSegments.map((segment) => [Date.parse(segment.startAt), Date.parse(segment.endAt)] as const);
  const hasUnlocatedUnpaidBreak = shift.unpaidBreakDurationMinutes > 0 && unpaidSegments.length === 0;
  const cacheKey = [shift.id, shift.startAt, shift.endAt, shift.timeZone, shift.unpaidBreakDurationMinutes, JSON.stringify(breakIntervals), JSON.stringify(workingWeekdays), JSON.stringify(exceptions)].join("|");
  const cached = classificationCache.get(cacheKey);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: shift.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const exceptionByDate = new Map(exceptions.map((item) => [item.localDate, item]));
  let worked = 0;
  let night = 0;
  let offCalendar = 0;
  let holiday = 0;
  const start = Date.parse(shift.startAt);
  const end = Date.parse(shift.endAt);
  for (let minute = start; minute < end; minute += 60_000) {
    if (breakIntervals.some(([breakStart, breakEnd]) => minute < breakEnd && minute + 60_000 > breakStart)
      || hasUnlocatedUnpaidBreak && minute >= end - shift.unpaidBreakDurationMinutes * 60_000) continue;
    const parts = formatter.formatToParts(new Date(minute));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
    const localDate = `${part("year")}-${part("month")}-${part("day")}`;
    const localHour = Number(part("hour"));
    const weekday = dateFromIso(localDate).getUTCDay();
    const exception = exceptionByDate.get(localDate);
    const working = exception?.isWorkingDay ?? (workingWeekdays?.includes(weekday) ?? true);
    worked += 1;
    if (localHour >= 22 || localHour < 6) night += 1;
    if (!working) {
      offCalendar += 1;
      if (exception?.label) holiday += 1;
    }
  }
  const result = {
    ordinaryDurationMinutes: Math.max(0, worked - night),
    nightDurationMinutes: night,
    nonWorkingDayDurationMinutes: offCalendar,
    holidayDurationMinutes: holiday,
  };
  classificationCache.set(cacheKey, result);
  return result;
}

function absenceCategory(workspace: DemoWorkspace, absenceId: string): DemoAbsenceAgencyCategory {
  const absence = workspace.absences.find((item) => item.id === absenceId);
  return absence?.agencyCategory ?? (absence?.state === "unreported" ? "unreported" : "attention");
}

function reviewerFor(factory: NonNullable<DemoWorkspace["factories"][number]>): MonthlyAttentionReason["responsible"] {
  if (factory.workflowSettings?.agencyMustReviewShifts) return "agency";
  if (factory.workflowSettings?.leaderMustReviewShifts) return "leader";
  return "agency";
}

function shiftAttentionReasons(record: DemoShiftRecord, factory: DemoWorkspace["factories"][number], dataMismatch: boolean, workspace: DemoWorkspace): MonthlyAttentionReason[] {
  const shift = record.shift;
  const reasons: MonthlyAttentionReason[] = [];
  const reviewer = reviewerFor(factory);
  const disputeReviewer = workspace.members.some((member) => member.organizationId === record.organizationId && member.role === "leader" && member.factoryId === shift.factoryId
    && member.accessState !== "suspended" && member.accessState !== "revoked" && (member.permissions?.canReviewShifts ?? true)) ? "leader" : "agency";
  if (shift.workerConfirmation === "pending") reasons.push({ code: "worker-confirmation", responsible: "worker" });
  if (shift.workerConfirmation === "disputed" || record.dispute?.state === "open") reasons.push({ code: "worker-dispute", responsible: disputeReviewer, detail: record.dispute?.reason });
  const breakReviewPending = factory.requiredBreakMinutes > 0 && shift.actualBreak.reviewState === "pending";
  if (breakReviewPending) reasons.push({ code: "break-review", responsible: reviewer, detail: shift.actualBreak.exceptionReason });
  if (shift.actualBreak.reviewState === "rejected") reasons.push({ code: "break-returned", responsible: shift.source === "worker" ? "worker" : shift.source === "leader" ? "leader" : "agency", detail: shift.actualBreak.exceptionReason });
  if (shift.reviewState === "pending" && !breakReviewPending) reasons.push({ code: "shift-review", responsible: reviewer });
  if (shift.reviewState === "returned") {
    const detail = [...record.history].reverse().find((entry) => entry.action === "returned")?.note;
    reasons.push({ code: "review-returned", responsible: shift.source === "worker" ? "worker" : shift.source === "leader" ? "leader" : "agency", detail });
  }
  if (dataMismatch) reasons.push({ code: "time-mismatch", responsible: "agency" });
  return reasons;
}

export function monthlyAttentionReasons(row: DemoMonthlyTimesheetRow): MonthlyAttentionReason[] {
  if (row.attentionReasons) return row.attentionReasons;
  if (row.kind === "absence") {
    if (row.absenceState === "clarification-requested") return [{ code: "absence-clarification", responsible: "worker", detail: row.comment }];
    if (row.absenceCategory === "unreported") return [{ code: "absence-unreported", responsible: "agency", detail: row.comment }];
    if (row.absenceCategory === "attention") return [{ code: "absence-review", responsible: "agency", detail: row.comment }];
    return [];
  }
  const reasons: MonthlyAttentionReason[] = [];
  if (row.workerConfirmation === "pending") reasons.push({ code: "worker-confirmation", responsible: "worker" });
  if (row.workerConfirmation === "disputed") reasons.push({ code: "worker-dispute", responsible: "leader" });
  if (row.reviewState === "pending") reasons.push({ code: "shift-review", responsible: "agency" });
  if (row.reviewState === "returned") reasons.push({ code: "review-returned", responsible: "agency" });
  if (row.dataMismatch) reasons.push({ code: "time-mismatch", responsible: "agency" });
  return reasons;
}

export function buildMonthlyTimesheetSnapshot(
  workspace: DemoWorkspace,
  factoryId: string,
  month: string,
  audience: "leader" | "agency" = "leader",
): MonthlyTimesheetSnapshot {
  const bounds = monthBounds(month);
  const empty: DemoMonthlyTimesheetTotals = {
    workerCount: 0, shiftCount: 0, absenceCount: 0, grossDurationMinutes: 0,
    totalBreakDurationMinutes: 0, unpaidBreakDurationMinutes: 0, paidDurationMinutes: 0,
    ordinaryDurationMinutes: 0, nightDurationMinutes: 0, overtimeDurationMinutes: 0,
    nonWorkingDayDurationMinutes: 0, holidayDurationMinutes: 0,
  };
  if (!bounds) return { rows: [], totals: empty };

  const factory = workspace.factories.find((item) => item.organizationId === workspace.organization.id && item.id === factoryId);
  if (!factory) return { rows: [], totals: empty };
  const workerMap = new Map(workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "worker").map((worker) => [worker.id, worker]));
  const periodPlacements = workspace.employmentPeriods
    .filter((period) => period.organizationId === workspace.organization.id)
    .flatMap((period) => period.placements.filter((placement) => placement.factoryId === factoryId && overlap(placement.startDate, placement.endDate ?? bounds.end, bounds.start, bounds.end)).map((placement) => ({ workerId: period.workerId, placement })));
  const workerIds = new Set(periodPlacements.map((item) => item.workerId));
  const placementAt = (workerId: string, date: string) => periodPlacements.some((item) => item.workerId === workerId && item.placement.startDate <= date && (!item.placement.endDate || item.placement.endDate >= date));
  const rows: DemoMonthlyTimesheetRow[] = [];

  const monthlyShiftRecords = uniqueFactualShiftRecords(workspace.shifts.filter((record) => record.organizationId === workspace.organization.id
    && record.shift.factoryId === factoryId && !record.shift.deletedAt && record.shift.localStartDate.startsWith(`${month}-`)));
  for (const record of monthlyShiftRecords) {
    const shift = record.shift;
    const worker = workerMap.get(shift.workerUid);
    if (!worker) continue;
    const legacyFactoryIds = worker.productionAssignments?.map((assignment) => assignment.factoryId) ?? (worker.factoryId ? [worker.factoryId] : []);
    if (!workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: record.organizationId, workerId: worker.id, factoryId, date: shift.localStartDate, employmentId: shift.employmentId }, legacyFactoryIds)) continue;
    workerIds.add(worker.id);
    const classification = classifyShift(record, factory.workCalendar?.workingWeekdays, factory.workCalendar?.exceptions ?? []);
    const dataMismatch = !placementAt(worker.id, shift.localStartDate) && workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === worker.id);
    rows.push({
      id: `shift-${shift.id}`, workerId: worker.id, workerName: worker.name, kind: "shift", recordId: shift.id,
      localDate: shift.localStartDate, weekday: dateFromIso(shift.localStartDate).getUTCDay(), startAt: shift.startAt, endAt: shift.endAt,
      grossDurationMinutes: shift.grossDurationMinutes, totalBreakDurationMinutes: shift.totalBreakDurationMinutes,
      unpaidBreakDurationMinutes: shift.unpaidBreakDurationMinutes, paidDurationMinutes: shift.paidDurationMinutes,
      ...classification, overtimeDurationMinutes: 0,
      breakTreatment: shift.actualBreak.segments[0]?.treatment ?? shift.actualBreak.treatment ?? (shift.totalBreakDurationMinutes > 0 && shift.unpaidBreakDurationMinutes === 0 ? "paid" : shift.unpaidBreakDurationMinutes > 0 ? "unpaid" : undefined),
      workerConfirmation: shift.workerConfirmation, reviewState: shift.reviewState,
      dataMismatch,
      attentionReasons: shiftAttentionReasons(record, factory, dataMismatch, workspace),
      comment: shift.comment, shiftHistory: record.history.map((event) => ({ ...event })),
    });
  }

  for (const absence of workspace.absences) {
    if (absence.organizationId !== workspace.organization.id || absence.factoryId !== factoryId || !absence.localDate.startsWith(`${month}-`)) continue;
    if (absence.state === "reported" || absence.state === "clarification-requested" || absence.state === "rejected" || absence.state === "cancelled") continue;
    if (audience === "agency" && !absence.agencyCategory && absence.state !== "reviewed" && absence.state !== "unreported") continue;
    const worker = workerMap.get(absence.workerId);
    if (!worker) continue;
    const legacyFactoryIds = worker.productionAssignments?.map((assignment) => assignment.factoryId) ?? (worker.factoryId ? [worker.factoryId] : []);
    if (!workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: absence.organizationId, workerId: worker.id, factoryId, date: absence.localDate, employmentId: absence.employmentId }, legacyFactoryIds)) continue;
    workerIds.add(worker.id);
    rows.push({
      id: `absence-${absence.id}`, workerId: worker.id, workerName: worker.name, kind: "absence", recordId: absence.id,
      localDate: absence.localDate, weekday: dateFromIso(absence.localDate).getUTCDay(), grossDurationMinutes: 0,
      totalBreakDurationMinutes: 0, unpaidBreakDurationMinutes: 0, paidDurationMinutes: 0,
      ordinaryDurationMinutes: 0, nightDurationMinutes: 0, overtimeDurationMinutes: 0,
      nonWorkingDayDurationMinutes: 0, holidayDurationMinutes: 0,
      absenceCategory: absenceCategory(workspace, absence.id),
      absenceState: absence.state,
      attentionReasons: absenceCategory(workspace, absence.id) === "unreported"
        ? [{ code: "absence-unreported", responsible: "agency", detail: absence.agencyNote }]
        : absenceCategory(workspace, absence.id) === "attention"
          ? [{ code: "absence-review", responsible: audience === "agency" ? "agency" : "leader", detail: absence.agencyNote }]
          : [],
      comment: audience === "agency" ? absence.agencyNote : absence.agencyNote,
    });
  }

  rows.sort((left, right) => left.localDate.localeCompare(right.localDate)
    || left.workerName.localeCompare(right.workerName)
    || (left.startAt ?? "").localeCompare(right.startAt ?? "")
    || left.id.localeCompare(right.id));
  const totals = rows.reduce<DemoMonthlyTimesheetTotals>((sum, row) => ({
    workerCount: workerIds.size,
    shiftCount: sum.shiftCount + Number(row.kind === "shift"),
    absenceCount: sum.absenceCount + Number(row.kind === "absence"),
    grossDurationMinutes: sum.grossDurationMinutes + row.grossDurationMinutes,
    totalBreakDurationMinutes: sum.totalBreakDurationMinutes + row.totalBreakDurationMinutes,
    unpaidBreakDurationMinutes: sum.unpaidBreakDurationMinutes + row.unpaidBreakDurationMinutes,
    paidDurationMinutes: sum.paidDurationMinutes + row.paidDurationMinutes,
    ordinaryDurationMinutes: sum.ordinaryDurationMinutes + row.ordinaryDurationMinutes,
    nightDurationMinutes: sum.nightDurationMinutes + row.nightDurationMinutes,
    overtimeDurationMinutes: sum.overtimeDurationMinutes + row.overtimeDurationMinutes,
    nonWorkingDayDurationMinutes: sum.nonWorkingDayDurationMinutes + row.nonWorkingDayDurationMinutes,
    holidayDurationMinutes: sum.holidayDurationMinutes + row.holidayDurationMinutes,
  }), { ...empty, workerCount: workerIds.size });
  return { rows, totals };
}

export function monthlyRecordFlags(row: DemoMonthlyTimesheetRow): MonthlyRecordFlag[] {
  const reasons = monthlyAttentionReasons(row);
  if (row.kind === "absence") return ["absence", ...(reasons.length ? ["check" as const] : [])];
  const flags: MonthlyRecordFlag[] = [];
  const problemCodes: MonthlyAttentionCode[] = ["worker-dispute", "break-returned", "review-returned", "time-mismatch"];
  const problem = reasons.some((reason) => problemCodes.includes(reason.code));
  const check = reasons.some((reason) => !problemCodes.includes(reason.code));
  if (check) flags.push("check");
  if (problem) flags.push("problem");
  if (!check && !problem) flags.push("ready");
  return flags;
}

export function hasOpenMonthlyIssues(rows: DemoMonthlyTimesheetRow[]) {
  return rows.some((row) => monthlyRecordFlags(row).some((flag) => flag === "check" || flag === "problem"));
}
