import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate, formatTime } from "../../../shared/formatters";
import { formatDuration } from "../workflow-utils";
import { getActiveBusinessEntity, getActiveMember, getBusinessWorksiteRoster, getLeaderAccessibleWorkers, getWorkerAccountMemberships, getWorkerProductionAssignments, useDemoWorkspace } from "../demo-store";

const WorkerProfileContext = createContext<(workerId: string) => void>(() => undefined);
type PeriodKind = "current-month" | "month" | "year" | "range" | "all";

export function WorkerProfileProvider({ children }: { children: ReactNode }) {
  const [workerId, setWorkerId] = useState("");
  return <WorkerProfileContext.Provider value={setWorkerId}>
    {children}
    {workerId && <WorkerProfileDialog key={workerId} workerId={workerId} onClose={() => setWorkerId("")} />}
  </WorkerProfileContext.Provider>;
}

export function WorkerProfileTrigger({ workerId, children, className = "worker-profile-trigger" }: { workerId: string; children: ReactNode; className?: string }) {
  const open = useContext(WorkerProfileContext);
  return <button type="button" className={className} onClick={(event) => { event.preventDefault(); event.stopPropagation(); open(workerId); }}>{children}</button>;
}

function WorkerProfileDialog({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const workspace = useDemoWorkspace();
  const viewer = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.role === "worker");
  const businessEntity = viewer.role === "factory-admin" ? getActiveBusinessEntity(workspace) : undefined;
  const factoryAdminWorkerRows = viewer.role === "factory-admin" && businessEntity
    ? (workspace.worksites ?? []).filter((site) => site.businessEntityId === businessEntity.id).flatMap((site) => getBusinessWorksiteRoster(site.id)).filter((entry) => entry.worker.id === workerId)
    : [];
  const workerMemberships = worker ? getWorkerAccountMemberships(workspace, worker.id) : [];
  const workerIds = new Set(workerMemberships.map((item) => item.id));
  const assignmentList = worker ? [
    ...getWorkerProductionAssignments(workspace, worker.id),
    ...workspace.employmentPeriods.filter((period) => period.organizationId === worker.organizationId && period.workerId === worker.id)
      .flatMap((period) => period.placements.map((placement) => ({ factoryId: placement.factoryId, groupId: placement.groupId, leaderId: placement.leaderId }))),
  ].filter((assignment, index, items) => items.findIndex((candidate) => candidate.factoryId === assignment.factoryId) === index) : [];
  const leaderRoster = viewer.role === "leader" ? getLeaderAccessibleWorkers(workspace, viewer.id) : [];
  const allowedFactoryIds = viewer.role === "agency"
    ? assignmentList.map((item) => item.factoryId)
    : viewer.role === "leader"
      ? leaderRoster.filter((entry) => entry.worker.id === workerId && entry.organizationId === workspace.organization.id).map((entry) => entry.factory.id)
      : viewer.role === "factory-admin"
        ? factoryAdminWorkerRows.map((entry) => entry.factoryId)
        : viewer.role === "worker" && workerIds.has(workerId)
        ? workspace.employmentPeriods.filter((period) => workerIds.has(period.workerId) && period.accountUid === (viewer.accountUid ?? viewer.id)).flatMap((period) => period.placements.map((placement) => placement.factoryId))
        : [];
  const isAllowed = Boolean(worker && (viewer.role === "worker" ? workerIds.has(workerId) : viewer.role === "factory-admin" ? factoryAdminWorkerRows.length > 0 : worker.organizationId === workspace.organization.id
    && (viewer.role === "agency" || viewer.role === "leader" && allowedFactoryIds.length > 0)));
  const [periodKind, setPeriodKind] = useState<PeriodKind>("current-month");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [fromDate, setFromDate] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; };
  }, [onClose]);

  const employmentPeriods = viewer.role === "worker"
    ? workspace.employmentPeriods.filter((period) => period.accountUid === (viewer.accountUid ?? viewer.id))
    : viewer.role === "factory-admin"
      ? workspace.employmentPeriods.filter((period) => period.workerId === workerId && allowedFactoryIds.some((factoryId) => period.placements.some((placement) => placement.factoryId === factoryId)))
      : workspace.employmentPeriods.filter((period) => period.organizationId === workspace.organization.id && period.workerId === workerId);
  employmentPeriods.sort((a, b) => b.startDate.localeCompare(a.startDate));
  const activePeriod = employmentPeriods.find((period) => period.state === "active");
  const dateMatches = (date: string) => periodKind === "current-month" ? date.startsWith(new Date().toISOString().slice(0, 7))
    : periodKind === "month" ? date.startsWith(month)
      : periodKind === "year" ? date.startsWith(`${year}-`)
        : periodKind === "range" ? date >= fromDate && date <= toDate : true;
  const shifts = workspace.shifts.filter((record) => (viewer.role === "worker" ? workerIds.has(record.shift.workerUid) && workerMemberships.some((item) => item.id === record.shift.workerUid && item.organizationId === record.organizationId) : viewer.role === "factory-admin" ? record.shift.workerUid === workerId && allowedFactoryIds.includes(record.shift.factoryId ?? "") : record.organizationId === workspace.organization.id && record.shift.workerUid === workerId)
    && (viewer.role !== "leader" && viewer.role !== "factory-admin" || allowedFactoryIds.includes(record.shift.factoryId ?? "")) && dateMatches(record.shift.localStartDate))
    .sort((a, b) => a.shift.startAt.localeCompare(b.shift.startAt));
  const absences = workspace.absences.filter((absence) => (viewer.role === "worker" ? workerIds.has(absence.workerId) && workerMemberships.some((item) => item.id === absence.workerId && item.organizationId === absence.organizationId) : viewer.role === "factory-admin" ? absence.workerId === workerId && allowedFactoryIds.includes(absence.factoryId) : absence.organizationId === workspace.organization.id && absence.workerId === workerId)
    && (viewer.role !== "leader" && viewer.role !== "factory-admin" || allowedFactoryIds.includes(absence.factoryId))
    && (viewer.role !== "agency" || Boolean(absence.agencyCategory) || absence.state === "reported" || absence.state === "reviewed" || absence.state === "rejected" || absence.state === "cancelled" || absence.state === "unreported")
    && dateMatches(absence.localDate))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  const activeShifts = shifts.filter((record) => !record.shift.deletedAt);
  const totals = useMemo(() => ({
    gross: activeShifts.reduce((sum, record) => sum + record.shift.grossDurationMinutes, 0),
    paid: activeShifts.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    confirmed: activeShifts.filter((record) => record.shift.workerConfirmation === "confirmed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    pending: activeShifts.filter((record) => record.shift.workerConfirmation === "pending").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    disputed: activeShifts.filter((record) => record.shift.workerConfirmation === "disputed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
  }), [shifts]);
  const factories = allowedFactoryIds.map((id) => workspace.factories.find((item) => item.id === id && (viewer.role === "worker" ? employmentPeriods.some((period) => period.organizationId === item.organizationId && period.placements.some((placement) => placement.factoryId === id)) : viewer.role === "factory-admin" ? factoryAdminWorkerRows.some((entry) => entry.factoryId === id) : item.organizationId === workspace.organization.id))).filter((factory) => Boolean(factory));
  const leaderIds = new Set(assignmentList.filter((item) => allowedFactoryIds.includes(item.factoryId) && item.leaderId).map((item) => item.leaderId));
  const leaders = workspace.members.filter((member) => leaderIds.has(member.id));
  const threads = workspace.messageThreads.filter((thread) => (viewer.role === "worker" ? Boolean(thread.workerId && workerIds.has(thread.workerId)) : viewer.role === "factory-admin" ? thread.workerId === workerId && thread.participants.includes(viewer.id) : thread.organizationId === workspace.organization.id && thread.workerId === workerId)
    && (thread.participants.includes(viewer.id) || viewer.role === "agency" && thread.recipientType === "agency" || viewer.role === "leader" && thread.factoryId === viewer.factoryId));
  const localDayOffRows = useMemo(() => {
    const dates = new Set<string>();
    if (periodKind !== "current-month" && periodKind !== "month") return [];
    const selectedMonth = periodKind === "month" ? month : new Date().toISOString().slice(0, 7);
    const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
    const dayCount = new Date(selectedYear, selectedMonthNumber, 0).getDate();
    const periods = employmentPeriods.flatMap((period) => period.placements.filter((placement) => allowedFactoryIds.includes(placement.factoryId)).map((placement) => ({ ...placement, periodStart: period.startDate, periodEnd: period.endDate })));
    for (let day = 1; day <= dayCount; day += 1) {
      const date = `${selectedMonth}-${String(day).padStart(2, "0")}`;
      for (const placement of periods) {
        if (placement.startDate > date || placement.endDate && placement.endDate < date || placement.periodStart > date || placement.periodEnd && placement.periodEnd < date) continue;
        const factory = workspace.factories.find((item) => item.id === placement.factoryId);
        const exception = factory?.workCalendar?.exceptions.find((item) => item.localDate === date);
        const weekday = new Date(`${date}T12:00:00`).getDay();
        const isWorkday = exception?.isWorkingDay ?? (factory?.workCalendar?.workingWeekdays ?? [1, 2, 3, 4, 5]).includes(weekday);
        const hasShift = shifts.some((record) => record.shift.factoryId === placement.factoryId && record.shift.localStartDate === date);
        const hasAbsence = absences.some((absence) => absence.factoryId === placement.factoryId && absence.localDate === date);
        if (!isWorkday && !hasShift && !hasAbsence) dates.add(date);
      }
    }
    return [...dates].sort();
  }, [absences, allowedFactoryIds.join("|"), employmentPeriods, month, periodKind, shifts, workspace.factories]);

  if (!isAllowed || !worker) return null;
  return <div className="worker-profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="worker-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="worker-profile-title">
      <header className="worker-profile-header"><div><span className="eyebrow">{t("workflow.workerProfile.title")}</span><h2 id="worker-profile-title">{worker.name}</h2><p>{factories.map((factory) => factory?.name).filter(Boolean).join(" · ") || t("workflow.employment.noCurrentPlacement")}</p></div><button type="button" className="icon-button" aria-label={t("common.close")} onClick={onClose}><X size={17} /></button></header>
      <div className="worker-profile-content">
        <section className="worker-profile-meta"><span className={`status-pill status-pill--${activePeriod ? "active" : "ended"}`}>{t("workflow.employment.status." + (activePeriod ? "active" : "ended"))}</span><span>{viewer.role === "worker" ? workerMemberships.map((item) => workspace.organizations.find((org) => org.id === item.organizationId)?.name).filter(Boolean).join(" · ") : workspace.organization.name}</span><span>{leaders.map((leader) => leader.name).join(", ") || t("workflow.employment.noLeader")}</span><span>{worker.email || worker.phone || t("workflow.employment.noContact")}</span></section>
        <div className="worker-profile-stats"><article><span>{t("workflow.timekeeping.shifts")}</span><strong>{shifts.length}</strong></article><article><span>{t("workflow.fields.gross")}</span><strong>{formatDuration(totals.gross, t)}</strong></article><article><span>{t("workflow.fields.paid")}</span><strong>{formatDuration(totals.paid, t)}</strong></article><article><span>{t("workflow.timekeeping.absences")}</span><strong>{absences.length}</strong></article><article><span>{t("workflow.timekeeping.confirmed")}</span><strong>{formatDuration(totals.confirmed, t)}</strong></article><article><span>{t("workflow.timekeeping.pending")}</span><strong>{formatDuration(totals.pending, t)}</strong></article><article><span>{t("workflow.timekeeping.disputed")}</span><strong>{formatDuration(totals.disputed, t)}</strong></article></div>
        <section className="worker-profile-history"><div className="worker-profile-section-heading"><div><span className="eyebrow">{t("workflow.workerProfile.shiftHistory")}</span><h3>{t("workflow.workerProfile.period")}</h3></div><div className="worker-profile-filters"><select aria-label={t("workflow.workerProfile.period")} value={periodKind} onChange={(event) => setPeriodKind(event.target.value as PeriodKind)}><option value="current-month">{t("common.currentMonth")}</option><option value="month">{t("exports.periodMonth")}</option><option value="year">{t("exports.periodYear")}</option><option value="range">{t("exports.periodRange")}</option><option value="all">{t("workflow.timekeeping.allPeriods")}</option></select>{periodKind === "month" && <input aria-label={t("exports.periodMonth")} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />}{periodKind === "year" && <input aria-label={t("exports.periodYear")} type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} />}{periodKind === "range" && <><input aria-label={t("common.from")} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><input aria-label={t("common.to")} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></>}</div></div>
          <div className="worker-profile-table-wrap"><table className="worker-profile-table"><thead><tr><th>{t("workflow.fields.date")}</th><th>{t("workflow.fields.start")}</th><th>{t("workflow.fields.end")}</th><th>{t("workflow.fields.breakDuration")}</th><th>{t("workflow.fields.paid")}</th><th>{t("workflow.timekeeping.status")}</th><th>{t("workflow.fields.comment")}</th></tr></thead><tbody>
            {shifts.map((record) => { const shift = record.shift; return <tr key={shift.id}><td>{formatDate(new Date(`${shift.localStartDate}T12:00:00`), { year: "numeric", month: "short", day: "numeric", weekday: "long" })}</td><td>{formatTime(new Date(shift.startAt))}</td><td>{formatTime(new Date(shift.endAt))}</td><td>{shift.actualBreak.status === "taken" ? formatDuration(shift.totalBreakDurationMinutes, t) : t("workflow.breakReport.none")}</td><td className="worker-profile-hours">{formatDuration(shift.paidDurationMinutes, t)}</td><td><span className={`status-pill status-pill--${shift.deletedAt ? "cancelled" : shift.workerConfirmation}`}>{shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${shift.workerConfirmation}`)}</span></td><td>{record.cancellationReason || shift.comment || "—"}</td></tr>; })}
            {absences.map((absence) => { const agencyCategory = absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention"); return <tr className="worker-profile-row--absence" key={absence.id}><td>{formatDate(new Date(`${absence.localDate}T12:00:00`), { year: "numeric", month: "short", day: "numeric", weekday: "long" })}</td><td colSpan={3}>{viewer.role === "agency" ? t(`workflow.absence.agencyCategory.${agencyCategory}`) : absence.reason ? t(`workflow.absence.reasons.${absence.reason}`) : t(`workflow.absence.state.${absence.state}`)}</td><td>—</td><td>{t(`workflow.absence.state.${absence.state}`)}</td><td>{viewer.role === "agency" ? absence.agencyNote || "—" : absence.message || absence.leaderNote || "—"}</td></tr>; })}
            {localDayOffRows.map((date) => <tr className="worker-profile-row--rest" key={`rest-${date}`}><td>{formatDate(new Date(`${date}T12:00:00`), { year: "numeric", month: "short", day: "numeric", weekday: "long" })}</td><td colSpan={6}>{t("workflow.workerProfile.scheduledDayOff")}</td></tr>)}
            {shifts.length === 0 && absences.length === 0 && localDayOffRows.length === 0 && <tr><td colSpan={7}>{t("workflow.worker.noShifts")}</td></tr>}
          </tbody></table></div>
        </section>
        {employmentPeriods.length > 0 && <section className="worker-profile-employment"><h3>{t("workflow.workerProfile.employmentHistory")}</h3>{employmentPeriods.map((period) => <article key={period.id}><strong>{period.startDate}{period.endDate ? ` — ${period.endDate}` : ` — ${t("workflow.employment.current")}`}</strong><span>{t(`workflow.employment.status.${period.state}`)}</span>{period.placements.filter((placement) => viewer.role !== "leader" && viewer.role !== "factory-admin" || allowedFactoryIds.includes(placement.factoryId)).map((placement) => <small key={placement.id}>{workspace.factories.find((factory) => factory.id === placement.factoryId)?.name} · {placement.startDate}{placement.endDate ? ` — ${placement.endDate}` : ""}</small>)}{period.history.map((event) => <small key={event.id}>{workspace.members.find((person) => person.id === event.actorId)?.name ?? event.actorId} · {t(`workflow.employment.event.${event.action}`)}{event.note ? ` · ${event.note}` : ""}</small>)}</article>)}</section>}
        {threads.length > 0 && <section className="worker-profile-messages"><h3>{t("workflow.messagesCenter.title")}</h3>{threads.map((thread) => <article key={thread.id}><strong>{thread.subject}</strong>{thread.messages.map((message) => <p key={message.id}>{message.text}<small>{formatDate(new Date(message.sentAt), { dateStyle: "medium", timeStyle: "short" })}</small></p>)}</article>)}</section>}
      </div>
    </section>
  </div>;
}
