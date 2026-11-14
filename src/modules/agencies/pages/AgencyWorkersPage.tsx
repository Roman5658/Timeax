import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Copy, Link2, UserPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PortalShell } from "../../../app/PortalShell";
import { formatDuration } from "../../workflows/workflow-utils";
import { approveAgencyWorkerJoinRequest, createAgencyWorker, createAgencyWorkerInvitation, declineAgencyWorkerJoinRequest, endWorkerEmployment, getWorkerInvitationUrl, hireWorker, isAgencyVisibleAbsence, revokeAgencyWorkerInvitation, transferWorkerProduction, updateAgencyWorker, useDemoWorkspace } from "../../workflows/demo-store";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { AgencyWorksiteAccess } from "../components/AgencyWorksiteAccess";
import { RightDrawer } from "../../workflows/components/RightDrawer";
import { useToast } from "../../../app/ToastProvider";

export function AgencyWorkersPage({ selfOperated: selfOperatedRoute = false }: { selfOperated?: boolean }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const selfOperated = selfOperatedRoute || workspace.organization.billingScenario === "self-operated";
  const member = workspace.members.find((item) => item.id === workspace.activeMemberId);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "ended">("all");
  const [productionFilter, setProductionFilter] = useState("all");
  const [periodDate, setPeriodDate] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [workerEditOpen, setWorkerEditOpen] = useState(false);
  const [workerDraft, setWorkerDraft] = useState({ name: "", email: "", phone: "" });
  const [workerDrawerOpen, setWorkerDrawerOpen] = useState(false);
  const [invitationDrawerOpen, setInvitationDrawerOpen] = useState(false);
  const [showWorksiteAccess, setShowWorksiteAccess] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [linkedAccountUid, setLinkedAccountUid] = useState("");
  const [factoryId, setFactoryId] = useState(() => {
    const allowed = workspace.factories.filter((item) => item.organizationId === workspace.organization.id && !item.archivedAt && (!selfOperated || item.id === member?.factoryId));
    const requested = searchParams.get("factory");
    return allowed.find((item) => item.id === requested)?.id ?? allowed[0]?.id ?? "";
  });
  const [independentParticipant, setIndependentParticipant] = useState(false);
  const [transferIndependentParticipant, setTransferIndependentParticipant] = useState(false);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [targetFactoryId, setTargetFactoryId] = useState("");
  const [sourceFactoryId, setSourceFactoryId] = useState("");
  const [transferConfirmationOpen, setTransferConfirmationOpen] = useState(false);
  const [transferStartDate, setTransferStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [employmentEndDate, setEmploymentEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setInlineMessage] = useState("");
  const showToast = useToast();
  const setMessage = (value: string) => {
    setInlineMessage(value);
    if (value) showToast(value, value === t("workflow.errors.permission") ? "error" : "success");
  };
  const workers = workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "worker");
  const workerInvitations = (workspace.workerInvitations ?? []).filter((item) => item.organizationId === workspace.organization.id).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const joinRequests = workerInvitations.filter((item) => item.state === "awaiting-approval");
  const factories = workspace.factories.filter((item) => item.organizationId === workspace.organization.id && !item.archivedAt && (!selfOperated || item.id === member?.factoryId));
  useEffect(() => {
    if (!factories.some((factory) => factory.id === factoryId)) setFactoryId(factories[0]?.id ?? "");
    if (!factories.some((factory) => factory.id === targetFactoryId)) setTargetFactoryId("");
  }, [workspace.organization.id, selfOperated, factories, factoryId, targetFactoryId]);
  const selectedWorker = workers.find((item) => item.id === selectedWorkerId);
  const selectedPeriods = workspace.employmentPeriods.filter((period) => period.workerId === selectedWorkerId && period.organizationId === workspace.organization.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const activePeriods = selectedPeriods.filter((period) => period.state === "active");
  const activePeriod = activePeriods[0];
  const transferDateToday = new Date().toISOString().slice(0, 10);
  const currentPlacements = activePeriod?.placements.filter((placement) => placement.startDate <= transferDateToday && (!placement.endDate || placement.endDate >= transferDateToday)) ?? [];
  const sourceFactory = workspace.factories.find((item) => item.id === sourceFactoryId && item.organizationId === workspace.organization.id);
  const targetFactory = factories.find((item) => item.id === targetFactoryId);
  useEffect(() => {
    if (!currentPlacements.some((placement) => placement.factoryId === sourceFactoryId)) setSourceFactoryId(currentPlacements[0]?.factoryId ?? "");
  }, [activePeriod?.id, activePeriod?.placements, sourceFactoryId]);
  const selectedShifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.shift.workerUid === selectedWorkerId).sort((a, b) => b.shift.startAt.localeCompare(a.shift.startAt));
  const selectedAbsences = workspace.absences.filter((absence) => absence.organizationId === workspace.organization.id && absence.workerId === selectedWorkerId && isAgencyVisibleAbsence(workspace, absence)).sort((a, b) => b.localDate.localeCompare(a.localDate));
  const filteredWorkers = useMemo(() => workers.filter((worker) => {
    const periods = workspace.employmentPeriods.filter((item) => item.organizationId === workspace.organization.id && item.workerId === worker.id);
    const period = periodDate ? periods.find((item) => item.startDate <= periodDate && (!item.endDate || item.endDate >= periodDate)) : periods.find((item) => item.state === "active");
    const isActive = periodDate ? Boolean(period && (!period.endDate || period.endDate >= periodDate)) : Boolean(period && period.state === "active");
    const matchesProduction = productionFilter === "all" || periods.some((item) => (!periodDate || (item.startDate <= periodDate && (!item.endDate || item.endDate >= periodDate))) && item.placements.some((placement) => placement.factoryId === productionFilter));
    return matchesProduction && (!periodDate || Boolean(period)) && (status === "all" || status === (isActive ? "active" : "ended")) && worker.name.toLowerCase().includes(search.trim().toLowerCase());
  }), [workers, workspace.employmentPeriods, workspace.organization.id, status, search, productionFilter, periodDate]);

  function getPeriodAt(workerId: string) {
    const periods = workspace.employmentPeriods.filter((item) => item.organizationId === workspace.organization.id && item.workerId === workerId);
    return periodDate
      ? periods.find((item) => item.startDate <= periodDate && (!item.endDate || item.endDate >= periodDate))
      : periods.find((item) => item.state === "active");
  }

  function createAndHire(event: FormEvent) {
    event.preventDefault();
    const worker = createAgencyWorker(newName, newEmail, newPhone, linkedAccountUid || undefined);
    if (!worker) { setMessage(t("workflow.errors.permission")); return; }
    setSelectedWorkerId(worker.id); setWorkerDraft({ name: worker.name, email: worker.email ?? "", phone: worker.phone ?? "" }); setWorkerEditOpen(false);
    if (!hireWorker(worker.id, factoryId || undefined, undefined, startDate, independentParticipant)) { setWorkerDrawerOpen(false); setMessage(t("workflow.errors.permission")); return; }
    setNewName(""); setNewEmail(""); setNewPhone(""); setLinkedAccountUid(""); setIndependentParticipant(false); setWorkerDrawerOpen(false); setMessage(t("workflow.employment.created"));
  }

  function openWorkerProfile(worker: typeof workers[number]) {
    setSelectedWorkerId(worker.id);
    setWorkerDraft({ name: worker.name, email: worker.email ?? "", phone: worker.phone ?? "" });
    setWorkerEditOpen(false);
  }

  function saveWorkerProfile(event: FormEvent) {
    event.preventDefault();
    if (!selectedWorker) return;
    const saved = updateAgencyWorker(selectedWorker.id, workerDraft);
    setMessage(t(saved ? "workflow.employment.workerDetailsSaved" : "workflow.errors.permission"));
    if (saved) setWorkerEditOpen(false);
  }
  function hireExisting(event: FormEvent) {
    event.preventDefault();
    const saved = hireWorker(selectedWorkerId, factoryId || undefined, undefined, startDate, independentParticipant);
    setMessage(saved ? t("workflow.employment.hired") : t("workflow.errors.permission"));
    if (saved) setIndependentParticipant(false);
  }
  function transfer(event: FormEvent) {
    event.preventDefault();
    if (!selectedWorker || !sourceFactoryId || !targetFactoryId || sourceFactoryId === targetFactoryId) return;
    setTransferConfirmationOpen(true);
  }

  function confirmTransfer() {
    if (!selectedWorker || !sourceFactoryId || !targetFactoryId) return;
    const saved = transferWorkerProduction(selectedWorker.id, sourceFactoryId, targetFactoryId, undefined, transferStartDate, true, transferIndependentParticipant);
    setMessage(saved ? t("workflow.employment.transferred") : t("workflow.errors.permission"));
    if (saved) setTransferIndependentParticipant(false);
    setTransferConfirmationOpen(false);
  }

  function createWorkerInvitation() {
    const invitation = createAgencyWorkerInvitation();
    setMessage(t(invitation ? "agencyWorkerInvitations.created" : "workflow.errors.permission"));
  }

  async function copyInvitation(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(t("agencyWorkerInvitations.copied"), "success");
    } catch {
      showToast(t("agencyWorkerInvitations.copyFailed"), "error");
    }
  }

  function approveJoinRequest(invitationId: string) {
    const worker = approveAgencyWorkerJoinRequest(invitationId);
    setMessage(t(worker ? "agencyWorkerInvitations.approved" : "workflow.errors.permission"));
    if (worker) setSelectedWorkerId(worker.id);
  }

  return <PortalShell role="agency">
    <PageHeading eyebrow={workspace.organization.name} title={t(selfOperated ? "workflow.employment.selfWorkersTitle" : "workflow.employment.workersTitle")} description={t("workflow.employment.workersLead")} action={<Link className="button button--outline button--small" to="/agency"><ArrowLeft size={15} />{t("workflow.employment.backToAgency")}</Link>} />
    {message && <p className="sr-only">{message}</p>}
    <section className="dashboard-panel worker-invitation-toolbar">
      <div className="panel-heading"><div><span className="eyebrow">{t("agencyWorkerInvitations.eyebrow")}</span><h2>{t("agencyWorkerInvitations.title")}</h2></div><span className="panel-period">{joinRequests.length}</span></div>
      <p className="muted-copy">{t("agencyWorkerInvitations.lead")}</p>
      <div className="form-actions"><button className="button button--outline button--small" type="button" onClick={() => setWorkerDrawerOpen(true)}><UserPlus size={15} />{t("workflow.employment.addWorker")}</button><button className="button button--primary button--small" type="button" onClick={() => setInvitationDrawerOpen(true)}><UserPlus size={15} />{t("agencyWorkerInvitations.inviteAction")}</button></div>
    </section>
    {joinRequests.length > 0 && <section className="dashboard-panel" id="worker-join-requests">
      <div className="panel-heading"><div><span className="eyebrow">{t("agencyWorkerInvitations.eyebrow")}</span><h2>{t("agencyWorkerInvitations.joinRequests")}</h2></div><span className="panel-period">{joinRequests.length}</span></div>
      <div className="worker-join-request-list">{joinRequests.map((invitation) => <article className="worker-join-request" key={invitation.id}>
        <div><strong>{invitation.name}</strong><span>{invitation.email}</span>{invitation.phone && <span>{invitation.phone}</span>}<small>{t("agencyWorkerInvitations.registeredAt", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(invitation.registeredAt ?? invitation.createdAt)) })}</small><small>{t("agencyWorkerInvitations.invitationCode", { code: invitation.code })}</small></div>
        <span className="status-pill status-pill--pending">{t("agencyWorkerInvitations.status.awaiting-approval")}</span>
        <div className="form-actions"><button className="button button--primary button--small" type="button" onClick={() => approveJoinRequest(invitation.id)}>{t("agencyWorkerInvitations.approve")}</button><button className="button button--quiet button--small" type="button" onClick={() => { const saved = declineAgencyWorkerJoinRequest(invitation.id); setMessage(t(saved ? "agencyWorkerInvitations.declined" : "workflow.errors.permission")); }}>{t("agencyWorkerInvitations.decline")}</button></div>
      </article>)}</div>
    </section>}
    {invitationDrawerOpen && <RightDrawer eyebrow={t("agencyWorkerInvitations.eyebrow")} title={t("agencyWorkerInvitations.title")} titleId="worker-invitation-drawer-title" onClose={() => setInvitationDrawerOpen(false)}>
      <p className="muted-copy">{t("agencyWorkerInvitations.lead")}</p>
      <button className="button button--primary button--small" type="button" onClick={createWorkerInvitation}><UserPlus size={15} />{t("agencyWorkerInvitations.create")}</button>
      {workerInvitations.length === 0 ? <p className="muted-copy">{t("agencyWorkerInvitations.empty")}</p> : <div className="worker-invitation-list">{workerInvitations.map((invitation) => <article className="worker-invitation-row" key={invitation.id}>
        <div><strong>{invitation.code}</strong><span className={"status-pill status-pill--" + (invitation.state === "pending" && Date.parse(invitation.expiresAt) <= Date.now() ? "expired" : invitation.state)}>{t("agencyWorkerInvitations.status." + (invitation.state === "pending" && Date.parse(invitation.expiresAt) <= Date.now() ? "expired" : invitation.state))}</span><small>{t("agencyWorkerInvitations.createdAt", { date: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(invitation.createdAt)) })}</small>{invitation.name && <small>{invitation.name} · {invitation.email}</small>}</div>
        <div className="form-actions"><button className="button button--outline button--small" type="button" onClick={() => copyInvitation(invitation.code)}><Copy size={14} />{t("agencyWorkerInvitations.copyCode")}</button><button className="button button--outline button--small" type="button" onClick={() => copyInvitation(getWorkerInvitationUrl(invitation.code))}><Link2 size={14} />{t("agencyWorkerInvitations.copyLink")}</button>{invitation.state === "pending" && <button className="button button--quiet button--small" type="button" onClick={() => { const saved = revokeAgencyWorkerInvitation(invitation.id); setMessage(t(saved ? "agencyWorkerInvitations.revoked" : "workflow.errors.permission")); }}>{t("agencyWorkerInvitations.revoke")}</button>}</div>
      </article>)}</div>}
    </RightDrawer>}
    {workerDrawerOpen && <RightDrawer eyebrow={t("workflow.employment.addWorker")} title={t("workflow.employment.createAndHire")} titleId="agency-worker-create-drawer-title" onClose={() => setWorkerDrawerOpen(false)} hasUnsavedChanges={Boolean(newName || newEmail || newPhone || linkedAccountUid)}>
      <form className="workflow-form" onSubmit={createAndHire}>
        <label className="field-label"><span>{t("workflow.fields.name")}</span><input value={newName} onChange={(event) => setNewName(event.target.value)} required /></label>
        <label className="field-label"><span>{t("workflow.employment.email")}</span><input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} /></label>
        <label className="field-label"><span>{t("workflow.employment.phone")}</span><input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} /></label>
        <label className="field-label"><span>{t("workflow.employment.linkAccount")}</span><input autoComplete="off" value={linkedAccountUid} onChange={(event) => setLinkedAccountUid(event.target.value)} /></label>
        <div className="field-action-row"><label className="field-label"><span>{t("workflow.fields.production")}</span><select value={factoryId} onChange={(event) => setFactoryId(event.target.value)}><option value="">{t("workflow.employment.noProductionAssignment")}</option>{factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label><button className="button button--outline button--small" type="button" onClick={() => setShowWorksiteAccess((visible) => !visible)}>{t("workflow.factoryAccess.requestAccess")}</button></div>
        {factories.find((factory) => factory.id === factoryId)?.requireNewWorkerTeamAssignment && <label className="checkbox-field field-label--wide"><input type="checkbox" checked={independentParticipant} onChange={(event) => setIndependentParticipant(event.target.checked)} /><span>{t("workflow.employment.independentParticipant")}</span></label>}
        <label className="field-label"><span>{t("workflow.employment.startDate")}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <button className="button button--primary field-label--wide" type="submit">{t("workflow.employment.createAndHire")}</button>
      </form>
      {showWorksiteAccess && <div className="agency-worker-inline-access"><p className="muted-copy">{t("workflow.employment.formWillStayOpen")}</p><AgencyWorksiteAccess showConnectionStatus={false} /></div>}
    </RightDrawer>}
    <div className="agency-worker-management-grid">
      <section className="dashboard-panel">
        <div className="panel-heading"><div><span className="eyebrow">{t("workflow.employment.roster")}</span><h2>{t("workflow.employment.workersTitle")}</h2></div><span className="panel-period">{workers.length}</span></div>
        <div className="worker-list-filters"><label className="field-label"><span>{t("workflow.employment.search")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="field-label"><span>{t("workflow.employment.statusFilter")}</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">{t("common.all")}</option><option value="active">{t("workflow.employment.status.active")}</option><option value="ended">{t("workflow.employment.status.ended")}</option></select></label><label className="field-label"><span>{t("workflow.fields.production")}</span><select value={productionFilter} onChange={(event) => setProductionFilter(event.target.value)}><option value="all">{t("common.all")}</option>{factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label><label className="field-label"><span>{t("workflow.employment.asOfDate")}</span><input type="date" value={periodDate} onChange={(event) => setPeriodDate(event.target.value)} /></label></div>
        <div className="agency-worker-roster">{filteredWorkers.map((worker) => {
          const period = getPeriodAt(worker.id);
          const visiblePlacements = period?.placements.filter((placement) => !periodDate || placement.startDate <= periodDate && (!placement.endDate || placement.endDate >= periodDate)) ?? [];
          const assignment = visiblePlacements.map((item) => workspace.factories.find((factory) => factory.id === item.factoryId)?.name).filter(Boolean).join(", ");
          return <div role="button" tabIndex={0} className={"agency-worker-roster-row" + (selectedWorkerId === worker.id ? " is-selected" : "")} key={worker.id} onClick={() => openWorkerProfile(worker)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openWorkerProfile(worker); } }}><span className="mini-avatar">{worker.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><span><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger><small>{assignment || t("workflow.employment.noCurrentPlacement")}</small></span><span className={"status-pill status-pill--" + (period ? "active" : "ended")}>{t("workflow.employment.status." + (period ? "active" : "ended"))}</span></div>;
        })}</div>
      </section>
    </div>
    {selectedWorker && <RightDrawer eyebrow={t("workflow.employment.profile")} title={selectedWorker.name} titleId="agency-worker-profile-drawer-title" onClose={() => { setSelectedWorkerId(""); setWorkerEditOpen(false); }} hasUnsavedChanges={Boolean(workerEditOpen && (workerDraft.name !== selectedWorker.name || workerDraft.email !== (selectedWorker.email ?? "") || workerDraft.phone !== (selectedWorker.phone ?? "")) || targetFactoryId || transferStartDate !== transferDateToday || employmentEndDate !== transferDateToday || independentParticipant)}>
      <section className="dashboard-panel employment-profile-panel">
      <div className="panel-heading"><div><span className="eyebrow">{t("workflow.employment.profile")}</span><h2>{selectedWorker.name}</h2></div><span className={"status-pill status-pill--" + (activePeriod ? "active" : "ended")}>{t("workflow.employment.status." + (activePeriod ? "active" : "ended"))}</span></div>
      <p className="muted-copy">{selectedWorker.email || selectedWorker.phone || t("workflow.employment.noContact")}</p>
      {!workerEditOpen && <button className="button button--outline button--small" type="button" onClick={() => { setWorkerDraft({ name: selectedWorker.name, email: selectedWorker.email ?? "", phone: selectedWorker.phone ?? "" }); setWorkerEditOpen(true); }}>{t("workflow.employment.editWorker")}</button>}
      {workerEditOpen && <form className="workflow-form employment-action-form" onSubmit={saveWorkerProfile}>
        <label className="field-label"><span>{t("workflow.fields.name")}</span><input value={workerDraft.name} onChange={(event) => setWorkerDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
        <label className="field-label"><span>{t("workflow.employment.email")}</span><input type="email" value={workerDraft.email} onChange={(event) => setWorkerDraft((current) => ({ ...current, email: event.target.value }))} /></label>
        <label className="field-label"><span>{t("workflow.employment.phone")}</span><input value={workerDraft.phone} onChange={(event) => setWorkerDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
        <div className="form-actions"><button className="button button--primary" type="submit">{t("common.save")}</button><button className="button button--quiet" type="button" onClick={() => { setWorkerEditOpen(false); setWorkerDraft({ name: selectedWorker.name, email: selectedWorker.email ?? "", phone: selectedWorker.phone ?? "" }); }}>{t("common.cancel")}</button></div>
      </form>}
      {selectedPeriods.map((period) => <article className="employment-history-row" key={period.id}><strong>{period.startDate}{period.endDate ? " — " + period.endDate : " — " + t("workflow.employment.current")}</strong><span>{t("workflow.employment.status." + period.state)}</span>{period.placements.length ? period.placements.map((placement) => <small key={placement.id}>{workspace.factories.find((factory) => factory.id === placement.factoryId)?.name} · {workspace.members.find((leader) => leader.id === placement.leaderId)?.name ?? t("workflow.employment.noLeader")} · {placement.startDate}{placement.endDate ? " — " + placement.endDate : ""}</small>) : <small>{t("workflow.employment.noProductionAssignment")}</small>}{period.history.length > 0 && <details><summary>{t("workflow.history.open")}</summary>{period.history.map((event) => <small key={event.id}>{workspace.members.find((actor) => actor.id === event.actorId)?.name ?? event.actorId} · {t(`workflow.employment.event.${event.action}`)} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}{event.note ? ` · ${event.note}` : ""}</small>)}</details>}</article>)}
      {!activePeriod && <form className="workflow-form employment-action-form" onSubmit={hireExisting}><h3>{selectedPeriods.length ? t("workflow.employment.rehire") : t("workflow.employment.hire")}</h3><label className="field-label"><span>{t("workflow.fields.production")}</span><select value={factoryId} onChange={(event) => setFactoryId(event.target.value)}><option value="">{t("workflow.employment.noProductionAssignment")}</option>{factories.map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label>{factories.find((factory) => factory.id === factoryId)?.requireNewWorkerTeamAssignment && <label className="checkbox-field"><input type="checkbox" checked={independentParticipant} onChange={(event) => setIndependentParticipant(event.target.checked)} /><span>{t("workflow.employment.independentParticipant")}</span></label>}<label className="field-label"><span>{t("workflow.employment.startDate")}</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><button className="button button--primary" type="submit">{t("workflow.employment.confirmHire")}</button></form>}
      {activePeriod && <div className="employment-actions"><form className="workflow-form employment-action-form" onSubmit={transfer}><h3>{t("workflow.employment.transfer")}</h3>{activePeriods.length > 1 && <p className="notice-box notice-box--warm">{t("workflow.employment.multipleActivePeriods")}</p>}{currentPlacements.length === 0 && <p className="muted-copy">{t("workflow.employment.noActivePlacement")}</p>}{currentPlacements.length > 1 && <label className="field-label"><span>{t("workflow.employment.fromProduction")}</span><select value={sourceFactoryId} onChange={(event) => setSourceFactoryId(event.target.value)} required><option value="">{t("common.select")}</option>{currentPlacements.map((placement) => <option key={placement.id} value={placement.factoryId}>{workspace.factories.find((item) => item.id === placement.factoryId)?.name ?? placement.factoryId}</option>)}</select></label>}{currentPlacements.length === 1 && <p className="muted-copy">{t("workflow.employment.fromProduction")}: {sourceFactory?.name ?? "—"}</p>}<label className="field-label"><span>{t("workflow.employment.toProduction")}</span><select value={targetFactoryId} onChange={(event) => setTargetFactoryId(event.target.value)} required><option value="">{t("common.select")}</option>{factories.filter((candidate) => candidate.id !== sourceFactoryId && !currentPlacements.some((placement) => placement.factoryId === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label className="field-label"><span>{t("workflow.employment.startDate")}</span><input type="date" min={sourceFactoryId ? currentPlacements.find((placement) => placement.factoryId === sourceFactoryId)?.startDate : undefined} max={transferDateToday} value={transferStartDate} onChange={(event) => setTransferStartDate(event.target.value)} required /></label><button className="button button--outline button--small" type="submit" disabled={activePeriods.length !== 1 || !sourceFactoryId || !targetFactoryId || sourceFactoryId === targetFactoryId || !currentPlacements.some((placement) => placement.factoryId === sourceFactoryId) || transferStartDate < (currentPlacements.find((placement) => placement.factoryId === sourceFactoryId)?.startDate ?? "9999-12-31")}>{t("workflow.employment.transfer")}</button></form><div className="employment-action-form"><h3>{t("workflow.employment.end")}</h3><label className="field-label"><span>{t("workflow.employment.endDate")}</span><input type="date" value={employmentEndDate} onChange={(event) => setEmploymentEndDate(event.target.value)} /></label><button className="button button--outline button--small" type="button" onClick={() => setMessage(endWorkerEmployment(selectedWorker.id, employmentEndDate) ? t("workflow.employment.ended") : t("workflow.errors.permission"))}>{t("workflow.employment.end")}</button></div></div>}
      <section className="employment-shift-history"><div className="panel-heading"><div><span className="eyebrow">{t("nav.shifts")}</span><h3>{t("workflow.employment.workerHistory")}</h3></div><Link className="button button--quiet button--small" to={`/agency/timekeeping?worker=${selectedWorker.id}`}>{t("workflow.timekeeping.open")}</Link></div>{selectedShifts.length ? selectedShifts.map((record) => <article className="timekeeping-shift-row" key={record.shift.id}><strong>{record.shift.localStartDate}</strong><span>{workspace.factories.find((item) => item.id === record.shift.factoryId)?.name ?? t("workflow.employment.noProductionAssignment")}</span><span>{formatDuration(record.shift.paidDurationMinutes, t)}</span><span>{record.shift.deletedAt ? t("workflow.shiftCancellation.cancelled") : t(`workflow.shiftStatus.${record.shift.workerConfirmation}`)}</span>{record.shift.comment && <small>{record.shift.comment}</small>}{record.cancellationReason && <small>{t("workflow.shiftCancellation.reason")}: {record.cancellationReason}</small>}<details><summary>{t("workflow.history.open")}</summary>{record.history.map((event) => <small key={event.id}>{event.actorName} · {t(`workflow.history.action.${event.action}`)} · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}{event.note ? ` · ${event.note}` : ""}</small>)}</details></article>) : <p className="muted-copy">{t("workflow.worker.noShifts")}</p>}{selectedAbsences.map((absence) => <p className="timekeeping-absence-row" key={absence.id}>{absence.localDate} · {t(`workflow.absence.agencyCategory.${absence.agencyCategory ?? (absence.state === "unreported" ? "unreported" : "attention")}`)} · {absence.agencyNote || t(`workflow.absence.state.${absence.state}`)}</p>)}</section>
      </section>
    </RightDrawer>}
      {transferConfirmationOpen && selectedWorker && sourceFactory && targetFactory && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransferConfirmationOpen(false); }}><section className="dashboard-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="worker-transfer-title"><div className="panel-heading"><div><span className="eyebrow">{t("workflow.employment.transfer")}</span><h2 id="worker-transfer-title">{t("workflow.employment.transferConfirmTitle")}</h2></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setTransferConfirmationOpen(false)}>×</button></div><dl className="transfer-confirmation-details"><div><dt>{t("nav.people")}</dt><dd>{selectedWorker.name}</dd></div><div><dt>{t("workflow.employment.fromProduction")}</dt><dd>{sourceFactory.name}</dd></div><div><dt>{t("workflow.employment.toProduction")}</dt><dd>{targetFactory.name}</dd></div><div><dt>{t("workflow.production.organization")}</dt><dd>{workspace.organization.name}</dd></div></dl><p>{t("workflow.employment.transferConfirmBody", { worker: selectedWorker.name, from: sourceFactory.name, to: targetFactory.name })}</p><p className="muted-copy">{t("workflow.employment.transferHistoryNote")}</p>{targetFactory.requireNewWorkerTeamAssignment && <label className="checkbox-field"><input type="checkbox" checked={transferIndependentParticipant} onChange={(event) => setTransferIndependentParticipant(event.target.checked)} /><span>{t("workflow.employment.independentParticipant")}</span></label>}<div className="form-actions"><button className="button button--primary" type="button" onClick={confirmTransfer}>{t("workflow.employment.confirmTransfer")}</button><button className="button button--quiet" type="button" onClick={() => setTransferConfirmationOpen(false)}>{t("common.cancel")}</button></div></section></div>}
    <p className="policy-note">{t("workflow.employment.noPhysicalDelete")}</p>
  </PortalShell>;
}
