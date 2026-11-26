import type { DemoFactory, DemoLeaderPermissions, DemoMember, DemoProductionAssignment, DemoProductionWorkflowSettings, DemoWorkspace } from "./demo-types";

export interface LeaderRosterEntry {
  key: string;
  leaderMembershipId: string;
  worker: DemoMember;
  organizationId: string;
  organizationName: string;
  factory: DemoFactory;
  assignment: DemoProductionAssignment;
  employmentId: string;
  groupName?: string;
  currentShift?: DemoWorkspace["shifts"][number];
  attention: boolean;
}

export interface LeaderRosterFilters {
  organizationId?: string;
  groupId?: string;
  workerState?: "all" | "active" | "away";
  shiftState?: "all" | "with-shift" | "without-shift" | "pending" | "disputed";
  attentionOnly?: boolean;
  search?: string;
}

export function effectiveLeaderPermissions(member: DemoMember): DemoLeaderPermissions {
  return member.permissions ?? {
    canViewWorkers: true,
    canRecordHours: true,
    canReviewShifts: true,
    canConfirmShifts: true,
    canSubmitTimesheet: true,
    canManageGroups: member.canManageGroups ?? true,
  };
}

export function effectiveWorkflowSettings(factory: DemoFactory): DemoProductionWorkflowSettings {
  if (factory.workflowSettings) return { ...factory.workflowSettings, workerCanRecordHours: true, leaderCanRecordHours: true, workerMustConfirmShifts: true, workerCanDisputeShifts: true };
  return {
    workerCanRecordHours: true,
    leaderCanRecordHours: true,
    leaderMustReviewShifts: false,
    agencyMustReviewShifts: false,
    workerMustConfirmShifts: true,
    workerCanDisputeShifts: true,
    leaderCanSubmitTimesheet: true,
    agencyCanSubmitTimesheet: false,
    agencyMustAcceptTimesheet: true,
  };
}

export function activeLeaderMemberships(workspace: DemoWorkspace, actor: DemoMember): DemoMember[] {
  if (actor.role !== "leader") return [];
  const identity = actor.accountUid ?? actor.id;
  return workspace.members.filter((member) => member.role === "leader"
    && (member.accountUid ?? member.id) === identity
    && member.accessState !== "suspended" && member.accessState !== "revoked");
}

export function isLeaderWorkerRemoved(workspace: DemoWorkspace, leaderMembershipId: string, organizationId: string, factoryId: string, workerId: string): boolean {
  return workspace.leaderWorkerAccess?.some((entry) => entry.leaderMembershipId === leaderMembershipId
    && entry.organizationId === organizationId && entry.factoryId === factoryId
    && entry.workerId === workerId && entry.state === "removed") ?? false;
}

