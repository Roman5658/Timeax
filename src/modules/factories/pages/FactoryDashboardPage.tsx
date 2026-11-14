import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Check, ClipboardList, Copy, Plus, Send, ShieldCheck, UsersRound, X, XCircle } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { useToast } from "../../../app/ToastProvider";
import { activateFactoryDemoSubscription, assignBusinessWorkerToTeam, createAgencyConnectionInvitation, createBusinessDepartment, createBusinessGroupForWorkers, createBusinessLeaderInvitation, createBusinessWorksite, createFactoryWorker, deactivateFactoryDemoSubscription, getActiveBusinessEntity, getActiveMember, getBusinessAgencyWorkerCount, getBusinessWorksiteActualSummary, getBusinessWorksiteRoster, getFactorySubscriptionSummary, getLeaderInvitationUrl, resolveLeaderConnectionRequest, resolveWorksiteConnectionRequest, revokeBusinessLeaderInvitation, useDemoWorkspace } from "../../workflows/demo-store";
import type { DemoBusinessWorksiteRosterEntry, DemoLeaderWorksiteMembership } from "../../workflows/domain/demo-types";
import { effectiveLeaderPermissions } from "../../workflows/domain/access";
import { formatDuration } from "../../workflows/workflow-utils";
import { ScheduleCenter } from "../../workflows/components/ScheduleCenter";
import { MessageCenter } from "../../workflows/components/MessageCenter";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";

type FactorySection = "overview" | "agencies" | "workers" | "teams" | "timekeeping" | "schedule" | "messages" | "timesheets" | "settings";

