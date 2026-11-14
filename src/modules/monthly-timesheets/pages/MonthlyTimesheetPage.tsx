import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BadgeCheck, ClipboardCheck, Download, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { PortalShell } from "../../../app/PortalShell";
import { PageHeading } from "../../../components/PageHeading";
import { useToast } from "../../../app/ToastProvider";
import { formatDate } from "../../../shared/formatters";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { acceptMonthlyTimesheet, getActiveMember, getLeaderAccessPermissions, getLeaderProductionMemberships, getProductionWorkflowSettings, getWorkspaceForOrganization, markMonthlyTimesheetReady, reopenMonthlyTimesheet, returnMonthlyTimesheet, submitMonthlyTimesheet, useDemoWorkspace } from "../../workflows/demo-store";
import type { DemoMonthlyTimesheetRow, DemoMonthlyTimesheetStatus } from "../../workflows/domain/demo-types";
import { formatDuration } from "../../workflows/workflow-utils";
import { buildMonthlyTimesheetSnapshot, hasOpenMonthlyIssues, monthlyAttentionReasons, monthlyRecordFlags } from "../domain/timesheet";

type RecordFilter = "all" | "ready" | "check" | "problem" | "absence";

function todayMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthDays(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function rowTotals(rows: DemoMonthlyTimesheetRow[]) {
  return rows.reduce((totals, row) => ({
    shifts: totals.shifts + Number(row.kind === "shift"),
    absences: totals.absences + Number(row.kind === "absence"),
    gross: totals.gross + row.grossDurationMinutes,
    breaks: totals.breaks + row.totalBreakDurationMinutes,
    paid: totals.paid + row.paidDurationMinutes,
  }), { shifts: 0, absences: 0, gross: 0, breaks: 0, paid: 0 });
}

function monthOverlap(startDate: string, endDate: string | undefined, month: string) {
  const from = `${month}-01`;
  const to = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
  return startDate <= to && (endDate ?? "9999-12-31") >= from;
}

function statusTone(status: DemoMonthlyTimesheetStatus) {
  if (status === "accepted_by_agency" || status === "accepted_by_factory" || status === "ready_for_review") return "success";
  if (status === "returned_to_leader" || status === "reopened") return "problem";
  if (status === "submitted_to_agency" || status === "submitted_by_factory") return "sent";
  return "progress";
}

function actorMaySign(workspace: ReturnType<typeof useDemoWorkspace>, factoryId: string, organizationId: string, role: "agency" | "leader" | "factory-admin") {
  const member = getActiveMember(workspace);
  const factory = workspace.factories.find((candidate) => candidate.organizationId === organizationId && candidate.id === factoryId);
  if (!factory) return false;
  const settings = getProductionWorkflowSettings(factory);
  if (role === "leader") return member.role === "leader" && getLeaderProductionMemberships(workspace).some((membership) => membership.organizationId === organizationId && membership.factoryId === factoryId && getLeaderAccessPermissions(membership).canSubmitTimesheet) && settings.leaderCanSubmitTimesheet;
  if (role === "factory-admin") return member.role === "factory-admin" && member.organizationId === organizationId && factory.ownerWorkforce === true;
  return member.role === "agency" && member.organizationId === organizationId && settings.agencyCanSubmitTimesheet;
}

export function MonthlyTimesheetPage() {
  const { t, i18n } = useTranslation();
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const showToast = useToast();
  const role = location.pathname.startsWith("/leader") ? "leader" : location.pathname.startsWith("/factory") ? "factory-admin" : "agency";
  const leaderMemberships = role === "leader" ? getLeaderProductionMemberships(workspace, member.id) : [];
  const factories = workspace.factories.filter((factory) => role === "leader"
    ? leaderMemberships.some((membership) => membership.organizationId === factory.organizationId && membership.factoryId === factory.id)
    : role === "factory-admin" ? factory.organizationId === workspace.organization.id && factory.ownerWorkforce === true
      : factory.organizationId === workspace.organization.id);
  const initialFactoryId = searchParams.get("factory") ?? "";
  const [factoryId, setFactoryId] = useState(() => factories.some((factory) => factory.id === initialFactoryId) ? initialFactoryId : factories[0]?.id ?? "");
  const initialMonth = searchParams.get("month") ?? "";
  const [month, setMonth] = useState(() => /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : todayMonth());
  const [recordFilter, setRecordFilter] = useState<RecordFilter>("all");
  const [workerSearch, setWorkerSearch] = useState("");
  const [expandedWorkers, setExpandedWorkers] = useState<string[]>([]);
  const [focusRecordId, setFocusRecordId] = useState("");
  const [allowOpenIssues, setAllowOpenIssues] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [agencyComment, setAgencyComment] = useState("");
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | "live">("live");
  const factory = factories.find((item) => item.id === factoryId);
  const organizationId = factory?.organizationId ?? workspace.organization.id;
  const organization = workspace.organizations.find((item) => item.id === organizationId) ?? workspace.organization;
  const workflowSettings = factory ? getProductionWorkflowSettings(factory) : undefined;
  const scopedWorkspace = useMemo(() => getWorkspaceForOrganization(workspace, organizationId), [workspace, organizationId]);
  const timesheet = (workspace.monthlyTimesheets ?? []).find((record) => record.organizationId === organizationId && record.factoryId === factoryId && record.month === month);
  const liveSnapshot = useMemo(() => buildMonthlyTimesheetSnapshot(scopedWorkspace, factoryId, month, role === "agency" ? "agency" : "leader"), [scopedWorkspace, factoryId, month, role]);
  const latestVersion = timesheet?.versions.find((version) => version.number === timesheet.currentVersion);
  const lockedStatus = timesheet?.status === "submitted_to_agency" || timesheet?.status === "accepted_by_agency" || timesheet?.status === "submitted_by_factory" || timesheet?.status === "accepted_by_factory";
  const selectedVersion = selectedVersionNumber === "live" ? undefined : timesheet?.versions.find((version) => version.number === selectedVersionNumber);
  const viewedRows = selectedVersion?.rows ?? (lockedStatus && latestVersion ? latestVersion.rows : liveSnapshot.rows);
  const viewedTotals = selectedVersion?.totals ?? (lockedStatus && latestVersion ? latestVersion.totals : liveSnapshot.totals);
  const status = timesheet?.status ?? (month < todayMonth() && liveSnapshot.rows.length > 0 && !hasOpenMonthlyIssues(liveSnapshot.rows) ? "ready_for_review" : "in_progress");
  const openIssues = hasOpenMonthlyIssues(liveSnapshot.rows);
  const canSign = Boolean(factoryId && actorMaySign(workspace, factoryId, organizationId, role));
  const agencyCanReview = role === "agency" && member.role === "agency" && member.organizationId === organizationId && workflowSettings?.agencyMustAcceptTimesheet && timesheet?.status === "submitted_to_agency";
  const factoryCanReview = role === "factory-admin" && member.role === "factory-admin" && member.organizationId === organizationId && factory?.ownerWorkforce === true && timesheet?.status === "submitted_by_factory";
  const exportQuery = new URLSearchParams({ factories: factoryId, periodKind: "month", month }).toString();

  const recordCounts = useMemo(() => {
    const counts: Record<RecordFilter, number> = { all: viewedRows.length, ready: 0, check: 0, problem: 0, absence: 0 };
    for (const row of viewedRows) for (const flag of monthlyRecordFlags(row)) counts[flag] += 1;
    return counts;
  }, [viewedRows]);
  const filteredRows = useMemo(() => viewedRows.filter((row) => recordFilter === "all" || monthlyRecordFlags(row).includes(recordFilter)), [viewedRows, recordFilter]);
  const searchText = workerSearch.trim().toLocaleLowerCase();
  const eligibleWorkerIds = useMemo(() => {
    const startDate = `${month}-01`;
    const endDate = `${month}-${String(monthDays(month)).padStart(2, "0")}`;
    const ids = new Set<string>();
    for (const period of workspace.employmentPeriods) {
      if (period.organizationId !== organizationId || period.startDate > endDate || (period.endDate && period.endDate < startDate)) continue;
      if (period.placements.some((placement) => placement.factoryId === factoryId && monthOverlap(placement.startDate, placement.endDate, month))) ids.add(period.workerId);
    }
    viewedRows.forEach((row) => ids.add(row.workerId));
    return [...ids];
  }, [workspace, factoryId, month, viewedRows, organizationId]);
  const employees = eligibleWorkerIds.map((id) => workspace.members.find((candidate) => candidate.id === id && candidate.organizationId === organizationId && candidate.role === "worker")).filter((worker): worker is NonNullable<typeof worker> => Boolean(worker))
    .filter((worker) => worker.name.toLocaleLowerCase().includes(searchText))
    .map((worker) => ({ worker, rows: filteredRows.filter((row) => row.workerId === worker.id), allRows: viewedRows.filter((row) => row.workerId === worker.id) }))
    .filter((item) => recordFilter === "all" || item.rows.length > 0)
    .sort((left, right) => left.worker.name.localeCompare(right.worker.name));

  const focusId = decodeURIComponentSafe(location.hash.slice(1));
  useTargetHighlight(focusId, Boolean(focusId));
  useTargetHighlight(focusRecordId ? `monthly-record-${focusRecordId}` : "", Boolean(focusRecordId));

  useEffect(() => {
    const requestedTimesheet = searchParams.get("timesheet");
    if (requestedTimesheet && timesheet?.id === requestedTimesheet) {
      document.getElementById(`timesheet-${requestedTimesheet}`)?.scrollIntoView({ block: "start" });
    }
  }, [searchParams, timesheet?.id]);

  function syncScope(nextFactoryId: string, nextMonth: string) {
    setFactoryId(nextFactoryId);
    setMonth(nextMonth);
    setRecordFilter("all");
    setSelectedVersionNumber("live");
    const params = new URLSearchParams(searchParams);
    params.set("factory", nextFactoryId);
    params.set("month", nextMonth);
    params.delete("timesheet");
    setSearchParams(params, { replace: true });
  }

  function confirmReady() {
    const saved = markMonthlyTimesheetReady(factoryId, month, organizationId);
    showToast(t(saved ? "monthlyTimesheets.readySaved" : "monthlyTimesheets.readyBlocked"), saved ? "success" : "error");
  }

  function submitTimesheet() {
    const saved = submitMonthlyTimesheet(factoryId, month, allowOpenIssues, organizationId);
    showToast(t(saved ? (timesheet?.currentVersion ? "monthlyTimesheets.resent" : "monthlyTimesheets.submitted") : "monthlyTimesheets.submitBlocked"), saved ? "success" : "error");
    setAllowOpenIssues(false);
  }

  function reviewTimesheet(action: "accept" | "return" | "reopen") {
    const saved = action === "accept" ? acceptMonthlyTimesheet(timesheet!.id, agencyComment)
      : action === "return" ? returnMonthlyTimesheet(timesheet!.id, returnReason)
        : reopenMonthlyTimesheet(timesheet!.id, reopenReason);
    showToast(t(saved ? `monthlyTimesheets.${action}Saved` : `monthlyTimesheets.${action}Failed`), saved ? "success" : "error");
    if (saved) { setReturnReason(""); setReopenReason(""); setAgencyComment(""); }
  }

  const canSubmit = canSign && viewedRows.length > 0 && !lockedStatus && (!openIssues || allowOpenIssues);
  const latestSignature = latestVersion?.signature;
  const shownHistory = timesheet?.history ?? [];

  return <PortalShell role={role}>
    <PageHeading eyebrow={organization.name} title={t("monthlyTimesheets.title")} description={t("monthlyTimesheets.lead")} action={<Link className="button button--outline button--small" to={role === "leader" ? "/leader" : role === "factory-admin" ? "/factory" : "/agency"}><ArrowLeft size={15} />{t("common.back")}</Link>} />
    <section className="dashboard-panel monthly-timesheet-scope">
      <div className="monthly-scope-fields">
        {(role === "agency" || factories.length > 1) && <label className="field-label"><span>{t("workflow.fields.production")}</span><select value={factoryId} onChange={(event) => syncScope(event.target.value, month)}>{factories.map((item) => <option key={`${item.organizationId}:${item.id}`} value={item.id}>{role === "leader" ? `${workspace.organizations.find((organizationItem) => organizationItem.id === item.organizationId)?.name ?? item.organizationId} · ` : ""}{item.name}</option>)}</select></label>}
        {role === "leader" && <div className="field-label"><span>{t("workflow.fields.production")}</span><strong>{factory?.name ?? "—"}</strong></div>}
        <label className="field-label"><span>{t("exports.periodMonth")}</span><input type="month" value={month} onChange={(event) => syncScope(factoryId, event.target.value)} /></label>
        <label className="field-label"><span>{t("monthlyTimesheets.search")}</span><input value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} /></label>
      </div>
      {role === "agency" && status === "in_progress" && <p className="policy-note">{t("monthlyTimesheets.liveDataNotice")}</p>}
    </section>

    <section className="monthly-timesheet-status-panel" aria-label={t("monthlyTimesheets.recordStatuses")}>
      {(["ready", "check", "problem", "absence"] as const).map((flag) => <button type="button" key={flag} className={`monthly-status-filter monthly-status-filter--${flag}${recordFilter === flag ? " is-active" : ""}`} aria-pressed={recordFilter === flag} onClick={() => {
        setRecordFilter(recordFilter === flag ? "all" : flag);
        const first = viewedRows.find((row) => monthlyRecordFlags(row).includes(flag));
        setExpandedWorkers(first ? [first.workerId] : []);
        setFocusRecordId(first?.id ?? "");
      }}><span>{t(`monthlyTimesheets.recordStatus.${flag}`)}</span><strong>{recordCounts[flag]}</strong></button>)}
      <button type="button" className={`monthly-status-filter monthly-status-filter--all${recordFilter === "all" ? " is-active" : ""}`} aria-pressed={recordFilter === "all"} onClick={() => { setRecordFilter("all"); setFocusRecordId(""); }}><span>{t("common.all")}</span><strong>{recordCounts.all}</strong></button>
    </section>

    <section className="dashboard-panel monthly-timesheet-panel" id={timesheet ? `timesheet-${timesheet.id}` : "monthly-timesheet"}>
      <div className="panel-heading monthly-timesheet-heading"><div><span className="eyebrow">{factory?.name ?? "—"} · {month}</span><h2>{t("monthlyTimesheets.title")}</h2></div><span className={`monthly-lifecycle monthly-lifecycle--${statusTone(status)}`}>{t(`monthlyTimesheets.status.${status}`)}</span></div>
      <div className="monthly-summary-grid">
        <div><span>{t("monthlyTimesheets.workers")}</span><strong>{viewedTotals.workerCount}</strong></div>
        <div><span>{t("monthlyTimesheets.shifts")}</span><strong>{viewedTotals.shiftCount}</strong></div>
        <div><span>{t("monthlyTimesheets.gross")}</span><strong>{formatDuration(viewedTotals.grossDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.breaks")}</span><strong>{formatDuration(viewedTotals.totalBreakDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.paid")}</span><strong>{formatDuration(viewedTotals.paidDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.absences")}</span><strong>{viewedTotals.absenceCount}</strong></div>
      </div>
      <div className="monthly-category-grid">
        <div><span>{t("monthlyTimesheets.ordinary")}</span><strong>{formatDuration(viewedTotals.ordinaryDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.night")}</span><strong>{formatDuration(viewedTotals.nightDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.overtime")}</span><strong>{formatDuration(viewedTotals.overtimeDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.nonWorking")}</span><strong>{formatDuration(viewedTotals.nonWorkingDayDurationMinutes, t)}</strong></div>
        <div><span>{t("monthlyTimesheets.holiday")}</span><strong>{formatDuration(viewedTotals.holidayDurationMinutes, t)}</strong></div>
      </div>
      <p className="monthly-method-note">{t("monthlyTimesheets.categoryNote")}</p>

      {timesheet && timesheet.versions.length > 0 && <div className="monthly-version-picker">
        <label className="field-label"><span>{t("monthlyTimesheets.viewVersion")}</span><select value={selectedVersionNumber === "live" ? (lockedStatus ? String(timesheet.currentVersion) : "live") : String(selectedVersionNumber)} onChange={(event) => { setSelectedVersionNumber(event.target.value === "live" ? "live" : Number(event.target.value)); setRecordFilter("all"); }}>
          {!lockedStatus && <option value="live">{t("monthlyTimesheets.liveVersion")}</option>}
          {timesheet.versions.slice().reverse().map((version) => <option value={version.number} key={version.id}>{t("monthlyTimesheets.versionOption", { number: version.number, date: formatDate(new Date(version.createdAt), { dateStyle: "short", timeStyle: "short" }) })}</option>)}
        </select></label>
        {selectedVersion && <span className="monthly-version-readonly"><ShieldCheck size={15} />{t("monthlyTimesheets.immutableVersion")}</span>}
      </div>}

      <div className="monthly-worker-table-wrap"><table className="monthly-worker-table"><thead><tr><th>{t("workflow.fields.worker")}</th><th>{t("monthlyTimesheets.shifts")}</th><th>{t("monthlyTimesheets.gross")}</th><th>{t("monthlyTimesheets.breaks")}</th><th>{t("monthlyTimesheets.paid")}</th><th>{t("monthlyTimesheets.absences")}</th><th>{t("monthlyTimesheets.recordStatus.title")}</th></tr></thead><tbody>
        {employees.map(({ worker, rows: matchingRows, allRows }) => {
          const totals = rowTotals(allRows);
          const expanded = expandedWorkers.includes(worker.id);
          const employeeFlags = [...new Set(allRows.flatMap((row) => monthlyRecordFlags(row)))].filter((flag) => flag !== "check");
          const employeeReasons = [...new Set(allRows.flatMap((row) => monthlyAttentionReasons(row).map((reason) => reason.code)))];
          return <Fragment key={worker.id}>
            <tr className="monthly-worker-row"><td><button type="button" className="monthly-worker-toggle" aria-expanded={expanded} onClick={() => setExpandedWorkers((current) => expanded ? current.filter((id) => id !== worker.id) : [...current, worker.id])}>{worker.name}</button></td><td>{totals.shifts}</td><td>{formatDuration(totals.gross, t)}</td><td>{formatDuration(totals.breaks, t)}</td><td>{formatDuration(totals.paid, t)}</td><td>{totals.absences}</td><td><div className="monthly-status-tags">{employeeFlags.map((flag) => <span key={flag} className={`monthly-record-tag monthly-record-tag--${flag}`}>{t(`monthlyTimesheets.recordStatus.${flag}`)}</span>)}{employeeReasons.map((reason) => <span key={reason} className="monthly-record-tag monthly-record-tag--check">{t(`monthlyTimesheets.attention.reason.${reason}`)}</span>)}</div></td></tr>
            {expanded && <tr className="monthly-worker-detail"><td colSpan={7}><div className="monthly-record-list">{matchingRows.length === 0 ? <p className="muted-copy">{t("monthlyTimesheets.noRecords")}</p> : matchingRows.map((row) => <MonthlyRecord row={row} key={row.id} role={role} factoryId={factoryId} t={t} i18nLanguage={i18n.language} selected={row.id === focusRecordId} onOpen={() => setFocusRecordId(row.id)} />)}</div></td></tr>}
          </Fragment>;
        })}
        {employees.length === 0 && <tr><td colSpan={7}><p className="muted-copy">{t("monthlyTimesheets.noRecords")}</p></td></tr>}
      </tbody><tfoot><tr><th>{t("monthlyTimesheets.productionTotal")}</th><th>{viewedTotals.shiftCount}</th><th>{formatDuration(viewedTotals.grossDurationMinutes, t)}</th><th>{formatDuration(viewedTotals.totalBreakDurationMinutes, t)}</th><th>{formatDuration(viewedTotals.paidDurationMinutes, t)}</th><th>{viewedTotals.absenceCount}</th><th>{t(`monthlyTimesheets.status.${status}`)}</th></tr></tfoot></table></div>

      {latestSignature && <section className="monthly-signature" aria-label={t("monthlyTimesheets.signature.title")}>
        <div className="monthly-signature-icon"><BadgeCheck size={21} /></div><div className="monthly-signature-body"><strong>{t("monthlyTimesheets.signature.title")}</strong><b>{latestSignature.signerName}</b><span>{t(latestSignature.signerRole === "leader" ? "monthlyTimesheets.signature.leader" : latestSignature.signerRole === "factory-admin" ? "monthlyTimesheets.signature.factory" : "monthlyTimesheets.signature.agency")}</span><span>{t("monthlyTimesheets.signature.production")}: {latestSignature.factoryName} · {t("monthlyTimesheets.signature.month")}: {latestSignature.month} · {t("monthlyTimesheets.signature.version")}: {latestSignature.version}</span><span>{t("monthlyTimesheets.signature.date")}: {new Intl.DateTimeFormat(i18n.language, { dateStyle: "short" }).format(new Date(latestSignature.signedAt))} · {t("monthlyTimesheets.signature.time")}: {new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }).format(new Date(latestSignature.signedAt))}</span><span className="monthly-signature-status"><BadgeCheck size={14} />{t("monthlyTimesheets.signature.confirmed")}</span><small>{t("monthlyTimesheets.signature.disclaimer")}</small></div>
      </section>}

      {!timesheet && role === "agency" && <p className="muted-copy">{t("monthlyTimesheets.noSubmission")}</p>}
      {canSign && !lockedStatus && <section className="monthly-submit-panel">
        {status !== "ready_for_review" && !openIssues && <button type="button" className="button button--outline" onClick={confirmReady}><ClipboardCheck size={16} />{t("monthlyTimesheets.markReady")}</button>}
        {openIssues && <div className="monthly-warning"><strong>{t("monthlyTimesheets.openIssuesTitle")}</strong><span>{t("monthlyTimesheets.openIssuesDescription", { check: recordCounts.check, problem: recordCounts.problem })}</span></div>}
        {openIssues && <label className="monthly-acknowledge"><input type="checkbox" checked={allowOpenIssues} onChange={(event) => setAllowOpenIssues(event.target.checked)} /><span>{t("monthlyTimesheets.acknowledgeOpenIssues")}</span></label>}
        <button type="button" className="button button--primary" disabled={!canSubmit} onClick={submitTimesheet}><Send size={16} />{t(timesheet?.currentVersion ? "monthlyTimesheets.confirmResend" : "monthlyTimesheets.confirmAndSend")}</button>
      </section>}

      {agencyCanReview && timesheet && <section className="monthly-agency-review">
        <h3>{t("monthlyTimesheets.agencyReview")}</h3>
        <label className="field-label"><span>{t("monthlyTimesheets.comment")}</span><textarea rows={2} value={agencyComment} onChange={(event) => setAgencyComment(event.target.value)} /></label>
        <div className="monthly-review-actions"><button type="button" className="button button--primary" onClick={() => reviewTimesheet("accept")}><BadgeCheck size={16} />{t("monthlyTimesheets.accept")}</button><button type="button" className="button button--outline" onClick={() => reviewTimesheet("return")} disabled={!returnReason.trim()}><RotateCcw size={15} />{t("monthlyTimesheets.return")}</button></div>
        <label className="field-label"><span>{t("monthlyTimesheets.returnReason")}</span><textarea rows={2} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} required /></label>
      </section>}
      {factoryCanReview && timesheet && <section className="monthly-agency-review">
        <h3>{t("monthlyTimesheets.factoryReview")}</h3>
        <label className="field-label"><span>{t("monthlyTimesheets.comment")}</span><textarea rows={2} value={agencyComment} onChange={(event) => setAgencyComment(event.target.value)} /></label>
        <div className="monthly-review-actions"><button type="button" className="button button--primary" onClick={() => reviewTimesheet("accept")}><BadgeCheck size={16} />{t("monthlyTimesheets.accept")}</button><button type="button" className="button button--outline" onClick={() => reviewTimesheet("return")} disabled={!returnReason.trim()}><RotateCcw size={15} />{t("monthlyTimesheets.return")}</button></div>
        <label className="field-label"><span>{t("monthlyTimesheets.returnReason")}</span><textarea rows={2} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} required /></label>
      </section>}
      {(role === "agency" && timesheet?.status === "accepted_by_agency" || role === "factory-admin" && timesheet?.status === "accepted_by_factory") && <section className="monthly-agency-review"><h3>{t("monthlyTimesheets.reopenTitle")}</h3><label className="field-label"><span>{t("monthlyTimesheets.reopenReason")}</span><textarea rows={2} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} required /></label><button type="button" className="button button--outline" disabled={!reopenReason.trim()} onClick={() => reviewTimesheet("reopen")}><RotateCcw size={15} />{t("monthlyTimesheets.reopen")}</button></section>}

      <div className="monthly-footer-actions">
        {role === "agency" && <Link className="button button--outline button--small" to={`/agency/exports?${exportQuery}`}><Download size={15} />{t("monthlyTimesheets.export")}</Link>}
        {timesheet && <details className="monthly-history"><summary>{t("monthlyTimesheets.history", { count: shownHistory.length })}</summary><ol>{shownHistory.slice().reverse().map((event) => <li key={event.id}><strong>{t(`monthlyTimesheets.event.${event.action}`)}</strong><span>{event.actorName} · {t(`workflow.role.${event.actorRole}`, event.actorRole)} · {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</span>{event.version && <small>{t("monthlyTimesheets.versionNumber", { number: event.version })}</small>}{event.note && <p>{event.note === "submitted-with-open-issues" ? t("monthlyTimesheets.sentWithIssues") : event.note === "source-data-changed" ? t("monthlyTimesheets.sourceChanged") : event.note}</p>}</li>)}</ol></details>}
      </div>
    </section>
  </PortalShell>;
}