export function getLeaderRoster(workspace: DemoWorkspace, actor: DemoMember, today: string): LeaderRosterEntry[] {
  const rows: LeaderRosterEntry[] = [];
  const seen = new Set<string>();
  for (const membership of activeLeaderMemberships(workspace, actor)) {
    if (!effectiveLeaderPermissions(membership).canViewWorkers) continue;
    const factory = workspace.factories.find((candidate) => candidate.id === membership.factoryId && candidate.organizationId === membership.organizationId);
    const organization = workspace.organizations.find((candidate) => candidate.id === membership.organizationId);
    if (!factory || factory.archivedAt || !organization) continue;
    for (const worker of workspace.members.filter((candidate) => candidate.role === "worker" && candidate.organizationId === membership.organizationId)) {
      const employmentHistory = workspace.employmentPeriods.filter((candidate) => candidate.organizationId === membership.organizationId && candidate.workerId === worker.id);
      const period = employmentHistory.find((candidate) => candidate.state === "active" && candidate.startDate <= today && (!candidate.endDate || candidate.endDate >= today));
      const placement = period?.placements.find((candidate) => candidate.factoryId === factory.id && candidate.startDate <= today && (!candidate.endDate || candidate.endDate >= today));
      const legacyAssignment = employmentHistory.length === 0
        ? worker.productionAssignments?.find((candidate) => candidate.factoryId === factory.id)
          ?? (worker.factoryId === factory.id ? { factoryId: factory.id, groupId: worker.groupId, leaderId: worker.leaderId } : undefined)
        : undefined;
      const assignment = placement ? { factoryId: factory.id, groupId: placement.groupId, leaderId: placement.leaderId, requiresTeamAssignment: placement.requiresTeamAssignment } : legacyAssignment;
      if (!assignment || !period && worker.status !== "active") continue;
      if (isLeaderWorkerRemoved(workspace, membership.id, membership.organizationId, factory.id, worker.id)) continue;
      const key = `${membership.organizationId}:${factory.id}:${worker.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const workerShifts = workspace.shifts
        .filter((record) => record.organizationId === membership.organizationId && record.shift.factoryId === factory.id && record.shift.workerUid === worker.id && !record.shift.deletedAt)
        .sort((left, right) => right.shift.localStartDate.localeCompare(left.shift.localStartDate) || right.shift.startAt.localeCompare(left.shift.startAt));
      const currentShift = workerShifts.find((record) => record.shift.localStartDate === today)
        ?? workerShifts.find((record) => record.shift.workerConfirmation === "pending" || record.shift.workerConfirmation === "disputed" || record.shift.reviewState === "pending")
        ?? workerShifts[0];
      const groupName = assignment.groupId ? workspace.groups.find((group) => group.id === assignment.groupId && group.organizationId === membership.organizationId && group.factoryId === factory.id)?.name : undefined;
      const attention = worker.status !== "active" || workerShifts.some((record) => record.shift.workerConfirmation === "pending" || record.shift.workerConfirmation === "disputed" || record.shift.reviewState === "pending");
      rows.push({
        key,
        leaderMembershipId: membership.id,
        worker,
        organizationId: membership.organizationId,
        organizationName: organization.name,
        factory,
        assignment,
        employmentId: period?.id ?? "",
        groupName,
        currentShift,
        attention,
      });
    }
  }
  return rows.sort((left, right) => left.organizationName.localeCompare(right.organizationName) || left.factory.name.localeCompare(right.factory.name) || left.worker.name.localeCompare(right.worker.name));
}

export function filterLeaderRoster(entries: LeaderRosterEntry[], filters: LeaderRosterFilters): LeaderRosterEntry[] {
  const search = (filters.search ?? "").trim().toLocaleLowerCase();
  return entries.filter((entry) =>
    (!filters.organizationId || entry.organizationId === filters.organizationId)
    && (!filters.groupId || filters.groupId === "all" || filters.groupId === "none" && !entry.assignment.groupId || entry.assignment.groupId === filters.groupId)
    && (!filters.workerState || filters.workerState === "all" || entry.worker.status === filters.workerState)
    && (!filters.attentionOnly || entry.attention)
    && (!filters.shiftState || filters.shiftState === "all" || filters.shiftState === "with-shift" && Boolean(entry.currentShift) || filters.shiftState === "without-shift" && !entry.currentShift || filters.shiftState === "pending" && entry.currentShift?.shift.workerConfirmation === "pending" || filters.shiftState === "disputed" && entry.currentShift?.shift.workerConfirmation === "disputed")
    && entry.worker.name.toLocaleLowerCase().includes(search));
}

export function canLeaderAccessAssignment(workspace: DemoWorkspace, actor: DemoMember, organizationId: string, factoryId: string, worker: DemoMember, assignment: DemoProductionAssignment, permission: keyof DemoLeaderPermissions): boolean {
  const membership = activeLeaderMemberships(workspace, actor).find((candidate) => candidate.organizationId === organizationId && candidate.factoryId === factoryId);
  const factory = workspace.factories.find((candidate) => candidate.id === factoryId && candidate.organizationId === organizationId);
  return Boolean(membership && factory && !factory.archivedAt && effectiveLeaderPermissions(membership)[permission] && worker.organizationId === organizationId && worker.role === "worker"
    && assignment.factoryId === factoryId
    && !isLeaderWorkerRemoved(workspace, membership.id, organizationId, factoryId, worker.id));
}
