import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { getActiveMember, useDemoWorkspace } from "../demo-store";
import { formatDuration } from "../workflow-utils";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";

export function WorkerWorkSummary() {
  const workspace = useDemoWorkspace();
  const member = getActiveMember(workspace);
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const focusedPeriodId = searchParams.get("focus") === "employment" ? searchParams.get("id") ?? "" : "";
  const accountUid = member.accountUid ?? member.id;
  const memberships = workspace.members.filter((item) => item.role === "worker" && (item.accountUid ?? item.id) === accountUid);
  const periods = workspace.employmentPeriods.filter((period) => period.accountUid === accountUid).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const workRecords = workspace.shifts.filter((record) => !record.shift.deletedAt && memberships.some((item) => item.id === record.shift.workerUid && item.organizationId === record.organizationId));
  const totalMinutes = workRecords.reduce((total, record) => total + record.shift.paidDurationMinutes, 0);
  const confirmedMinutes = workRecords.filter((record) => record.shift.workerConfirmation === "confirmed").reduce((total, record) => total + record.shift.paidDurationMinutes, 0);
  const pendingMinutes = workRecords.filter((record) => record.shift.workerConfirmation === "pending").reduce((total, record) => total + record.shift.paidDurationMinutes, 0);
  const disputedCount = workRecords.filter((record) => record.shift.workerConfirmation === "disputed").length;
  const focusTargetId = focusedPeriodId ? `employment-${focusedPeriodId}` : "";
  useTargetHighlight(focusTargetId, Boolean(focusedPeriodId));
  return <>
    <section className="dashboard-panel worker-work-overview">
      <div className="panel-heading"><div><span className="eyebrow">{t("workflow.timekeeping.allPeriods")}</span><h2>{t("workflow.timekeeping.title")}</h2></div><Link className="text-button" to="/worker/shifts">{t("nav.shifts")}</Link></div>
      <div className="workflow-stat-grid workflow-stat-grid--four">
        <div className="workflow-stat-card"><span>{t("workflow.fields.paid")}</span><strong>{formatDuration(totalMinutes, t)}</strong></div>
        <div className="workflow-stat-card"><span>{t("workflow.timekeeping.confirmed")}</span><strong>{formatDuration(confirmedMinutes, t)}</strong></div>
        <div className="workflow-stat-card"><span>{t("workflow.timekeeping.pending")}</span><strong>{formatDuration(pendingMinutes, t)}</strong></div>
        <div className="workflow-stat-card"><span>{t("workflow.dispute.eyebrow")}</span><strong>{disputedCount}</strong></div>
      </div>
    </section>
    <details className="dashboard-panel worker-work-summary" id="worker-work-summary" open>
    <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.employment.eyebrow")}</span><strong>{t("workflow.employment.myWork")}</strong></span><span className="panel-period">{memberships.length}</span></summary>
    {memberships.length === 0 ? <p className="muted-copy">{t("workflow.employment.noAssignments")}</p> : memberships.map((membership) => {
      const org = workspace.organizations.find((item) => item.id === membership.organizationId);
      const workerPeriods = periods.filter((period) => period.organizationId === membership.organizationId && period.workerId === membership.id);
      const latestPeriod = workerPeriods[0];
      const assignments = membership.productionAssignments ?? (membership.factoryId ? [{ factoryId: membership.factoryId, groupId: membership.groupId, leaderId: membership.leaderId }] : []);
      return <article className="worker-employment-card" key={membership.id}>
        <div className="worker-employment-head"><div><strong>{org?.name ?? membership.organizationId}</strong><span>{t("workflow.employment.status." + (latestPeriod?.state ?? "ended"))}</span></div><span>{membership.email || org?.contactEmail || t("workflow.employment.noContact")}</span></div>
        {assignments.map((assignment) => {
          const factory = workspace.factories.find((item) => item.id === assignment.factoryId);
          return <div className="worker-employment-placement" key={assignment.factoryId}><strong>{factory?.name ?? assignment.factoryId}</strong><span>{workspace.groups.find((group) => group.id === assignment.groupId)?.name ?? t("workflow.groups.noGroup")}</span><span>{workspace.members.find((item) => item.id === assignment.leaderId)?.name ?? t("workflow.employment.noLeader")}</span>{factory?.address && <small>{factory.address}</small>}</div>;
        })}
        {workerPeriods.length > 0 && <details className="employment-history-details" open={workerPeriods.some((period) => period.id === focusedPeriodId)}><summary>{t("workflow.employment.history")}</summary>{workerPeriods.map((period) => <article key={period.id} id={`employment-${period.id}`} className="employment-history-row"><strong>{period.startDate}{period.endDate ? " — " + period.endDate : " — " + t("workflow.employment.current")}</strong><span>{t("workflow.employment.status." + period.state)}</span>{period.placements.map((placement) => <small key={placement.id}>{workspace.factories.find((factory) => factory.id === placement.factoryId)?.name}: {placement.startDate}{placement.endDate ? " — " + placement.endDate : ""}</small>)}</article>)}</details>}
      </article>;
    })}
    </details>
  </>;
}
