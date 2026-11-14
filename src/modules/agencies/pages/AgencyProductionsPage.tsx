import { useEffect, useState, type FormEvent } from "react";
import { Archive, ArrowLeft, Building2, Check, RotateCcw, Settings2, UserPlus, X } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDuration } from "../../workflows/workflow-utils";
import { archiveProduction, assignWorkerToProduction, createAgencyWorkplace, createProductionLeader, getActiveMember, getFactoryInvitationUrl, getProductionWorkers, getProductionWorkflowSettings, getWorkerProductionAssignment, isAgencyVisibleAbsence, resolveAgencyWorksiteInvitation, restoreProduction, revokeFactoryInvitation, setFactoryInputMode, setFactoryTeamAssignmentRequirement, setFactoryTimeDataSubmission, setLeaderMembershipAccess, updateFactoryDetails, updateLeaderMembershipPermissions, updateProductionWorkflowSettings, useDemoWorkspace } from "../../workflows/demo-store";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import type { DemoMember, DemoProductionWorkflowSettings, ProductionInputMode } from "../../workflows/domain/demo-types";
import { useToast } from "../../../app/ToastProvider";
import { effectiveLeaderPermissions } from "../../workflows/domain/access";
import { workerHasProductionOnDate } from "../../exports/domain/employment-scope";
import { AgencyWorksiteAccess } from "../components/AgencyWorksiteAccess";
import { RightDrawer } from "../../workflows/components/RightDrawer";

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function AgencyProductionsPage() {
  const { t } = useTranslation();
  const { factoryId } = useParams();
  const location = useLocation();
  const workspace = useDemoWorkspace();
  const active = getActiveMember(workspace);
  const allFactories = workspace.factories.filter((item) => item.organizationId === workspace.organization.id);
  const factories = allFactories.filter((item) => !item.archivedAt);
  const archivedFactories = allFactories.filter((item) => item.archivedAt);
  const activeConnections = (workspace.agencyWorksites ?? []).filter((item) => item.organizationId === workspace.organization.id && item.state === "active");
  const ownFactories = factories.filter((item) => !workspace.worksites?.find((site) => site.id === item.worksiteId)?.businessEntityId);
  const connectedFactories = factories.filter((item) => activeConnections.some((connection) => connection.worksiteId === item.worksiteId && connection.businessEntityId === workspace.worksites?.find((site) => site.id === item.worksiteId)?.businessEntityId));
  const otherCentralFactories = factories.filter((item) => !ownFactories.includes(item) && !connectedFactories.includes(item));
  const pendingAgencyRequests = (workspace.worksiteConnectionRequests ?? []).filter((item) => item.organizationId === workspace.organization.id && item.state === "pending" && (item.direction ?? "agency-request") === "agency-request");
  const incomingAgencyInvitations = (workspace.worksiteConnectionRequests ?? []).filter((item) => item.organizationId === workspace.organization.id && item.state === "pending" && item.direction === "factory-invitation");
  const pendingFactoryInvitations = (workspace.factoryInvitations ?? []).filter((item) => item.organizationId === workspace.organization.id && item.state === "pending");
  const isArchiveList = factoryId === "archive";
  const factory = allFactories.find((item) => item.id === factoryId);
  const isSettings = location.pathname.endsWith("/settings") && !factory?.archivedAt;
  const [message, setInlineMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workplaceDrawerOpen, setWorkplaceDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [overviewMonth, setOverviewMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [participantFactoryId, setParticipantFactoryId] = useState("");
  const [participantMonth, setParticipantMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedLeaderId, setSelectedLeaderId] = useState("");
  const [createdLeaderId, setCreatedLeaderId] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (value) showToast(value, value === t("workflow.errors.permission") ? "error" : "success");
  };
  useEffect(() => {
    if (location.hash === "#agency-worksite-access") setSettingsOpen(true);
  }, [location.hash]);
  const [name, setName] = useState(factory?.name ?? "");
  const [address, setAddress] = useState(factory?.address ?? "");
  const [description, setDescription] = useState(factory?.description ?? "");
  const [ownWorksiteName, setOwnWorksiteName] = useState("");
  const [ownWorksiteAddress, setOwnWorksiteAddress] = useState("");
  const [ownProductionName, setOwnProductionName] = useState("");
  const [ownLeaderName, setOwnLeaderName] = useState("");
  const [ownLeaderEmail, setOwnLeaderEmail] = useState("");
  const [inputMode, setInputMode] = useState<ProductionInputMode>(factory?.inputMode ?? "A");
  const [assignWorkerId, setAssignWorkerId] = useState("");
  const [independentParticipant, setIndependentParticipant] = useState(false);
  const [workflowSettings, setWorkflowSettings] = useState<DemoProductionWorkflowSettings>(() => factory ? getProductionWorkflowSettings(factory) : { workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: false, agencyMustReviewShifts: false, workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: false, agencyMustAcceptTimesheet: true });
  const agencyWorkers = workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "worker");
  const workers = factory ? factory.archivedAt
    ? workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "worker" && workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === member.id && period.placements.some((placement) => placement.factoryId === factory.id)))
    : getProductionWorkers(workspace, factory.id) : [];
  const workersAwaitingProduction = factory && !factory.archivedAt ? agencyWorkers.filter((worker) => !getWorkerProductionAssignment(workspace, worker.id, factory.id) && workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === worker.id && period.state === "active")) : [];
  const workersNeedingEmployment = factory && !factory.archivedAt ? agencyWorkers.filter((worker) => !getWorkerProductionAssignment(workspace, worker.id, factory.id) && !workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === worker.id && period.state === "active")) : [];
  const leaders = factory ? workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "leader" && member.factoryId === factory.id) : [];
  const isAgencyOwnedWorkplace = Boolean(factory && !factory.ownerWorkforce && !workspace.worksites?.find((site) => site.id === factory.worksiteId)?.businessEntityId);
  const factoryShifts = factory ? workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.factoryId === factory.id) : [];
  const factoryAbsences = factory ? workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && absence.factoryId === factory.id && isAgencyVisibleAbsence(workspace, absence)) : [];
  const periodShifts = factoryShifts.filter((record) => record.shift.localStartDate.startsWith(`${overviewMonth}-`));
  const periodAbsences = factoryAbsences.filter((absence) => absence.localDate.startsWith(`${overviewMonth}-`));
  const pendingShiftCount = periodShifts.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "pending").length;
  const disputedShiftCount = periodShifts.filter((record) => !record.shift.deletedAt && record.shift.workerConfirmation === "disputed").length;
  const selectedLeader = workspace.members.find((member) => member.id === selectedLeaderId && member.organizationId === workspace.organization.id && member.role === "leader");
  const selectedLeaderMemberships = selectedLeader ? workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "leader" && (member.accountUid ?? member.id) === (selectedLeader.accountUid ?? selectedLeader.id)) : [];
  const participantFactory = factories.find((item) => item.id === participantFactoryId);
  const participantBounds = /^\d{4}-\d{2}$/.test(participantMonth) ? { start: `${participantMonth}-01`, end: `${participantMonth}-${String(new Date(Date.UTC(Number(participantMonth.slice(0, 4)), Number(participantMonth.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}` } : undefined;
  const participantWorkers = participantFactory && participantBounds ? (() => {
    const employment = workspace.employmentPeriods.filter((period) => period.organizationId === workspace.organization.id
      && period.startDate <= participantBounds.end && (!period.endDate || period.endDate >= participantBounds.start));
    const assignedIds = new Set(employment.filter((period) => period.placements.some((placement) => placement.factoryId === participantFactory.id
      && placement.startDate <= participantBounds.end && (!placement.endDate || placement.endDate >= participantBounds.start))).map((period) => period.workerId));
    for (const worker of agencyWorkers) {
      const history = workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === worker.id);
      if (!history && (worker.productionAssignments ?? []).some((assignment) => assignment.factoryId === participantFactory.id)) assignedIds.add(worker.id);
    }
    return [...assignedIds].flatMap((workerId) => {
      const worker = agencyWorkers.find((item) => item.id === workerId);
      if (!worker) return [];
      const legacyFactoryIds = worker.productionAssignments?.map((assignment) => assignment.factoryId) ?? (worker.factoryId ? [worker.factoryId] : []);
      const shifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.factoryId === participantFactory.id
        && record.shift.workerUid === workerId && record.shift.localStartDate >= participantBounds.start && record.shift.localStartDate <= participantBounds.end && !record.shift.deletedAt
        && workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: record.organizationId, workerId, factoryId: participantFactory.id, date: record.shift.localStartDate, employmentId: record.shift.employmentId }, legacyFactoryIds));
      const absences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && absence.factoryId === participantFactory.id
        && absence.workerId === workerId && absence.localDate >= participantBounds.start && absence.localDate <= participantBounds.end && isAgencyVisibleAbsence(workspace, absence)
        && workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: absence.organizationId, workerId, factoryId: participantFactory.id, date: absence.localDate, employmentId: absence.employmentId }, legacyFactoryIds));
      return [{ worker, shifts, absences }];
    }).sort((left, right) => left.worker.name.localeCompare(right.worker.name));
  })() : [];

  useEffect(() => {
    setName(factory?.name ?? "");
    setAddress(factory?.address ?? "");
    setDescription(factory?.description ?? "");
    setInputMode(factory?.inputMode ?? "A");
    if (factory) setWorkflowSettings(getProductionWorkflowSettings(factory));
    setMessage("");
  }, [factory?.id, factory?.inputMode, factory?.workflowSettings]);

  useEffect(() => {
    if (!participantFactoryId && !selectedLeaderId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setParticipantFactoryId(""); setSelectedLeaderId(""); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [participantFactoryId, selectedLeaderId]);

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    const saved = Boolean(factory && updateFactoryDetails(factory.id, { name, address, description }));
    setMessage(t(saved ? "workflow.production.saved" : "workflow.errors.permission"));
    if (saved) setDetailsDrawerOpen(false);
  }

  function saveInputMode(event: FormEvent) {
    event.preventDefault();
    setMessage(factory && setFactoryInputMode(factory.id, inputMode) ? t("workflow.production.inputModeSaved") : t("workflow.errors.permission"));
  }

  function assignWorker(event: FormEvent) {
    event.preventDefault();
    if (!factory || !assignWorkerId) return;
    const assigned = assignWorkerToProduction(factory.id, assignWorkerId, true, independentParticipant);
    setMessage(assigned ? t("workflow.production.workerAssigned") : t("workflow.errors.permission"));
    if (assigned) { setAssignWorkerId(""); setIndependentParticipant(false); }
  }

  function saveLeaderPermissions(membership: DemoMember, permissions: ReturnType<typeof effectiveLeaderPermissions>) {
    const saved = updateLeaderMembershipPermissions(membership.factoryId ?? "", membership.id, permissions);
    setMessage(t(saved ? "workflow.production.permissionSaved" : "workflow.errors.permission"));
    if (saved) setSelectedLeaderId("");
  }

  function saveWorkflowSettings(event: FormEvent) {
    event.preventDefault();
    setMessage(factory && updateProductionWorkflowSettings(factory.id, workflowSettings) ? t("workflow.production.workflowSaved") : t("workflow.errors.permission"));
  }

  function createOwnWorkplace(event: FormEvent) {
    event.preventDefault();
    const created = createAgencyWorkplace({ worksiteName: ownWorksiteName, address: ownWorksiteAddress, productionName: ownProductionName });
    setMessage(created ? t("workflow.agencyWorkplace.created") : t("workflow.errors.permission"));
    if (created) { setOwnWorksiteName(""); setOwnWorksiteAddress(""); setOwnProductionName(""); setWorkplaceDrawerOpen(false); }
  }

  function createOwnLeader(event: FormEvent) {
    event.preventDefault();
    if (!factory) return;
    const created = createProductionLeader(factory.id, ownLeaderName, false, ownLeaderEmail);
    setMessage(created ? t("workflow.agencyWorkplace.leaderCreated") : t("workflow.errors.permission"));
    setCreatedLeaderId(created?.id ?? "");
    if (created) { setOwnLeaderName(""); setOwnLeaderEmail(""); }
  }

  function confirmArchiveProduction() {
    if (!factory) return;
    setMessage(archiveProduction(factory.id) ? t("workflow.production.archivedToast") : t("workflow.errors.permission"));
    setArchiveConfirmationOpen(false);
  }

  function resolveIncomingInvitation(requestId: string, decision: "accept" | "decline") {
    const saved = resolveAgencyWorksiteInvitation(requestId, decision);
    setMessage(saved ? t(decision === "accept" ? "workflow.factoryAccess.invitationAccepted" : "workflow.factoryAccess.invitationDeclined") : t("workflow.errors.permission"));
  }

  const renderProductionCards = (items: typeof factories) => items.map((item) => {
    const assigned = getProductionWorkers(workspace, item.id);
    const managerCount = workspace.members.filter((person) => person.role === "leader" && person.factoryId === item.id && person.organizationId === workspace.organization.id).length;
    const worksite = workspace.worksites?.find((site) => site.id === item.worksiteId);
    return <article className="dashboard-panel production-directory-card" key={item.id}>
      <button className="production-directory-hitarea" type="button" onClick={() => setParticipantFactoryId(item.id)} aria-label={`${item.name} — ${t("workflow.production.participants")}`}><span className="sr-only">{item.name} — {t("workflow.production.participants")}</span></button>
      <span className="factory-summary-icon"><Building2 size={18} /></span>
      <div><h2>{item.name}</h2><p>{item.address || t("workflow.production.addressMissing")}</p><small>{t("workflow.production.worksite")}: {worksite?.name ?? item.name} · {assigned.length} · {t("workflow.agency.workersLabel")} · {managerCount} · {t("workflow.production.leaders")}</small></div>
      <div className="production-directory-actions"><Link className="button button--quiet button--small" to={`/agency/productions/${item.id}/settings`}><Settings2 size={14} />{t("workflow.production.settings")}</Link></div>
    </article>;
  });

  return <PortalShell role="agency">
    {!factoryId || isArchiveList ? <>
      <PageHeading eyebrow={workspace.organization.name} title={t(isArchiveList ? "workflow.production.archiveList" : "workflow.production.productions")} description={t(isArchiveList ? "workflow.production.archiveListLead" : "workflow.production.listLead")} action={<div className="production-list-actions">{!isArchiveList && <Link className="button button--outline button--small" to="/agency/productions/archive"><Archive size={15} />{t("workflow.production.archiveList")}{archivedFactories.length > 0 && <span className="panel-period">{archivedFactories.length}</span>}</Link>}<Link className="button button--outline button--small" to="/agency"><ArrowLeft size={15} />{t("workflow.employment.backToAgency")}</Link></div>} />
      {message && <p className="sr-only">{message}</p>}
      {!isArchiveList && <>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.agencyWorkplace.ownProductions")}</span><h2>{t("workflow.agencyWorkplace.ownProductions")}</h2></div><button className="button button--primary button--small" type="button" onClick={() => setWorkplaceDrawerOpen(true)}><Building2 size={14} />{t("workflow.agencyWorkplace.create")}</button></div>{ownFactories.length ? <div className="production-directory">{renderProductionCards(ownFactories)}</div> : <p className="muted-copy">{t("workflow.production.archiveEmpty")}</p>}</section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.factoryAccess.connectedSites")}</span><h2>{t("workflow.factoryAccess.connectedSites")}</h2></div><span className="panel-period">{connectedFactories.length}</span></div>{connectedFactories.length ? <div className="production-directory">{renderProductionCards(connectedFactories)}</div> : <p className="muted-copy">{t("workflow.factoryAccess.noConnectedSites")}</p>}{otherCentralFactories.length > 0 && <div className="agency-access-list"><h3>{t("workflow.factoryAccess.otherStatuses")}</h3><div className="production-directory">{renderProductionCards(otherCentralFactories)}</div></div>}</section>
        {(pendingAgencyRequests.length > 0 || incomingAgencyInvitations.length > 0 || pendingFactoryInvitations.length > 0) && <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.factoryAccess.connectionStatus")}</span><h2>{t("workflow.factoryAccess.connectionStatus")}</h2></div><span className="panel-period">{pendingAgencyRequests.length + incomingAgencyInvitations.length + pendingFactoryInvitations.length}</span></div>
          {incomingAgencyInvitations.map((request) => { const entity = workspace.businessEntities?.find((item) => item.id === request.businessEntityId); const site = workspace.worksites?.find((item) => item.id === request.worksiteId); return <article className="employment-history-row" id={`agency-invitation-${request.id}`} key={request.id}><strong>{t("workflow.factoryAccess.invitationFrom", { company: entity?.name ?? "" })}</strong><span>{t("workflow.factoryAccess.nip")}: {entity?.nip ?? "—"} · {t("workflow.factoryAccess.city")}: {entity?.city ?? "—"} · {t("workflow.factoryAccess.centralIdentifier")}: {entity?.identifier ?? "—"}</span><span>{site?.name ?? request.requestedWorksiteName} · {site?.address ?? request.requestedAddress} · {t("workflow.factoryAccess.identifier")}: {site?.identifier ?? request.requestedIdentifier ?? "—"}</span><div className="form-actions"><button className="button button--primary button--small" type="button" onClick={() => resolveIncomingInvitation(request.id, "accept")}><Check size={14} />{t("workflow.factoryAccess.acceptInvitation")}</button><button className="button button--quiet button--small" type="button" onClick={() => resolveIncomingInvitation(request.id, "decline")}><X size={14} />{t("workflow.factoryAccess.declineInvitation")}</button></div></article>; })}
          {pendingAgencyRequests.map((request) => <article className="employment-history-row" key={request.id}><strong>{request.requestedWorksiteName}</strong><span>{workspace.businessEntities?.find((entity) => entity.id === request.businessEntityId)?.name} · {request.requestedAddress} · {request.productionName}</span><small>{t("workflow.factoryAccess.waitingForApproval")}</small></article>)}
          {pendingFactoryInvitations.map((invitation) => <article className="employment-history-row" key={invitation.id}><strong>{invitation.companyName}</strong><span>{invitation.city} · {invitation.worksiteName} · {invitation.worksiteAddress}</span><small>{t("workflow.factoryAccess.waitingForRegistration")}</small><div className="form-actions"><button className="button button--quiet button--small" type="button" onClick={() => { void navigator.clipboard?.writeText(getFactoryInvitationUrl(invitation.token)); }}>{t("workflow.factoryAccess.copyLink")}</button><button className="button button--quiet button--small" type="button" onClick={() => setMessage(revokeFactoryInvitation(invitation.id) ? t("workflow.factoryAccess.invitationRevoked") : t("workflow.errors.permission"))}>{t("workflow.factoryAccess.revoke")}</button></div></article>)}
        </section>}
        <details className="dashboard-panel agency-production-settings" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
          <summary className="agency-collapsible-heading"><span><span className="eyebrow">{t("workflow.agencyWorkplace.settingsEyebrow")}</span><strong>{t("workflow.agencyWorkplace.settingsTitle")}</strong></span><Settings2 size={18} /></summary>
          <div className="agency-production-settings-body"><AgencyWorksiteAccess showConnectionStatus={false} /></div>
        </details>
        {workplaceDrawerOpen && <RightDrawer eyebrow={t("workflow.agencyWorkplace.eyebrow")} title={t("workflow.agencyWorkplace.title")} titleId="agency-workplace-drawer-title" onClose={() => setWorkplaceDrawerOpen(false)} hasUnsavedChanges={Boolean(ownWorksiteName || ownWorksiteAddress || ownProductionName)}>
          <p className="muted-copy">{t("workflow.agencyWorkplace.lead")}</p>
          <form className="workflow-form" onSubmit={createOwnWorkplace}>
            <label className="field-label"><span>{t("workflow.agencyWorkplace.worksiteName")}</span><input value={ownWorksiteName} onChange={(event) => setOwnWorksiteName(event.target.value)} required /></label>
            <p className="muted-copy">{t("workflow.agencyWorkplace.worksiteHelp")}</p>
            <label className="field-label"><span>{t("workflow.agencyWorkplace.address")}</span><input value={ownWorksiteAddress} onChange={(event) => setOwnWorksiteAddress(event.target.value)} required /></label>
            <label className="field-label"><span>{t("workflow.agencyWorkplace.productionName")}</span><input value={ownProductionName} onChange={(event) => setOwnProductionName(event.target.value)} required /><small className="muted-copy">{t("workflow.factoryAccess.productionNameHelp")}</small></label>
            <button className="button button--primary" type="submit"><Building2 size={14} />{t("workflow.agencyWorkplace.create")}</button>
          </form>
        </RightDrawer>}
      </>}
      {isArchiveList ? <div className="production-directory">{archivedFactories.map((item) => {
        const worksite = workspace.worksites?.find((site) => site.id === item.worksiteId);
        const shiftCount = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.factoryId === item.id).length;
        return <article className="dashboard-panel production-directory-card" key={item.id}>
          <Link className="production-directory-hitarea" to={`/agency/productions/${item.id}`} aria-label={`${item.name} — ${t("workflow.production.details")}`}><span className="sr-only">{item.name} — {t("workflow.production.details")}</span></Link>
          <span className="factory-summary-icon"><Archive size={18} /></span>
          <div><h2>{item.name}</h2><p>{item.address || t("workflow.production.addressMissing")}</p><small>{t("workflow.production.worksite")}: {worksite?.name ?? item.name} · {shiftCount} · {t("nav.shifts")}</small></div>
          <div className="production-directory-actions"><button className="button button--outline button--small" type="button" onClick={() => setMessage(restoreProduction(item.id) ? t("workflow.production.restoredToast") : t("workflow.errors.permission"))}><RotateCcw size={14} />{t("workflow.production.restore")}</button></div>
        </article>;
      })}{archivedFactories.length === 0 && <section className="dashboard-panel"><p className="muted-copy">{t("workflow.production.archiveEmpty")}</p></section>}</div> : <div className="production-directory">{renderProductionCards(factories)}</div>}
    </> : !factory ? <section className="dashboard-panel"><p className="muted-copy">{t("workflow.production.notFound")}</p><Link to="/agency/productions">{t("workflow.production.productions")}</Link></section> : <>
      <PageHeading eyebrow={factory.address || workspace.organization.name} title={factory.name} description={isSettings ? t("workflow.production.settingsLead") : factory.description || t("workflow.production.detailsLead")} action={<div className="production-list-actions"><Link className="button button--outline button--small" to={factory.archivedAt ? "/agency/productions/archive" : "/agency/productions"}><ArrowLeft size={15} />{t(factory.archivedAt ? "workflow.production.archiveList" : "workflow.production.productions")}</Link>{active.role === "agency" && !factory.archivedAt && !isSettings && <button className="button button--outline button--small" type="button" onClick={() => setArchiveConfirmationOpen(true)}><Archive size={14} />{t("workflow.production.archiveAction")}</button>}{active.role === "agency" && factory.archivedAt && <button className="button button--outline button--small" type="button" onClick={() => setMessage(restoreProduction(factory.id) ? t("workflow.production.restoredToast") : t("workflow.errors.permission"))}><RotateCcw size={14} />{t("workflow.production.restore")}</button>}</div>} />
      {message && <p className="sr-only">{message}</p>}
      {factory.archivedAt && <p className="inline-notice">{t("workflow.production.archivedNotice", { date: factory.archivedAt.slice(0, 10) })}</p>}
      {!factory.archivedAt && <div className="production-page-tabs"><Link className={!isSettings ? "is-active" : ""} to={`/agency/productions/${factory.id}`}>{t("workflow.production.details")}</Link><Link className={isSettings ? "is-active" : ""} to={`/agency/productions/${factory.id}/settings`}>{t("workflow.production.settings")}</Link></div>}
      {!isSettings ? <>
        <div className="workflow-stat-grid workflow-stat-grid--four">
          <Link className="workflow-stat-card workflow-stat-link" to="/agency/workers"><span>{t("workflow.employment.status.active")} {t("workflow.agency.workersLabel")}</span><strong>{workers.filter((worker) => worker.status === "active").length}</strong></Link>
          <a className="workflow-stat-card workflow-stat-link" href="#production-leaders"><span>{t("workflow.production.leaders")}</span><strong>{leaders.length}</strong></a>
          <Link className="workflow-stat-card workflow-stat-link" to={`/agency/timekeeping?factory=${factory.id}`}><span>{t("nav.shifts")}</span><strong>{periodShifts.length}</strong></Link>
          <Link className="workflow-stat-card workflow-stat-link" to="/agency/reviews?focus=absence#agency-absences-panel"><span>{t("workflow.absence.eyebrow")}</span><strong>{periodAbsences.length}</strong></Link><a className="workflow-stat-card workflow-stat-link" href="#production-shifts"><span>{t("workflow.leader.waiting")}</span><strong>{pendingShiftCount}</strong></a><a className="workflow-stat-card workflow-stat-link" href="#production-shifts"><span>{t("workflow.dispute.eyebrow")}</span><strong>{disputedShiftCount}</strong></a>
        </div>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.overview")}</span><h2>{factory.name}</h2></div><div className="team-filter-row"><label className="field-label"><span>{t("workflow.timekeeping.period")}</span><input type="month" value={overviewMonth} onChange={(event) => setOverviewMonth(event.target.value)} /></label><span className={`mode-badge mode-badge--${factory.inputMode.toLowerCase()}`}>{t(`workflow.agency.modeName.${factory.inputMode}`)}</span></div></div>
          <p>{factory.description || t("workflow.production.noDescription")}</p><p>{factory.address || t("workflow.production.addressMissing")} · {workspace.organization.contactEmail || t("workflow.employment.noContact")}</p><p>{t("workflow.production.worksite")}: {workspace.worksites?.find((site) => site.id === factory.worksiteId)?.name ?? factory.name}</p>
          <p>{t("workflow.production.requiredBreak")}: {factory.requiredBreakMinutes} min · {t("workflow.production.workdays")}: {(factory.workCalendar?.workingWeekdays ?? []).map((day) => t(`workflow.schedule.days.${dayKeys[day]}`)).join(", ") || "—"}</p>
          <p className="policy-note">{t("workflow.production.operationalSettingsOwnedByProduction")}</p>
          <Link className="button button--outline button--small" to={`/agency/timekeeping?factory=${factory.id}`}>{t("workflow.timekeeping.open")}</Link>
        </section>
        <section className="dashboard-panel" id="production-shifts"><div className="panel-heading"><div><span className="eyebrow">{t("nav.shifts")}</span><h2>{t("nav.shifts")}</h2></div><span className="panel-period">{periodShifts.length}</span></div>{periodShifts.length ? periodShifts.map((record) => <article className="factory-queue-row" key={record.shift.id}><WorkerProfileTrigger workerId={record.shift.workerUid} className="worker-profile-open">{workspace.members.find((worker) => worker.organizationId === workspace.organization.id && worker.id === record.shift.workerUid)?.name ?? record.shift.workerUid}</WorkerProfileTrigger><span>{record.shift.localStartDate} · {formatDuration(record.shift.paidDurationMinutes, t)}</span><span className={`status-pill status-pill--${record.shift.workerConfirmation}`}>{record.shift.workerConfirmation === "pending" ? t("workflow.shiftStatus.pending") : record.shift.workerConfirmation === "disputed" ? t("workflow.shiftStatus.disputed") : t(`workflow.shiftStatus.${record.shift.workerConfirmation}`)}</span></article>) : <p className="muted-copy">{t("workflow.worker.noShifts")}</p>}</section>
        <section className="dashboard-panel" id="production-absences"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.absence.eyebrow")}</span><h2>{t("workflow.absence.inbox")}</h2></div><span className="panel-period">{periodAbsences.length}</span></div>{periodAbsences.length ? periodAbsences.map((absence) => <article className="factory-queue-row" key={absence.id}><WorkerProfileTrigger workerId={absence.workerId} className="worker-profile-open">{workers.find((worker) => worker.id === absence.workerId)?.name ?? absence.workerId}</WorkerProfileTrigger><span>{absence.localDate}</span><span className={"status-pill status-pill--" + absence.state}>{t("workflow.absence.state." + absence.state)}</span>{absence.agencyNote && <small>{absence.agencyNote}</small>}</article>) : <p className="muted-copy">{t("workflow.absence.none")}</p>}</section>
        <section className="dashboard-panel" id="production-leaders"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.leaders")}</span><h2>{t("workflow.production.leaders")}</h2></div><span className="panel-period">{leaders.filter((leader) => leader.accessState !== "suspended" && leader.accessState !== "revoked").length}</span></div>{leaders.length ? leaders.map((leader) => <button className="factory-worker-row leader-membership-open" type="button" key={leader.id} onClick={() => setSelectedLeaderId(leader.id)} aria-label={`${leader.name} — ${t("workflow.production.leaderCard")}`}><span className="mini-avatar">{leader.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{leader.name}</strong><small>{t("workflow.production.account")}: {leader.accountUid ?? leader.id} · {t(`workflow.production.access${leader.accessState === "suspended" ? "Suspended" : leader.accessState === "revoked" ? "Revoked" : "Active"}`)}</small></span><span className={`status-pill status-pill--${leader.accessState === "suspended" ? "pending" : leader.accessState === "revoked" ? "cancelled" : "active"}`}>{t("workflow.production.openLeaderCard")}</span></button>) : <p className="muted-copy">{t("workflow.production.noLeaders")}</p>}<p className="muted-copy">{t("workflow.production.leaderConnectNotice")}</p>
          {active.role === "agency" && isAgencyOwnedWorkplace && !factory.archivedAt && <form className="workflow-form" onSubmit={createOwnLeader}><label className="field-label"><span>{t("workflow.agencyWorkplace.leaderName")}</span><input value={ownLeaderName} onChange={(event) => setOwnLeaderName(event.target.value)} required /></label><label className="field-label"><span>{t("workflow.agencyWorkplace.leaderEmail")}</span><input type="email" value={ownLeaderEmail} onChange={(event) => setOwnLeaderEmail(event.target.value)} required /></label><p className="muted-copy field-label--wide">{t("workflow.agencyWorkplace.leaderLead")}</p><button className="button button--outline button--small" type="submit"><UserPlus size={14} />{t("workflow.agencyWorkplace.createLeader")}</button></form>}
          {createdLeaderId && <Link className="button button--outline button--small" to={`/agency/messages?messageTo=${encodeURIComponent(createdLeaderId)}#messages-center`}>{t("workflow.messagesCenter.messageLeaderNow")}</Link>}
        </section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.agency.workersLabel")}</span><h2>{t("workflow.leader.teamList")}</h2></div><span className="panel-period">{workers.length}</span></div>
          {workers.map((worker) => { const records = periodShifts.filter((record) => record.shift.workerUid === worker.id); const minutes = records.filter((record) => !record.shift.deletedAt).reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0); const groupId = getWorkerProductionAssignment(workspace, worker.id, factory.id)?.groupId; const group = workspace.groups.find((item) => item.id === groupId); return <article className="factory-worker-row" key={worker.id}><span className="mini-avatar">{worker.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger><small>{records.length} {t("workflow.timekeeping.shifts")} · {group?.name ?? t("workflow.groups.noGroup")}</small></span><strong>{formatDuration(minutes, t)}</strong></article>; })}
          {workers.length === 0 && <p className="muted-copy">{t("workflow.production.noProductionWorkers")}</p>}
        </section>
        {(workersAwaitingProduction.length > 0 || workersNeedingEmployment.length > 0) && <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.assignedPeople")}</span><h2>{t("workflow.agency.assignWorker")}</h2></div><UserPlus size={17} /></div>{workersAwaitingProduction.length > 0 && <form className="workflow-form" onSubmit={assignWorker}>
          <label className="field-label"><span>{t("workflow.agency.assignWorker")}</span><select value={assignWorkerId} onChange={(event) => setAssignWorkerId(event.target.value)} required><option value="">{t("common.select")}</option>{workersAwaitingProduction.map((worker) => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label>
          {factory.requireNewWorkerTeamAssignment && <label className="checkbox-field field-label--wide"><input type="checkbox" checked={independentParticipant} onChange={(event) => setIndependentParticipant(event.target.checked)} /><span>{t("workflow.employment.independentParticipant")}</span></label>}
          <p className="muted-copy field-label--wide">{t("workflow.production.noLeaderRequired")}</p>
          <button className="button button--primary button--small" type="submit">{t("workflow.production.assign")}</button>
        </form>}{workersNeedingEmployment.length > 0 && <div className="inline-notice"><span>{t("workflow.employment.productionAssignmentNeedsEmployment")}</span><Link className="button button--outline button--small" to={`/agency/workers?factory=${factory.id}`}>{t("workflow.employment.hireForProduction")}</Link></div>}</section>}
      </> : <>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.information")}</span><h2>{t("workflow.production.editDetails")}</h2></div><button className="button button--outline button--small" type="button" onClick={() => setDetailsDrawerOpen(true)}>{t("workflow.production.editDetails")}</button></div><p className="muted-copy">{factory.name} · {factory.address || t("workflow.production.addressMissing")}</p></section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.dataPermissionTitle")}</span><h2>{t("workflow.production.dataPermissionTitle")}</h2></div></div>
          <label className="checkbox-field"><input type="checkbox" checked={factory.allowTimeDataSubmission !== false} onChange={(event) => setMessage(setFactoryTimeDataSubmission(factory.id, event.target.checked) ? t("workflow.production.permissionSaved") : t("workflow.errors.permission"))} /><span>{t("workflow.production.allowTimeDataSubmission")}</span></label>
          <p className="muted-copy">{t("workflow.production.dataPermissionDescription")}</p>
          <label className="checkbox-field"><input type="checkbox" checked={factory.requireNewWorkerTeamAssignment === true} onChange={(event) => setMessage(setFactoryTeamAssignmentRequirement(factory.id, event.target.checked) ? t("workflow.production.permissionSaved") : t("workflow.errors.permission"))} /><span>{t("workflow.production.requireNewWorkerTeamAssignment")}</span></label>
          <p className="muted-copy">{t("workflow.production.requireNewWorkerTeamAssignmentHelp")}</p>
        </section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.inputMode")}</span><h2>{t("workflow.production.inputMode")}</h2></div></div>
          {active.role === "agency" ? <form className="workflow-form" onSubmit={saveInputMode}>
            {factory.inputMode === "C" && <p className="muted-copy field-label--wide">{t("workflow.production.legacyMixedModeNotice")}</p>}
            <label className="field-label"><span>{t("workflow.production.inputMode")}</span><select value={inputMode} onChange={(event) => setInputMode(event.target.value as ProductionInputMode)}>
              <option value="A">{t("workflow.agency.modeName.A")}</option>
              <option value="B">{t("workflow.agency.modeName.B")}</option>
              {factory.inputMode === "C" && <option value="C" disabled>{t("workflow.agency.modeName.C")}</option>}
            </select></label>
            <p className="muted-copy field-label--wide">{t("workflow.production.inputModeHint")}</p>
            <button className="button button--primary button--small" type="submit">{t("common.save")}</button>
          </form> : <p className="policy-note">{t("workflow.production.currentInputMode", { mode: t(`workflow.agency.modeName.${factory.inputMode}`) })}</p>}
        </section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.workflowSettings")}</span><h2>{t("workflow.production.workflowSettings")}</h2></div></div><form className="workflow-form" onSubmit={saveWorkflowSettings}><div className="permission-checks field-label--wide">{(["workerCanRecordHours", "leaderCanRecordHours", "leaderMustReviewShifts", "agencyMustReviewShifts", "workerMustConfirmShifts", "workerCanDisputeShifts", "leaderCanSubmitTimesheet", "agencyCanSubmitTimesheet", "agencyMustAcceptTimesheet"] as const).map((setting) => <label className="checkbox-field" key={setting}><input type="checkbox" checked={workflowSettings[setting]} onChange={(event) => setWorkflowSettings((current) => ({ ...current, [setting]: event.target.checked }))} /><span>{t(`workflow.production.workflow.${setting}`)}</span></label>)}</div><p className="muted-copy field-label--wide">{t("workflow.production.workflowLead")}</p><button className="button button--primary button--small" type="submit">{t("common.save")}</button></form></section>
        <section className="dashboard-panel"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.operationalSettings")}</span><h2>{t("workflow.production.operationalSettings")}</h2></div></div><p className="muted-copy">{t("workflow.production.operationalSettingsOwnedByProduction")}</p></section>
      </>}
      <p className="policy-note">{t("workflow.production.billingNote", { organization: workspace.organization.name })}</p>
    </>}
    {detailsDrawerOpen && factory && <RightDrawer eyebrow={t("workflow.production.information")} title={t("workflow.production.editDetails")} titleId="production-details-drawer-title" onClose={() => setDetailsDrawerOpen(false)} hasUnsavedChanges={name !== factory.name || address !== (factory.address ?? "") || description !== (factory.description ?? "")}>
      <form className="workflow-form" onSubmit={saveDetails}>
        <label className="field-label"><span>{t("workflow.production.name")}</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.production.address")}</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
        <label className="field-label"><span>{t("workflow.production.description")}</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <button className="button button--primary" type="submit">{t("common.save")}</button>
      </form>
    </RightDrawer>}
    {participantFactory && <div className="modal-backdrop production-participants-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setParticipantFactoryId(""); }}><section className="dashboard-panel compact-modal production-participants-dialog" role="dialog" aria-modal="true" aria-labelledby="production-participants-title"><div className="panel-heading"><div><span className="eyebrow">{workspace.organization.name}</span><h2 id="production-participants-title">{participantFactory.name}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setParticipantFactoryId("")}>×</button></div><div className="production-participants-period"><label className="field-label"><span>{t("exports.periodMonth")}</span><input type="month" value={participantMonth} onChange={(event) => setParticipantMonth(event.target.value)} /></label></div><div className="production-participants-table-wrap"><table className="production-participants-table"><thead><tr><th>{t("workflow.fields.worker")}</th><th>{t("monthlyTimesheets.shifts")}</th><th>{t("monthlyTimesheets.gross")}</th><th>{t("monthlyTimesheets.paid")}</th><th>{t("monthlyTimesheets.absences")}</th><th>{t("monthlyTimesheets.recordStatus.title")}</th></tr></thead><tbody>{participantWorkers.map(({ worker, shifts, absences }) => <tr key={worker.id}><td><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger></td><td>{shifts.length}</td><td>{formatDuration(shifts.reduce((sum, record) => sum + record.shift.grossDurationMinutes, 0), t)}</td><td>{formatDuration(shifts.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0), t)}</td><td>{absences.length}</td><td><span className={`status-pill status-pill--${worker.status === "active" ? "active" : "cancelled"}`}>{t(`workflow.employment.status.${worker.status === "active" ? "active" : "ended"}`)}</span></td></tr>)}</tbody></table>{participantWorkers.length === 0 && <p className="muted-copy">{t("workflow.production.noProductionWorkers")}</p>}</div></section></div>}
    {selectedLeader && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLeaderId(""); }}><section className="dashboard-panel compact-modal leader-membership-dialog" role="dialog" aria-modal="true" aria-labelledby="leader-membership-title"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.leaderCard")}</span><h2 id="leader-membership-title">{selectedLeader.name}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setSelectedLeaderId("")}>×</button></div><p className="muted-copy">{t("workflow.production.account")}: <strong>{selectedLeader.accountUid ?? selectedLeader.id}</strong></p><div className="leader-membership-list">{selectedLeaderMemberships.map((membership) => {
      const membershipFactory = workspace.factories.find((item) => item.id === membership.factoryId && item.organizationId === workspace.organization.id);
      return <LeaderMembershipEditor key={membership.id} membership={membership} factoryName={membershipFactory?.name ?? membership.factoryId ?? "—"} readOnly={Boolean(membershipFactory?.archivedAt)} t={t}
        onAccessChange={(accessState) => setMessage(setLeaderMembershipAccess(membership.factoryId ?? "", membership.id, accessState) ? t("workflow.production.permissionSaved") : t("workflow.errors.permission"))}
        onSave={(permissions) => saveLeaderPermissions(membership, permissions)} />;
    })}</div></section></div>}
    {archiveConfirmationOpen && factory && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveConfirmationOpen(false); }}><section className="dashboard-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="production-archive-title"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.production.archiveAction")}</span><h2 id="production-archive-title">{t("workflow.production.archiveConfirmTitle", { name: factory.name })}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setArchiveConfirmationOpen(false)}>×</button></div><p>{t("workflow.production.archiveConfirmBody")}</p><p className="muted-copy">{t("workflow.production.archiveHistoryNote")}</p><div className="form-actions"><button className="button button--primary" type="button" onClick={confirmArchiveProduction}>{t("workflow.production.archiveAction")}</button><button className="button button--quiet" type="button" onClick={() => setArchiveConfirmationOpen(false)}>{t("common.cancel")}</button></div></section></div>}
    <span className="sr-only">{active.name}</span>
  </PortalShell>;
}