export function FactoryDashboardPage({ section = "overview" }: { section?: FactorySection }) {
  const workspace = useDemoWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const { t } = useTranslation();
  const toast = useToast();
const activeSection = section;
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [agencyFilter, setAgencyFilter] = useState("");
  const [workerCategoryFilter, setWorkerCategoryFilter] = useState<"all" | "agency" | "factory">("all");
  const [workerStatusFilter, setWorkerStatusFilter] = useState<"all" | "active" | "away">("all");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [leaderFilter, setLeaderFilter] = useState("");
  const [search, setSearch] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [leaderEmail, setLeaderEmail] = useState("");
  const [leaderDepartments, setLeaderDepartments] = useState<string[]>([]);
  const [leaderOrganizations, setLeaderOrganizations] = useState<string[]>([]);
  const [leaderInviteUrl, setLeaderInviteUrl] = useState("");
  const [leaderPermissions, setLeaderPermissions] = useState<DemoLeaderWorksiteMembership["permissions"]>({ canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: false, canManageGroups: false });
  const [leaderRequestOrganizationScopes, setLeaderRequestOrganizationScopes] = useState<Record<string, string[]>>({});
  const [leaderRequestDepartmentScopes, setLeaderRequestDepartmentScopes] = useState<Record<string, string[]>>({});
  const [leaderRequestPermissions, setLeaderRequestPermissions] = useState<Record<string, DemoLeaderWorksiteMembership["permissions"]>>({});
  const [subscriptionTierId, setSubscriptionTierId] = useState(() => workspace.subscriptions?.find((item) => item.payerType === "factory" && item.payerId === actor.businessEntityId)?.tierId
    ?? workspace.subscriptionTiers?.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? "");
  const [factoryWorkerName, setFactoryWorkerName] = useState("");
  const [factoryWorkerEmail, setFactoryWorkerEmail] = useState("");
  const [factoryWorkerPhone, setFactoryWorkerPhone] = useState("");
  const [newWorksiteName, setNewWorksiteName] = useState("");
  const [newWorksiteAddress, setNewWorksiteAddress] = useState("");
  const [newWorksiteIdentifier, setNewWorksiteIdentifier] = useState("");
  const [agencySearch, setAgencySearch] = useState("");
  const [selectedInviteAgencyId, setSelectedInviteAgencyId] = useState("");
  const [agencyInvitationText, setAgencyInvitationText] = useState("");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedDepartmentLeaderUid, setSelectedDepartmentLeaderUid] = useState("");
  const [selectedRosterWorkerIds, setSelectedRosterWorkerIds] = useState<string[]>([]);
  const [inlineGroupName, setInlineGroupName] = useState("");
  const [inlineGroupDepartmentId, setInlineGroupDepartmentId] = useState("");
  const [inlineGroupLeaderUid, setInlineGroupLeaderUid] = useState("");
  const [showInlineGroupForm, setShowInlineGroupForm] = useState(false);

  const actorAccountUid = actor.accountUid ?? actor.id;
  const visibleLeaderSiteMemberships = actor.role === "leader"
    ? (workspace.leaderWorksiteMemberships ?? []).filter((membership) => membership.businessEntityId === entity?.id && membership.accountUid === actorAccountUid && membership.state === "active" && membership.permissions.canViewWorkers
      && (membership.organizationIds ?? []).some((organizationId) => (workspace.agencyWorksites ?? []).some((connection) => connection.businessEntityId === membership.businessEntityId && connection.worksiteId === membership.worksiteId && connection.organizationId === organizationId && connection.state === "active")
        && workspace.members.some((member) => member.role === "leader" && member.organizationId === organizationId && (member.accountUid ?? member.id) === actorAccountUid && member.accessState !== "suspended" && member.accessState !== "revoked"
          && effectiveLeaderPermissions(member).canViewWorkers && workspace.factories.some((factory) => factory.id === member.factoryId && factory.organizationId === organizationId && factory.worksiteId === membership.worksiteId))))
    : [];
  const visibleLeaderSiteIds = new Set(visibleLeaderSiteMemberships.map((membership) => membership.worksiteId));
  const sites = (workspace.worksites ?? []).filter((site) => entity && site.businessEntityId === entity.id && (actor.role === "factory-admin" || visibleLeaderSiteIds.has(site.id)));
  const site = sites.find((item) => item.id === selectedSiteId) ?? sites[0];
  const siteLeaderMembership = visibleLeaderSiteMemberships.find((membership) => membership.worksiteId === site?.id);
  const requests = (workspace.worksiteConnectionRequests ?? []).filter((request) => entity && request.businessEntityId === entity.id && request.state === "pending" && (request.direction ?? "agency-request") === "agency-request");
  const outgoingAgencyInvitations = (workspace.worksiteConnectionRequests ?? []).filter((request) => entity && request.businessEntityId === entity.id && request.state === "pending" && request.direction === "factory-invitation");
  const departments = (workspace.departments ?? []).filter((department) => site && department.businessEntityId === entity?.id && department.worksiteId === site.id && !department.archivedAt
    && (actor.role !== "leader" || !siteLeaderMembership?.departmentIds.length || siteLeaderMembership.departmentIds.includes(department.id)));
  const allSiteConnections = (workspace.agencyWorksites ?? []).filter((connection) => site && connection.businessEntityId === entity?.id && connection.worksiteId === site.id && connection.state === "active");
  const hasLocalLeaderAccess = (organizationId: string, accountUid: string) => workspace.members.some((member) => member.role === "leader" && member.organizationId === organizationId
    && (member.accountUid ?? member.id) === accountUid && member.accessState !== "suspended" && member.accessState !== "revoked"
    && effectiveLeaderPermissions(member).canViewWorkers && workspace.factories.some((factory) => factory.id === member.factoryId && factory.organizationId === organizationId && factory.worksiteId === site?.id));
  const connections = allSiteConnections.filter((connection) => actor.role === "factory-admin"
    || Boolean(siteLeaderMembership?.organizationIds?.includes(connection.organizationId) && hasLocalLeaderAccess(connection.organizationId, actorAccountUid)));
  const allSiteLeaders = (workspace.leaderWorksiteMemberships ?? []).filter((leader) => site && leader.businessEntityId === entity?.id && leader.worksiteId === site.id && leader.state === "active");
  const leaders = actor.role === "factory-admin" ? allSiteLeaders : allSiteLeaders.filter((leader) => connections.some((connection) => leader.organizationIds?.includes(connection.organizationId) && hasLocalLeaderAccess(connection.organizationId, leader.accountUid)));
  const leaderInvitations = actor.role === "factory-admin" ? (workspace.leaderInvitations ?? []).filter((invitation) => site && invitation.businessEntityId === entity?.id && invitation.worksiteId === site.id && invitation.state === "pending") : [];
  const leaderRequests = actor.role === "factory-admin" ? (workspace.leaderConnectionRequests ?? []).filter((request) => site && request.businessEntityId === entity?.id && request.worksiteId === site.id && request.state === "pending") : [];
  const agencyOptions = connections.flatMap((connection) => {
    const organization = workspace.organizations.find((item) => item.id === connection.organizationId);
    return organization ? [{ id: organization.id, name: organization.name }] : [];
  });
  const hasOwnedWorkforceAtSite = Boolean(site && workspace.factories.some((factory) => factory.organizationId === entity?.organizationId && factory.worksiteId === site.id && factory.ownerWorkforce && !factory.archivedAt));
  const leaderOrganizationOptions = hasOwnedWorkforceAtSite && entity
    ? [...agencyOptions, { id: entity.organizationId, name: entity.name }]
    : agencyOptions;
  const roster = useMemo(() => site ? getBusinessWorksiteRoster(site.id, {
    organizationId: workerCategoryFilter === "factory" ? undefined : agencyFilter || undefined,
    departmentId: departmentFilter || undefined,
    leaderAccountUid: leaderFilter || undefined,
    search: search || undefined,
    workerCategory: workerCategoryFilter === "all" ? undefined : workerCategoryFilter,
    workerStatus: workerStatusFilter,
  }) : [], [site?.id, agencyFilter, workerCategoryFilter, workerStatusFilter, departmentFilter, leaderFilter, search, workspace]);
  const actualSummary = site && actor.role === "factory-admin" ? getBusinessWorksiteActualSummary(site.id, month) : [];
  const visibleWorkerKeys = new Set(roster.map((row) => `${row.organizationId}:${row.worker.id}`));
  const visibleFactoryIds = new Set(roster.map((row) => row.factoryId));
  const connectedAgencyIds = new Set(connections.map((connection) => connection.organizationId));
  const siteFactoryIds = new Set(workspace.factories.filter((factory) => site && factory.worksiteId === site.id && (factory.ownerWorkforce && factory.organizationId === entity?.organizationId || connectedAgencyIds.has(factory.organizationId))).map((factory) => factory.id));
  const confirmedActualMinutes = workspace.shifts.filter((record) => visibleWorkerKeys.has(`${record.organizationId}:${record.shift.workerUid}`) && visibleFactoryIds.has(record.shift.factoryId ?? "") && record.shift.workerConfirmation === "confirmed" && !record.shift.deletedAt).reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0);
  const readyAgencyTimesheets = (workspace.monthlyTimesheets ?? []).filter((timesheet) => connectedAgencyIds.has(timesheet.organizationId) && siteFactoryIds.has(timesheet.factoryId) && timesheet.status === "ready_for_review");
  const internalFactoryTimesheets = (workspace.monthlyTimesheets ?? []).filter((timesheet) => timesheet.organizationId === entity?.organizationId && siteFactoryIds.has(timesheet.factoryId) && ["submitted_by_factory", "accepted_by_factory"].includes(timesheet.status));
  const selectedDepartment = departments.find((item) => item.id === selectedDepartmentId);
  const departmentRoster = selectedDepartment ? roster.filter((row) => row.departmentId === selectedDepartment.id) : [];
  const departmentLeaders = selectedDepartment ? leaders.filter((leader) => !leader.departmentIds.length || leader.departmentIds.includes(selectedDepartment.id)) : [];
  const departmentGroups = [...new Set(departmentRoster.flatMap((row) => {
    const period = workspace.employmentPeriods.find((item) => item.id === row.employmentId && item.organizationId === row.organizationId);
    const placement = period?.placements.find((item) => item.factoryId === row.factoryId);
    return placement?.groupId ? [placement.groupId] : [];
  }))].flatMap((groupId) => { const group = workspace.groups.find((item) => item.id === groupId); return group ? [group] : []; });
  const departmentActualShifts = departmentRoster.flatMap((row) => workspace.shifts.filter((record) => record.organizationId === row.organizationId && record.shift.factoryId === row.factoryId && record.shift.workerUid === row.worker.id && !record.shift.deletedAt).map((record) => ({ row, shift: record.shift }))).sort((left, right) => right.shift.startAt.localeCompare(left.shift.startAt));
  const selectedRosterRows = selectedRosterWorkerIds.flatMap((workerId) => { const row = roster.find((item) => item.worker.id === workerId); return row ? [row] : []; });
  const selectedRosterOrganizationId = selectedRosterRows[0]?.organizationId ?? "";
  const inlineGroupLeaders = leaders.filter((leader) => leader.organizationIds?.includes(selectedRosterOrganizationId) && (!inlineGroupDepartmentId || !leader.departmentIds.length || leader.departmentIds.includes(inlineGroupDepartmentId)));
  const registeredAgencyChoices = workspace.organizations.filter((organization) => organization.type === "agency" && `${organization.name} ${organization.id} ${organization.contactEmail ?? ""}`.toLocaleLowerCase().includes(agencySearch.trim().toLocaleLowerCase()));
  const factorySubscription = actor.role === "factory-admin" ? getFactorySubscriptionSummary(workspace) : undefined;
  const factoryCapacityReached = Boolean(factorySubscription && factorySubscription.capacity !== null && factorySubscription.usedWorkers >= factorySubscription.capacity);
  const factoryCanCreateOwnedWorker = factorySubscription?.status === "test-active" && !factoryCapacityReached;
  const agencyWorkerCount = actor.role === "factory-admin" ? getBusinessAgencyWorkerCount(workspace) : 0;
  const subscriptionTiers = workspace.subscriptionTiers?.slice().sort((a, b) => a.sortOrder - b.sortOrder) ?? [];

  useEffect(() => {
    setSelectedRosterWorkerIds([]);
  }, [site?.id, agencyFilter, workerCategoryFilter, departmentFilter, leaderFilter, search]);

  if (actor.role !== "factory-admin" && actor.role !== "leader") {
    return <Navigate replace to={actor.role === "agency" ? "/agency" : actor.role === "worker" ? "/worker" : "/leader"} />;
  }
  if (actor.role === "leader" && activeSection !== "overview" && activeSection !== "workers") {
    return <Navigate replace to="/factory/workers" />;
  }

  function createOwnedWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    const worker = createFactoryWorker({ name: factoryWorkerName, email: factoryWorkerEmail, phone: factoryWorkerPhone, worksiteId: site.id });
    toast(worker ? t("factorySubscription.workerCreated") : t("workflow.errors.permission"), worker ? "success" : "error");
    if (worker) { setFactoryWorkerName(""); setFactoryWorkerEmail(""); setFactoryWorkerPhone(""); }
  }

  function decideRequest(requestId: string, decision: "approve" | "decline") {
    const saved = resolveWorksiteConnectionRequest(requestId, decision);
    toast(saved ? t(decision === "approve" ? "workflow.factory.requestApproved" : "workflow.factory.requestDeclined") : t("workflow.errors.permission"), saved ? "success" : "error");
  }

  function decideLeaderRequest(requestId: string, decision: "approve" | "decline") {
    const permissions = leaderRequestPermissions[requestId] ?? { canViewWorkers: true, canRecordHours: false, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: false, canManageGroups: false };
    const saved = resolveLeaderConnectionRequest(requestId, decision, decision === "approve" ? {
      organizationIds: leaderRequestOrganizationScopes[requestId] ?? [],
      departmentIds: leaderRequestDepartmentScopes[requestId] ?? [],
      permissions,
    } : undefined);
    toast(saved ? t(decision === "approve" ? "workflow.factory.leaderRequestApproved" : "workflow.factory.leaderRequestDeclined") : t("workflow.errors.permission"), saved ? "success" : "error");
  }

  async function copyLeaderInvite(url: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      toast(t("workflow.factory.invitationCopied"), "success");
    } catch {
      toast(t("workflow.factory.copyManually"), "error");
    }
  }

  function addDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    const department = createBusinessDepartment(site.id, departmentName);
    toast(department ? t("workflow.factory.departmentAdded") : t("workflow.factory.departmentDuplicate"), department ? "success" : "error");
    if (department) setDepartmentName("");
  }

  function createAgencyInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site || !selectedInviteAgencyId) return;
    const agency = workspace.organizations.find((item) => item.id === selectedInviteAgencyId && item.type === "agency");
    const result = createAgencyConnectionInvitation(selectedInviteAgencyId, site.id);
    if (result.kind === "invalid") { toast(t("workflow.factory.invitationCouldNotCreate"), "error"); return; }
    if (result.kind === "connected") { toast(t("workflow.factory.agencyAlreadyConnected"), "error"); return; }
    if (result.kind === "requested") { toast(t("workflow.factory.agencyAlreadyRequested"), "error"); return; }
    const central = entity;
    const inviteUrl = `${window.location.origin}/agency/productions#agency-invitation-${result.request.id}`;
    const inviteText = [
      t("workflow.factory.invitationTextTitle", { agency: agency?.name ?? "" }),
      `${t("workflow.factory.company")}: ${central?.name ?? "—"}`,
      `${t("workflow.factory.nip")}: ${central?.nip ?? "—"}`,
      `${t("workflow.factory.city")}: ${central?.city ?? "—"}`,
      `${t("workflow.factory.centralIdentifier")}: ${central?.identifier ?? "—"}`,
      `${t("workflow.factory.worksite")}: ${site.name}`,
      `${t("workflow.factory.worksiteAddress")}: ${site.address ?? "—"}`,
      `${t("workflow.factory.worksiteIdentifier")}: ${site.identifier ?? "—"}`,
      inviteUrl,
    ].join("\n");
    setAgencyInvitationText(inviteText);
    toast(t(result.kind === "created" ? "workflow.factory.agencyInvitationCreated" : "workflow.factory.agencyInvitationAlreadyPending"), "success");
  }

  async function copyAgencyInvite() {
    if (!agencyInvitationText) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(agencyInvitationText);
      toast(t("workflow.factory.invitationCopied"), "success");
    } catch {
      toast(t("workflow.factory.copyManually"), "error");
    }
  }

  function toggleRosterWorker(row: DemoBusinessWorksiteRosterEntry) {
    setSelectedRosterWorkerIds((current) => {
      if (current.includes(row.worker.id)) return current.filter((id) => id !== row.worker.id);
      const currentRows = current.flatMap((id) => { const item = roster.find((entry) => entry.worker.id === id); return item ? [item] : []; });
      if (currentRows.some((item) => item.organizationId !== row.organizationId || item.factoryId !== row.factoryId)) {
        toast(t("workflow.factory.groupSelectOneProduction"), "error");
        return current;
      }
      return [...current, row.worker.id];
    });
  }

  function createInlineGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    const saved = createBusinessGroupForWorkers({ worksiteId: site.id, workerIds: selectedRosterWorkerIds, name: inlineGroupName, departmentId: inlineGroupDepartmentId || undefined, leaderAccountUid: inlineGroupLeaderUid || undefined });
    toast(t(saved ? "workflow.factory.groupCreatedAndAssigned" : "workflow.errors.permission"), saved ? "success" : "error");
    if (saved) { setSelectedRosterWorkerIds([]); setInlineGroupName(""); setInlineGroupDepartmentId(""); setInlineGroupLeaderUid(""); setShowInlineGroupForm(false); }
  }

  function addWorksite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const worksite = createBusinessWorksite({ name: newWorksiteName, address: newWorksiteAddress, identifier: newWorksiteIdentifier });
    toast(worksite ? t("workflow.factory.worksiteSaved") : t("workflow.errors.permission"), worksite ? "success" : "error");
    if (worksite) { setSelectedSiteId(worksite.id); setNewWorksiteName(""); setNewWorksiteAddress(""); setNewWorksiteIdentifier(""); }
  }

  function addLeader(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!site) return;
    const result = createBusinessLeaderInvitation(site.id, { name: leaderName, email: leaderEmail, departmentIds: leaderDepartments, organizationIds: leaderOrganizations, permissions: leaderPermissions });
    toast(result ? t("workflow.factory.leaderInvitationCreated") : t("workflow.factory.leaderCouldNotAdd"), result ? "success" : "error");
    if (result) { setLeaderName(""); setLeaderEmail(""); setLeaderDepartments([]); setLeaderOrganizations([]); setLeaderPermissions({ canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: false, canManageGroups: false }); setLeaderInviteUrl(result.url); }
  }

  function toggleLeaderDepartment(departmentId: string) {
    setLeaderDepartments((current) => current.includes(departmentId) ? current.filter((id) => id !== departmentId) : [...current, departmentId]);
  }

