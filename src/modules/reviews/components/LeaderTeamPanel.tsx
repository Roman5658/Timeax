import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MessageCircleWarning } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "../../../app/ToastProvider";
import { useTargetHighlight } from "../../../shared/useTargetHighlight";
import { formatDuration, todayLocalDate } from "../../workflows/workflow-utils";
import { assignWorkerToGroupForMembership, createLeaderWorkerMessage, getActiveMember, getLeaderProductionMemberships, getLeaderProductionParticipants, getWorkspaceForOrganization, setLeaderWorkerAccessForMembership, useDemoWorkspace, type LeaderProductionParticipant } from "../../workflows/demo-store";
import { WorkerProfileTrigger } from "../../workflows/components/WorkerProfile";
import { effectiveLeaderPermissions } from "../../workflows/domain/access";
import type { DemoMember } from "../../workflows/domain/demo-types";

interface TeamRow {
  key: string;
  membership: DemoMember;
  participant: LeaderProductionParticipant;
  organizationName: string;
  factoryName: string;
}

export function LeaderTeamPanel() {
  const { t } = useTranslation();
  const showToast = useToast();
  const [searchParams] = useSearchParams();
  const workspace = useDemoWorkspace();
  const leader = getActiveMember(workspace);
  const memberships = getLeaderProductionMemberships(workspace, leader.id)
    .filter((membership) => effectiveLeaderPermissions(membership).canViewWorkers && membership.factoryId);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [productionFilter, setProductionFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState(() => searchParams.get("focus") === "new-workers" ? "pending" : "all");
  const [month, setMonth] = useState(() => todayLocalDate().slice(0, 7));
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [assignmentGroupId, setAssignmentGroupId] = useState("");
  const [groupSelections, setGroupSelections] = useState<Record<string, string>>({});
  const [noteTarget, setNoteTarget] = useState<TeamRow>();
  const [noteCategory, setNoteCategory] = useState<"service-note" | "complaint">("service-note");
  const [noteSubject, setNoteSubject] = useState("");
  const [noteText, setNoteText] = useState("");
  const focusWorkerId = searchParams.get("focus") === "new-workers" ? searchParams.get("id") ?? "" : "";
  useTargetHighlight(focusWorkerId ? `leader-worker-${leader.id}-${focusWorkerId}` : "", Boolean(focusWorkerId));

  useEffect(() => {
    if (searchParams.get("focus") === "new-workers") setAssignmentFilter("pending");
  }, [searchParams]);

  const rows = useMemo(() => memberships.flatMap((membership) => {
    const scoped = getWorkspaceForOrganization(workspace, membership.organizationId);
    const organization = workspace.organizations.find((item) => item.id === membership.organizationId);
    const factory = workspace.factories.find((item) => item.id === membership.factoryId && item.organizationId === membership.organizationId);
    if (!organization || !factory || factory.archivedAt) return [];
    return getLeaderProductionParticipants(scoped, membership.id, factory.id).map((participant) => ({
      key: `${membership.id}:${participant.worker.id}`,
      membership,
      participant,
      organizationName: organization.name,
      factoryName: factory.name,
    }));
  }), [memberships, workspace]);

  const visibleGroups = workspace.groups.filter((group) => {
    if (group.archivedAt) return false;
    return memberships.some((item) => item.organizationId === group.organizationId && item.factoryId === group.factoryId);
  }).sort((left, right) => left.name.localeCompare(right.name));
  const groups = visibleGroups.filter((group) => {
    const membership = memberships.find((item) => item.organizationId === group.organizationId && item.factoryId === group.factoryId);
    return Boolean(membership && effectiveLeaderPermissions(membership).canManageGroups && (group.leaderId === membership.id || membership.canManageAllWorkers));
  });
  const filteredRows = rows.filter((row) => {
    const groupId = row.participant.groupId;
    return (agencyFilter === "all" || row.membership.organizationId === agencyFilter)
      && (productionFilter === "all" || row.membership.factoryId === productionFilter)
      && (groupFilter === "all" || groupFilter === "none" && !groupId || groupId === groupFilter)
      && (assignmentFilter === "all" || assignmentFilter === "assigned" && Boolean(groupId) || assignmentFilter === "unassigned" && !groupId || assignmentFilter === "pending" && Boolean(row.participant.requiresTeamAssignment))
      && (statusFilter === "all" || (row.participant.accessState === "removed" ? statusFilter === "removed" : row.participant.worker.status === statusFilter))
      && row.participant.worker.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const selectedRows = rows.filter((row) => selectedKeys.includes(row.key) && row.participant.accessState === "active" && effectiveLeaderPermissions(row.membership).canManageGroups);
  const selectedGroup = groups.find((group) => group.id === assignmentGroupId);
  const agencies = [...new Map(memberships.map((item) => [item.organizationId, workspace.organizations.find((organization) => organization.id === item.organizationId)!])).values()].sort((left, right) => left.name.localeCompare(right.name));
  const factories = [...new Map(memberships.map((item) => [item.factoryId!, workspace.factories.find((factory) => factory.id === item.factoryId && factory.organizationId === item.organizationId)!])).values()].sort((left, right) => left.name.localeCompare(right.name));
  const filterGroups = visibleGroups.filter((group) => productionFilter === "all" || group.factoryId === productionFilter);

  function toggleRow(key: string) {
    setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function applyGroupAssignment() {
    if (!assignmentGroupId && assignmentGroupId !== "__ungrouped__") return;
    const targetGroup = assignmentGroupId === "__ungrouped__" ? undefined : selectedGroup;
    const eligible = selectedRows.filter((row) => !targetGroup || row.membership.organizationId === targetGroup.organizationId && row.membership.factoryId === targetGroup.factoryId);
    const completed = eligible.filter((row) => assignWorkerToGroupForMembership(row.membership.id, row.participant.worker.id, targetGroup?.id)).length;
    const skipped = selectedRows.length - eligible.length;
    showToast(completed
      ? `${t("workflow.leader.assignmentSaved", { total: completed })}${targetGroup ? ` ${t("workflow.leader.assignmentGroupResult", { group: targetGroup.name })}` : ""}${skipped ? ` ${t("workflow.leader.assignmentSkipped", { total: skipped })}` : ""}`
      : t("workflow.errors.permission"), completed ? "success" : "error");
    if (completed) { setSelectedKeys([]); setAssignmentGroupId(""); }
  }

  function changeWorkerAccess(row: TeamRow) {
    const nextState = row.participant.accessState === "removed" ? "active" : "removed";
    const saved = setLeaderWorkerAccessForMembership(row.membership.id, row.participant.worker.id, nextState);
    showToast(t(saved ? nextState === "removed" ? "workflow.leader.participants.removedToast" : "workflow.leader.participants.returned" : "workflow.errors.permission"), saved ? "success" : "error");
    if (saved) setSelectedKeys((current) => current.filter((key) => key !== row.key));
  }

  function openNote(row: TeamRow, category: "service-note" | "complaint" = "service-note") {
    setNoteTarget(row);
    setNoteCategory(category);
    setNoteSubject("");
    setNoteText("");
  }

  function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!noteTarget) return;
    const saved = createLeaderWorkerMessage(noteTarget.membership.id, noteTarget.participant.worker.id, noteCategory, noteSubject, noteText);
    showToast(t(saved ? "workflow.leader.noteSent" : "workflow.errors.permission"), saved ? "success" : "error");
    if (saved) setNoteTarget(undefined);
  }

  function rowStats(row: TeamRow) {
    const workerId = row.participant.worker.id;
    const records = workspace.shifts.filter((record) => record.organizationId === row.membership.organizationId && record.shift.factoryId === row.membership.factoryId && record.shift.workerUid === workerId && record.shift.localStartDate.startsWith(`${month}-`) && !record.shift.deletedAt);
    const absences = workspace.absences.filter((absence) => absence.organizationId === row.membership.organizationId && absence.factoryId === row.membership.factoryId && absence.workerId === workerId && absence.localDate.startsWith(`${month}-`));
    return {
      shifts: records.length,
      gross: records.reduce((total, record) => total + record.shift.grossDurationMinutes, 0),
      paid: records.reduce((total, record) => total + record.shift.paidDurationMinutes, 0),
      absences: absences.length,
    };
  }

  return <section className="dashboard-panel leader-team-panel" id="leader-team-panel">
    <div className="panel-heading"><div><span className="eyebrow">{t("workflow.leader.roster.title")}</span><h2>{t("workflow.leader.teamTitle")}</h2><p className="muted-copy">{t("workflow.leader.roster.description")}</p></div><div className="panel-heading-side"><span className="panel-period">{t("workflow.leader.selected", { total: selectedRows.length })}</span><button type="button" className="text-button" onClick={() => { const visible = filteredRows.filter((row) => row.participant.accessState === "active" && effectiveLeaderPermissions(row.membership).canManageGroups).map((row) => row.key); const allSelected = visible.length > 0 && visible.every((key) => selectedKeys.includes(key)); setSelectedKeys((current) => allSelected ? current.filter((key) => !visible.includes(key)) : [...new Set([...current, ...visible])]); }}>{t("workflow.leader.selectVisible")}</button></div></div>
    <div className="leader-roster-controls leader-team-filters">
      <label className="field-label"><span>{t("workflow.leader.searchWorkers")}</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="field-label"><span>{t("workflow.leader.agencyFilter")}</span><select value={agencyFilter} onChange={(event) => { setAgencyFilter(event.target.value); setProductionFilter("all"); setGroupFilter("all"); }}><option value="all">{t("common.all")}</option>{agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.leader.productionFilter")}</span><select value={productionFilter} onChange={(event) => { setProductionFilter(event.target.value); setGroupFilter("all"); }}><option value="all">{t("common.all")}</option>{factories.filter((factory) => agencyFilter === "all" || memberships.some((membership) => membership.factoryId === factory.id && membership.organizationId === agencyFilter)).map((factory) => <option key={factory.id} value={factory.id}>{factory.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.leader.groupFilter")}</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">{t("workflow.leader.allGroups")}</option><option value="none">{t("workflow.leader.roster.noGroup")}</option>{filterGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className="field-label"><span>{t("workflow.leader.teamAssignmentStatus")}</span><select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}><option value="all">{t("common.all")}</option><option value="assigned">{t("workflow.leader.groupAssigned")}</option><option value="unassigned">{t("workflow.leader.groupUnassigned")}</option><option value="pending">{t("workflow.leader.pendingAssignments")}</option></select></label>
      <label className="field-label"><span>{t("workflow.leader.statusFilter")}</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t("common.all")}</option><option value="active">{t("workflow.memberState.active")}</option><option value="away">{t("workflow.memberState.away")}</option><option value="removed">{t("workflow.leader.participants.removed")}</option></select></label>
      <label className="field-label"><span>{t("workflow.timekeeping.period")}</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
    </div>
    {selectedRows.length > 0 && <div className="team-bulk-actions"><strong>{t("workflow.leader.selected", { total: selectedRows.length })}</strong><label className="field-label"><span>{t("workflow.leader.assignGroupSelection")}</span><select value={assignmentGroupId} onChange={(event) => setAssignmentGroupId(event.target.value)}><option value="">{t("common.select")}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.factoryId && workspace.factories.find((factory) => factory.id === group.factoryId)?.name}</option>)}<option value="__ungrouped__">{t("workflow.leader.leaveWithoutGroup")}</option></select></label><button type="button" className="button button--primary button--small" disabled={!assignmentGroupId} onClick={applyGroupAssignment}>{assignmentGroupId === "__ungrouped__" ? t("workflow.leader.leaveWithoutGroup") : t("workflow.leader.assignSelectedToGroup")}</button><button type="button" className="button button--quiet button--small" onClick={() => { setSelectedKeys([]); setAssignmentGroupId(""); }}>{t("workflow.leader.clearSelection")}</button></div>}
    <div className="leader-participants-table-wrap"><table className="leader-participants-table"><thead><tr><th>{t("nav.people")}</th><th>{t("workflow.leader.agencyFilter")}</th><th>{t("workflow.leader.productionFilter")}</th><th>{t("workflow.groups.title")}</th><th>{t("workflow.timekeeping.shifts")}</th><th>{t("workflow.fields.gross")}</th><th>{t("workflow.fields.paid")}</th><th>{t("workflow.timekeeping.absences")}</th><th>{t("workflow.timekeeping.status")}</th><th>{t("workflow.leader.participants.manage")}</th></tr></thead><tbody>{filteredRows.map((row) => {
      const worker = row.participant.worker;
      const stats = rowStats(row);
      const group = workspace.groups.find((item) => item.id === row.participant.groupId && item.organizationId === row.membership.organizationId && item.factoryId === row.membership.factoryId);
      const canManage = effectiveLeaderPermissions(row.membership).canManageGroups;
      const compatibleGroups = groups.filter((item) => item.organizationId === row.membership.organizationId && item.factoryId === row.membership.factoryId);
      const isRemoved = row.participant.accessState === "removed";
      return <tr key={row.key} id={`leader-worker-${row.membership.id}-${worker.id}`} className={isRemoved ? "is-removed" : ""}>
        <td><div className="participant-select">{canManage && !isRemoved ? <input type="checkbox" aria-label={`${t("workflow.leader.teamTitle")}: ${worker.name}`} checked={selectedKeys.includes(row.key)} onChange={() => toggleRow(row.key)} /> : <span className="participant-select-spacer" aria-hidden="true" />}<span className="participant-identity"><WorkerProfileTrigger workerId={worker.id} className="worker-profile-open">{worker.name}</WorkerProfileTrigger><small>{t(`workflow.memberState.${worker.status}`)}</small></span></div></td>
      <td>{row.organizationName}</td><td>{row.factoryName}</td>
        <td><span>{group?.name ?? <span className="muted-copy">{t("workflow.leader.roster.noGroup")}</span>}</span><small className="team-assignment-state">{t(group ? "workflow.leader.groupAssigned" : "workflow.leader.groupUnassigned")}</small></td>
        <td>{stats.shifts}</td><td>{formatDuration(stats.gross, t)}</td><td>{formatDuration(stats.paid, t)}</td><td>{stats.absences}</td>
        <td><div className="team-row-status"><span className={`status-pill status-pill--${isRemoved ? "removed" : worker.status}`}>{isRemoved ? t("workflow.leader.participants.removed") : t(`workflow.memberState.${worker.status}`)}</span>{row.participant.requiresTeamAssignment && <span className="status-pill status-pill--pending">{t("workflow.leader.assignmentPendingStatus")}</span>}</div></td>
        <td><div className="team-row-actions">{canManage && !isRemoved && <><label className="sr-only" htmlFor={`team-group-${row.key}`}>{t("workflow.leader.assignGroupSelection")}</label><select id={`team-group-${row.key}`} value={groupSelections[row.key] ?? group?.id ?? ""} onChange={(event) => setGroupSelections((current) => ({ ...current, [row.key]: event.target.value }))}><option value="">{t("common.select")}</option><option value="__ungrouped__">{t("workflow.leader.leaveWithoutGroup")}</option>{compatibleGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="text-button" disabled={!(groupSelections[row.key] ?? group?.id) || (groupSelections[row.key] ?? group?.id) === group?.id} onClick={() => { const selectedId = groupSelections[row.key] ?? group?.id ?? ""; const targetId = selectedId === "__ungrouped__" ? undefined : selectedId; const saved = assignWorkerToGroupForMembership(row.membership.id, worker.id, targetId); const groupName = compatibleGroups.find((item) => item.id === targetId)?.name ?? ""; showToast(saved ? targetId ? t("workflow.leader.assignmentGroupResult", { group: groupName }) : t("workflow.leader.assignmentUnassigned") : t("workflow.errors.permission"), saved ? "success" : "error"); }}>{group ? t("workflow.leader.changeGroup") : t("workflow.leader.assignToGroup")}</button><button type="button" className="text-button" onClick={() => changeWorkerAccess(row)}>{t("workflow.leader.participants.remove")}</button></>}{canManage && isRemoved && <button type="button" className="text-button" onClick={() => changeWorkerAccess(row)}>{t("workflow.leader.participants.return")}</button>}{!isRemoved && <button type="button" className="text-button" onClick={() => openNote(row)}><MessageCircleWarning size={14} />{t("workflow.leader.noteAction")}</button>}</div></td>
      </tr>;
    })}{filteredRows.length === 0 && <tr><td colSpan={10} className="muted-copy">{t("workflow.production.noProductionWorkers")}</td></tr>}</tbody></table></div>
    {noteTarget && <div className="modal-backdrop attendance-entry-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNoteTarget(undefined); }}><section className="dashboard-panel compact-modal workflow-form-panel team-note-modal" role="dialog" aria-modal="true" aria-labelledby="team-note-title"><div className="panel-heading"><div><span className="eyebrow">{noteTarget.participant.worker.name}</span><h2 id="team-note-title">{t("workflow.leader.noteAction")}</h2><p className="muted-copy">{t("workflow.leader.noteHint")}</p></div><button className="icon-button" type="button" aria-label={t("common.cancel")} onClick={() => setNoteTarget(undefined)}>×</button></div><form className="workflow-form" onSubmit={submitNote}><label className="field-label"><span>{t("workflow.leader.noteCategory")}</span><select value={noteCategory} onChange={(event) => setNoteCategory(event.target.value as typeof noteCategory)}><option value="service-note">{t("workflow.leader.serviceNote")}</option><option value="complaint">{t("workflow.leader.complaint")}</option></select></label><label className="field-label"><span>{t("workflow.leader.noteSubject")}</span><input value={noteSubject} onChange={(event) => setNoteSubject(event.target.value)} maxLength={120} required /></label><label className="field-label field-label--wide"><span>{t("workflow.leader.noteText")}</span><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} rows={4} required /></label><div className="form-actions field-label--wide"><button className="button button--primary" type="submit">{t("workflow.messagesCenter.send")}</button><button className="button button--quiet" type="button" onClick={() => setNoteTarget(undefined)}>{t("common.cancel")}</button></div></form></section></div>}
  </section>;
}
