import { AgencyShiftEntry } from "../components/AgencyShiftEntry";
import { useMemo, useState } from "react";
import { ArrowLeft, FileSpreadsheet, RotateCcw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDate, formatTime } from "../../../shared/formatters";
import { getActiveMember, getProductionWorkflowSettings, getWorkerProductionAssignment, isAgencyVisibleAbsence, reviewShiftRecord, useDemoWorkspace } from "../../workflows/demo-store";
import { formatDuration } from "../../workflows/workflow-utils";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { useToast } from "../../../app/ToastProvider";

type PeriodKind = "month" | "year" | "date" | "date-range" | "all";
function today(): string { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }

export function AgencyTimekeepingPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const showToast = useToast();
  const factories = workspace.factories.filter((factory) => factory.organizationId === workspace.organization.id);
  const workers = workspace.members.filter((worker) => worker.organizationId === workspace.organization.id && worker.role === "worker");
  const initialFactory = searchParams.get("factory") ?? "";
  const initialWorker = searchParams.get("worker") ?? "";
  const initialMonth = searchParams.get("month") ?? "";
  const [factoryIds, setFactoryIds] = useState<string[]>(() => factories.some((factory) => factory.id === initialFactory) ? [initialFactory] : []);
  const [workerIds, setWorkerIds] = useState<string[] | null>(() => workers.some((worker) => worker.id === initialWorker) ? [initialWorker] : null);
  const [search, setSearch] = useState("");
  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : today().slice(0, 7));
  const [year, setYear] = useState(today().slice(0, 4));
  const [date, setDate] = useState(today());
  const [fromDate, setFromDate] = useState(today().slice(0, 7) + "-01");
  const [toDate, setToDate] = useState(today());
  const availableWorkers = workers.filter((worker) => !factoryIds.length || factoryIds.some((id) => getWorkerProductionAssignment(workspace, worker.id, id)) || worker.id === initialWorker);
  const matchingWorkers = availableWorkers.filter((worker) => worker.name.toLowerCase().includes(search.trim().toLowerCase()) && (!workerIds || workerIds.includes(worker.id)));
  const dateMatch = (value: string) => periodKind === "month" ? value.startsWith(month)
    : periodKind === "year" ? value.startsWith(year + "-")
      : periodKind === "date" ? value === date
        : periodKind === "date-range" ? (!fromDate || value >= fromDate) && (!toDate || value <= toDate) : true;
  const scopedShifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id
    && matchingWorkers.some((worker) => worker.id === record.shift.workerUid)
    && (!factoryIds.length || factoryIds.includes(record.shift.factoryId ?? "")) && dateMatch(record.shift.localStartDate));
  const scopedAbsences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && isAgencyVisibleAbsence(workspace, absence)
    && matchingWorkers.some((worker) => worker.id === absence.workerId)
    && (!factoryIds.length || factoryIds.includes(absence.factoryId)) && dateMatch(absence.localDate));
  const totals = {
    confirmed: scopedShifts.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "confirmed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    pending: scopedShifts.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "pending").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    disputed: scopedShifts.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "disputed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
  };
  const exportParams = useMemo(() => {
    const params = new URLSearchParams();
    if (factoryIds.length) params.set("factories", factoryIds.join(","));
    if (workerIds) params.set("workers", workerIds.join(","));
    params.set("periodKind", periodKind);
    if (periodKind === "month") params.set("month", month);
    if (periodKind === "year") params.set("year", year);
    if (periodKind === "date") params.set("date", date);
    if (periodKind === "date-range") { params.set("fromDate", fromDate); params.set("toDate", toDate); }
    return params.toString();
  }, [factoryIds, workerIds, periodKind, month, year, date, fromDate, toDate]);

  function toggleWorker(workerId: string) {
    const selected = workerIds ?? availableWorkers.map((worker) => worker.id);
    const next = selected.includes(workerId) ? selected.filter((id) => id !== workerId) : [...selected, workerId];
    setWorkerIds(next);
  }
  function toggleFactory(id: string) {
    const next = factoryIds.includes(id) ? factoryIds.filter((value) => value !== id) : [...factoryIds, id];
    setFactoryIds(next);
    setWorkerIds((current) => current === null ? null : current.filter((workerId) => !next.length || next.some((factoryId) => getWorkerProductionAssignment(workspace, workerId, factoryId))));
  }
  function reset() { setFactoryIds([]); setWorkerIds(null); setSearch(""); setPeriodKind("month"); setMonth(today().slice(0, 7)); setYear(today().slice(0, 4)); setDate(today()); setFromDate(today().slice(0, 7) + "-01"); setToDate(today()); }

  return <PortalShell role="agency">
    <PageHeading eyebrow={workspace.organization.name} title={t("workflow.timekeeping.title")} description={t("workflow.timekeeping.lead")} action={<Link className="button button--outline button--small" to="/agency"><ArrowLeft size={15} />{t("workflow.employment.backToAgency")}</Link>} />
    <AgencyShiftEntry />
    <section className="dashboard-panel timekeeping-filters">
      <div className="panel-heading"><div><span className="eyebrow">{t("workflow.timekeeping.filters")}</span><h2>{t("workflow.timekeeping.chooseScope")}</h2></div><button type="button" className="button button--quiet button--small" onClick={reset}><RotateCcw size={14} />{t("workflow.timekeeping.reset")}</button></div>
      <div className="timekeeping-filter-grid">
        <fieldset><legend>{t("workflow.fields.production")}</legend>{factories.map((factory) => <label key={factory.id}><input type="checkbox" checked={factoryIds.includes(factory.id)} onChange={() => toggleFactory(factory.id)} />{factory.name}</label>)}</fieldset>
        <fieldset><legend>{t("workflow.timekeeping.workers")}</legend>{availableWorkers.map((worker) => <label key={worker.id}><input type="checkbox" checked={!workerIds || workerIds.includes(worker.id)} onChange={() => toggleWorker(worker.id)} /><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger></label>)}</fieldset>
      </div>
      <div className="scope-controls timekeeping-period-controls"><label className="field-label"><span>{t("workflow.timekeeping.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field-label"><span>{t("workflow.timekeeping.period")}</span><select value={periodKind} onChange={(event) => setPeriodKind(event.target.value as PeriodKind)}><option value="month">{t("exports.periodMonth")}</option><option value="year">{t("workflow.timekeeping.year")}</option><option value="date">{t("exports.periodDate")}</option><option value="date-range">{t("exports.periodRange")}</option><option value="all">{t("workflow.timekeeping.allPeriods")}</option></select></label>
        {periodKind === "month" && <label className="field-label"><span>{t("exports.periodMonth")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}
        {periodKind === "year" && <label className="field-label"><span>{t("workflow.timekeeping.year")}</span><input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></label>}
        {periodKind === "date" && <label className="field-label"><span>{t("exports.periodDate")}</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}
        {periodKind === "date-range" && <><label className="field-label"><span>{t("common.from")}</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field-label"><span>{t("common.to")}</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></>}
      </div>
      <p className="scope-result-note">{t("workflow.timekeeping.selectedScope", { factories: factoryIds.length || factories.length, workers: matchingWorkers.length })}</p>
    </section>
    <div className="workflow-stat-grid workflow-stat-grid--four">
      <a className="workflow-stat-card workflow-stat-link" href="#timekeeping-results"><span>{t("workflow.timekeeping.confirmed")}</span><strong>{formatDuration(totals.confirmed, t)}</strong></a><a className="workflow-stat-card workflow-stat-link" href="#timekeeping-results"><span>{t("workflow.timekeeping.pending")}</span><strong>{formatDuration(totals.pending, t)}</strong></a><a className="workflow-stat-card workflow-stat-link" href="#timekeeping-results"><span>{t("workflow.timekeeping.disputed")}</span><strong>{formatDuration(totals.disputed, t)}</strong></a><a className="workflow-stat-card workflow-stat-link" href="#timekeeping-results"><span>{t("workflow.timekeeping.shifts")}</span><strong>{scopedShifts.length}</strong><small>{t("workflow.timekeeping.absences")}: {scopedAbsences.length}</small></a>
    </div>
    <section className="dashboard-panel timekeeping-results" id="timekeeping-results">
      <div className="panel-heading"><div><span className="eyebrow">{t("workflow.timekeeping.results")}</span><h2>{t("workflow.timekeeping.workers")}</h2></div><Link className="button button--primary button--small" to={`/agency/exports?${exportParams}`}><FileSpreadsheet size={15} />{t("dashboard.quickExports")}</Link></div>
      {matchingWorkers.length === 0 ? <p className="muted-copy">{t("workflow.timekeeping.noMatches")}</p> : <div className="timekeeping-worker-list">{matchingWorkers.map((worker) => {
        const records = scopedShifts.filter((record) => record.shift.workerUid === worker.id).sort((a, b) => b.shift.startAt.localeCompare(a.shift.startAt));
        const absences = scopedAbsences.filter((absence) => absence.workerId === worker.id);
        const confirmed = records.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "confirmed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
        const pending = records.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "pending").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
        const disputed = records.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "disputed").reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
        return <details className="timekeeping-worker-card" key={worker.id}><summary><span><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger><small>{Array.from(new Set(records.map((record) => workspace.factories.find((factory) => factory.id === record.shift.factoryId)?.name).filter(Boolean))).join(", ")}</small></span><span>{records.length} {t("workflow.timekeeping.shifts")}</span><span>{t("workflow.timekeeping.confirmed")}: {formatDuration(confirmed, t)}</span><span>{t("workflow.timekeeping.pending")}: {formatDuration(pending, t)}</span><span>{t("workflow.timekeeping.disputed")}: {formatDuration(disputed, t)}</span><span>{t("workflow.timekeeping.absences")}: {absences.length}</span></summary>
          {records.length === 0 ? <p className="muted-copy">{t("workflow.worker.noShifts")}</p> : <div className="timekeeping-shift-list">{records.map((record) => { const shift = record.shift; const shiftFactory = workspace.factories.find((candidate) => candidate.id === shift.factoryId && candidate.organizationId === record.organizationId); const needsAgencyReview = Boolean(member.role === "agency" && shiftFactory && getProductionWorkflowSettings(shiftFactory).agencyMustReviewShifts && shift.reviewState === "pending"); return <article className="timekeeping-shift-row" key={shift.id}><strong>{formatDate(new Date(shift.localStartDate + "T12:00:00"))}</strong><span>{shiftFactory?.name}</span><span>{formatTime(new Date(shift.startAt))}–{formatTime(new Date(shift.endAt))}</span><span>{t("workflow.fields.gross")}: {formatDuration(shift.grossDurationMinutes, t)}</span><span>{t("workflow.fields.breakDuration")}: {formatDuration(shift.totalBreakDurationMinutes, t)}</span><strong>{t("workflow.fields.paid")}: {formatDuration(shift.paidDurationMinutes, t)}</strong><span className={`status-pill status-pill--${shift.deletedAt ? "cancelled" : shift.workerConfirmation}`}>{shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${shift.workerConfirmation}`)}</span>{needsAgencyReview && <button className="button button--outline button--small" type="button" onClick={() => { const saved = reviewShiftRecord(shift.id, "approve"); showToast(t(saved ? "workflow.production.shiftReviewed" : "workflow.errors.permission"), saved ? "success" : "error"); }}>{t("workflow.production.reviewShift")}</button>}{shift.comment && <small>{shift.comment}</small>}{record.cancellationReason && <small>{t("workflow.shiftCancellation.reason")}: {record.cancellationReason}</small>}<details><summary>{t("workflow.history.open")}</summary>{record.history.map((entry) => <small key={entry.id}>{entry.actorName} · {t(`workflow.history.action.${entry.action}`)} · {formatDate(new Date(entry.occurredAt), { dateStyle: "medium", timeStyle: "short" })}{entry.note ? ` · ${entry.note}` : ""}</small>)}</details></article>; })}</div>}
          {absences.map((absence) => <p className="timekeeping-absence-row" key={absence.id}>{absence.localDate} · {t(`workflow.absence.state.${absence.state}`)} · {t(`workflow.absence.agencyCategory.${absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention")}`)}{absence.agencyNote ? ` · ${absence.agencyNote}` : ""}</p>)}
        </details>;
      })}</div>}
    </section>
    <p className="policy-note">{t("workflow.timekeeping.actualOnly")}</p><span className="sr-only">{member.name}</span>
  </PortalShell>;
}