const sectionTitle = activeSection === "overview" ? t("workflow.factory.title")
: activeSection === "schedule" ? t("workflow.schedule.title")
: activeSection === "messages" ? t("workflow.messagesCenter.title")
: t(`workflow.factory.sections.${activeSection}`);

return <PortalShell role={actor.role} navigationMode={actor.role === "leader" ? "factory-leader" : undefined}>
<PageHeading eyebrow={entity?.name ?? t("nav.factoryHome")} title={sectionTitle} description={activeSection === "overview" ? t("workflow.factory.lead") : undefined} />
    {!entity && <section className="dashboard-panel"><p className="muted-copy">{t("workflow.factory.noCompany")}</p></section>}
    {entity && <>
      <section className="dashboard-panel">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.worksite")}</span><h2>{site?.name ?? t("workflow.factory.noWorksites")}</h2></div><Building2 size={19} />
          {sites.length > 1 && <label className="field-label"><span>{t("workflow.factory.selectWorksite")}</span><select value={site?.id ?? ""} onChange={(event) => { setSelectedSiteId(event.target.value); setAgencyFilter(""); setDepartmentFilter(""); setLeaderFilter(""); setSelectedDepartmentId(""); setInlineGroupDepartmentId(""); }}>
            {sites.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.address}</option>)}
          </select></label>}
        </div>
        {site && <p className="muted-copy">{site.address} {site.identifier ? `· ${site.identifier}` : ""}</p>}
      </section>

      {activeSection === "overview" && <section className="dashboard-panel factory-daily-overview">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.dailyOverview")}</span><h2>{t("workflow.factory.dailyOverview")}</h2></div></div>
        <div className="factory-overview-grid">
<Link className="factory-overview-card" to="/factory/workers"><span>{t("workflow.factory.availableWorkers")}</span><strong>{roster.filter((row) => !row.leaderAccountUid).length}</strong><small>{t("workflow.factory.availableWorkersHelp")}</small></Link>
<Link className="factory-overview-card" to={actor.role === "factory-admin" ? "/factory/teams" : "/factory/workers"}><span>{t("workflow.factory.assignedWorkers")}</span><strong>{roster.filter((row) => Boolean(row.leaderAccountUid)).length}</strong><small>{t("workflow.factory.assignedWorkersHelp")}</small></Link>
{actor.role === "factory-admin" && <>
<Link className="factory-overview-card" to="/factory/timekeeping"><span>{t("workflow.factory.confirmedHours")}</span><strong>{formatDuration(confirmedActualMinutes, t)}</strong><small>{t("workflow.factory.confirmedHoursHelp")}</small></Link>
<Link className="factory-overview-card" to="/factory/timesheets"><span>{t("workflow.factory.readyAgencyTimesheets")}</span><strong>{readyAgencyTimesheets.length}</strong><small>{t("workflow.factory.readyAgencyTimesheetsHelp")}</small></Link>
<Link className="factory-overview-card" to="/factory/timesheets"><span>{t("workflow.factory.internalFactoryTimesheets")}</span><strong>{internalFactoryTimesheets.length}</strong><small>{t("workflow.factory.internalFactoryTimesheetsHelp")}</small></Link>
<Link className="factory-overview-card" to="/factory/connections"><span>{t("workflow.factory.connectionRequests")}</span><strong>{requests.length + outgoingAgencyInvitations.length}</strong><small>{t("workflow.factory.connectionRequestsHelp")}</small></Link>
</>}
        </div>
      </section>}

      {activeSection === "settings" && actor.role === "factory-admin" && factorySubscription && <section className="dashboard-panel" id="factory-subscription">
        <div className="panel-heading"><div><span className="eyebrow">{t("factorySubscription.eyebrow")}</span><h2>{t("factorySubscription.title")}</h2></div><span className={`status-pill status-pill--${factorySubscription.status === "test-active" ? "active" : "pending"}`}>{t(`factorySubscription.status.${factorySubscription.status}`)}</span></div>
        <p className="muted-copy">{t("factorySubscription.testDisclaimer")}</p>
        <div className="monthly-summary-grid">
          <div><span>{t("factorySubscription.agencyWorkers")}</span><strong>{agencyWorkerCount}</strong></div>
          <div><span>{t("factorySubscription.ownWorkers")}</span><strong>{factorySubscription.usedWorkers}</strong></div>
          {factorySubscription.status === "test-active" && <>
            <div><span>{t("factorySubscription.plan")}</span><strong>{!factorySubscription.tier || factorySubscription.tier.maxWorkers === null ? t("factorySubscription.customTier") : factorySubscription.tier.minWorkers <= 1 ? t("factorySubscription.upTo", { count: factorySubscription.tier.maxWorkers }) : t("factorySubscription.range", { min: factorySubscription.tier.minWorkers, max: factorySubscription.tier.maxWorkers })}</strong></div>
            <div><span>{t("factorySubscription.available")}</span><strong>{factorySubscription.availableWorkers === null ? t("factorySubscription.unlimited") : factorySubscription.availableWorkers}</strong></div>
          </>}
        </div>
        {factorySubscription.status !== "test-active" && <>
          <p className="muted-copy">{t("factorySubscription.freeFeatures")}</p>
          <p className="muted-copy">{t("factorySubscription.paidBenefit")}</p>
          <div className="workflow-form">
            <label className="field-label"><span>{t("factorySubscription.selectPlan")}</span><select value={subscriptionTierId} onChange={(event) => setSubscriptionTierId(event.target.value)}>{subscriptionTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.maxWorkers === null ? t("factorySubscription.customTier") : tier.minWorkers <= 1 ? t("factorySubscription.upTo", { count: tier.maxWorkers }) : t("factorySubscription.range", { min: tier.minWorkers, max: tier.maxWorkers })}</option>)}</select></label>
            <button className="button button--primary button--small" type="button" disabled={!subscriptionTierId || factorySubscription.usedWorkers > (subscriptionTiers.find((tier) => tier.id === subscriptionTierId)?.maxWorkers ?? Number.POSITIVE_INFINITY)} onClick={() => { const saved = activateFactoryDemoSubscription(subscriptionTierId); toast(t(saved ? "factorySubscription.activated" : "factorySubscription.activationFailed"), saved ? "success" : "error"); }}>{t("factorySubscription.activate")}</button>
          </div>
        </>}
        {factorySubscription.status === "test-active" && <>
          <p className="muted-copy">{t("factorySubscription.agenciesExcluded")}</p>
          <button className="button button--outline button--small" type="button" onClick={() => { const saved = deactivateFactoryDemoSubscription(); toast(t(saved ? "factorySubscription.deactivated" : "workflow.errors.permission"), saved ? "success" : "error"); }}>{t("factorySubscription.deactivate")}</button>
        </>}
      </section>}

      {activeSection === "settings" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-worksites">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.worksite")}</span><h2>{t("workflow.factory.addWorksite")}</h2></div><Building2 size={18} /></div>
        <p className="muted-copy">{t("workflow.factory.worksiteLead")}</p>
        <form className="workflow-form" onSubmit={addWorksite}>
          <label className="field-label"><span>{t("workflow.factory.worksiteName")}</span><input value={newWorksiteName} onChange={(event) => setNewWorksiteName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("workflow.factory.worksiteAddress")}</span><input value={newWorksiteAddress} onChange={(event) => setNewWorksiteAddress(event.target.value)} required /></label>
          <label className="field-label"><span>{t("workflow.factory.worksiteIdentifier")}</span><input value={newWorksiteIdentifier} onChange={(event) => setNewWorksiteIdentifier(event.target.value)} /></label>
          <button className="button button--outline button--small" type="submit"><Plus size={14} />{t("workflow.factory.addWorksite")}</button>
        </form>
      </section>}

      {activeSection === "settings" && site && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-department-settings">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.departments")}</span><h2>{t("workflow.factory.addDepartment")}</h2></div><Building2 size={18} /></div>
        <form className="workflow-form" onSubmit={addDepartment}><label className="field-label"><span>{t("workflow.factory.departmentName")}</span><input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required /></label><button className="button button--outline button--small" type="submit"><Plus size={14} />{t("workflow.factory.addDepartment")}</button></form>
      </section>}

      {site && activeSection === "workers" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-owned-workers">
        <div className="panel-heading"><div><span className="eyebrow">{t("factorySubscription.ownWorkers")}</span><h2>{t("factorySubscription.manageWorkers")}</h2></div></div>
        <form className="workflow-form" onSubmit={createOwnedWorker}>
          <label className="field-label"><span>{t("workflow.fields.name")}</span><input value={factoryWorkerName} onChange={(event) => setFactoryWorkerName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("auth.email")}</span><input type="email" value={factoryWorkerEmail} onChange={(event) => setFactoryWorkerEmail(event.target.value)} /></label>
            <label className="field-label"><span>{t("factorySubscription.phone")}</span><input type="tel" value={factoryWorkerPhone} onChange={(event) => setFactoryWorkerPhone(event.target.value)} /></label>
          {!factoryCanCreateOwnedWorker && <p className="muted-copy field-label--wide">{factoryCapacityReached ? t("factorySubscription.capacityReached") : t("factorySubscription.subscriptionRequired")}</p>}
          <button className="button button--primary button--small" type="submit" disabled={!factoryCanCreateOwnedWorker}><Plus size={14} />{t("factorySubscription.addWorker")}</button>
        </form>
      </section>}

      {activeSection === "agencies" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-connections">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.connections")}</span><h2>{t("workflow.factory.connectionRequests")}</h2></div><span className="panel-period">{requests.length}</span></div>
        {requests.length ? requests.map((request) => {
          const agency = workspace.organizations.find((item) => item.id === request.organizationId);
          return <article className="factory-queue-row" id={`factory-request-${request.id}`} key={request.id}>
            <span><strong>{agency?.name ?? request.organizationId}</strong><small>{request.requestedWorksiteName} · {request.requestedAddress} · {request.productionName}</small></span>
            <div className="form-actions"><button className="button button--primary button--small" type="button" onClick={() => decideRequest(request.id, "approve")}><Check size={14} />{t("workflow.factory.approve")}</button><button className="button button--quiet button--small" type="button" onClick={() => decideRequest(request.id, "decline")}><X size={14} />{t("workflow.factory.decline")}</button></div>
          </article>;
        }) : <p className="muted-copy">{t("workflow.factory.noRequests")}</p>}
        <div className="agency-access-list"><h3>{t("workflow.factory.connectedAgencies")}</h3>{connections.length ? connections.map((connection) => <p className="inline-notice" key={connection.id}>{workspace.organizations.find((item) => item.id === connection.organizationId)?.name ?? connection.organizationId}</p>) : <p className="muted-copy">{t("workflow.factory.noConnections")}</p>}</div>
        <div className="agency-access-list"><h3>{t("workflow.factory.pendingAgencyInvitations")}</h3>{outgoingAgencyInvitations.length ? outgoingAgencyInvitations.map((invitation) => <article className="employment-history-row" key={invitation.id}><strong>{workspace.organizations.find((item) => item.id === invitation.organizationId)?.name ?? invitation.organizationId}</strong><span>{invitation.requestedWorksiteName} · {invitation.requestedAddress}</span><small>{t("workflow.factory.waitingForAgencyAcceptance")}</small></article>) : <p className="muted-copy">{t("workflow.factory.noPendingAgencyInvitations")}</p>}</div>
        <form className="workflow-form factory-agency-invite-form" onSubmit={createAgencyInvite}>
          <h3 className="field-label--wide">{t("workflow.factory.inviteAgency")}</h3>
          <p className="muted-copy field-label--wide">{t("workflow.factory.inviteAgencyHelp")}</p>
          <label className="field-label"><span>{t("workflow.factory.searchAgencies")}</span><input value={agencySearch} onChange={(event) => { setAgencySearch(event.target.value); setSelectedInviteAgencyId(""); }} /></label>
          <label className="field-label"><span>{t("workflow.factory.selectAgency")}</span><select value={selectedInviteAgencyId} onChange={(event) => setSelectedInviteAgencyId(event.target.value)} required><option value="">{t("common.select")}</option>{registeredAgencyChoices.map((agency) => <option value={agency.id} key={agency.id}>{agency.name} · {agency.contactEmail ?? agency.id}</option>)}</select></label>
          <button className="button button--outline button--small field-label--wide" type="submit" disabled={!site || !selectedInviteAgencyId}><Send size={14} />{t("workflow.factory.createAgencyInvitation")}</button>
        </form>
        {agencyInvitationText && <div className="notice-box agency-invitation-link"><label className="field-label field-label--wide"><span>{t("workflow.factory.invitationCopyText")}</span><textarea rows={8} value={agencyInvitationText} readOnly /></label><button className="button button--outline button--small" type="button" onClick={() => void copyAgencyInvite()}><Copy size={14} />{t("workflow.factory.copyInvitation")}</button><p className="muted-copy">{t("workflow.factory.noAutomaticConnection")}</p></div>}
      </section>}

      {site && activeSection === "teams" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-departments">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.departments")}</span><h2>{t("workflow.factory.sharedDepartments")}</h2></div></div>
        <p className="muted-copy">{t("workflow.factory.departmentDetailsLead")}</p>
        <div className="factory-worker-grid">{departments.map((department) => <button className={`factory-worker-row factory-department-choice${selectedDepartment?.id === department.id ? " is-selected" : ""}`} type="button" key={department.id} onClick={() => { setSelectedDepartmentId(department.id); setSelectedDepartmentLeaderUid(""); }}><span className="factory-summary-icon"><Building2 size={17} /></span><strong>{department.name}</strong><span className="status-pill">{roster.filter((row) => row.departmentId === department.id).length} {t("workflow.agency.workersLabel")}</span></button>)}{departments.length === 0 && <p className="muted-copy">{t("workflow.factory.noDepartments")}</p>}</div>
        {selectedDepartment && <section className="dashboard-panel factory-department-detail" id={`factory-department-${selectedDepartment.id}`}>
          <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.departmentDetails")}</span><h3>{selectedDepartment.name}</h3></div><span>{site?.name} · {site?.address}</span></div>
          <div className="factory-department-detail-grid">
            <div><h4>{t("workflow.factory.departmentLeaders")}</h4>{departmentLeaders.length ? departmentLeaders.map((leader) => <button className="factory-worker-row factory-department-leader" type="button" key={leader.id} onClick={() => setSelectedDepartmentLeaderUid(selectedDepartmentLeaderUid === leader.accountUid ? "" : leader.accountUid)}><span className="mini-avatar">{leader.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{leader.name}</strong><small>{leader.email ?? leader.accountUid}</small></span></button>) : <p className="muted-copy">{t("workflow.factory.noDepartmentLeaders")}</p>}</div>
            <div><h4>{t("workflow.factory.departmentTeams")}</h4>{departmentGroups.length ? departmentGroups.map((group) => <p className="inline-notice" key={group.id}>{group.name} · {workspace.organizations.find((item) => item.id === group.organizationId)?.name ?? "—"}</p>) : <p className="muted-copy">{t("workflow.factory.noDepartmentTeams")}</p>}</div>
          </div>
          {selectedDepartmentLeaderUid && departmentLeaders.find((leader) => leader.accountUid === selectedDepartmentLeaderUid) && <article className="notice-box factory-leader-detail"><strong>{departmentLeaders.find((leader) => leader.accountUid === selectedDepartmentLeaderUid)?.name}</strong><span>{departmentLeaders.find((leader) => leader.accountUid === selectedDepartmentLeaderUid)?.email ?? selectedDepartmentLeaderUid}</span><span>{t("workflow.factory.departmentAccess")}: {departmentLeaders.find((leader) => leader.accountUid === selectedDepartmentLeaderUid)?.departmentIds.map((id) => departments.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || t("workflow.factory.allDepartments")}</span></article>}
          <div className="factory-department-workers"><h4>{t("workflow.factory.departmentWorkers")}</h4>{departmentRoster.length ? departmentRoster.map((row) => { const period = workspace.employmentPeriods.find((item) => item.id === row.employmentId && item.organizationId === row.organizationId); const placement = period?.placements.find((item) => item.factoryId === row.factoryId); const group = placement?.groupId ? workspace.groups.find((item) => item.id === placement.groupId) : undefined; const actual = departmentActualShifts.filter((item) => item.row.worker.id === row.worker.id && item.row.organizationId === row.organizationId); return <article className="factory-worker-row" key={`${row.organizationId}:${row.worker.id}`}><span className="mini-avatar">{row.worker.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><WorkerProfileTrigger workerId={row.worker.id} className="worker-profile-open">{row.worker.name}</WorkerProfileTrigger><small>{row.organizationName} · {group?.name ?? t("workflow.groups.noGroup")} · {row.leaderName ?? t("workflow.factory.unassigned")}</small></span><strong>{formatDuration(actual.reduce((sum, item) => sum + item.shift.paidDurationMinutes, 0), t)}</strong></article>; }) : <p className="muted-copy">{t("workflow.factory.noDepartmentWorkers")}</p>}</div>
          <div className="factory-department-workers"><h4>{t("workflow.factory.departmentActualShifts")}</h4>{departmentActualShifts.length ? departmentActualShifts.slice(0, 12).map(({ row, shift }) => <article className="factory-queue-row" key={shift.id}><WorkerProfileTrigger workerId={row.worker.id} className="worker-profile-open">{row.worker.name}</WorkerProfileTrigger><span>{row.organizationName} · {shift.localStartDate}</span><strong>{formatDuration(shift.paidDurationMinutes, t)}</strong></article>) : <p className="muted-copy">{t("workflow.factory.noActualHours")}</p>}</div>
        </section>}
        <div className="panel-heading factory-leader-heading"><div><span className="eyebrow">{t("workflow.factory.leaders")}</span><h2>{t("workflow.factory.globalLeaders")}</h2></div><ShieldCheck size={18} /></div>
        {leaders.map((leader) => <article className="factory-worker-row" key={leader.id}><span className="mini-avatar">{leader.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{leader.name}</strong><small>{leader.email ?? leader.accountUid} · {leader.departmentIds.map((id) => departments.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || t("workflow.factory.allDepartments")}</small></span></article>)}
        {leaderRequests.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factory.leaderConnectionRequests")}</h3><p className="muted-copy">{t("workflow.factory.leaderConnectionRequestLead")}</p>{leaderRequests.map((request) => {
          const permissions = leaderRequestPermissions[request.id] ?? { canViewWorkers: true, canRecordHours: false, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: false, canManageGroups: false };
          const organizations = leaderRequestOrganizationScopes[request.id] ?? [];
          const requestedDepartments = leaderRequestDepartmentScopes[request.id] ?? [];
          return <article className="employment-history-row" key={request.id}>
            <strong>{request.name}</strong><span>{request.email}</span>
            <fieldset className="permission-checks"><legend>{t("factorySubscription.leaderOrganizationAccess")}</legend>{leaderOrganizationOptions.map((organization) => <label className="checkbox-field" key={organization.id}><input type="checkbox" checked={organizations.includes(organization.id)} onChange={() => setLeaderRequestOrganizationScopes((current) => ({ ...current, [request.id]: organizations.includes(organization.id) ? organizations.filter((id) => id !== organization.id) : [...organizations, organization.id] }))} /><span>{organization.name}</span></label>)}{leaderOrganizationOptions.length === 0 && <p className="muted-copy">{t("workflow.factory.leaderRequestNoOrganizations")}</p>}</fieldset>
            {departments.length > 0 && <fieldset className="permission-checks"><legend>{t("workflow.factory.departmentAccess")}</legend>{departments.map((department) => <label className="checkbox-field" key={department.id}><input type="checkbox" checked={requestedDepartments.includes(department.id)} onChange={() => setLeaderRequestDepartmentScopes((current) => ({ ...current, [request.id]: requestedDepartments.includes(department.id) ? requestedDepartments.filter((id) => id !== department.id) : [...requestedDepartments, department.id] }))} /><span>{department.name}</span></label>)}</fieldset>}
            <fieldset className="permission-checks"><legend>{t("workflow.production.permissions")}</legend><label className="checkbox-field"><input type="checkbox" checked disabled /><span>{t("workflow.factory.leaderRequestViewWorkersRequired")}</span></label>{(["canRecordHours", "canReviewShifts", "canConfirmShifts", "canSubmitTimesheet", "canManageGroups"] as const).map((permission) => <label className="checkbox-field" key={permission}><input type="checkbox" checked={permissions[permission]} onChange={(event) => setLeaderRequestPermissions((current) => ({ ...current, [request.id]: { ...permissions, [permission]: event.target.checked } }))} /><span>{t(`workflow.production.permission.${permission}`)}</span></label>)}</fieldset>
            <div className="form-actions"><button className="button button--primary button--small" type="button" disabled={organizations.length === 0} onClick={() => decideLeaderRequest(request.id, "approve")}><Check size={14} />{t("workflow.factory.approve")}</button><button className="button button--quiet button--small" type="button" onClick={() => decideLeaderRequest(request.id, "decline")}><X size={14} />{t("workflow.factory.decline")}</button></div>
          </article>;
        })}</div>}
        {actor.role === "factory-admin" && <form className="workflow-form" onSubmit={addLeader}>
          <h3 className="field-label--wide">{t("workflow.factory.inviteGlobalLeader")}</h3>
          <label className="field-label"><span>{t("workflow.fields.name")}</span><input value={leaderName} onChange={(event) => setLeaderName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("auth.email")}</span><input type="email" value={leaderEmail} onChange={(event) => setLeaderEmail(event.target.value)} required /></label>
          <fieldset className="permission-checks field-label--wide"><legend>{t("factorySubscription.leaderOrganizationAccess")}</legend>{leaderOrganizationOptions.map((organization) => <label className="checkbox-field" key={organization.id}><input type="checkbox" checked={leaderOrganizations.includes(organization.id)} onChange={() => setLeaderOrganizations((current) => current.includes(organization.id) ? current.filter((id) => id !== organization.id) : [...current, organization.id])} /><span>{organization.name}</span></label>)}{leaderOrganizationOptions.length === 0 && <p className="muted-copy">{t("workflow.factory.noConnections")}</p>}</fieldset>
          {departments.length > 0 && <fieldset className="permission-checks field-label--wide"><legend>{t("workflow.factory.departmentAccess")}</legend>{departments.map((department) => <label className="checkbox-field" key={department.id}><input type="checkbox" checked={leaderDepartments.includes(department.id)} onChange={() => toggleLeaderDepartment(department.id)} /><span>{department.name}</span></label>)}</fieldset>}
          <fieldset className="permission-checks field-label--wide"><legend>{t("workflow.production.permissions")}</legend>{(["canRecordHours", "canReviewShifts", "canConfirmShifts", "canSubmitTimesheet", "canManageGroups"] as const).map((permission) => <label className="checkbox-field" key={permission}><input type="checkbox" checked={leaderPermissions[permission]} onChange={(event) => setLeaderPermissions((current) => ({ ...current, [permission]: event.target.checked }))} /><span>{t(`workflow.production.permission.${permission}`)}</span></label>)}</fieldset>
          <p className="muted-copy field-label--wide">{t("workflow.factory.leaderInviteDemoNote")}</p>
          <button className="button button--outline button--small" type="submit"><Send size={14} />{t("workflow.factory.inviteGlobalLeader")}</button>
        </form>}
        {leaderInviteUrl && <div className="notice-box agency-invitation-link"><span>{leaderInviteUrl}</span><button className="button button--outline button--small" type="button" onClick={() => void copyLeaderInvite(leaderInviteUrl)}><Copy size={14} />{t("workflow.factory.copyInvitation")}</button></div>}
        {leaderInvitations.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factory.pendingLeaderInvitations")}</h3>{leaderInvitations.map((invitation) => <article className="employment-history-row" key={invitation.id}><strong>{invitation.name}</strong><span>{invitation.email} · {invitation.organizationIds.map((id) => workspace.organizations.find((item) => item.id === id)?.name ?? id).join(", ")}</span><small>{t("workflow.factory.invitationExpires", { date: new Date(invitation.expiresAt).toLocaleDateString() })}</small><div className="form-actions"><button className="button button--quiet button--small" type="button" onClick={() => void copyLeaderInvite(getLeaderInvitationUrl(invitation.token))}><Copy size={14} />{t("workflow.factory.copyInvitation")}</button><button className="button button--quiet button--small" type="button" onClick={() => { const revoked = revokeBusinessLeaderInvitation(invitation.id); toast(revoked ? t("workflow.factory.invitationRevoked") : t("workflow.errors.permission"), revoked ? "success" : "error"); }}><XCircle size={14} />{t("workflow.factory.revokeInvitation")}</button></div></article>)}</div>}
      </section>}

      {site && activeSection === "workers" && <section className="dashboard-panel" id="factory-roster">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.roster")}</span><h2>{t("workflow.factory.sharedRoster")}</h2></div><span className="panel-period">{roster.length}</span></div>
        <div className="workflow-filter-row">
          <label className="field-label"><span>{t("factorySubscription.workerSource")}</span><select value={workerCategoryFilter} onChange={(event) => { setWorkerCategoryFilter(event.target.value as typeof workerCategoryFilter); if (event.target.value === "factory") setAgencyFilter(""); }}><option value="all">{t("common.all")}</option><option value="agency">{t("factorySubscription.agencySource")}</option><option value="factory">{t("factorySubscription.factorySource")}</option></select></label>
          {workerCategoryFilter !== "factory" && <label className="field-label"><span>{t("workflow.factory.agency")}</span><select value={agencyFilter} onChange={(event) => setAgencyFilter(event.target.value)}><option value="">{t("common.all")}</option>{agencyOptions.map((agency) => <option value={agency.id} key={agency.id}>{agency.name}</option>)}</select></label>}
          <label className="field-label"><span>{t("factorySubscription.workerStatus")}</span><select value={workerStatusFilter} onChange={(event) => setWorkerStatusFilter(event.target.value as typeof workerStatusFilter)}><option value="all">{t("common.all")}</option><option value="active">{t("factorySubscription.activeStatus")}</option><option value="away">{t("factorySubscription.awayStatus")}</option></select></label>
          <label className="field-label"><span>{t("workflow.factory.department")}</span><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="">{t("common.all")}</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="field-label"><span>{t("workflow.factory.leader")}</span><select value={leaderFilter} onChange={(event) => setLeaderFilter(event.target.value)}><option value="">{t("common.all")}</option>{leaders.map((item) => <option value={item.accountUid} key={item.id}>{item.name}</option>)}</select></label>
          <label className="field-label"><span>{t("workflow.factory.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
          {roster.length > 0 && (actor.role === "factory-admin" || actor.role === "leader" && Boolean(siteLeaderMembership?.permissions.canManageGroups && actor.permissions?.canManageGroups)) && <div className="factory-inline-group-launch"><button className="button button--outline button--small" type="button" disabled={!selectedRosterWorkerIds.length} onClick={() => setShowInlineGroupForm((open) => !open)}><UsersRound size={14} />{t("workflow.factory.createGroupForSelected", { count: selectedRosterWorkerIds.length })}</button>{selectedRosterWorkerIds.length > 0 && <small className="muted-copy">{t("workflow.factory.groupSelectOneProduction")}</small>}{showInlineGroupForm && <form className="workflow-form factory-inline-group-form" onSubmit={createInlineGroup}>
          <label className="field-label"><span>{t("workflow.groups.name")}</span><input value={inlineGroupName} onChange={(event) => setInlineGroupName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("workflow.factory.department")}</span><select value={inlineGroupDepartmentId} onChange={(event) => setInlineGroupDepartmentId(event.target.value)}><option value="">{t("workflow.factory.unassigned")}</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
          {actor.role === "factory-admin" && <label className="field-label"><span>{t("workflow.factory.leaderOptional")}</span><select value={inlineGroupLeaderUid} onChange={(event) => setInlineGroupLeaderUid(event.target.value)}><option value="">{t("workflow.factory.unassigned")}</option>{inlineGroupLeaders.map((leader) => <option value={leader.accountUid} key={leader.id}>{leader.name}</option>)}</select></label>}
          <button className="button button--primary button--small" type="submit" disabled={!selectedRosterWorkerIds.length || !inlineGroupName.trim()}>{t("workflow.factory.createAndAssignGroup")}</button>
        </form>}</div>}
        {roster.length ? <div className="factory-roster-list">{roster.map((row) => <WorksiteWorkerRow key={`${row.organizationId}-${row.worker.id}`} row={row} departments={departments} leaders={leaders.filter((leader) => leader.organizationIds?.includes(row.organizationId))} canAssign={actor.role === "factory-admin" || actor.role === "leader" && Boolean(siteLeaderMembership?.permissions.canManageGroups && actor.permissions?.canManageGroups)} selected={selectedRosterWorkerIds.includes(row.worker.id)} onSelect={() => toggleRosterWorker(row)} onAssign={(departmentId, leaderAccountUid) => {
          const saved = assignBusinessWorkerToTeam({ worksiteId: site.id, workerId: row.worker.id, departmentId: departmentId || undefined, leaderAccountUid: leaderAccountUid || undefined });
          toast(saved ? t("workflow.factory.assignmentSaved") : t("workflow.errors.permission"), saved ? "success" : "error");
        }} t={t} />)}</div> : <p className="muted-copy">{t("workflow.factory.rosterEmpty")}</p>}
      </section>}

      {site && activeSection === "timekeeping" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-actual-hours">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.factory.actualTime")}</span><h2>{t("workflow.factory.actualSummary")}</h2></div><label className="field-label"><span>{t("workflow.timekeeping.period")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
        <p className="muted-copy">{t("workflow.factory.timesheetsRemainSeparate")}</p>
        {actualSummary.length ? <div className="factory-actual-list">{actualSummary.map((row) => <article className="factory-actual-card" key={row.factoryId}><h3>{row.organizationName} · {row.factoryName}</h3><span>{row.workerCount} {t("workflow.agency.workersLabel")}</span><span>{row.shiftCount} {t("nav.shifts")}</span><strong>{formatDuration(row.paidMinutes, t)}</strong></article>)}</div> : <p className="muted-copy">{t("workflow.factory.noActualHours")}</p>}
      </section>}
{activeSection === "schedule" && actor.role === "factory-admin" && <><p className="muted-copy">{t("workflow.factory.plannedSchedulesSeparate")}</p><ScheduleCenter /></>}
{activeSection === "messages" && actor.role === "factory-admin" && <MessageCenter />}
      {activeSection === "timesheets" && actor.role === "factory-admin" && <section className="dashboard-panel" id="factory-timesheets">
        <div className="panel-heading"><div><span className="eyebrow">{t("monthlyTimesheets.title")}</span><h2>{t("factorySubscription.separateTimesheets")}</h2></div></div>
        <p className="muted-copy">{t("workflow.factory.timesheetsRemainSeparate")}</p>
        <div className="factory-timesheet-summary"><article><h3>{t("workflow.factory.agencyTimesheets")}</h3><strong>{readyAgencyTimesheets.length}</strong><p>{t("workflow.factory.readyAgencyTimesheetsHelp")}</p></article><article><h3>{t("workflow.factory.ownWorkerTimesheets")}</h3><strong>{internalFactoryTimesheets.length}</strong><p>{t("workflow.factory.internalFactoryTimesheetsHelp")}</p></article></div>
        <Link className="button button--outline button--small" to="/factory/monthly-timesheets"><ClipboardList size={15} />{t("monthlyTimesheets.title")}</Link>
      </section>}
    </>}
  </PortalShell>;
}

function WorksiteWorkerRow({ row, departments, leaders, canAssign, selected, onSelect, onAssign, t }: {
  row: DemoBusinessWorksiteRosterEntry;
  departments: Array<{ id: string; name: string }>;
  leaders: DemoLeaderWorksiteMembership[];
  canAssign: boolean;
  selected: boolean;
  onSelect: () => void;
  onAssign: (departmentId: string, leaderAccountUid: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [departmentId, setDepartmentId] = useState(row.departmentId ?? "");
  const [leaderAccountUid, setLeaderAccountUid] = useState(row.leaderAccountUid ?? "");
  useEffect(() => { setDepartmentId(row.departmentId ?? ""); setLeaderAccountUid(row.leaderAccountUid ?? ""); }, [row.departmentId, row.leaderAccountUid]);
  const scopedLeaders = useMemo(() => leaders.filter((leader) => !leader.departmentIds.length || !departmentId || leader.departmentIds.includes(departmentId)), [leaders, departmentId]);
  return <article className="factory-worker-row factory-roster-worker">
    {canAssign && <label className="factory-roster-select"><input type="checkbox" checked={selected} onChange={onSelect} /><span className="sr-only">{t("workflow.factory.selectWorker", { name: row.worker.name })}</span></label>}
    <span className="mini-avatar">{row.worker.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
    <span><WorkerProfileTrigger workerId={row.worker.id} className="worker-profile-open">{row.worker.name}</WorkerProfileTrigger><small>{row.workerCategory === "factory" ? t("factorySubscription.factorySource") : row.organizationName} · {row.factoryName}</small></span>
    {canAssign ? <form className="factory-roster-assignment" onSubmit={(event) => { event.preventDefault(); onAssign(departmentId, leaderAccountUid); }}>
      <label className="field-label"><span>{t("workflow.factory.department")}</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">{t("workflow.factory.unassigned")}</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.factory.leader")}</span><select value={leaderAccountUid} onChange={(event) => setLeaderAccountUid(event.target.value)}><option value="">{t("workflow.factory.unassigned")}</option>{scopedLeaders.map((leader) => <option value={leader.accountUid} key={leader.id}>{leader.name}</option>)}</select></label>
          <button className="button button--quiet button--small" type="submit">{t("common.save")}</button>
    </form> : <span>{row.departmentName ?? t("workflow.factory.unassigned")} · {row.leaderName ?? t("workflow.factory.unassigned")}</span>}
  </article>;
}