function LeaderMembershipEditor({ membership, factoryName, readOnly, t, onAccessChange, onSave }: {
  membership: DemoMember;
  factoryName: string;
  readOnly: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  onAccessChange: (accessState: "active" | "suspended" | "revoked") => void;
  onSave: (permissions: ReturnType<typeof effectiveLeaderPermissions>) => void;
}) {
  const [permissions, setPermissions] = useState(() => effectiveLeaderPermissions(membership));
  useEffect(() => setPermissions(effectiveLeaderPermissions(membership)), [membership.id, membership.permissions]);
  return <section className="leader-membership-item"><div className="leader-membership-item-heading"><h3>{factoryName}</h3><label className="field-label"><span>{t("workflow.production.access")}</span><select disabled={readOnly} value={membership.accessState ?? "active"} onChange={(event) => onAccessChange(event.target.value as "active" | "suspended" | "revoked")}><option value="active">{t("workflow.production.accessActive")}</option><option value="suspended">{t("workflow.production.accessSuspended")}</option><option value="revoked">{t("workflow.production.accessRevoked")}</option></select></label></div><fieldset className="permission-checks"><legend>{t("workflow.production.permissions")}</legend>{(["canViewWorkers", "canRecordHours", "canReviewShifts", "canConfirmShifts", "canSubmitTimesheet", "canManageGroups"] as const).map((permission) => <label className="checkbox-field" key={permission}><input type="checkbox" disabled={readOnly} checked={permissions[permission]} onChange={(event) => setPermissions((current) => ({ ...current, [permission]: event.target.checked }))} /><span>{t(`workflow.production.permission.${permission}`)}</span></label>)}</fieldset>{!readOnly && <button className="button button--outline button--small" type="button" onClick={() => onSave(permissions)}>{t("common.save")}</button>}</section>;
}