function decodeURIComponentSafe(value: string) { try { return decodeURIComponent(value); } catch { return value; } }

function MonthlyRecord({ row, role, factoryId, t, i18nLanguage, selected, onOpen }: { row: DemoMonthlyTimesheetRow; role: "agency" | "leader" | "factory-admin"; factoryId: string; t: TFunction; i18nLanguage: string; selected: boolean; onOpen: () => void }) {
  const weekday = new Intl.DateTimeFormat(i18nLanguage, { weekday: "long", timeZone: "UTC" }).format(new Date(`${row.localDate}T12:00:00Z`));
  const flags = monthlyRecordFlags(row);
  const reasons = monthlyAttentionReasons(row);
  const attentionDetails = selected && reasons.length > 0 && <div className="monthly-attention-details" role="region" aria-label={t("monthlyTimesheets.attention.title")}><strong>{t("monthlyTimesheets.attention.title")}</strong>{reasons.map((reason, index) => <div className="monthly-attention-reason" key={`${reason.code}-${index}`}><b>{t(`monthlyTimesheets.attention.reason.${reason.code}`)}</b><span>{t("monthlyTimesheets.attention.responsible", { role: t(`monthlyTimesheets.attention.role.${reason.responsible}`) })}</span><span>{t(`monthlyTimesheets.attention.action.${reason.code}`)}</span>{reason.detail && <small>{reason.detail}</small>}</div>)}{role === "agency" && row.kind === "shift" && <Link className="text-button" to={`/agency/timekeeping?factory=${encodeURIComponent(factoryId)}&worker=${encodeURIComponent(row.workerId)}&month=${encodeURIComponent(row.localDate.slice(0, 7))}`} onClick={(event) => event.stopPropagation()}>{t("monthlyTimesheets.openShift")}</Link>}</div>;
  return <article id={`monthly-record-${row.id}`} className={`monthly-record${selected ? " is-selected" : ""} monthly-record--${row.kind}`} onClick={onOpen}>
    <button type="button" className="monthly-record-head" aria-expanded={selected} onClick={(event) => { event.stopPropagation(); onOpen(); }}><strong>{formatDate(new Date(`${row.localDate}T12:00:00`))} · {weekday}</strong><div className="monthly-status-tags">{flags.map((flag) => <span key={flag} className={`monthly-record-tag monthly-record-tag--${flag}`}>{t(`monthlyTimesheets.recordStatus.${flag}`)}</span>)}</div></button>
    {row.kind === "shift" ? <><div className="monthly-record-facts"><span>{t("monthlyTimesheets.shift")}: {row.startAt ? new Intl.DateTimeFormat(i18nLanguage, { timeStyle: "short" }).format(new Date(row.startAt)) : "—"}–{row.endAt ? new Intl.DateTimeFormat(i18nLanguage, { timeStyle: "short" }).format(new Date(row.endAt)) : "—"}</span><span>{t("monthlyTimesheets.gross")}: {formatDuration(row.grossDurationMinutes, t)}</span><span>{t("monthlyTimesheets.breaks")}: {formatDuration(row.totalBreakDurationMinutes, t)}{row.breakTreatment ? ` · ${t(`monthlyTimesheets.breakTreatment.${row.breakTreatment}`)}` : ""}</span><span>{t("monthlyTimesheets.paid")}: {formatDuration(row.paidDurationMinutes, t)}</span><span>{t("monthlyTimesheets.night")}: {formatDuration(row.nightDurationMinutes, t)}</span><span>{t("monthlyTimesheets.confirmation")}: {t(`workflow.shiftStatus.${row.workerConfirmation ?? "not-required"}`)}</span></div>{row.comment && <p className="monthly-record-comment">{row.comment}</p>}
      {role === "leader" && <Link className="text-button" to={`/leader/reviews?focus=shift&id=${encodeURIComponent(row.recordId)}#leader-shift-${encodeURIComponent(row.recordId)}`} onClick={(event) => event.stopPropagation()}>{t("monthlyTimesheets.openShift")}</Link>}
      {row.shiftHistory && row.shiftHistory.length > 0 && <details className="monthly-record-history" onClick={(event) => event.stopPropagation()}><summary>{t("workflow.history.open")}</summary>{row.shiftHistory.map((event) => <p key={event.id}>{event.actorName} · {t(`workflow.history.action.${event.action}`, event.action)} · {new Intl.DateTimeFormat(i18nLanguage, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.occurredAt))}{event.note ? ` · ${event.note}` : ""}</p>)}</details>}</>
      : <><span className="monthly-absence-label">{t(`workflow.absence.agencyCategory.${row.absenceCategory ?? "attention"}`)}</span>{row.comment && <p className="monthly-record-comment">{row.comment}</p>}</>}
    {attentionDetails}{selected && reasons.length === 0 && <p className="monthly-checked-status"><BadgeCheck size={15} />{t("monthlyTimesheets.recordStatus.ready")}</p>}
  </article>;
}
