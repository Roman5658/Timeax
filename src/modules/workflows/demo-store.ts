import { zonedDateTime, nextLocalDate } from "./domain/zoned-time.ts";
import { calculatePayroll, type PayrollSettings, type PayrollInput, type DemoPayslip } from "../payroll/domain/payroll.ts";
import { useSyncExternalStore } from "react";
import type { ActualBreakReport, Shift } from "../shifts/domain/types";
import { createSeedWorkspace } from "./demo-data.ts";
import type { DemoAbsence, DemoAbsenceDecision, DemoAbsenceHistoryEntry, DemoAbsenceReason, DemoAgencyWorksite, DemoBusinessEntity, DemoBusinessWorksiteRosterEntry, DemoCentralSearchResult, DemoChangeRequest, DemoDepartment, DemoEmploymentPeriod, DemoFactory, DemoFactoryInvitation, DemoFolder, DemoGroup, DemoLeaderConnectionRequest, DemoLeaderInvitation, DemoLeaderWorksiteMembership, DemoLeaderWorkerAccess, DemoMember, DemoMessageThread, DemoMonthlyTimesheet, DemoMonthlyTimesheetEvent, DemoMonthlyTimesheetVersion, DemoNotification, DemoProductionAssignment, DemoRole, DemoSchedule, DemoScheduleAttendanceReview, DemoScheduleOutcome, DemoShiftHistoryEntry, DemoShiftRecord, DemoShiftValues, DemoSubscription, DemoSubscriptionPayerType, DemoTemplate, DemoWorkCalendar, DemoWorkspace, DemoWorksite, DemoWorksiteConnectionRequest, DemoWorkerInvitation, ProductionInputMode, WorkerInputAccess } from "./domain/demo-types";
import { buildMonthlyTimesheetSnapshot, factualShiftFingerprint, hasOpenMonthlyIssues, uniqueFactualShiftRecords } from "../monthly-timesheets/domain/timesheet.ts";
import { activeLeaderMemberships, canLeaderAccessAssignment, effectiveLeaderPermissions, effectiveWorkflowSettings, getLeaderRoster, isLeaderWorkerRemoved, type LeaderRosterEntry } from "./domain/access.ts";
import { workerHasProductionOnDate } from "../exports/domain/employment-scope.ts";
import { canAddAgencyWorker, canAddFactoryWorker, countPayerWorkers, getPayerSummary, tierAcceptsCurrentWorkers, workerPayer } from "../subscriptions/domain/subscription.ts";
import type { PortalRole } from "../auth/portal-access";

const STORAGE_KEY = "timeax-demo-workspace-v1";
type AuthenticatedPreviewAccount = { id: string; email?: string; role: PortalRole };
let previewAccount: AuthenticatedPreviewAccount | undefined;
let snapshot: DemoWorkspace | undefined;
let storageWritesBlocked = false;
const listeners = new Set<() => void>();

function workspaceStorageKey() {
  return previewAccount ? `timeax-preview-v1:${previewAccount.id}:${previewAccount.role}` : STORAGE_KEY;
}

export function setAuthenticatedPreviewAccount(account: AuthenticatedPreviewAccount | undefined) {
  if (previewAccount?.id === account?.id && previewAccount?.role === account?.role && previewAccount?.email === account?.email) return;
  previewAccount = account;
  snapshot = undefined;
  storageWritesBlocked = false;
  listeners.forEach((listener) => listener());
}

function createWorkspace(): DemoWorkspace {
  const seed = createSeedWorkspace();
  if (!previewAccount) return seed;
  const { id, email, role } = previewAccount;
  const organization = { ...seed.organization, id: `preview-${id}`, name: "Timeax", contactEmail: undefined };
  const member: DemoMember = { id, name: email ?? "Timeax", email, role: role === "admin" ? "agency" : role, organizationId: organization.id, status: "active" };
  return { ...seed, organization, organizations: [organization], members: [member], activeMemberId: id };
}

type LegacyStoredMember = Omit<DemoMember, "role"> & { role: DemoRole | "factory" };
type LegacyStoredChangeRequest = Omit<DemoChangeRequest, "approverType"> & { approverType: "agency" | "leader" | "factory" };
type LegacyStoredMessageThread = Omit<DemoMessageThread, "recipientType"> & { recipientType: "agency" | "leader" | "production" | "worker" | "factory" };
type StoredWorkspace = Omit<DemoWorkspace, "schemaVersion" | "organizations" | "employmentPeriods" | "messageThreads" | "schedules" | "scheduleAttendanceReviews" | "members" | "changeRequests"> & {
  schemaVersion?: number;
  organizations?: DemoWorkspace["organizations"];
  employmentPeriods?: DemoWorkspace["employmentPeriods"];
  messageThreads?: LegacyStoredMessageThread[];
  schedules?: DemoWorkspace["schedules"];
  scheduleAttendanceReviews?: DemoWorkspace["scheduleAttendanceReviews"];
  members: LegacyStoredMember[];
  changeRequests?: LegacyStoredChangeRequest[];
};

function mergeById<T extends { id: string }>(primary: T[] | undefined, additions: T[] | undefined): T[] {
  const merged: T[] = [];
  const ids = new Set<string>();
  for (const item of [...(primary ?? []), ...(additions ?? [])]) if (!ids.has(item.id)) { merged.push(item); ids.add(item.id); }
  return merged;
}

function normalizeHumanIdentifier(value: string): string {
  return value.normalize("NFKC").trim().toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

function migrationHumanIdentifier(prefix: "C" | "S", sourceId: string, used: Set<string>): string {
  const suffix = sourceId.normalize("NFKC").replace(/[^a-zA-Z0-9]/g, "").toLocaleUpperCase("en-US").slice(-8) || "00000000";
  const base = `TA-${prefix}-${suffix}`;
  let candidate = base;
  let revision = 2;
  while (used.has(normalizeHumanIdentifier(candidate))) candidate = `${base}-${revision++}`;
  return candidate;
}

function cityFromAddress(address?: string): string | undefined {
  const city = address?.split(",", 1)[0]?.trim();
  return city || undefined;
}

function newPublicIdentifier(prefix: "C" | "S", workspace: DemoWorkspace): string {
  const used = new Set([
    ...(workspace.businessEntities ?? []).map((entity) => normalizeHumanIdentifier(entity.identifier ?? "")),
    ...(workspace.worksites ?? []).map((site) => normalizeHumanIdentifier(site.identifier ?? "")),
  ]);
  for (;;) {
    const candidate = `TA-${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLocaleUpperCase("en-US")}`;
    if (!used.has(normalizeHumanIdentifier(candidate))) return candidate;
  }
}

function protectOriginalDemo(raw: string | null): boolean {
  if (!raw || typeof window === "undefined") return true;
  const key = `${workspaceStorageKey()}-backup-before-payroll-v1`;
  try {
    if (window.localStorage.getItem(key) === null) {
      window.localStorage.setItem(key, raw);
      if (window.localStorage.getItem(key) !== raw) return false;
    }
    return true;
  } catch { return false; }
}

function readWorkspace(): DemoWorkspace {
  if (snapshot) return snapshot;
  if (typeof window !== "undefined") {
    try {
      const key = workspaceStorageKey();
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredWorkspace;
        if ([1, 2, 3, 4, 5, 6, 7, 8].includes(parsed.schemaVersion ?? 0) && parsed.organization?.id && Array.isArray(parsed.members)
          && Array.isArray(parsed.factories) && Array.isArray(parsed.groups) && Array.isArray(parsed.shifts)
          && Array.isArray(parsed.templates) && Array.isArray(parsed.absences) && Array.isArray(parsed.notifications)) {
          const seed = createWorkspace();
          storageWritesBlocked = !protectOriginalDemo(raw);
          const seededOrganizations = new Map(seed.organizations.map((organization) => [organization.id, organization]));
          const organizations = mergeById([parsed.organization, ...(parsed.organizations ?? [])], seed.organizations).map((organization) => {
            const seeded = seededOrganizations.get(organization.id);
            return { ...organization, ...(seeded ? { name: seeded.name } : {}), type: organization.type ?? "agency" as const };
          });
          const seededAgencyAccounts = new Map(seed.members.filter((member) => member.role === "agency").map((member) => [member.id, member]));
          const legacyMembers = mergeById(parsed.members, seed.members as LegacyStoredMember[]);
          const members: DemoMember[] = legacyMembers.map((member) => {
            const organization = organizations.find((item) => item.id === member.organizationId);
            const wasFactoryRole = member.role === "factory";
            const role: DemoRole = wasFactoryRole ? (organization?.billingScenario === "self-operated" ? "agency" : "leader") : member.role as DemoRole;
            return {
              ...member,
              role,
              accountUid: role === "worker" ? member.accountUid ?? member.id : role === "agency" ? member.accountUid ?? seededAgencyAccounts.get(member.id)?.accountUid : member.accountUid,
              canManageGroups: member.canManageGroups ?? role === "leader",
              canManageAllWorkers: member.canManageAllWorkers ?? (wasFactoryRole && organization?.billingScenario !== "self-operated"),
              productionAssignments: member.productionAssignments?.length ? member.productionAssignments : (role === "worker" && member.factoryId ? [{ factoryId: member.factoryId, groupId: member.groupId, leaderId: member.leaderId }] : []),
            };
          });
          const groups = mergeById(parsed.groups ?? [], seed.groups).map((group) => ({
            ...group,
            leaderId: group.leaderId ?? members.find((member) => member.role === "worker" && member.organizationId === group.organizationId && getWorkerProductionAssignments({ ...seed, organization: organizations.find((item) => item.id === group.organizationId) ?? seed.organization, organizations, members }, member.id).some((assignment) => assignment.factoryId === group.factoryId && assignment.groupId === group.id))?.leaderId,
          }));
          const activeMemberId = parsed.activeMemberId && members.some((member) => member.id === parsed.activeMemberId) ? parsed.activeMemberId : members[0]?.id ?? seed.activeMemberId;
          const activeOrganization = organizations.find((item) => item.id === members.find((member) => member.id === activeMemberId)?.organizationId) ?? parsed.organization;
          const seededPeriods = seed.employmentPeriods;
          const employmentPeriods = mergeById(parsed.employmentPeriods, seededPeriods);
          const employmentWorkerIds = new Set(employmentPeriods.filter((period) => period.state === "active").map((period) => `${period.organizationId}:${period.workerId}`));
          for (const worker of members.filter((member) => member.role === "worker" && !employmentWorkerIds.has(`${member.organizationId}:${member.id}`))) {
            const workerAssignments = worker.productionAssignments?.length ? worker.productionAssignments : worker.factoryId ? [{ factoryId: worker.factoryId, groupId: worker.groupId, leaderId: worker.leaderId }] : [];
            if (workerAssignments.length === 0) continue;
            const actorId = members.find((member) => member.organizationId === worker.organizationId && member.role === "agency")?.id ?? members.find((member) => member.organizationId === worker.organizationId && member.role === "leader" && member.canManageAllWorkers)?.id ?? worker.id;
            const now = new Date().toISOString();
            const startDate = todayDate();
            const placements: DemoEmploymentPeriod["placements"] = workerAssignments.map((assignment) => ({ id: `placement-migrated-${worker.id}-${assignment.factoryId}`, factoryId: assignment.factoryId, groupId: assignment.groupId, leaderId: assignment.leaderId, startDate, createdAt: now, createdById: actorId }));
            employmentPeriods.push({ id: `employment-migrated-${worker.id}`, organizationId: worker.organizationId, workerId: worker.id, accountUid: worker.accountUid ?? worker.id, workerCategory: worker.workerCategory ?? (organizations.find((item) => item.id === worker.organizationId)?.type === "factory" ? "factory" : "agency"), state: "active", startDate, createdAt: now, createdById: actorId, placements, history: [{ id: `employment-event-migrated-${worker.id}`, actorId, action: "hired", occurredAt: now }] });
            employmentWorkerIds.add(`${worker.organizationId}:${worker.id}`);
          }
          const normalizedPeriods = employmentPeriods.map((period) => {
            const worker = members.find((member) => member.organizationId === period.organizationId && member.id === period.workerId && member.role === "worker");
            const workerCategory = period.workerCategory ?? worker?.workerCategory ?? (organizations.find((item) => item.id === period.organizationId)?.type === "factory" ? "factory" as const : "agency" as const);
            if (period.state !== "active" || !worker) return { ...period, workerCategory };
            const assignments = [...(worker.productionAssignments ?? [])];
            const currentPlacements = period.placements.filter((placement) => !placement.endDate);
            for (const placement of currentPlacements) if (!assignments.some((assignment) => assignment.factoryId === placement.factoryId)) assignments.push({ factoryId: placement.factoryId, groupId: placement.groupId, leaderId: placement.leaderId });
            const now = new Date().toISOString();
            const actorId = members.find((member) => member.organizationId === period.organizationId && member.role === "agency")?.id ?? period.createdById;
            const missingPlacements: DemoEmploymentPeriod["placements"] = assignments.filter((assignment) => !currentPlacements.some((placement) => placement.factoryId === assignment.factoryId)).map((assignment) => ({ id: `placement-repaired-${period.id}-${assignment.factoryId}`, factoryId: assignment.factoryId, groupId: assignment.groupId, leaderId: assignment.leaderId, startDate: period.startDate, createdAt: now, createdById: actorId }));
            return { ...period, workerCategory, ...(missingPlacements.length ? { placements: [...period.placements, ...missingPlacements] } : {}) };
          });
          const normalizedMembers = members.map((member) => {
            if (member.role !== "worker") return member;
            const workerCategory = member.workerCategory ?? (organizations.find((item) => item.id === member.organizationId)?.type === "factory" ? "factory" as const : "agency" as const);
            const workerPayerOrganizationId = workerCategory === "agency" ? member.organizationId : undefined;
            const period = normalizedPeriods.find((item) => item.organizationId === member.organizationId && item.workerId === member.id && item.state === "active");
            if (!period) return { ...member, workerCategory, workerPayerOrganizationId, productionAssignments: [], factoryId: undefined, groupId: undefined, leaderId: undefined };
            const assignments = [...(member.productionAssignments ?? [])];
            for (const placement of period.placements.filter((item) => !item.endDate)) if (!assignments.some((assignment) => assignment.factoryId === placement.factoryId)) assignments.push({ factoryId: placement.factoryId, groupId: placement.groupId, leaderId: placement.leaderId });
            const preferred = assignments.find((assignment) => assignment.factoryId === member.factoryId) ?? assignments[0];
            return { ...member, workerCategory, workerPayerOrganizationId, productionAssignments: assignments, factoryId: preferred?.factoryId, groupId: preferred?.groupId, leaderId: preferred?.leaderId };
          });
          const mergedFactories = mergeById((parsed.factories ?? []).map((factory) => ({ requiredBreakTreatment: "unpaid" as const, allowActualBreakReport: true, allowTimeDataSubmission: true, ...factory })), seed.factories);
          const worksites = mergeById(parsed.worksites ?? [], seed.worksites ?? []);
          const normalizedFactories = mergedFactories.map((factory) => {
            const worksiteId = factory.worksiteId || `worksite-legacy-${factory.id}`;
            if (!worksites.some((worksite) => worksite.id === worksiteId)) worksites.push({ id: worksiteId, name: factory.name, address: factory.address, description: factory.description });
            return { ...factory, worksiteId };
          });
          const usedIdentifiers = new Set<string>();
          const migratedWorksites = worksites.map((site) => {
            let identifier = site.identifier?.trim() || migrationHumanIdentifier("S", site.id, usedIdentifiers);
            while (usedIdentifiers.has(normalizeHumanIdentifier(identifier))) identifier = migrationHumanIdentifier("S", `${site.id}-${usedIdentifiers.size}`, usedIdentifiers);
            usedIdentifiers.add(normalizeHumanIdentifier(identifier));
            return { ...site, identifier };
          });
          const businessEntities = mergeById(parsed.businessEntities, seed.businessEntities).map((entity) => {
            const firstSite = migratedWorksites.find((site) => site.businessEntityId === entity.id);
            let identifier = entity.identifier?.trim() || migrationHumanIdentifier("C", entity.id, usedIdentifiers);
            while (usedIdentifiers.has(normalizeHumanIdentifier(identifier))) identifier = migrationHumanIdentifier("C", `${entity.id}-${usedIdentifiers.size}`, usedIdentifiers);
            usedIdentifiers.add(normalizeHumanIdentifier(identifier));
            return { ...entity, city: entity.city?.trim() || cityFromAddress(firstSite?.address), identifier };
          });
          const migrated: DemoWorkspace = {
            ...parsed,
            schemaVersion: 8,
            organization: activeOrganization,
            organizations,
            worksites: migratedWorksites,
            businessEntities,
            agencyWorksites: mergeById(parsed.agencyWorksites, seed.agencyWorksites),
            worksiteConnectionRequests: mergeById(parsed.worksiteConnectionRequests, seed.worksiteConnectionRequests),
            factoryInvitations: mergeById(parsed.factoryInvitations, seed.factoryInvitations),
            departments: mergeById(parsed.departments, seed.departments),
            leaderWorksiteMemberships: mergeById(parsed.leaderWorksiteMemberships, seed.leaderWorksiteMemberships),
            leaderInvitations: mergeById(parsed.leaderInvitations, seed.leaderInvitations),
            leaderConnectionRequests: mergeById(parsed.leaderConnectionRequests, seed.leaderConnectionRequests),
            subscriptions: mergeById(parsed.subscriptions, seed.subscriptions),
            subscriptionTiers: mergeById(parsed.subscriptionTiers, seed.subscriptionTiers),
            folders: parsed.folders ?? [],
            changeRequests: (parsed.changeRequests ?? []).map((request) => ({ ...request, approverType: request.approverType === "factory" ? "leader" as const : request.approverType })),
            factories: normalizedFactories,
            groups,
            leaderWorkerAccess: parsed.leaderWorkerAccess ?? [],
            members: normalizedMembers,
            shifts: [...parsed.shifts, ...seed.shifts.filter((record) => !parsed.shifts.some((existing) => existing.shift.id === record.shift.id))],
            templates: mergeById(parsed.templates.map((template) => ({ ...template, breakType: template.breakType ?? (template.breakStart || template.breakEnd ? "unpaid" as const : "none" as const), breakDurationMinutes: template.breakDurationMinutes ?? 0 })), seed.templates),
            absences: mergeById(parsed.absences, seed.absences),
            employmentPeriods: normalizedPeriods,
            messageThreads: mergeById((parsed.messageThreads ?? []).map((thread) => ({ ...thread, recipientType: thread.recipientType === "factory" ? "production" as const : thread.recipientType })), seed.messageThreads),
            schedules: mergeById(parsed.schedules, seed.schedules),
            scheduleAttendanceReviews: parsed.scheduleAttendanceReviews ?? [],
            monthlyTimesheets: parsed.monthlyTimesheets ?? [],
            notifications: mergeById(parsed.notifications, seed.notifications),
          };
          snapshot = migrated;
          if (parsed.schemaVersion !== 8 && !storageWritesBlocked) {
            try {
              window.localStorage.setItem(key, JSON.stringify(migrated));
              storageWritesBlocked = false;
            } catch {
              storageWritesBlocked = true;
            }
          }
          return migrated;
        } else storageWritesBlocked = true;
      }
    } catch {
      storageWritesBlocked = true;
    }
  }
  snapshot = createWorkspace();
  return snapshot;
}

function publish(next: DemoWorkspace, forcePersist = false) {
  snapshot = next;
  if (typeof window !== "undefined" && (!storageWritesBlocked || forcePersist)) {
    try {
      const key = workspaceStorageKey();
      if (!protectOriginalDemo(window.localStorage.getItem(key))) { storageWritesBlocked = true; return; }
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch { storageWritesBlocked = true; }
  }
  listeners.forEach((listener) => listener());
}

export function applyCrossTabWorkspaceUpdate(event: Pick<StorageEvent, "key" | "newValue">): boolean {
  if (event.key !== workspaceStorageKey() || !event.newValue) return false;
  try {
    const incoming = JSON.parse(event.newValue) as DemoWorkspace;
    if (incoming.schemaVersion !== 8 || !incoming.organization?.id || !Array.isArray(incoming.members)
      || !Array.isArray(incoming.factories) || !Array.isArray(incoming.groups) || !Array.isArray(incoming.shifts)
      || !Array.isArray(incoming.templates) || !Array.isArray(incoming.absences) || !Array.isArray(incoming.notifications)) {
      storageWritesBlocked = true;
      return false;
    }
    storageWritesBlocked = false;
    snapshot = incoming;
    listeners.forEach((listener) => listener());
    return true;
  } catch {
    // Keep the last valid in-memory workspace if another tab writes invalid data.
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => applyCrossTabWorkspaceUpdate(event);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDemoWorkspace(): DemoWorkspace {
  return useSyncExternalStore(subscribe, readWorkspace, readWorkspace);
}

export function isDemoStorageProtected() {
  readWorkspace();
  return storageWritesBlocked;
}

export function getActiveMember(workspace = readWorkspace()) {
  return workspace.members.find((member) => member.id === workspace.activeMemberId) ?? workspace.members[0];
}

export function getActiveBusinessEntity(workspace = readWorkspace()): DemoBusinessEntity | undefined {
  const active = getActiveMember(workspace);
  if (active.role === "factory-admin" && active.businessEntityId) {
    return workspace.businessEntities?.find((entity) => entity.id === active.businessEntityId);
  }
  if (active.role === "leader" && active.factoryId) {
    const factory = workspace.factories.find((item) => item.id === active.factoryId && item.organizationId === active.organizationId);
    const worksite = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
    return worksite?.businessEntityId ? workspace.businessEntities?.find((entity) => entity.id === worksite.businessEntityId) : undefined;
  }
  return undefined;
}

export function getPayerSubscriptionSummary(payerType: DemoSubscriptionPayerType, payerId: string, workspace = readWorkspace()) {
  return getPayerSummary(workspace, payerType, payerId);
}

export function getFactorySubscriptionSummary(workspace = readWorkspace()) {
  const entity = getActiveBusinessEntity(workspace);
  return entity ? getPayerSummary(workspace, "factory", entity.id) : undefined;
}

export function getBusinessAgencyWorkerCount(workspace = readWorkspace()): number {
  const entity = getActiveBusinessEntity(workspace);
  const actor = getActiveMember(workspace);
  if (!entity || actor.role !== "factory-admin" || actor.businessEntityId !== entity.id) return 0;
  const workerIds = new Set<string>();
  for (const site of workspace.worksites ?? []) {
    if (site.businessEntityId !== entity.id) continue;
    for (const row of getBusinessWorksiteRoster(site.id, { workerCategory: "agency" })) workerIds.add(row.worker.id);
  }
  return workerIds.size;
}

export function setDemoSubscription(payerType: DemoSubscriptionPayerType, tierId: string, active: boolean): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const payerId = payerType === "factory" ? entity?.id : actor.organizationId;
  const authorized = payerType === "factory"
    ? actor.role === "factory-admin" && Boolean(entity && actor.businessEntityId === entity.id)
    : actor.role === "agency" && actor.organizationId === payerId;
  if (!authorized || !payerId) return false;
  const currentWorkerCount = countPayerWorkers(workspace, payerType, payerId);
  const tier = (workspace.subscriptionTiers ?? []).find((item) => item.id === tierId);
  if (active && (!tier || !tierAcceptsCurrentWorkers(tier, currentWorkerCount))) return false;
  const existing = (workspace.subscriptions ?? []).find((item) => item.payerType === payerType && item.payerId === payerId);
  if (!active && !existing) return false;
  const now = new Date().toISOString();
  const updated: DemoSubscription | undefined = active
    ? { id: existing?.id ?? `subscription-${payerType}-${payerId}`, payerType, payerId, status: "test-active", tierId, activatedAt: now, updatedAt: now, demo: true }
    : existing ? { ...existing, status: "inactive", updatedAt: now, demo: true } : undefined;
  if (!updated) return false;
  mutate((state) => ({ ...state, subscriptions: [...(state.subscriptions ?? []).filter((item) => item.id !== updated.id), updated] }));
  return true;
}

export function activateFactoryDemoSubscription(tierId: string): boolean {
  return setDemoSubscription("factory", tierId, true);
}

export function deactivateFactoryDemoSubscription(): boolean {
  const entity = getActiveBusinessEntity();
  return entity ? setDemoSubscription("factory", getPayerSummary(readWorkspace(), "factory", entity.id).tier?.id ?? "", false) : false;
}

export function normalizeBusinessNip(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? digits : undefined;
}

function normalizeWorksiteAddress(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("pl-PL").replace(/\s+/g, " ");
}

function centralSearchResult(workspace: DemoWorkspace, entity: DemoBusinessEntity, matchedWorksiteId?: string): DemoCentralSearchResult {
  const worksites = (workspace.worksites ?? []).filter((site) => site.businessEntityId === entity.id
    && (!matchedWorksiteId || site.id === matchedWorksiteId)).map((site) => ({ id: site.id, name: site.name, address: site.address, identifier: site.identifier }));
  return {
    businessEntityId: entity.id,
    name: entity.name,
    nip: entity.nip,
    city: entity.city,
    identifier: entity.identifier,
    registrationStatus: "registered",
    matchedWorksiteId,
    worksites,
  };
}

/** Prefix search for registered territorial central cabinets. NIP is not a unique cabinet key. */
export function searchRegisteredCentralsByNip(value: string): DemoCentralSearchResult[] {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 3) return [];
  const workspace = readWorkspace();
  return (workspace.businessEntities ?? []).filter((entity) => (entity.nip ?? "").replace(/\D/g, "").startsWith(digits))
    .map((entity) => centralSearchResult(workspace, entity))
    .filter((result) => result.worksites.length > 0)
    .sort((left, right) => (left.city ?? "").localeCompare(right.city ?? "") || left.name.localeCompare(right.name));
}

/** Exact code search only returns public central/worksite details; the code does not grant access. */
export function searchRegisteredCentralsByIdentifier(value: string): DemoCentralSearchResult[] {
  const code = normalizeHumanIdentifier(value);
  if (code.length < 5) return [];
  const workspace = readWorkspace();
  const results: DemoCentralSearchResult[] = [];
  for (const entity of workspace.businessEntities ?? []) {
    if (normalizeHumanIdentifier(entity.identifier ?? "") === code) {
      results.push(centralSearchResult(workspace, entity));
      continue;
    }
    const site = (workspace.worksites ?? []).find((candidate) => candidate.businessEntityId === entity.id && normalizeHumanIdentifier(candidate.identifier ?? "") === code);
    if (site) results.push(centralSearchResult(workspace, entity, site.id));
  }
  return results;
}

export function requestAgencyWorksiteConnection(input: { businessEntityId: string; worksiteId?: string; worksiteName?: string; address?: string; productionName?: string }): AgencyWorksiteRequestResult {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  if (actor.role !== "agency") return { kind: "invalid", reason: "agency-only" };
  const businessEntity = (workspace.businessEntities ?? []).find((entity) => entity.id === input.businessEntityId);
  const worksite = (workspace.worksites ?? []).find((site) => site.id === input.worksiteId && site.businessEntityId === businessEntity?.id);
  const requestedWorksiteName = worksite?.name ?? input.worksiteName?.trim() ?? "";
  const requestedAddress = worksite?.address ?? input.address?.trim() ?? "";
  if (!businessEntity || input.worksiteId && !worksite || !requestedWorksiteName || !requestedAddress) return { kind: "invalid", reason: "not-found" };
  if (worksite && (workspace.agencyWorksites ?? []).some((item) => item.organizationId === actor.organizationId && item.businessEntityId === businessEntity.id && item.worksiteId === worksite.id && item.state === "active")) {
    return { kind: "connected", businessEntity, worksite };
  }
  const existingInvitation = worksite && (workspace.worksiteConnectionRequests ?? []).find((request) => request.organizationId === actor.organizationId && request.businessEntityId === businessEntity.id && request.worksiteId === worksite.id && request.state === "pending" && request.direction === "factory-invitation");
  if (existingInvitation && worksite) return { kind: "invited", businessEntity, worksite, request: existingInvitation };
  const addressKey = normalizeWorksiteAddress(requestedAddress);
  const pending = (workspace.worksiteConnectionRequests ?? []).find((request) => request.organizationId === actor.organizationId && request.businessEntityId === businessEntity.id && request.state === "pending"
    && (request.direction ?? "agency-request") === "agency-request"
    && (worksite ? request.worksiteId === worksite.id : !request.worksiteId && normalizeWorksiteAddress(request.requestedAddress) === addressKey));
  if (pending) return { kind: "request", businessEntity, request: pending };
  const admin = workspace.members.find((member) => member.id === businessEntity.adminMemberId && member.role === "factory-admin");
  if (!admin) return { kind: "invalid", reason: "not-found" };
  const request: DemoWorksiteConnectionRequest = {
    id: `worksite-request-${crypto.randomUUID()}`,
    organizationId: actor.organizationId,
    businessEntityId: businessEntity.id,
    worksiteId: worksite?.id,
    requestedWorksiteName,
    requestedAddress,
    requestedIdentifier: worksite?.identifier,
    productionName: input.productionName?.trim() || requestedWorksiteName,
    source: "search",
    direction: "agency-request",
    state: "pending",
    createdById: actor.id,
    createdAt: new Date().toISOString(),
  };
  mutate((state) => ({
    ...state,
    worksiteConnectionRequests: [...(state.worksiteConnectionRequests ?? []), request],
    notifications: admin ? [connectionNotification(admin.organizationId, admin.id, "agency-connection-requested", request.id), ...state.notifications] : state.notifications,
  }));
  return { kind: "request", businessEntity, request };
}

export type AgencyConnectionInvitationResult =
  | { kind: "created"; request: DemoWorksiteConnectionRequest }
  | { kind: "pending"; request: DemoWorksiteConnectionRequest }
  | { kind: "connected" }
  | { kind: "requested" }
  | { kind: "invalid" };

/** Create a pending invitation to an already registered agency for this exact central/site. */
export function createAgencyConnectionInvitation(agencyOrganizationId: string, worksiteId: string): AgencyConnectionInvitationResult {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const businessEntity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === worksiteId && item.businessEntityId === businessEntity?.id);
  const agency = workspace.organizations.find((item) => item.id === agencyOrganizationId && item.type === "agency");
  const agencyAdmin = workspace.members.find((item) => item.organizationId === agencyOrganizationId && item.role === "agency");
  if (actor.role !== "factory-admin" || !businessEntity || actor.businessEntityId !== businessEntity.id || !site || !agency || !agencyAdmin) return { kind: "invalid" };
  if ((workspace.agencyWorksites ?? []).some((item) => item.organizationId === agencyOrganizationId && item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.state === "active")) return { kind: "connected" };
  if ((workspace.worksiteConnectionRequests ?? []).some((item) => item.organizationId === agencyOrganizationId && item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.state === "pending" && (item.direction ?? "agency-request") === "agency-request")) return { kind: "requested" };
  const existing = (workspace.worksiteConnectionRequests ?? []).find((item) => item.organizationId === agencyOrganizationId && item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.state === "pending" && item.direction === "factory-invitation");
  if (existing) return { kind: "pending", request: existing };
  const request: DemoWorksiteConnectionRequest = {
    id: `worksite-request-${crypto.randomUUID()}`,
    organizationId: agencyOrganizationId,
    businessEntityId: businessEntity.id,
    worksiteId: site.id,
    requestedWorksiteName: site.name,
    requestedAddress: site.address ?? "",
    requestedIdentifier: site.identifier,
    productionName: `${agency.name} · ${site.name}`,
    source: "invitation",
    direction: "factory-invitation",
    state: "pending",
    createdById: actor.id,
    createdAt: new Date().toISOString(),
  };
  mutate((state) => ({
    ...state,
    worksiteConnectionRequests: [...(state.worksiteConnectionRequests ?? []), request],
    notifications: [connectionNotification(agencyOrganizationId, agencyAdmin.id, "agency-connection-invited", request.id), ...state.notifications],
  }));
  return { kind: "created", request };
}

export function createFactoryInvitation(input: { email: string; companyName: string; nip: string; city: string; worksiteName: string; worksiteAddress: string; productionName: string }): { invitation: DemoFactoryInvitation; url: string } | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const email = input.email.trim().toLocaleLowerCase("en-US");
  const nip = normalizeBusinessNip(input.nip);
  const companyName = input.companyName.trim();
  const city = input.city.trim();
  const worksiteName = input.worksiteName.trim();
  const worksiteAddress = input.worksiteAddress.trim();
  const productionName = input.productionName.trim();
  if (actor.role !== "agency" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !nip || !companyName || !city || !worksiteName || !worksiteAddress || !productionName) return undefined;
  const existingTerritory = (workspace.businessEntities ?? []).some((entity) => normalizeBusinessNip(entity.nip ?? "") === nip
    && normalizeWorksiteAddress(entity.city ?? cityFromAddress((workspace.worksites ?? []).find((site) => site.businessEntityId === entity.id)?.address) ?? "") === normalizeWorksiteAddress(city));
  if (existingTerritory) return undefined;
  const existing = (workspace.factoryInvitations ?? []).find((item) => item.organizationId === actor.organizationId && item.email?.toLocaleLowerCase("en-US") === email
    && item.state === "pending" && normalizeBusinessNip(item.nip ?? "") === nip && normalizeWorksiteAddress(item.city ?? "") === normalizeWorksiteAddress(city));
  if (existing) return { invitation: existing, url: getFactoryInvitationUrl(existing.token) };
  const now = new Date();
  const invitation: DemoFactoryInvitation = {
    id: `factory-invitation-${crypto.randomUUID()}`,
    token: crypto.randomUUID(),
    organizationId: actor.organizationId,
    email,
    nip,
    companyName,
    city,
    worksiteName,
    worksiteAddress,
    productionName,
    createdById: actor.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    state: "pending",
    simulatedEmailSentAt: now.toISOString(),
  };
  mutate((state) => ({ ...state, factoryInvitations: [...(state.factoryInvitations ?? []), invitation] }));
  return { invitation, url: getFactoryInvitationUrl(invitation.token) };
}

function createAgencyFactory(organizationId: string, worksite: DemoWorksite, name: string, address = ""): DemoFactory {
  return {
    id: `factory-${crypto.randomUUID()}`,
    organizationId,
    worksiteId: worksite.id,
    name: name.trim(),
    inputMode: "A",
    workerAccess: {},
    requiredBreakMinutes: 0,
    requiredBreakTreatment: "unpaid",
    allowActualBreakReport: true,
    allowTimeDataSubmission: true,
    address: address.trim() || worksite.address,
    workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] },
  };
}

function connectionNotification(organizationId: string, recipientId: string, kind: DemoWorkspace["notifications"][number]["kind"], subjectId: string): DemoWorkspace["notifications"][number] {
  return { id: `notice-${crypto.randomUUID()}`, organizationId, recipientId, kind, subjectId, createdAt: new Date().toISOString() };
}

export function getFactory(workspace: DemoWorkspace, factoryId?: string) {
  return workspace.factories.find((factory) => factory.id === factoryId && factory.organizationId === workspace.organization.id);
}

function getFactoryInOrganization(workspace: DemoWorkspace, organizationId: string, factoryId: string) {
  return workspace.factories.find((factory) => factory.id === factoryId && factory.organizationId === organizationId);
}

function scopedWorkspace(workspace: DemoWorkspace, organizationId: string): DemoWorkspace {
  const organization = workspace.organizations.find((item) => item.id === organizationId) ?? workspace.organization;
  return organization.id === workspace.organization.id ? workspace : { ...workspace, organization };
}

export function getWorkspaceForOrganization(workspace: DemoWorkspace, organizationId: string): DemoWorkspace {
  return scopedWorkspace(workspace, organizationId);
}

export function getLeaderProductionMemberships(workspace: DemoWorkspace, leaderId = getActiveMember(workspace).id) {
  const leader = workspace.members.find((member) => member.id === leaderId && member.role === "leader");
  return leader ? activeLeaderMemberships(workspace, leader) : [];
}

export function getLeaderAccessibleWorkers(workspace: DemoWorkspace, leaderId = getActiveMember(workspace).id, today = todayDate()): LeaderRosterEntry[] {
  const actor = workspace.members.find((member) => member.id === leaderId && member.role === "leader");
  return actor ? getLeaderRoster(workspace, actor, today) : [];
}

export interface LeaderProductionParticipant {
  worker: DemoMember;
  groupId?: string;
  requiresTeamAssignment?: boolean;
  accessState: "active" | "removed";
}

export function getLeaderProductionParticipants(workspace: DemoWorkspace, leaderId: string, factoryId: string, today = todayDate()): LeaderProductionParticipant[] {
  const leader = workspace.members.find((member) => member.id === leaderId && member.role === "leader");
  const membership = leader && activeLeaderMemberships(workspace, leader).find((item) => item.organizationId === workspace.organization.id && item.factoryId === factoryId);
  const factory = getFactory(workspace, factoryId);
  if (!membership || !effectiveLeaderPermissions(membership).canViewWorkers || !factory || factory.archivedAt) return [];
  return workspace.members.filter((worker) => worker.organizationId === membership.organizationId && worker.role === "worker").flatMap((worker) => {
    const period = workspace.employmentPeriods.find((item) => item.organizationId === membership.organizationId && item.workerId === worker.id && item.state === "active" && item.startDate <= today && (!item.endDate || item.endDate >= today));
    const placement = period?.placements.find((item) => item.factoryId === factoryId && item.startDate <= today && (!item.endDate || item.endDate >= today));
    if (!placement) return [];
    return [{ worker, groupId: placement.groupId, requiresTeamAssignment: placement.requiresTeamAssignment, accessState: isLeaderWorkerRemoved(workspace, membership.id, membership.organizationId, factoryId, worker.id) ? "removed" as const : "active" as const }];
  }).sort((left, right) => left.worker.name.localeCompare(right.worker.name));
}

export function getProductionWorkflowSettings(factory: DemoFactory) {
  return effectiveWorkflowSettings(factory);
}

export function getLeaderAccessPermissions(member: DemoMember) {
  return effectiveLeaderPermissions(member);
}

function activeEmploymentAt(workspace: DemoWorkspace, organizationId: string, workerId: string, factoryId: string, localDate: string) {
  const period = workspace.employmentPeriods.find((item) => item.organizationId === organizationId && item.workerId === workerId && item.state === "active" && item.startDate <= localDate && (!item.endDate || item.endDate >= localDate));
  const placement = period?.placements.find((item) => item.factoryId === factoryId && item.startDate <= localDate && (!item.endDate || item.endDate >= localDate));
  return period && placement ? { period, placement } : undefined;
}

function shiftEmploymentIsValid(workspace: DemoWorkspace, record: DemoShiftRecord): boolean {
  const { shift } = record;
  if (!shift.factoryId || shift.agencyId !== record.organizationId) return false;
  const worker = workspace.members.find((member) => member.id === shift.workerUid && member.organizationId === record.organizationId && member.role === "worker");
  if (!worker) return false;
  const legacyFactoryIds = worker.productionAssignments?.map((assignment) => assignment.factoryId) ?? (worker.factoryId ? [worker.factoryId] : []);
  return workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: record.organizationId, workerId: worker.id, factoryId: shift.factoryId, date: shift.localStartDate, employmentId: shift.employmentId }, legacyFactoryIds);
}

function absenceEmploymentIsValid(workspace: DemoWorkspace, record: DemoAbsence): boolean {
  const worker = workspace.members.find((member) => member.id === record.workerId && member.organizationId === record.organizationId && member.role === "worker");
  if (!worker) return false;
  const legacyFactoryIds = worker.productionAssignments?.map((assignment) => assignment.factoryId) ?? (worker.factoryId ? [worker.factoryId] : []);
  return workerHasProductionOnDate(workspace.employmentPeriods, { organizationId: record.organizationId, workerId: worker.id, factoryId: record.factoryId, date: record.localDate, employmentId: record.employmentId }, legacyFactoryIds);
}

function activeLeaderMembershipFor(workspace: DemoWorkspace, organizationId: string, factoryId: string, permission: keyof NonNullable<DemoMember["permissions"]>) {
  const actor = getActiveMember(workspace);
  return activeLeaderMemberships(workspace, actor).find((item) => item.organizationId === organizationId && item.factoryId === factoryId && effectiveLeaderPermissions(item)[permission]);
}

export function getWorkerProductionAssignments(workspace: DemoWorkspace, workerId: string, organizationId = workspace.organization.id): DemoProductionAssignment[] {
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === organizationId && member.role === "worker");
  if (!worker) return [];
  return worker.productionAssignments?.length ? worker.productionAssignments : (worker.factoryId ? [{ factoryId: worker.factoryId, groupId: worker.groupId, leaderId: worker.leaderId }] : []);
}

export function getWorkerAccountMemberships(workspace: DemoWorkspace, workerId: string): DemoMember[] {
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker");
  if (!worker) return [];
  const accountUid = worker.accountUid ?? worker.id;
  return workspace.members.filter((member) => member.role === "worker" && (member.accountUid ?? member.id) === accountUid);
}

export function getWorkerProductionAssignment(workspace: DemoWorkspace, workerId: string, factoryId?: string, organizationId = workspace.organization.id): DemoProductionAssignment | undefined {
  return getWorkerProductionAssignments(workspace, workerId, organizationId).find((assignment) => assignment.factoryId === factoryId);
}

export function getProductionWorkers(workspace: DemoWorkspace, factoryId: string): DemoMember[] {
  const today = todayDate();
  const actor = getActiveMember(workspace);
  const factory = actor.role === "factory-admin" ? workspace.factories.find((item) => item.id === factoryId) : getFactory(workspace, factoryId);
  const organizationId = factory?.organizationId ?? workspace.organization.id;
  const site = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
  const entity = actor.role === "factory-admin" ? getActiveBusinessEntity(workspace) : undefined;
  const businessAccess = actor.role === "factory-admin" && factory && entity && site?.businessEntityId === entity.id
    && (factory.organizationId === entity.organizationId ? factory.ownerWorkforce === true
      : (workspace.agencyWorksites ?? []).some((connection) => connection.businessEntityId === entity.id && connection.worksiteId === site.id && connection.organizationId === factory.organizationId && connection.state === "active"));
  if (!factory || actor.role === "factory-admin" && !businessAccess || actor.role !== "factory-admin" && factory.organizationId !== workspace.organization.id) return [];
  return workspace.members.filter((member) => {
    if (member.role !== "worker" || member.organizationId !== organizationId) return false;
    const history = workspace.employmentPeriods.filter((period) => period.organizationId === member.organizationId && period.workerId === member.id);
    if (history.length === 0) return Boolean(getWorkerProductionAssignment(workspace, member.id, factoryId, organizationId));
    return history.some((period) => period.state === "active" && period.startDate <= today && (!period.endDate || period.endDate >= today)
      && period.placements.some((placement) => placement.factoryId === factoryId && placement.startDate <= today && (!placement.endDate || placement.endDate >= today)));
  });
}

export function isAgencyVisibleAbsence(workspace: DemoWorkspace, absence: DemoAbsence): boolean {
  const actor = getActiveMember(workspace);
  if (actor.role === "agency" && actor.organizationId !== absence.organizationId) return false;
  return Boolean(absence.agencyCategory || absence.state === "reviewed" || absence.state === "unreported"
    || absence.state === "reported" || absence.state === "rejected" || absence.state === "cancelled");
}

export function getAgencyAbsenceConflictingShifts(absenceId: string, workspace = readWorkspace()): DemoShiftRecord[] {
  const actor = getActiveMember(workspace);
  const absence = workspace.absences.find((item) => item.id === absenceId && item.organizationId === actor.organizationId);
  if (actor.role !== "agency" || !absence || !absenceEmploymentIsValid(workspace, absence)) return [];
  return workspace.shifts.filter((record) => record.organizationId === absence.organizationId && record.shift.workerUid === absence.workerId
    && record.shift.factoryId === absence.factoryId && record.shift.localStartDate === absence.localDate && !record.shift.deletedAt
    && (!record.shift.employmentId || record.shift.employmentId === absence.employmentId) && shiftEmploymentIsValid(workspace, record));
}

export function getAbsenceLeaderRecipients(workspace: DemoWorkspace, workerId: string, factoryId: string): string[] {
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === workspace.organization.id && item.role === "worker");
  if (!worker) return [];
  return workspace.members.filter((item) => item.organizationId === workspace.organization.id && item.role === "leader"
    && item.factoryId === factoryId && item.accessState !== "suspended" && item.accessState !== "revoked"
    && effectiveLeaderPermissions(item).canViewWorkers && effectiveLeaderPermissions(item).canReviewShifts
    && !isLeaderWorkerRemoved(workspace, item.id, item.organizationId, factoryId, workerId)).map((item) => item.id);
}

export function getLeaderUnassignedWorkers(workspace: DemoWorkspace, leaderId: string, factoryId: string): DemoMember[] {
  return getLeaderProductionWorkers(workspace, leaderId, factoryId).filter((worker) => !getWorkerProductionAssignment(workspace, worker.id, factoryId)?.groupId);
}

export function getLeaderProductionWorkers(workspace: DemoWorkspace, leaderId: string, factoryId: string): DemoMember[] {
  return getLeaderProductionParticipants(workspace, leaderId, factoryId).filter((item) => item.accessState === "active").map((item) => item.worker);
}

export function isInternalAgencyFactory(workspace: DemoWorkspace, factoryId: string): boolean {
  const factory = workspace.factories.find(item => item.id === factoryId);
  const site = workspace.worksites?.find(item => item.id === factory?.worksiteId);
  return Boolean(factory && !factory.ownerWorkforce && site && !site.businessEntityId);
}

export function getWorkerAccess(workspace: DemoWorkspace, workerId: string, factoryId?: string): WorkerInputAccess {
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === workspace.organization.id);
  const factory = getFactory(workspace, factoryId ?? worker?.factoryId);
  if (!factory || !getWorkerProductionAssignment(workspace, workerId, factory.id)) return "leader";
  if (isInternalAgencyFactory(workspace, factory.id)) return "self";
  // Explicit leader decisions take precedence; retain legacy defaults without rewriting saved records.
  return factory.workerAccess[workerId] ?? (factory.inputMode === "A" ? "self" : "leader");
}

export function setActiveMember(memberId: string) {
  if (previewAccount && memberId !== previewAccount.id) return;
  const workspace = readWorkspace();
  const member = workspace.members.find((item) => item.id === memberId);
  if (!member || member.accessState === "suspended" || member.accessState === "revoked") return;
  const organization = workspace.organizations.find((item) => item.id === member.organizationId);
  if (!organization) return;
  publish({ ...workspace, organization, activeMemberId: memberId });
}

export function registerDemoAgency(input: { organizationName: string; adminName: string; email: string }): DemoMember | undefined {
  const workspace = readWorkspace();
  const organizationName = input.organizationName.trim();
  const adminName = input.adminName.trim();
  const email = input.email.trim().toLocaleLowerCase("en-US");
  if (!organizationName || !adminName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  const existingOrganization = workspace.organizations.find((item) => item.type !== "factory"
    && item.name.trim().toLocaleLowerCase("en-US") === organizationName.toLocaleLowerCase("en-US")
    && item.contactEmail?.trim().toLocaleLowerCase("en-US") === email);
  if (existingOrganization) return undefined;
  const organizationId = `agency-${crypto.randomUUID()}`;
  const organization = { id: organizationId, name: organizationName, timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: email };
  const existingAccount = workspace.members.find((member) => member.email?.trim().toLocaleLowerCase("en-US") === email);
  const member: DemoMember = {
    id: `agency-admin-${crypto.randomUUID()}`,
    organizationId,
    role: "agency",
    name: adminName,
    email,
    accountUid: existingAccount?.accountUid ?? `account-${crypto.randomUUID()}`,
    status: "active",
  };
  publish({ ...workspace, organization, organizations: [...workspace.organizations, organization], members: [...workspace.members, member], activeMemberId: member.id });
  return member;
}

export type AgencyWorksiteAccessStart =
  | { kind: "invalid"; reason: "agency-only" | "required" | "invalid-nip" | "not-found" }
  | { kind: "connected"; businessEntity: DemoBusinessEntity; worksite: DemoWorksite }
  | { kind: "invited"; businessEntity: DemoBusinessEntity; worksite: DemoWorksite; request: DemoWorksiteConnectionRequest }
  | { kind: "request"; businessEntity: DemoBusinessEntity; request: DemoWorksiteConnectionRequest }
  | { kind: "invitation"; invitation: DemoFactoryInvitation; url: string };

export type AgencyWorksiteRequestResult = Exclude<AgencyWorksiteAccessStart, { kind: "invitation" }>;

export type FactoryWorkspaceRegistrationResult =
  | { kind: "created"; admin: DemoMember; businessEntity: DemoBusinessEntity; worksite: DemoWorksite }
  | { kind: "existing"; businessEntity: DemoBusinessEntity; worksite?: DemoWorksite }
  | { kind: "invalid"; reason: "required" | "invalid-nip" | "invalid-email" };

export function registerFactoryWorkspace(input: { companyName: string; nip: string; city?: string; adminName: string; email: string; worksiteName: string; address: string }): FactoryWorkspaceRegistrationResult {
  const workspace = readWorkspace();
  const companyName = input.companyName.trim();
  const nipInput = input.nip.trim();
  const nip = normalizeBusinessNip(nipInput);
  const city = input.city?.trim() || cityFromAddress(input.address);
  const adminName = input.adminName.trim();
  const email = input.email.trim().toLocaleLowerCase("en-US");
  const worksiteName = input.worksiteName.trim();
  const address = input.address.trim();
  if (!companyName || !nipInput || !adminName || !email || !worksiteName || !address || !city) return { kind: "invalid", reason: "required" };
  if (!nip) return { kind: "invalid", reason: "invalid-nip" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { kind: "invalid", reason: "invalid-email" };
  const existing = (workspace.businessEntities ?? []).find((entity) => normalizeBusinessNip(entity.nip ?? "") === nip
    && normalizeWorksiteAddress(entity.city ?? cityFromAddress((workspace.worksites ?? []).find((site) => site.businessEntityId === entity.id)?.address) ?? "") === normalizeWorksiteAddress(city));
  if (existing) {
    const worksite = (workspace.worksites ?? []).find((site) => site.businessEntityId === existing.id && normalizeWorksiteAddress(site.address ?? "") === normalizeWorksiteAddress(address));
    return { kind: "existing", businessEntity: existing, worksite };
  }

  const now = new Date().toISOString();
  const businessEntityId = `business-${crypto.randomUUID()}`;
  const organizationId = `factory-account-${businessEntityId}`;
  const adminId = `factory-admin-${crypto.randomUUID()}`;
  const organization = { id: organizationId, name: companyName, timezone: "Europe/Warsaw", type: "factory" as const, contactEmail: email };
  const existingEmailAccount = workspace.members.find((member) => member.email?.trim().toLocaleLowerCase("en-US") === email);
  const accountUid = existingEmailAccount?.accountUid ?? (existingEmailAccount ? `account-${existingEmailAccount.id}` : `account-${crypto.randomUUID()}`);
  const businessEntity: DemoBusinessEntity = { id: businessEntityId, organizationId, name: companyName, nip, city, identifier: newPublicIdentifier("C", workspace), adminMemberId: adminId, createdAt: now };
  const admin: DemoMember = { id: adminId, organizationId, role: "factory-admin", name: adminName, email, accountUid, businessEntityId, status: "active" };
  const worksite: DemoWorksite = { id: `worksite-${crypto.randomUUID()}`, businessEntityId, name: worksiteName, address, identifier: newPublicIdentifier("S", workspace) };
  publish({
    ...workspace,
    organization,
    organizations: [...workspace.organizations, organization],
    businessEntities: [...(workspace.businessEntities ?? []), businessEntity],
    worksites: [...(workspace.worksites ?? []), worksite],
    members: [...workspace.members, admin],
    activeMemberId: admin.id,
  });
  return { kind: "created", admin, businessEntity, worksite };
}

export function findBusinessWorksite(nip: string, address: string): { businessEntity: DemoBusinessEntity; worksite: DemoWorksite } | undefined {
  const normalizedNip = normalizeBusinessNip(nip);
  const normalizedAddress = normalizeWorksiteAddress(address);
  if (!normalizedNip || !normalizedAddress) return undefined;
  const workspace = readWorkspace();
  const businessEntity = workspace.businessEntities?.find((entity) => normalizeBusinessNip(entity.nip ?? "") === normalizedNip);
  const worksite = businessEntity && workspace.worksites?.find((site) => site.businessEntityId === businessEntity.id && normalizeWorksiteAddress(site.address ?? "") === normalizedAddress);
  return businessEntity && worksite ? { businessEntity, worksite } : undefined;
}

export function getFactoryInvitationUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location?.origin ?? "" : "");
  return `${base}/factory/register?invitation=${encodeURIComponent(token)}`;
}

export function revokeFactoryInvitation(invitationId: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const invitation = (workspace.factoryInvitations ?? []).find((item) => item.id === invitationId && item.organizationId === actor.organizationId && item.state === "pending");
  if (actor.role !== "agency" || !invitation || invitation.createdById !== actor.id) return false;
  mutate((state) => ({ ...state, factoryInvitations: (state.factoryInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "revoked" as const } : item) }));
  return true;
}

/** Legacy address-based entry point; it only connects to a uniquely selected existing central/site. */
export function startAgencyWorksiteAccess(input: { companyName: string; nip?: string; email?: string; city?: string; businessEntityId?: string; worksiteId?: string; worksiteName: string; address: string; worksiteIdentifier?: string; productionName?: string }): AgencyWorksiteAccessStart {
  const actor = getActiveMember();
  if (actor.role !== "agency") return { kind: "invalid", reason: "agency-only" };
  if (input.businessEntityId) return requestAgencyWorksiteConnection({ businessEntityId: input.businessEntityId, worksiteId: input.worksiteId, worksiteName: input.worksiteName, address: input.address, productionName: input.productionName });
  const nipDigits = input.nip?.replace(/\D/g, "") ?? "";
  if (nipDigits.length !== 10) return { kind: "invalid", reason: "invalid-nip" };
  const matches = searchRegisteredCentralsByNip(nipDigits).filter((central) => central.nip?.replace(/\D/g, "") === nipDigits);
  if (matches.length > 0) return { kind: "invalid", reason: "not-found" };
  const invitation = createFactoryInvitation({ email: input.email ?? "", companyName: input.companyName, nip: nipDigits, city: input.city?.trim() || cityFromAddress(input.address) || "", worksiteName: input.worksiteName, worksiteAddress: input.address, productionName: input.productionName ?? input.worksiteName });
  return invitation ? { kind: "invitation", ...invitation } : { kind: "invalid", reason: "required" };
}

export function registerFactoryFromInvitation(token: string, adminInput: { name: string; email?: string }): DemoMember | undefined {
  const workspace = readWorkspace();
  const invitation = (workspace.factoryInvitations ?? []).find((item) => item.token === token);
  if (!invitation || invitation.state !== "pending") return undefined;
  const adminName = adminInput.name.trim();
  const email = adminInput.email?.trim() || undefined;
  if (!adminName || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  const now = new Date();
  if (Date.parse(invitation.expiresAt) <= now.getTime()) {
    mutate((state) => ({ ...state, factoryInvitations: (state.factoryInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "expired" as const } : item) }));
    return undefined;
  }
  const nip = invitation.nip ? normalizeBusinessNip(invitation.nip) : undefined;
  if (invitation.nip && !nip) return undefined;
  const agencyOrganization = workspace.organizations.find((item) => item.id === invitation.organizationId);
  const agencyAccount = workspace.members.find((member) => member.organizationId === invitation.organizationId && member.role === "agency");
  if (!agencyOrganization || !agencyAccount) return undefined;

  const invitationCity = invitation.city?.trim() || cityFromAddress(invitation.worksiteAddress);
  const existingEntity = nip && (workspace.businessEntities ?? []).find((entity) => normalizeBusinessNip(entity.nip ?? "") === nip
    && normalizeWorksiteAddress(entity.city ?? cityFromAddress((workspace.worksites ?? []).find((site) => site.businessEntityId === entity.id)?.address) ?? "") === normalizeWorksiteAddress(invitationCity ?? ""));
  const nowIso = now.toISOString();
  let businessEntity: DemoBusinessEntity;
  let admin: DemoMember;
  let worksite: DemoWorksite | undefined;
  let organizations = workspace.organizations;
  let businessEntities = workspace.businessEntities ?? [];
  let worksites = workspace.worksites ?? [];
  let members = workspace.members;
  if (existingEntity) {
    const existingAdmin = workspace.members.find((member) => member.id === existingEntity.adminMemberId && member.role === "factory-admin" && member.businessEntityId === existingEntity.id);
    if (!existingAdmin) return undefined;
    businessEntity = existingEntity;
    admin = existingAdmin;
    worksite = worksites.find((site) => site.businessEntityId === businessEntity.id && normalizeWorksiteAddress(site.address ?? "") === normalizeWorksiteAddress(invitation.worksiteAddress ?? ""));
  } else {
    const businessEntityId = `business-${crypto.randomUUID()}`;
    const factoryOrganizationId = `factory-account-${businessEntityId}`;
    const adminMemberId = `factory-admin-${crypto.randomUUID()}`;
    const existingEmailAccount = email ? workspace.members.find((member) => member.email?.trim().toLocaleLowerCase("en-US") === email.toLocaleLowerCase("en-US")) : undefined;
    const accountUid = existingEmailAccount?.accountUid ?? (existingEmailAccount ? `account-${existingEmailAccount.id}` : `account-${crypto.randomUUID()}`);
    const factoryOrganization = { id: factoryOrganizationId, name: invitation.companyName ?? "", timezone: "Europe/Warsaw", type: "factory" as const, contactEmail: email };
    businessEntity = { id: businessEntityId, organizationId: factoryOrganizationId, name: invitation.companyName ?? "", nip, city: invitationCity, identifier: newPublicIdentifier("C", workspace), adminMemberId, createdAt: nowIso };
    admin = { id: adminMemberId, organizationId: factoryOrganizationId, role: "factory-admin", name: adminName, accountUid, businessEntityId, email, status: "active" };
    worksite = { id: `worksite-${crypto.randomUUID()}`, businessEntityId, name: invitation.worksiteName ?? "", address: invitation.worksiteAddress ?? "", identifier: newPublicIdentifier("S", workspace) };
    organizations = [...organizations, factoryOrganization];
    businessEntities = [...businessEntities, businessEntity];
    worksites = [...worksites, worksite];
    members = [...members, admin];
  }
  const connectionRequest: DemoWorksiteConnectionRequest = {
    id: `worksite-request-${crypto.randomUUID()}`,
    organizationId: invitation.organizationId,
    businessEntityId: businessEntity.id,
    worksiteId: worksite?.id,
    requestedWorksiteName: invitation.worksiteName ?? worksite?.name ?? "",
    requestedAddress: invitation.worksiteAddress ?? worksite?.address ?? "",
    requestedIdentifier: worksite?.identifier,
    productionName: invitation.productionName ?? invitation.worksiteName ?? "",
    source: "invitation",
    invitationId: invitation.id,
    state: "pending",
    createdById: agencyAccount.id,
    createdAt: invitation.createdAt,
  };
  const completedInvitation = { ...invitation, state: "accepted" as const, acceptedBusinessEntityId: businessEntity.id, acceptedWorksiteId: worksite?.id, acceptedByMemberId: admin.id };
  publish({
    ...workspace,
    organization: organizations.find((item) => item.id === businessEntity.organizationId) ?? workspace.organization,
    organizations,
    businessEntities,
    worksites,
    members,
    worksiteConnectionRequests: [...(workspace.worksiteConnectionRequests ?? []), connectionRequest],
    factoryInvitations: (workspace.factoryInvitations ?? []).map((item) => item.id === invitation.id ? completedInvitation : item),
    notifications: [
      connectionNotification(admin.organizationId, admin.id, "agency-connection-requested", connectionRequest.id),
      connectionNotification(agencyOrganization.id, agencyAccount.id, "factory-invitation-registered", invitation.id),
      ...workspace.notifications,
    ],
    activeMemberId: admin.id,
  });
  return admin;
}

function ensureAgencyLeaderMembership(workspace: DemoWorkspace, agencyOrganizationId: string, factory: DemoFactory, siteLeader: DemoLeaderWorksiteMembership): DemoMember | undefined {
  const existing = workspace.members.find((member) => member.role === "leader" && member.organizationId === agencyOrganizationId && member.factoryId === factory.id && (member.accountUid ?? member.id) === siteLeader.accountUid);
  if (existing) return {
    ...existing,
    name: siteLeader.name,
    email: siteLeader.email,
    canManageGroups: siteLeader.permissions.canManageGroups,
    permissions: { ...siteLeader.permissions },
    accessState: siteLeader.state,
  };
  const membership: DemoMember = {
    id: `leader-${crypto.randomUUID()}`,
    organizationId: agencyOrganizationId,
    role: "leader",
    name: siteLeader.name,
    accountUid: siteLeader.accountUid,
    email: siteLeader.email,
    factoryId: factory.id,
    canManageGroups: siteLeader.permissions.canManageGroups,
    canManageAllWorkers: false,
    accessState: siteLeader.state,
    permissions: { ...siteLeader.permissions },
    status: "active",
  };
  return membership;
}

export function resolveWorksiteConnectionRequest(requestId: string, decision: "approve" | "decline", response = ""): boolean {
  const workspace = readWorkspace();
  const admin = getActiveMember(workspace);
  const businessEntity = getActiveBusinessEntity(workspace);
  const request = (workspace.worksiteConnectionRequests ?? []).find((item) => item.id === requestId && item.state === "pending");
  if (admin.role !== "factory-admin" || !businessEntity || !request || request.businessEntityId !== businessEntity.id || (request.direction ?? "agency-request") !== "agency-request") return false;
  const agency = workspace.organizations.find((item) => item.id === request.organizationId && item.type !== "factory");
  const agencyAccount = workspace.members.find((member) => member.organizationId === request.organizationId && member.role === "agency");
  if (!agency || !agencyAccount) return false;
  const now = new Date().toISOString();
  if (decision === "decline") {
    mutate((state) => ({
      ...state,
      worksiteConnectionRequests: (state.worksiteConnectionRequests ?? []).map((item) => item.id === request.id ? { ...item, state: "declined" as const, resolvedByMemberId: admin.id, resolvedAt: now, response: response.trim() || undefined } : item),
      notifications: [connectionNotification(agency.id, agencyAccount.id, "agency-connection-declined", request.id), ...state.notifications],
    }));
    return true;
  }

  let worksite = request.worksiteId ? workspace.worksites?.find((site) => site.id === request.worksiteId && site.businessEntityId === businessEntity.id) : undefined;
  if (!worksite) worksite = workspace.worksites?.find((site) => site.businessEntityId === businessEntity.id && normalizeWorksiteAddress(site.address ?? "") === normalizeWorksiteAddress(request.requestedAddress));
  if (!worksite) worksite = { id: `worksite-${crypto.randomUUID()}`, businessEntityId: businessEntity.id, name: request.requestedWorksiteName, address: request.requestedAddress, identifier: newPublicIdentifier("S", workspace) };
  const existingFactory = workspace.factories.find((factory) => factory.organizationId === request.organizationId && factory.worksiteId === worksite!.id && factory.name.trim().toLocaleLowerCase("en-US") === request.productionName.trim().toLocaleLowerCase("en-US"));
  const factory = existingFactory ?? createAgencyFactory(request.organizationId, worksite, request.productionName);
  const existingConnection = (workspace.agencyWorksites ?? []).find((item) => item.organizationId === request.organizationId && item.worksiteId === worksite!.id);
  const connection: DemoAgencyWorksite = existingConnection
    ? { ...existingConnection, state: "active", approvedAt: now, approvedByMemberId: admin.id, source: "request" }
    : { id: `agency-worksite-${crypto.randomUUID()}`, organizationId: request.organizationId, businessEntityId: businessEntity.id, worksiteId: worksite.id, state: "active", createdAt: request.createdAt, approvedAt: now, approvedByMemberId: admin.id, source: "request" };
  const requestResult = { ...request, worksiteId: worksite.id, state: "approved" as const, resolvedByMemberId: admin.id, resolvedAt: now, response: response.trim() || undefined };
  const linkedFactoryExists = workspace.factories.some((item) => item.id === factory.id && item.organizationId === request.organizationId);
  mutate((state) => ({
    ...state,
    worksites: (state.worksites ?? []).some((site) => site.id === worksite!.id) ? state.worksites : [...(state.worksites ?? []), worksite!],
    agencyWorksites: [...(state.agencyWorksites ?? []).filter((item) => !(item.organizationId === request.organizationId && item.worksiteId === worksite!.id)), connection],
    worksiteConnectionRequests: (state.worksiteConnectionRequests ?? []).map((item) => item.id === request.id ? requestResult : item),
    factories: linkedFactoryExists ? state.factories : [...state.factories, factory],
    notifications: [connectionNotification(agency.id, agencyAccount.id, "agency-connected", request.id), ...state.notifications],
  }));
  return true;
}

/** Accept or decline a factory-originated invitation. Selecting an invitation never activates a link by itself. */
export function resolveAgencyWorksiteInvitation(requestId: string, decision: "accept" | "decline"): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const request = (workspace.worksiteConnectionRequests ?? []).find((item) => item.id === requestId && item.state === "pending" && item.direction === "factory-invitation");
  if (actor.role !== "agency" || !request || request.organizationId !== actor.organizationId) return false;
  const entity = (workspace.businessEntities ?? []).find((item) => item.id === request.businessEntityId);
  const site = workspace.worksites?.find((item) => item.id === request.worksiteId && item.businessEntityId === entity?.id);
  const admin = entity && workspace.members.find((item) => item.id === entity.adminMemberId && item.role === "factory-admin");
  if (!entity || !site || !admin) return false;
  const now = new Date().toISOString();
  if (decision === "decline") {
    mutate((state) => ({
      ...state,
      worksiteConnectionRequests: (state.worksiteConnectionRequests ?? []).map((item) => item.id === request.id ? { ...item, state: "declined" as const, resolvedByMemberId: actor.id, resolvedAt: now } : item),
      notifications: [connectionNotification(entity.organizationId, admin.id, "agency-invitation-declined", request.id), ...state.notifications],
    }));
    return true;
  }
  const alreadyConnected = (workspace.agencyWorksites ?? []).some((item) => item.organizationId === actor.organizationId && item.businessEntityId === entity.id && item.worksiteId === site.id && item.state === "active");
  const factory = workspace.factories.find((item) => item.organizationId === actor.organizationId && item.worksiteId === site.id && item.name.trim().toLocaleLowerCase("en-US") === request.productionName.trim().toLocaleLowerCase("en-US"))
    ?? createAgencyFactory(actor.organizationId, site, request.productionName);
  const connection: DemoAgencyWorksite = { id: `agency-worksite-${crypto.randomUUID()}`, organizationId: actor.organizationId, businessEntityId: entity.id, worksiteId: site.id, state: "active", createdAt: request.createdAt, approvedAt: now, approvedByMemberId: actor.id, source: "invitation" };
  mutate((state) => ({
    ...state,
    agencyWorksites: alreadyConnected ? state.agencyWorksites : [...(state.agencyWorksites ?? []).filter((item) => !(item.organizationId === actor.organizationId && item.businessEntityId === entity.id && item.worksiteId === site.id)), connection],
    factories: state.factories.some((item) => item.id === factory.id) ? state.factories : [...state.factories, factory],
    worksiteConnectionRequests: (state.worksiteConnectionRequests ?? []).map((item) => item.id === request.id ? { ...item, state: "approved" as const, resolvedByMemberId: actor.id, resolvedAt: now } : item),
    notifications: [connectionNotification(entity.organizationId, admin.id, "agency-connection-accepted", request.id), ...state.notifications],
  }));
  return true;
}

export function createBusinessWorksite(input: { name: string; address: string; identifier?: string }): DemoWorksite | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const name = input.name.trim();
  const address = input.address.trim();
  if (actor.role !== "factory-admin" || !entity || actor.businessEntityId !== entity.id || !name || !address) return undefined;
  const existing = (workspace.worksites ?? []).find((site) => site.businessEntityId === entity.id && normalizeWorksiteAddress(site.address ?? "") === normalizeWorksiteAddress(address));
  if (existing) return existing;
  const requestedIdentifier = input.identifier?.trim();
  const normalizedIdentifier = requestedIdentifier ? normalizeHumanIdentifier(requestedIdentifier) : "";
  const identifierInUse = normalizedIdentifier && [...(workspace.businessEntities ?? []).map((item) => item.identifier), ...(workspace.worksites ?? []).map((item) => item.identifier)]
    .some((identifier) => normalizeHumanIdentifier(identifier ?? "") === normalizedIdentifier);
  if (identifierInUse) return undefined;
  const worksite: DemoWorksite = { id: `worksite-${crypto.randomUUID()}`, businessEntityId: entity.id, name, address, identifier: requestedIdentifier || newPublicIdentifier("S", workspace) };
  mutate((state) => ({ ...state, worksites: [...(state.worksites ?? []), worksite] }));
  return worksite;
}

export function createBusinessDepartment(worksiteId: string, name: string): DemoDepartment | undefined {
  const workspace = readWorkspace();
  const entity = getActiveBusinessEntity(workspace);
  const cleanName = name.trim();
  const worksite = workspace.worksites?.find((site) => site.id === worksiteId && site.businessEntityId === entity?.id);
  if (!entity || getActiveMember(workspace).role !== "factory-admin" || !worksite || !cleanName) return undefined;
  const existing = (workspace.departments ?? []).find((department) => department.worksiteId === worksiteId && department.name.trim().toLocaleLowerCase("en-US") === cleanName.toLocaleLowerCase("en-US") && !department.archivedAt);
  if (existing) return undefined;
  const department: DemoDepartment = { id: `department-${crypto.randomUUID()}`, businessEntityId: entity.id, worksiteId, name: cleanName, createdAt: new Date().toISOString() };
  mutate((state) => ({ ...state, departments: [...(state.departments ?? []), department] }));
  return department;
}

export function getLeaderInvitationUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location?.origin ?? "" : "");
  return `${base}/leader/register?invitation=${encodeURIComponent(token)}`;
}

export function createBusinessLeaderInvitation(worksiteId: string, input: {
  name: string;
  email: string;
  organizationIds: string[];
  departmentIds?: string[];
  permissions?: DemoMember["permissions"];
}): { invitation: DemoLeaderInvitation; url: string } | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const worksite = workspace.worksites?.find((item) => item.id === worksiteId && item.businessEntityId === entity?.id);
  const name = input.name.trim();
  const email = input.email.trim();
  const emailKey = email.toLocaleLowerCase("en-US");
  if (actor.role !== "factory-admin" || !entity || !worksite || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  const connectedOrganizationIds = new Set((workspace.agencyWorksites ?? []).filter((connection) => connection.businessEntityId === entity.id && connection.worksiteId === worksiteId && connection.state === "active").map((connection) => connection.organizationId));
  if (workspace.factories.some((factory) => factory.organizationId === entity.organizationId && factory.worksiteId === worksiteId && factory.ownerWorkforce && !factory.archivedAt)) connectedOrganizationIds.add(entity.organizationId);
  const organizationIds = [...new Set(input.organizationIds)].filter((organizationId) => connectedOrganizationIds.has(organizationId));
  if (organizationIds.length === 0) return undefined;
  const departmentIds = [...new Set(input.departmentIds ?? [])].filter((id) => (workspace.departments ?? []).some((item) => item.id === id && item.businessEntityId === entity.id && item.worksiteId === worksiteId && !item.archivedAt));
  const permissions = input.permissions ?? { canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: false, canManageGroups: false };
  const existingInvitation = (workspace.leaderInvitations ?? []).find((item) => item.businessEntityId === entity.id && item.worksiteId === worksiteId && item.email.trim().toLocaleLowerCase("en-US") === emailKey && item.state === "pending");
  const now = new Date();
  const invitation: DemoLeaderInvitation = existingInvitation
    ? { ...existingInvitation, name, organizationIds: [...new Set([...existingInvitation.organizationIds, ...organizationIds])], departmentIds, permissions: { ...permissions }, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() }
    : { id: `leader-invitation-${crypto.randomUUID()}`, token: crypto.randomUUID(), businessEntityId: entity.id, worksiteId, organizationIds, name, email, departmentIds, permissions: { ...permissions }, createdById: actor.id, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), state: "pending", simulatedEmailSentAt: now.toISOString() };
  mutate((state) => ({ ...state, leaderInvitations: [...(state.leaderInvitations ?? []).filter((item) => item.id !== invitation.id), invitation] }));
  return { invitation, url: getLeaderInvitationUrl(invitation.token) };
}

export function revokeBusinessLeaderInvitation(invitationId: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const invitation = (workspace.leaderInvitations ?? []).find((item) => item.id === invitationId && item.businessEntityId === entity?.id && item.state === "pending");
  if (actor.role !== "factory-admin" || !entity || !invitation || invitation.createdById !== actor.id) return false;
  mutate((state) => ({ ...state, leaderInvitations: (state.leaderInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "revoked" as const } : item) }));
  return true;
}

export function registerLeaderFromInvitation(token: string, input: { name: string; email: string }): DemoMember | undefined {
  const workspace = readWorkspace();
  const invitation = (workspace.leaderInvitations ?? []).find((item) => item.token === token && item.state === "pending");
  if (!invitation) return undefined;
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name || email.toLocaleLowerCase("en-US") !== invitation.email.toLocaleLowerCase("en-US")) return undefined;
  const now = new Date();
  if (Date.parse(invitation.expiresAt) <= now.getTime()) {
    mutate((state) => ({ ...state, leaderInvitations: (state.leaderInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "expired" as const } : item) }));
    return undefined;
  }
  const entity = (workspace.businessEntities ?? []).find((item) => item.id === invitation.businessEntityId);
  const worksite = workspace.worksites?.find((item) => item.id === invitation.worksiteId && item.businessEntityId === invitation.businessEntityId);
  if (!entity || !worksite) return undefined;
  const normalizedEmail = email.toLocaleLowerCase("en-US");
  const previousGlobalMembership = (workspace.leaderWorksiteMemberships ?? []).find((item) => item.email?.trim().toLocaleLowerCase("en-US") === normalizedEmail);
  const priorLeaderAccount = workspace.members.find((item) => item.role === "leader" && item.email?.trim().toLocaleLowerCase("en-US") === normalizedEmail);
  const accountUid = previousGlobalMembership?.accountUid ?? priorLeaderAccount?.accountUid ?? (priorLeaderAccount ? `account-${priorLeaderAccount.id}` : `account-${crypto.randomUUID()}`);
  const existingSiteMembership = (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === entity.id && item.worksiteId === worksite.id && item.accountUid === accountUid);
  const leaderMembership: DemoLeaderWorksiteMembership = {
    id: existingSiteMembership?.id ?? `leader-worksite-${crypto.randomUUID()}`,
    businessEntityId: entity.id,
    worksiteId: worksite.id,
    accountUid,
    name,
    email,
    departmentIds: invitation.departmentIds,
    organizationIds: [...new Set([...(existingSiteMembership?.organizationIds ?? []), ...invitation.organizationIds])],
    permissions: { ...invitation.permissions },
    state: "active",
    createdAt: existingSiteMembership?.createdAt ?? now.toISOString(),
  };
  const agencyMemberships = (leaderMembership.organizationIds ?? []).flatMap((organizationId) => {
    const isOwnerScope = organizationId === entity.organizationId;
    const connection = isOwnerScope || (workspace.agencyWorksites ?? []).some((item) => item.organizationId === organizationId && item.businessEntityId === entity.id && item.worksiteId === worksite.id && item.state === "active");
    const factory = connection && workspace.factories.find((item) => item.organizationId === organizationId && item.worksiteId === worksite.id && !item.archivedAt && (isOwnerScope ? item.ownerWorkforce : !item.ownerWorkforce));
    return connection && factory ? [ensureAgencyLeaderMembership(workspace, organizationId, factory, leaderMembership)].filter((item): item is DemoMember => Boolean(item)) : [];
  });
  if (agencyMemberships.length === 0) return undefined;
  const firstMembership = agencyMemberships[0];
  const invitationResult = { ...invitation, name, state: "accepted" as const, acceptedAccountUid: accountUid, acceptedAt: now.toISOString() };
  const admin = workspace.members.find((item) => item.id === entity.adminMemberId && item.role === "factory-admin");
  publish({
    ...workspace,
    organization: workspace.organizations.find((item) => item.id === firstMembership.organizationId) ?? workspace.organization,
    leaderWorksiteMemberships: [...(workspace.leaderWorksiteMemberships ?? []).filter((item) => item.id !== leaderMembership.id), leaderMembership],
    leaderInvitations: (workspace.leaderInvitations ?? []).map((item) => item.id === invitation.id ? invitationResult : item),
    members: [...workspace.members.filter((item) => !agencyMemberships.some((membership) => membership.id === item.id)), ...agencyMemberships],
    notifications: admin ? [connectionNotification(admin.organizationId, admin.id, "leader-invitation-accepted", invitation.id), ...workspace.notifications] : workspace.notifications,
    activeMemberId: firstMembership.id,
  });
  return firstMembership;
}

export function requestLeaderWorksiteConnection(input: { businessEntityId: string; worksiteId: string; name: string; email: string }): DemoLeaderConnectionRequest | undefined {
  const workspace = readWorkspace();
  const entity = (workspace.businessEntities ?? []).find((item) => item.id === input.businessEntityId);
  const worksite = workspace.worksites?.find((item) => item.id === input.worksiteId && item.businessEntityId === entity?.id);
  const name = input.name.trim();
  const email = input.email.trim();
  const emailKey = email.toLocaleLowerCase("en-US");
  const admin = entity && workspace.members.find((member) => member.id === entity.adminMemberId && member.role === "factory-admin");
  if (!entity || !worksite || !admin || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  const pending = (workspace.leaderConnectionRequests ?? []).find((request) => request.businessEntityId === entity.id && request.worksiteId === worksite.id
    && request.email.trim().toLocaleLowerCase("en-US") === emailKey && request.state === "pending");
  if (pending) return pending;
  const existingSiteMembership = (workspace.leaderWorksiteMemberships ?? []).find((membership) => membership.businessEntityId === entity.id && membership.worksiteId === worksite.id
    && membership.email?.trim().toLocaleLowerCase("en-US") === emailKey && membership.state === "active");
  if (existingSiteMembership) return undefined;
  const existingLeader = workspace.members.find((member) => member.role === "leader" && member.email?.trim().toLocaleLowerCase("en-US") === emailKey);
  const accountUid = existingLeader?.accountUid ?? (existingLeader ? `account-${existingLeader.id}` : `account-leader-${crypto.randomUUID()}`);
  const request: DemoLeaderConnectionRequest = {
    id: `leader-request-${crypto.randomUUID()}`,
    businessEntityId: entity.id,
    worksiteId: worksite.id,
    accountUid,
    name,
    email,
    state: "pending",
    createdAt: new Date().toISOString(),
  };
  mutate((state) => ({
    ...state,
    leaderConnectionRequests: [...(state.leaderConnectionRequests ?? []), request],
    notifications: [connectionNotification(admin.organizationId, admin.id, "leader-connection-requested", request.id), ...state.notifications],
  }));
  return request;
}

export function resolveLeaderConnectionRequest(requestId: string, decision: "approve" | "decline", access?: {
  organizationIds: string[];
  departmentIds?: string[];
  permissions: DemoLeaderWorksiteMembership["permissions"];
}): boolean {
  const workspace = readWorkspace();
  const admin = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const request = (workspace.leaderConnectionRequests ?? []).find((item) => item.id === requestId && item.state === "pending");
  const worksite = request && workspace.worksites?.find((item) => item.id === request.worksiteId && item.businessEntityId === request.businessEntityId);
  if (admin.role !== "factory-admin" || !entity || !request || request.businessEntityId !== entity.id || !worksite) return false;
  const now = new Date().toISOString();
  if (decision === "decline") {
    mutate((state) => ({
      ...state,
      leaderConnectionRequests: (state.leaderConnectionRequests ?? []).map((item) => item.id === request.id ? { ...item, state: "declined" as const, resolvedByMemberId: admin.id, resolvedAt: now } : item),
    }));
    return true;
  }
  if (!access) return false;
  const availableOrganizationIds = new Set((workspace.agencyWorksites ?? []).filter((connection) => connection.businessEntityId === entity.id && connection.worksiteId === worksite.id && connection.state === "active").map((connection) => connection.organizationId));
  const ownedWorkforce = workspace.factories.some((factory) => factory.organizationId === entity.organizationId && factory.worksiteId === worksite.id && factory.ownerWorkforce && !factory.archivedAt);
  if (ownedWorkforce) availableOrganizationIds.add(entity.organizationId);
  const organizationIds = [...new Set(access.organizationIds)].filter((organizationId) => availableOrganizationIds.has(organizationId));
  if (!organizationIds.length || !access.permissions.canViewWorkers) return false;
  const departmentIds = [...new Set(access.departmentIds ?? [])].filter((departmentId) => (workspace.departments ?? []).some((department) => department.id === departmentId && department.businessEntityId === entity.id && department.worksiteId === worksite.id && !department.archivedAt));
  const previousSiteMembership = (workspace.leaderWorksiteMemberships ?? []).find((membership) => membership.businessEntityId === entity.id && membership.worksiteId === worksite.id && membership.accountUid === request.accountUid);
  const siteLeader: DemoLeaderWorksiteMembership = {
    id: previousSiteMembership?.id ?? `leader-worksite-${crypto.randomUUID()}`,
    businessEntityId: entity.id,
    worksiteId: worksite.id,
    accountUid: request.accountUid,
    name: request.name,
    email: request.email,
    organizationIds,
    departmentIds,
    permissions: { ...access.permissions },
    state: "active",
    createdAt: previousSiteMembership?.createdAt ?? now,
  };
  const agencyMemberships = organizationIds.flatMap((organizationId) => {
    const isOwnerScope = organizationId === entity.organizationId;
    const factories = workspace.factories.filter((factory) => factory.organizationId === organizationId && factory.worksiteId === worksite.id && !factory.archivedAt && (isOwnerScope ? factory.ownerWorkforce : !factory.ownerWorkforce));
    return factories.map((factory) => ensureAgencyLeaderMembership(workspace, organizationId, factory, siteLeader)).filter((member): member is DemoMember => Boolean(member));
  });
  if (!agencyMemberships.length) return false;
  const approvedRequest = { ...request, state: "approved" as const, resolvedByMemberId: admin.id, resolvedAt: now, acceptedOrganizationIds: organizationIds };
  const revokedMembershipIds = new Set(workspace.members.filter((member) => member.role === "leader" && (member.accountUid ?? member.id) === request.accountUid
    && member.factoryId && workspace.factories.some((factory) => factory.id === member.factoryId && factory.worksiteId === worksite.id && factory.organizationId === member.organizationId)
    && !organizationIds.includes(member.organizationId)).map((member) => member.id));
  mutate((state) => ({
    ...state,
    leaderConnectionRequests: (state.leaderConnectionRequests ?? []).map((item) => item.id === request.id ? approvedRequest : item),
    leaderWorksiteMemberships: [...(state.leaderWorksiteMemberships ?? []).filter((item) => item.id !== siteLeader.id), siteLeader],
    members: [
      ...state.members.filter((member) => !agencyMemberships.some((membership) => membership.id === member.id)).map((member) => revokedMembershipIds.has(member.id) ? { ...member, accessState: "revoked" as const } : member),
      ...agencyMemberships,
    ],
  }));
  return true;
}

export function getBusinessWorksiteRoster(worksiteId: string, filters: { organizationId?: string; departmentId?: string; leaderAccountUid?: string; search?: string; workerCategory?: "agency" | "factory"; workerStatus?: "all" | "active" | "away" } = {}): DemoBusinessWorksiteRosterEntry[] {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const businessEntity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === worksiteId);
  if (!site || !businessEntity || site.businessEntityId !== businessEntity.id) return [];
  const leaderAccountUid = actor.role === "leader" ? actor.accountUid ?? actor.id : undefined;
  const siteLeaderMembership = leaderAccountUid ? (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === businessEntity.id && item.worksiteId === worksiteId && item.accountUid === leaderAccountUid && item.state === "active" && item.permissions.canViewWorkers) : undefined;
  if (actor.role !== "factory-admin" && !siteLeaderMembership) return [];
  const connectedOrganizationIds = new Set((workspace.agencyWorksites ?? []).filter((item) => item.businessEntityId === businessEntity.id && item.worksiteId === worksiteId && item.state === "active").map((item) => item.organizationId));
  const ownedFactories = workspace.factories.filter((factory) => factory.organizationId === businessEntity.organizationId && factory.worksiteId === worksiteId && factory.ownerWorkforce && !factory.archivedAt);
  if (ownedFactories.length) connectedOrganizationIds.add(businessEntity.organizationId);
  const scopedOrganizationIds = filters.organizationId
    ? new Set(connectedOrganizationIds.has(filters.organizationId) ? [filters.organizationId] : [])
    : connectedOrganizationIds;
  const today = todayDate();
  const needle = filters.search?.trim().toLocaleLowerCase("en-US");
  const rows: DemoBusinessWorksiteRosterEntry[] = [];
  for (const connection of (workspace.agencyWorksites ?? []).filter((item) => {
    if (item.businessEntityId !== businessEntity.id || item.worksiteId !== worksiteId || item.state !== "active" || !scopedOrganizationIds.has(item.organizationId)) return false;
    if (actor.role !== "leader") return actor.role === "factory-admin";
    if (!siteLeaderMembership?.organizationIds?.includes(item.organizationId)) return false;
    const leaderMembership = workspace.members.find((member) => member.role === "leader" && member.organizationId === item.organizationId
      && (member.accountUid ?? member.id) === leaderAccountUid && member.accessState !== "suspended" && member.accessState !== "revoked"
      && workspace.factories.some((factory) => factory.id === member.factoryId && factory.organizationId === item.organizationId && factory.worksiteId === worksiteId));
    return Boolean(leaderMembership && effectiveLeaderPermissions(leaderMembership).canViewWorkers);
  })) {
    const agency = workspace.organizations.find((item) => item.id === connection.organizationId);
    if (!agency) continue;
    const factories = workspace.factories.filter((factory) => factory.organizationId === connection.organizationId && factory.worksiteId === worksiteId && !factory.archivedAt);
    for (const factory of factories) {
      const periods = workspace.employmentPeriods.filter((period) => period.organizationId === connection.organizationId && period.state === "active" && period.startDate <= today && (!period.endDate || period.endDate >= today));
      for (const period of periods) {
        const placement = period.placements.find((item) => item.factoryId === factory.id && item.startDate <= today && (!item.endDate || item.endDate >= today));
        if (!placement) continue;
        const worker = workspace.members.find((member) => member.id === period.workerId && member.organizationId === connection.organizationId && member.role === "worker");
        if (!worker || filters.workerCategory === "factory" || filters.workerStatus && filters.workerStatus !== "all" && worker.status !== filters.workerStatus || filters.departmentId && placement.departmentId !== filters.departmentId) continue;
        const accountUid = placement.leaderAccountUid ?? workspace.members.find((member) => member.id === placement.leaderId && member.organizationId === connection.organizationId)?.accountUid;
        if (filters.leaderAccountUid && accountUid !== filters.leaderAccountUid
          || siteLeaderMembership && !siteLeaderMembership.permissions.canManageGroups && accountUid !== leaderAccountUid
          || siteLeaderMembership?.departmentIds.length && !siteLeaderMembership.departmentIds.includes(placement.departmentId ?? "")) continue;
        if (needle && !`${worker.name} ${agency.name} ${factory.name}`.toLocaleLowerCase("en-US").includes(needle)) continue;
        rows.push({
          worksiteId,
          organizationId: connection.organizationId,
          organizationName: agency.name,
          factoryId: factory.id,
          factoryName: factory.name,
          worker,
          workerCategory: "agency",
          employmentId: period.id,
          departmentId: placement.departmentId,
          departmentName: workspace.departments?.find((department) => department.id === placement.departmentId)?.name,
          leaderAccountUid: accountUid,
          leaderName: workspace.members.find((member) => member.role === "leader" && member.organizationId === connection.organizationId && member.factoryId === factory.id && (member.accountUid ?? member.id) === accountUid)?.name,
        });
      }
    }
  }
  for (const factory of ownedFactories) {
    if (filters.workerCategory === "agency" || filters.organizationId && filters.organizationId !== businessEntity.organizationId) continue;
    if (actor.role === "leader") {
      if (!siteLeaderMembership?.organizationIds?.includes(businessEntity.organizationId)) continue;
      const localMembership = workspace.members.find((member) => member.role === "leader" && member.organizationId === businessEntity.organizationId && member.factoryId === factory.id
        && (member.accountUid ?? member.id) === leaderAccountUid && member.accessState !== "suspended" && member.accessState !== "revoked" && effectiveLeaderPermissions(member).canViewWorkers);
      if (!localMembership) continue;
    }
    const periods = workspace.employmentPeriods.filter((period) => period.organizationId === businessEntity.organizationId && period.state === "active" && period.startDate <= today && (!period.endDate || period.endDate >= today));
    for (const period of periods) {
      const placement = period.placements.find((item) => item.factoryId === factory.id && item.startDate <= today && (!item.endDate || item.endDate >= today));
      const worker = workspace.members.find((member) => member.id === period.workerId && member.organizationId === businessEntity.organizationId && member.role === "worker" && member.workerCategory === "factory" && member.businessEntityId === businessEntity.id);
      if (!placement || !worker || filters.workerStatus && filters.workerStatus !== "all" && worker.status !== filters.workerStatus || filters.departmentId && placement.departmentId !== filters.departmentId) continue;
      const accountUid = placement.leaderAccountUid ?? workspace.members.find((member) => member.id === placement.leaderId && member.organizationId === businessEntity.organizationId)?.accountUid;
      if (filters.leaderAccountUid && accountUid !== filters.leaderAccountUid
        || siteLeaderMembership && !siteLeaderMembership.permissions.canManageGroups && accountUid !== leaderAccountUid
        || siteLeaderMembership?.departmentIds.length && !siteLeaderMembership.departmentIds.includes(placement.departmentId ?? "")) continue;
      if (needle && !`${worker.name} ${businessEntity.name} ${factory.name}`.toLocaleLowerCase("en-US").includes(needle)) continue;
      rows.push({
        worksiteId,
        organizationId: businessEntity.organizationId,
        organizationName: businessEntity.name,
        factoryId: factory.id,
        factoryName: factory.name,
        worker,
        workerCategory: "factory",
        employmentId: period.id,
        departmentId: placement.departmentId,
        departmentName: workspace.departments?.find((department) => department.id === placement.departmentId)?.name,
        leaderAccountUid: accountUid,
        leaderName: workspace.members.find((member) => member.role === "leader" && member.organizationId === businessEntity.organizationId && member.factoryId === factory.id && (member.accountUid ?? member.id) === accountUid)?.name,
      });
    }
  }
  return rows;
}

/** Read-only common actual-time summary. Rows stay separated by agency and production. */
export function getBusinessWorksiteActualSummary(worksiteId: string, month: string): Array<{
  organizationId: string;
  organizationName: string;
  factoryId: string;
  factoryName: string;
  workerCategory: "agency" | "factory";
  shiftCount: number;
  workerCount: number;
  paidMinutes: number;
}> {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === worksiteId && item.businessEntityId === entity?.id);
  if (!entity || !site || !/^\d{4}-\d{2}$/.test(month) || actor.role !== "factory-admin") return [];
  const rows: Array<{ organizationId: string; organizationName: string; factoryId: string; factoryName: string; workerCategory: "agency" | "factory"; shiftCount: number; workerCount: number; paidMinutes: number }> = [];
  for (const connection of (workspace.agencyWorksites ?? []).filter((item) => item.businessEntityId === entity.id && item.worksiteId === worksiteId && item.state === "active")) {
    const organization = workspace.organizations.find((item) => item.id === connection.organizationId);
    if (!organization) continue;
    for (const factory of workspace.factories.filter((item) => item.organizationId === connection.organizationId && item.worksiteId === worksiteId && !item.archivedAt)) {
      const records = uniqueFactualShiftRecords(workspace.shifts.filter((record) => record.organizationId === connection.organizationId && record.shift.factoryId === factory.id
        && record.shift.localStartDate.startsWith(`${month}-`) && !record.shift.deletedAt));
      rows.push({
        organizationId: connection.organizationId,
        organizationName: organization.name,
        factoryId: factory.id,
        factoryName: factory.name,
        workerCategory: "agency",
        shiftCount: records.length,
        workerCount: new Set(records.map((record) => record.shift.workerUid)).size,
        paidMinutes: records.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
      });
    }
  }
  for (const factory of workspace.factories.filter((item) => item.organizationId === entity.organizationId && item.worksiteId === worksiteId && item.ownerWorkforce && !item.archivedAt)) {
    const records = uniqueFactualShiftRecords(workspace.shifts.filter((record) => record.organizationId === entity.organizationId && record.shift.factoryId === factory.id
      && record.shift.localStartDate.startsWith(`${month}-`) && !record.shift.deletedAt));
    rows.push({
      organizationId: entity.organizationId,
      organizationName: entity.name,
      factoryId: factory.id,
      factoryName: factory.name,
      workerCategory: "factory",
      shiftCount: records.length,
      workerCount: new Set(records.map((record) => record.shift.workerUid)).size,
      paidMinutes: records.reduce((sum, record) => sum + record.shift.paidDurationMinutes, 0),
    });
  }
  return rows;
}

export function assignBusinessWorkerToTeam(input: { worksiteId: string; workerId: string; departmentId?: string; leaderAccountUid?: string; groupId?: string }): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const businessEntity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === input.worksiteId && item.businessEntityId === businessEntity?.id);
  if (!site || !businessEntity) return false;
  const siteLeader = input.leaderAccountUid ? (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.accountUid === input.leaderAccountUid && item.state === "active") : undefined;
  if (actor.role === "factory-admin") {
    if (actor.businessEntityId !== businessEntity.id) return false;
  } else if (actor.role === "leader") {
    const actorAccountUid = actor.accountUid ?? actor.id;
    const actorSiteMembership = (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.accountUid === actorAccountUid && item.state === "active" && item.permissions.canManageGroups);
    if (!actorSiteMembership?.organizationIds?.includes(actor.organizationId)) return false;
    const actorAgencyMembership = workspace.members.find((item) => item.role === "leader" && item.organizationId === actor.organizationId && item.factoryId === actor.factoryId
      && (item.accountUid ?? item.id) === actorAccountUid && item.accessState !== "suspended" && item.accessState !== "revoked" && effectiveLeaderPermissions(item).canManageGroups);
    if (!actorSiteMembership || !actorAgencyMembership || !actor.factoryId || !workspace.factories.some((item) => item.id === actor.factoryId && item.organizationId === actor.organizationId && item.worksiteId === site.id)) return false;
    if (input.leaderAccountUid && input.leaderAccountUid !== actorAccountUid) return false;
  } else return false;
  if (input.departmentId && !(workspace.departments ?? []).some((item) => item.id === input.departmentId && item.businessEntityId === businessEntity.id && item.worksiteId === site.id && !item.archivedAt)) return false;
  if (input.leaderAccountUid && (!siteLeader || input.departmentId && siteLeader.departmentIds.length && !siteLeader.departmentIds.includes(input.departmentId))) return false;

  const worker = workspace.members.find((member) => member.id === input.workerId && member.role === "worker");
  if (!worker) return false;
  const workerOrganization = workspace.organizations.find((item) => item.id === worker.organizationId);
  const workerCategory = worker.workerCategory ?? (workerOrganization?.type === "factory" ? "factory" : "agency");
  const hasAgencyConnection = (workspace.agencyWorksites ?? []).some((item) => item.organizationId === worker.organizationId && item.businessEntityId === businessEntity.id && item.worksiteId === site.id && item.state === "active");
  const isOwnedWorker = workerCategory === "factory" && worker.businessEntityId === businessEntity.id && worker.organizationId === businessEntity.organizationId;
  if (workerCategory === "agency" && !hasAgencyConnection || workerCategory === "factory" && !isOwnedWorker) return false;
  if (input.leaderAccountUid && !siteLeader?.organizationIds?.includes(worker.organizationId)) return false;
  const factory = workspace.factories.find((item) => item.organizationId === worker.organizationId && item.worksiteId === site.id && !item.archivedAt
    && (workerCategory === "factory" ? item.ownerWorkforce : !item.ownerWorkforce));
  const period = workspace.employmentPeriods.find((item) => item.organizationId === worker.organizationId && item.workerId === worker.id && item.state === "active");
  const today = todayDate();
  const placement = factory && period?.placements.find((item) => item.factoryId === factory.id && item.startDate <= today && (!item.endDate || item.endDate >= today));
  if (!factory || !period || !placement) return false;
  const existingLeaderMembership = input.leaderAccountUid ? workspace.members.find((item) => item.role === "leader" && item.organizationId === worker.organizationId && item.factoryId === factory.id && (item.accountUid ?? item.id) === input.leaderAccountUid) : undefined;
  if (input.leaderAccountUid && !siteLeader?.permissions.canViewWorkers) return false;
  if (input.leaderAccountUid && actor.role === "leader" && input.leaderAccountUid !== (actor.accountUid ?? actor.id)) return false;
  const leaderMembership = input.leaderAccountUid
    ? existingLeaderMembership && existingLeaderMembership.accessState !== "suspended" && existingLeaderMembership.accessState !== "revoked"
      ? existingLeaderMembership
      : actor.role === "factory-admin" ? ensureAgencyLeaderMembership(workspace, worker.organizationId, factory, siteLeader!) : undefined
    : undefined;
  if (input.leaderAccountUid && !leaderMembership) return false;

  const requestedGroup = input.groupId ? workspace.groups.find((item) => item.id === input.groupId && item.organizationId === worker.organizationId && item.factoryId === factory.id && item.departmentId === input.departmentId && !item.archivedAt) : undefined;
  if (input.groupId && (!requestedGroup || requestedGroup.leaderId !== leaderMembership?.id)) return false;
  let group = requestedGroup ?? (input.departmentId ? workspace.groups.find((item) => item.organizationId === worker.organizationId && item.factoryId === factory.id && item.departmentId === input.departmentId && !item.archivedAt) : undefined);
  const now = new Date().toISOString();
  if (input.departmentId && !group) {
    const department = workspace.departments?.find((item) => item.id === input.departmentId);
    if (!department) return false;
    group = { id: `group-${crypto.randomUUID()}`, organizationId: worker.organizationId, factoryId: factory.id, leaderId: leaderMembership?.id, departmentId: department.id, name: department.name };
  }
  const nextLeaderId = leaderMembership?.id;
  const changedLeader = (placement.leaderAccountUid ?? workspace.members.find((item) => item.id === placement.leaderId)?.accountUid) !== input.leaderAccountUid;
  const changedDepartment = placement.departmentId !== input.departmentId;
  const changedGroup = placement.groupId !== group?.id;
  if (!changedLeader && !changedDepartment && !changedGroup) return true;
  const action = changedLeader ? "leader-changed" as const : changedDepartment ? "department-changed" as const : "group-changed" as const;
  const historyEvent = { id: `employment-event-${crypto.randomUUID()}`, actorId: actor.id, action, occurredAt: now, note: input.departmentId ? workspace.departments?.find((item) => item.id === input.departmentId)?.name : undefined };
  const nextPlacement = { ...placement, groupId: group?.id, leaderId: nextLeaderId, leaderAccountUid: input.leaderAccountUid, departmentId: input.departmentId };
  const assignments = [...(worker.productionAssignments ?? [])].filter((item) => item.factoryId !== factory.id);
  assignments.push({ factoryId: factory.id, groupId: group?.id, leaderId: nextLeaderId, leaderAccountUid: input.leaderAccountUid, departmentId: input.departmentId });
  const oldLeaderUid = placement.leaderAccountUid ?? workspace.members.find((item) => item.id === placement.leaderId)?.accountUid;
  const oldMembership = oldLeaderUid && workspace.members.find((item) => item.role === "leader" && item.organizationId === worker.organizationId && item.factoryId === factory.id && (item.accountUid ?? item.id) === oldLeaderUid);
  const accessRows = [...(workspace.leaderWorkerAccess ?? [])];
  if (oldMembership && oldLeaderUid !== input.leaderAccountUid) accessRows.push({ id: `leader-access-${crypto.randomUUID()}`, leaderMembershipId: oldMembership.id, organizationId: worker.organizationId, factoryId: factory.id, workerId: worker.id, state: "removed", changedAt: now, changedById: actor.id });
  if (leaderMembership && !accessRows.some((item) => item.leaderMembershipId === leaderMembership.id && item.organizationId === worker.organizationId && item.factoryId === factory.id && item.workerId === worker.id && item.state === "active")) accessRows.push({ id: `leader-access-${crypto.randomUUID()}`, leaderMembershipId: leaderMembership.id, organizationId: worker.organizationId, factoryId: factory.id, workerId: worker.id, state: "active", changedAt: now, changedById: actor.id });
  const agencyAccount = workerCategory === "agency" ? workspace.members.find((item) => item.organizationId === worker.organizationId && item.role === "agency") : undefined;
  const notices = [
    connectionNotification(businessEntity.organizationId, businessEntity.adminMemberId, "worksite-worker-assigned", period.id),
    connectionNotification(worker.organizationId, worker.id, "worksite-worker-assigned", period.id),
    ...(agencyAccount ? [connectionNotification(worker.organizationId, agencyAccount.id, "worksite-worker-assigned", period.id)] : []),
    ...(leaderMembership ? [connectionNotification(worker.organizationId, leaderMembership.id, "worksite-worker-assigned", period.id)] : []),
  ];
  mutate((state) => ({
    ...state,
    groups: group && !state.groups.some((item) => item.id === group!.id) ? [...state.groups, group] : state.groups,
    employmentPeriods: state.employmentPeriods.map((item) => item.id === period.id ? { ...item, placements: item.placements.map((current) => current.id === placement.id ? nextPlacement : current), history: [...item.history, historyEvent] } : item),
    members: [
      ...state.members.map((item) => item.id === worker.id && item.organizationId === worker.organizationId ? { ...item, productionAssignments: assignments, factoryId: factory.id, groupId: group?.id, leaderId: nextLeaderId, departmentId: input.departmentId, leaderAccountUid: input.leaderAccountUid } : item),
      ...(leaderMembership && !state.members.some((item) => item.id === leaderMembership.id) ? [leaderMembership] : []),
    ],
    leaderWorkerAccess: accessRows,
    notifications: [...notices, ...state.notifications],
  }));
  return true;
}

/** Create or reuse an employer-scoped group, then assign the selected site workers in the same workflow. */
export function createBusinessGroupForWorkers(input: { worksiteId: string; workerIds: string[]; name: string; departmentId?: string; leaderAccountUid?: string }): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === input.worksiteId && item.businessEntityId === entity?.id);
  const cleanName = input.name.trim();
  const workerIds = [...new Set(input.workerIds)];
  if (!entity || !site || actor.role !== "factory-admin" && actor.role !== "leader" || !cleanName || workerIds.length === 0) return false;
  if (actor.role === "factory-admin" && actor.businessEntityId !== entity.id) return false;
  const department = input.departmentId ? (workspace.departments ?? []).find((item) => item.id === input.departmentId && item.businessEntityId === entity.id && item.worksiteId === site.id && !item.archivedAt) : undefined;
  if (input.departmentId && !department) return false;
  const roster = getBusinessWorksiteRoster(site.id);
  const selectedRows = workerIds.flatMap((workerId) => { const row = roster.find((item) => item.worker.id === workerId); return row ? [row] : []; });
  if (selectedRows.length !== workerIds.length) return false;
  const organizationId = selectedRows[0].organizationId;
  const factoryId = selectedRows[0].factoryId;
  if (selectedRows.some((row) => row.organizationId !== organizationId || row.factoryId !== factoryId)) return false;
  const leaderAccountUid = actor.role === "leader" ? actor.accountUid ?? actor.id : input.leaderAccountUid;
  const siteLeader = leaderAccountUid ? (workspace.leaderWorksiteMemberships ?? []).find((item) => item.businessEntityId === entity.id && item.worksiteId === site.id && item.accountUid === leaderAccountUid && item.state === "active") : undefined;
  if (leaderAccountUid && (!siteLeader?.permissions.canViewWorkers || !siteLeader.organizationIds?.includes(organizationId) || department && siteLeader.departmentIds.length > 0 && !siteLeader.departmentIds.includes(department.id))) return false;
  if (actor.role === "leader") {
    const actorUid = actor.accountUid ?? actor.id;
    const siteScope = siteLeader?.accountUid === actorUid && siteLeader.permissions.canManageGroups;
    const agencyScope = workspace.members.some((item) => item.role === "leader" && item.organizationId === actor.organizationId && item.factoryId === actor.factoryId && (item.accountUid ?? item.id) === actorUid && item.accessState !== "suspended" && item.accessState !== "revoked" && effectiveLeaderPermissions(item).canManageGroups);
    const canManageAll = workspace.members.some((item) => item.role === "leader" && item.organizationId === actor.organizationId && item.factoryId === actor.factoryId && (item.accountUid ?? item.id) === actorUid && item.canManageAllWorkers);
    if (!siteScope || !agencyScope || selectedRows.some((row) => row.leaderAccountUid && row.leaderAccountUid !== actorUid && !canManageAll)) return false;
  }
  if (department && siteLeader?.departmentIds.length && !siteLeader.departmentIds.includes(department.id)) return false;
  const factory = workspace.factories.find((item) => item.id === factoryId && item.organizationId === organizationId && item.worksiteId === site.id);
  if (!factory) return false;
  const existingLeader = leaderAccountUid ? workspace.members.find((item) => item.role === "leader" && item.organizationId === organizationId && item.factoryId === factory.id && (item.accountUid ?? item.id) === leaderAccountUid) : undefined;
  const leaderMembership = leaderAccountUid
    ? existingLeader && existingLeader.accessState !== "suspended" && existingLeader.accessState !== "revoked"
      ? existingLeader
      : actor.role === "factory-admin" && siteLeader ? ensureAgencyLeaderMembership(workspace, organizationId, factory, siteLeader) : undefined
    : undefined;
  if (leaderAccountUid && !leaderMembership) return false;
  const nameKey = cleanName.toLocaleLowerCase("en-US");
  const existingGroup = workspace.groups.find((item) => item.organizationId === organizationId && item.factoryId === factory.id && item.departmentId === department?.id && item.name.trim().toLocaleLowerCase("en-US") === nameKey && !item.archivedAt && item.leaderId === leaderMembership?.id);
  const group = existingGroup ?? { id: `group-${crypto.randomUUID()}`, organizationId, factoryId: factory.id, leaderId: leaderMembership?.id, departmentId: department?.id, name: cleanName };
  mutate((state) => ({
    ...state,
    groups: state.groups.some((item) => item.id === group.id) ? state.groups : [...state.groups, group],
    ...(leaderMembership && !state.members.some((item) => item.id === leaderMembership.id) ? { members: [...state.members, leaderMembership] } : {}),
  }));
  return workerIds.every((workerId) => assignBusinessWorkerToTeam({ worksiteId: site.id, workerId, departmentId: department?.id, leaderAccountUid, groupId: group.id }));
}

export function resetDemoWorkspace(confirmed: boolean): boolean {
  if (previewAccount) return false;
  if (!confirmed) return false;
  const current = readWorkspace();
  const activeMember = current.members.find((member) => member.id === current.activeMemberId);
  if (activeMember?.role !== "agency") return false;
  const targetOrganization = current.organizations.find((organization) => organization.id === activeMember.organizationId);
  const seed = createSeedWorkspace();
  const seededOrganization = seed.organizations.find((organization) => organization.id === targetOrganization?.id);
  const seededAgency = seed.members.find((member) => member.organizationId === targetOrganization?.id && member.role === "agency");
  if (!targetOrganization || !seededOrganization || !seededAgency) return false;

  const preservedAgency = current.members.find((member) => member.id === seededAgency.id && member.organizationId === targetOrganization.id && member.role === "agency") ?? seededAgency;
  const alreadyHasPreservedAgency = current.members.some((member) => member.id === preservedAgency.id && member.organizationId === targetOrganization.id);
  const organizationReferenceFields = ["organizationId", "agencyId", "agencyOrganizationId", "requestingOrganizationId", "requesterOrganizationId", "sourceOrganizationId", "targetOrganizationId", "fromOrganizationId", "toOrganizationId"];
  const removedFactoryWorksiteIds = new Set(current.factories.filter((factory) => factory.organizationId === targetOrganization.id).map((factory) => factory.worksiteId).filter((id): id is string => Boolean(id)));
  for (const worksite of current.worksites ?? []) {
    if (organizationReferenceFields.some((field) => (worksite as unknown as Record<string, unknown>)[field] === targetOrganization.id)) removedFactoryWorksiteIds.add(worksite.id);
  }
  for (const [key, value] of Object.entries(current)) {
    if (["organization", "organizations", "members", "factories", "worksites"].includes(key) || !Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const linkedWorksiteId = row.worksiteId ?? row.siteId;
      if (typeof linkedWorksiteId === "string" && organizationReferenceFields.some((field) => row[field] === targetOrganization.id)) removedFactoryWorksiteIds.add(linkedWorksiteId);
    }
  }
  const survivingFactories = current.factories.filter((factory) => factory.organizationId !== targetOrganization.id);
  const base: DemoWorkspace = {
    ...current,
    factories: survivingFactories,
    members: [...current.members.filter((member) => member.organizationId !== targetOrganization.id || member.id === preservedAgency.id), ...(alreadyHasPreservedAgency ? [] : [preservedAgency])],
    groups: current.groups.filter((group) => group.organizationId !== targetOrganization.id),
    folders: (current.folders ?? []).filter((folder) => folder.organizationId !== targetOrganization.id),
    leaderWorkerAccess: (current.leaderWorkerAccess ?? []).filter((entry) => entry.organizationId !== targetOrganization.id),
    shifts: current.shifts.filter((record) => record.organizationId !== targetOrganization.id),
    templates: current.templates.filter((template) => template.organizationId !== targetOrganization.id),
    absences: current.absences.filter((absence) => absence.organizationId !== targetOrganization.id),
    employmentPeriods: current.employmentPeriods.filter((period) => period.organizationId !== targetOrganization.id),
    messageThreads: current.messageThreads.filter((thread) => thread.organizationId !== targetOrganization.id),
    schedules: current.schedules.filter((schedule) => schedule.organizationId !== targetOrganization.id),
    scheduleAttendanceReviews: current.scheduleAttendanceReviews.filter((review) => review.organizationId !== targetOrganization.id),
    monthlyTimesheets: (current.monthlyTimesheets ?? []).filter((timesheet) => timesheet.organizationId !== targetOrganization.id),
    changeRequests: (current.changeRequests ?? []).filter((request) => request.organizationId !== targetOrganization.id),
    notifications: current.notifications.filter((notification) => notification.organizationId !== targetOrganization.id),
    activeMemberId: preservedAgency.id,
  };
  const globallyScopedCollections = new Set(["organization", "organizations", "members", "factories", "worksites"]);
  const cleared = { ...base } as DemoWorkspace & Record<string, unknown>;
  for (const [key, value] of Object.entries(base)) {
    if (globallyScopedCollections.has(key) || !Array.isArray(value)) continue;
    cleared[key] = value.filter((item) => {
      if (!item || typeof item !== "object") return true;
      const row = item as Record<string, unknown>;
      return !organizationReferenceFields.some((field) => row[field] === targetOrganization.id);
    });
  }
  const remainingWorksiteIds = new Set(survivingFactories.map((factory) => factory.worksiteId).filter((id): id is string => Boolean(id)));
  for (const [key, value] of Object.entries(cleared)) {
    if (globallyScopedCollections.has(key) || !Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const linkedWorksiteId = row.worksiteId ?? row.siteId;
      if (typeof linkedWorksiteId === "string") remainingWorksiteIds.add(linkedWorksiteId);
    }
  }
  const targetWorksiteIds = new Set(removedFactoryWorksiteIds);
  const organizations = current.organizations.map((organization) => organization.id === seededOrganization.id ? { ...organization, name: seededOrganization.name } : organization);
  const next: DemoWorkspace = {
    ...cleared,
    organization: organizations.find((organization) => organization.id === targetOrganization.id) ?? targetOrganization,
    organizations,
    worksites: (current.worksites ?? []).filter((worksite) => !targetWorksiteIds.has(worksite.id) || remainingWorksiteIds.has(worksite.id)),
  };
  if (typeof window !== "undefined") {
    try {
      const previous = window.localStorage.getItem(STORAGE_KEY);
      const serialized = JSON.stringify(next);
      if (previous !== null && previous !== serialized) {
        const backupBase = `${STORAGE_KEY}-backup-${Date.now()}`;
        let backupKey = backupBase;
        let suffix = 1;
        while (window.localStorage.getItem(backupKey) !== null) backupKey = `${backupBase}-${suffix++}`;
        window.localStorage.setItem(backupKey, previous);
        if (window.localStorage.getItem(backupKey) !== previous) return false;
      }
      if (previous !== serialized) {
        window.localStorage.setItem(STORAGE_KEY, serialized);
        if (window.localStorage.getItem(STORAGE_KEY) !== serialized) return false;
      }
    } catch {
      return false;
    }
  }
  storageWritesBlocked = false;
  snapshot = next;
  listeners.forEach((listener) => listener());
  return true;
}

function draftTimeZone(draft: ShiftDraft): string {
  const workspace = readWorkspace();
  const factory = workspace.factories.find((item) => item.id === draft.factoryId);
  return workspace.organizations.find((item) => item.id === factory?.organizationId)?.timezone ?? workspace.organization.timezone;
}

function nextDate(date: string): string { return nextLocalDate(date); }

function todayDate(): string {
  const value = new Date();
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

export interface ShiftDraft {
  factoryId?: string;
  localDate: string;
  startTime: string;
  endTime: string;
  comment: string;
  breakStatus: ActualBreakReport["status"];
  breakTreatment?: "paid" | "unpaid";
  breakDurationMinutes?: number;
  breakStartTime?: string;
  breakEndTime?: string;
  plannedBreakStart?: string;
  plannedBreakEnd?: string;
  plannedBreakTreatment?: "paid" | "unpaid";
  plannedBreakDurationMinutes?: number;
}

export function isValidShiftDraft(draft: ShiftDraft): boolean {
  const dateTime = (date: string, time: string) => zonedDateTime(date, time, draftTimeZone(draft));
  const parsedDate = new Date(`${draft.localDate}T12:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.localDate) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0,10) === draft.localDate;
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!validDate || !validTime(draft.startTime) || !validTime(draft.endTime) || draft.startTime === draft.endTime) return false;
  const start = dateTime(draft.localDate, draft.startTime);
  const endDate = draft.endTime <= draft.startTime ? nextDate(draft.localDate) : draft.localDate;
  const end = dateTime(endDate, draft.endTime);
  const gross = (end.getTime() - start.getTime()) / 60000;
  if (!Number.isFinite(gross) || gross <= 0 || gross > 24 * 60) return false;
  if (draft.breakStatus !== "taken") return true;
  if ((draft.breakTreatment ?? "unpaid") === "paid" && (!draft.breakStartTime || !draft.breakEndTime)) return true;
  if ((draft.breakTreatment ?? "unpaid") === "unpaid" && (!draft.breakStartTime || !draft.breakEndTime)) {
    const minutes = Number(draft.breakDurationMinutes);
    return Number.isInteger(minutes) && minutes > 0 && minutes <= gross;
  }
  if (!draft.breakStartTime || !draft.breakEndTime || !validTime(draft.breakStartTime) || !validTime(draft.breakEndTime)) return false;
  const breakDate = draft.breakStartTime < draft.startTime ? endDate : draft.localDate;
  const breakStart = dateTime(breakDate, draft.breakStartTime);
  const breakEndDate = draft.breakEndTime <= draft.breakStartTime ? nextDate(breakDate) : breakDate;
  const breakEnd = dateTime(breakEndDate, draft.breakEndTime);
  const breakMinutes = (breakEnd.getTime() - breakStart.getTime()) / 60000;
  return breakMinutes > 0 && breakMinutes <= gross && breakStart >= start && breakEnd <= end;
}

function hasWorkerShiftConflict(workspace: DemoWorkspace, organizationId: string, workerId: string, exceptShiftId: string, startAt: string, endAt: string): boolean {
  return workspace.shifts.some(({ organizationId: shiftOrganizationId, shift }) => shiftOrganizationId === organizationId
    && shift.workerUid === workerId && shift.id !== exceptShiftId && !shift.deletedAt
    && shift.startAt < endAt && startAt < shift.endAt);
}

function deriveValues(draft: ShiftDraft): DemoShiftValues {
  const dateTime = (date: string, time: string) => zonedDateTime(date, time, draftTimeZone(draft));
  const start = dateTime(draft.localDate, draft.startTime);
  const endDate = draft.endTime <= draft.startTime ? nextDate(draft.localDate) : draft.localDate;
  const end = dateTime(endDate, draft.endTime);
  let breakStart: Date | undefined;
  let breakEnd: Date | undefined;
  let totalBreakMinutes = 0;
  let unpaidBreakMinutes = 0;
  const breakTreatment = draft.breakTreatment ?? "unpaid";
  if (draft.breakStatus === "taken" && draft.breakStartTime && draft.breakEndTime) {
    const breakDate = draft.breakStartTime < draft.startTime ? endDate : draft.localDate;
    breakStart = dateTime(breakDate, draft.breakStartTime);
    const breakEndDate = draft.breakEndTime <= draft.breakStartTime ? nextDate(breakDate) : breakDate;
    breakEnd = dateTime(breakEndDate, draft.breakEndTime);
    totalBreakMinutes = Math.max(0, Math.round((breakEnd.getTime() - breakStart.getTime()) / 60000));
  } else if (draft.breakStatus === "taken" && draft.breakDurationMinutes) {
    totalBreakMinutes = Math.max(0, Math.round(draft.breakDurationMinutes));
  }
  if (draft.breakStatus === "taken" && breakTreatment === "unpaid") unpaidBreakMinutes = totalBreakMinutes;
  const grossDurationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  return {
    localDate: draft.localDate,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    comment: draft.comment.trim(),
    breakStatus: draft.breakStatus,
    breakTreatment,
    breakStartAt: breakStart?.toISOString(),
    breakEndAt: breakEnd?.toISOString(),
    grossDurationMinutes,
    paidDurationMinutes: Math.max(0, grossDurationMinutes - unpaidBreakMinutes),
    unpaidBreakDurationMinutes: unpaidBreakMinutes,
    totalBreakDurationMinutes: totalBreakMinutes,
  };
}

function valuesFromShift(shift: Shift): DemoShiftValues {
  return {
    localDate: shift.localStartDate,
    startAt: shift.startAt,
    endAt: shift.endAt,
    comment: shift.comment ?? "",
    breakStatus: shift.actualBreak.status,
    breakTreatment: shift.actualBreak.segments[0]?.treatment ?? shift.actualBreak.treatment ?? (shift.totalBreakDurationMinutes > 0 && shift.unpaidBreakDurationMinutes === 0 ? "paid" : "unpaid"),
    totalBreakDurationMinutes: shift.totalBreakDurationMinutes,
    breakStartAt: shift.actualBreak.segments[0]?.startAt,
    breakEndAt: shift.actualBreak.segments[0]?.endAt,
    grossDurationMinutes: shift.grossDurationMinutes,
    paidDurationMinutes: shift.paidDurationMinutes,
    unpaidBreakDurationMinutes: shift.unpaidBreakDurationMinutes,
  };
}

function shiftFromDraft(workerId: string, draft: ShiftDraft, source: Shift["source"], actorId: string, requiresReview: boolean, confirmation: Shift["workerConfirmation"]): Shift {
  const workspace = readWorkspace();
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker")!;
  const factoryId = draft.factoryId ?? worker.factoryId;
  const factory = getFactoryInOrganization(workspace, worker.organizationId, factoryId ?? "");
  const organization = workspace.organizations.find((item) => item.id === worker.organizationId) ?? workspace.organization;
  const values = deriveValues(draft);
  const now = new Date().toISOString();
  const actualBreak: ActualBreakReport = {
    status: values.breakStatus,
    treatment: values.breakStatus === "taken" ? values.breakTreatment : undefined,
    segments: values.breakStatus === "taken" && values.breakStartAt && values.breakEndAt
      ? [{ startAt: values.breakStartAt, endAt: values.breakEndAt, treatment: values.breakTreatment ?? "unpaid", durationMinutes: values.totalBreakDurationMinutes ?? 0 }]
      : [],
    reportedByUid: values.breakStatus === "not-reported" ? undefined : actorId,
    reportedAt: values.breakStatus === "not-reported" ? undefined : now,
    reviewState: requiresReview ? "pending" : "not-required",
  };
  return {
    id: `shift-${crypto.randomUUID()}`,
    workerUid: workerId,
    agencyId: worker.organizationId,
    factoryId,
    folderId: worker.folderId,
    localStartDate: values.localDate,
    startAt: values.startAt,
    endAt: values.endAt,
    timeZone: organization.timezone,
    grossDurationMinutes: values.grossDurationMinutes,
    totalBreakDurationMinutes: values.totalBreakDurationMinutes ?? 0,
    unpaidBreakDurationMinutes: values.unpaidBreakDurationMinutes,
    paidDurationMinutes: values.paidDurationMinutes,
    actualBreak,
    breakPolicySnapshot: {
      appliedRuleIds: factory?.requiredBreakMinutes ? [`policy-${factory.id}`] : [],
      required: Boolean(factory?.requiredBreakMinutes),
      allowedTreatments: factory?.requiredBreakMinutes && factory.requiredBreakTreatment ? [factory.requiredBreakTreatment] : ["paid", "unpaid"],
      workerMayEditActualTimes: factory?.allowActualBreakReport !== false,
      workerMayChooseTreatment: !factory?.requiredBreakMinutes,
      noBreakRequiresReview: false,
      capturedAt: now,
      version: 1,
    },
    comment: values.comment || undefined,
    source,
    createdByUid: actorId,
    createdAt: now,
    updatedByUid: actorId,
    updatedAt: now,
    revision: 1,
    workerConfirmation: confirmation,
    reviewState: requiresReview ? "pending" : source === "worker" ? "not-submitted" : "approved",
  };
}

function updateShiftFromDraft(shift: Shift, draft: ShiftDraft, actorId: string, confirmation: Shift["workerConfirmation"], requiresReview: boolean): Shift {
  const workspace = readWorkspace();
  const values = deriveValues(draft);
  const now = new Date().toISOString();
  const actor = workspace.members.find((member) => member.id === actorId);
  const workerBreakEditDisabled = actor?.role === "worker" && getFactory(workspace, shift.factoryId)?.allowActualBreakReport === false;
  const previousSegment = shift.actualBreak.segments[0];
  const previousTreatment = previousSegment?.treatment ?? shift.actualBreak.treatment ?? (shift.totalBreakDurationMinutes > 0 && shift.unpaidBreakDurationMinutes === 0 ? "paid" : "unpaid");
  const breakContentChanged = values.breakStatus !== shift.actualBreak.status
    || values.breakTreatment !== previousTreatment
    || values.totalBreakDurationMinutes !== shift.totalBreakDurationMinutes
    || localTime(values.breakStartAt) !== localTime(previousSegment?.startAt)
    || localTime(values.breakEndAt) !== localTime(previousSegment?.endAt);
  const actualBreak: ActualBreakReport = {
    status: values.breakStatus,
    treatment: values.breakStatus === "taken" ? values.breakTreatment : undefined,
    segments: values.breakStatus === "taken" && values.breakStartAt && values.breakEndAt
      ? [{ startAt: values.breakStartAt, endAt: values.breakEndAt, treatment: values.breakTreatment ?? "unpaid", durationMinutes: values.totalBreakDurationMinutes ?? 0 }]
      : [],
    reportedByUid: values.breakStatus === "not-reported" || !breakContentChanged ? shift.actualBreak.reportedByUid : actorId,
    reportedAt: values.breakStatus === "not-reported" || !breakContentChanged ? shift.actualBreak.reportedAt : now,
    lastChangedByUid: breakContentChanged ? actorId : shift.actualBreak.lastChangedByUid,
    lastChangedAt: breakContentChanged ? now : shift.actualBreak.lastChangedAt,
    reviewState: requiresReview ? "pending" : "not-required",
  };
  return {
    ...shift,
    localStartDate: values.localDate,
    startAt: values.startAt,
    endAt: values.endAt,
    grossDurationMinutes: values.grossDurationMinutes,
    totalBreakDurationMinutes: values.totalBreakDurationMinutes ?? 0,
    unpaidBreakDurationMinutes: values.unpaidBreakDurationMinutes,
    paidDurationMinutes: values.paidDurationMinutes,
    actualBreak: workerBreakEditDisabled ? shift.actualBreak : actualBreak,
    comment: values.comment || undefined,
    updatedByUid: actorId,
    updatedAt: now,
    revision: shift.revision + 1,
    workerConfirmation: confirmation,
    reviewState: requiresReview ? "pending" : "approved",
  };
}

function makeHistoryEntry(action: DemoShiftHistoryEntry["action"], actorId: string, revision: number, oldValues?: DemoShiftValues, newValues?: DemoShiftValues, note?: string): DemoShiftHistoryEntry {
  const actor = readWorkspace().members.find((member) => member.id === actorId);
  const sameFacts = oldValues && newValues && JSON.stringify(oldValues) === JSON.stringify(newValues);
  return { id: `event-${crypto.randomUUID()}`, action, actorId, actorName: actor?.name ?? "Timeax", occurredAt: new Date().toISOString(), revision, oldValues: sameFacts ? undefined : oldValues, newValues: sameFacts ? undefined : newValues, note };
}

function makeNotification(recipientId: string, kind: DemoWorkspace["notifications"][number]["kind"], subjectId: string, organizationId = readWorkspace().organization.id): DemoWorkspace["notifications"][number] {
  return { id: `notice-${crypto.randomUUID()}`, organizationId, recipientId, kind, subjectId, createdAt: new Date().toISOString() };
}

function makeMonthlyTimesheetEvent(actor: DemoMember, action: DemoMonthlyTimesheetEvent["action"], fromStatus: DemoMonthlyTimesheetEvent["fromStatus"], toStatus: DemoMonthlyTimesheetEvent["toStatus"], note?: string, version?: number, occurredAt = new Date().toISOString()): DemoMonthlyTimesheetEvent {
  return { id: `timesheet-event-${crypto.randomUUID()}`, action, fromStatus, toStatus, actorId: actor.id, actorAccountUid: actor.accountUid ?? actor.id, actorName: actor.name, actorRole: actor.role, occurredAt, note, version };
}

function timesheetReviewerIds(workspace: DemoWorkspace, factoryId: string) {
  const factory = getFactory(workspace, factoryId);
  const assignedLeaderIds = workspace.employmentPeriods
    .filter((period) => period.organizationId === workspace.organization.id)
    .flatMap((period) => period.placements.filter((placement) => placement.factoryId === factoryId).map((placement) => placement.leaderId))
    .filter((id): id is string => Boolean(id));
  return [...new Set([
    ...workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "agency").map((member) => member.id),
    ...(factory?.ownerWorkforce ? workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "factory-admin").map((member) => member.id) : []),
    ...workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "leader" && member.factoryId === factoryId && member.accessState !== "suspended" && member.accessState !== "revoked").map((member) => member.id),
    ...assignedLeaderIds.filter((id) => workspace.members.some((member) => member.id === id && member.organizationId === workspace.organization.id && member.role === "leader" && member.accessState !== "suspended" && member.accessState !== "revoked")),
  ])];
}

function changedFactRoutes(previous: DemoWorkspace, next: DemoWorkspace) {
  const routes = new Set<string>();
  const compare = <T,>(before: T[], after: T[], id: (record: T) => string, route: (record: T) => string | undefined) => {
    const oldById = new Map(before.map((record) => [id(record), record]));
    const newById = new Map(after.map((record) => [id(record), record]));
    for (const key of new Set([...oldById.keys(), ...newById.keys()])) {
      const oldRecord = oldById.get(key);
      const newRecord = newById.get(key);
      if (JSON.stringify(oldRecord) === JSON.stringify(newRecord)) continue;
      if (oldRecord) { const oldRoute = route(oldRecord); if (oldRoute) routes.add(oldRoute); }
      if (newRecord) { const newRoute = route(newRecord); if (newRoute) routes.add(newRoute); }
    }
  };
  compare(previous.shifts, next.shifts, (record) => record.shift.id, (record) => record.shift.factoryId ? `${record.organizationId}|${record.shift.factoryId}|${record.shift.localStartDate.slice(0, 7)}` : undefined);
  compare(previous.absences, next.absences, (record) => record.id, (record) => `${record.organizationId}|${record.factoryId}|${record.localDate.slice(0, 7)}`);
  return routes;
}

function reopenSubmittedTimesheets(previous: DemoWorkspace, next: DemoWorkspace): DemoWorkspace {
  const changedRoutes = changedFactRoutes(previous, next);
  if (!changedRoutes.size) return next;
  const active = getActiveMember(next);
  const now = new Date().toISOString();
  const changedIds = new Set<string>();
  const monthlyTimesheets = (next.monthlyTimesheets ?? []).map((record) => {
    const route = `${record.organizationId}|${record.factoryId}|${record.month}`;
    if (!changedRoutes.has(route) || !["submitted_to_agency", "accepted_by_agency", "submitted_by_factory", "accepted_by_factory"].includes(record.status)) return record;
    changedIds.add(record.id);
    const actor = active.role === "leader"
      ? activeLeaderMemberships(next, active).find((member) => member.organizationId === record.organizationId && member.factoryId === record.factoryId) ?? active
      : active;
    const history = makeMonthlyTimesheetEvent(actor, "reopened", record.status, "reopened", "source-data-changed", record.currentVersion, now);
    return { ...record, status: "reopened" as const, updatedAt: now, history: [...record.history, history] };
  });
  if (!changedIds.size) return next;
  const notifications = monthlyTimesheets.filter((record) => changedIds.has(record.id)).flatMap((record) => timesheetReviewerIds(scopedWorkspace(next, record.organizationId), record.factoryId)
    .filter((recipientId) => recipientId !== active.id)
    .map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId: record.organizationId, recipientId, kind: "timesheet-reopened" as const, subjectId: record.id, createdAt: now })));
  return { ...next, monthlyTimesheets, notifications: [...notifications, ...next.notifications] };
}

function canManageWorker(workerId: string, workspace: DemoWorkspace, factoryId?: string): boolean {
  const active = getActiveMember(workspace);
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker");
  if (active.role === "agency") return Boolean(worker && worker.organizationId === active.organizationId);
  if (active.role === "factory-admin") {
    const entity = getActiveBusinessEntity(workspace);
    const factory = factoryId ? workspace.factories.find((item) => item.id === factoryId) : undefined;
    const site = factory?.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
    const businessAccess = Boolean(entity && factory && site?.businessEntityId === entity.id && (factory.organizationId === entity.organizationId
      ? factory.ownerWorkforce && worker?.businessEntityId === entity.id && worker.organizationId === entity.organizationId
      : worker?.organizationId === factory.organizationId && (workspace.agencyWorksites ?? []).some((item) => item.businessEntityId === entity.id && item.worksiteId === site.id && item.organizationId === factory.organizationId && item.state === "active")));
    return Boolean(worker && businessAccess && workspace.employmentPeriods.some((period) => period.organizationId === worker.organizationId && period.workerId === worker.id && period.state === "active" && period.placements.some((placement) => placement.factoryId === factoryId)));
  }
  if (!worker || active.role !== "leader") return false;
  const memberships = activeLeaderMemberships(workspace, active).filter((membership) => membership.organizationId === worker.organizationId && (!factoryId || membership.factoryId === factoryId));
  return memberships.some((membership) => {
    const hasProductionHistory = workspace.employmentPeriods.some((period) => period.organizationId === worker.organizationId && period.workerId === workerId && period.placements.some((placement) => placement.factoryId === membership.factoryId));
    return hasProductionHistory && effectiveLeaderPermissions(membership).canViewWorkers
      && !isLeaderWorkerRemoved(workspace, membership.id, membership.organizationId, membership.factoryId!, workerId);
  });
}

function getProductionLeaderIds(workspace: DemoWorkspace, factoryId: string, workerId?: string): string[] {
  return workspace.members.filter((member) => member.organizationId === workspace.organization.id && member.role === "leader"
    && member.factoryId === factoryId && member.accessState !== "suspended" && member.accessState !== "revoked"
    && effectiveLeaderPermissions(member).canViewWorkers && effectiveLeaderPermissions(member).canReviewShifts
    && (!workerId || !isLeaderWorkerRemoved(workspace, member.id, member.organizationId, factoryId, workerId))).map((member) => member.id);
}

function mutate(updater: (workspace: DemoWorkspace) => DemoWorkspace) {
  const previous = readWorkspace();
  publish(reopenSubmittedTimesheets(previous, updater(previous)));
}

export function canFactorySubmitTimesheet(workspace: DemoWorkspace, organizationId: string, factoryId: string): boolean {
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const factory = getFactoryInOrganization(workspace, organizationId, factoryId);
  const site = workspace.worksites?.find((item) => item.id === factory?.worksiteId);
  if (actor.role !== "factory-admin" || !entity || actor.businessEntityId !== entity.id || !factory || factory.archivedAt || site?.businessEntityId !== entity.id) return false;
  if (organizationId === entity.organizationId) return factory.ownerWorkforce === true;
  return (workspace.agencyWorksites ?? []).some((connection) => connection.businessEntityId === entity.id && connection.worksiteId === site.id && connection.organizationId === organizationId && connection.state === "active");
}

function getTimesheetActor(workspace: DemoWorkspace, organizationId: string, factoryId: string, action: "submit" | "review"): DemoMember | undefined {
  const active = getActiveMember(workspace);
  const factory = getFactoryInOrganization(workspace, organizationId, factoryId);
  if (!factory) return undefined;
  const settings = effectiveWorkflowSettings(factory);
  if (active.role === "leader") {
    const membership = activeLeaderMemberships(workspace, active).find((item) => item.organizationId === organizationId && item.factoryId === factoryId);
    const allowed = action === "submit" ? settings.leaderCanSubmitTimesheet && membership && effectiveLeaderPermissions(membership).canSubmitTimesheet
      : membership && effectiveLeaderPermissions(membership).canReviewShifts;
    return allowed ? membership : undefined;
  }
  if (active.role === "agency" && active.organizationId === organizationId && action === "submit" && settings.agencyCanSubmitTimesheet) return active;
  if (active.role === "agency" && active.organizationId === organizationId && action === "review" && settings.agencyMustAcceptTimesheet) return active;
  const businessEntity = getActiveBusinessEntity(workspace);
  const site = factory.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
  const factoryAdminOwnWorkforce = active.role === "factory-admin" && active.organizationId === organizationId && factory.ownerWorkforce === true
    && Boolean(businessEntity && active.businessEntityId === businessEntity.id && site?.businessEntityId === businessEntity.id);
  if (factoryAdminOwnWorkforce && (action === "submit" || action === "review")) return active;
  if (action === "submit" && canFactorySubmitTimesheet(workspace, organizationId, factoryId)) return active;
  return undefined;
}

function getMonthlyTimesheet(workspace: DemoWorkspace, factoryId: string, month: string, organizationId = workspace.organization.id) {
  return (workspace.monthlyTimesheets ?? []).find((record) => record.organizationId === organizationId && record.factoryId === factoryId && record.month === month);
}

function makeMonthlyTimesheet(factoryId: string, month: string, actor: DemoMember, status: DemoMonthlyTimesheet["status"], event: DemoMonthlyTimesheetEvent, versions: DemoMonthlyTimesheetVersion[] = []): DemoMonthlyTimesheet {
  return { id: `timesheet-${crypto.randomUUID()}`, organizationId: actor.organizationId, factoryId, month, status, currentVersion: versions.at(-1)?.number ?? 0, versions, history: [event], updatedAt: event.occurredAt };
}

export function markMonthlyTimesheetReady(factoryId: string, month: string, organizationId = getActiveMember().organizationId): boolean {
  const workspace = readWorkspace();
  const actor = getTimesheetActor(workspace, organizationId, factoryId, "submit");
  const scoped = scopedWorkspace(workspace, organizationId);
  const factory = getFactoryInOrganization(workspace, organizationId, factoryId);
  const settings = factory && effectiveWorkflowSettings(factory);
  const snapshot = buildMonthlyTimesheetSnapshot(scoped, factoryId, month, "leader");
  const current = getMonthlyTimesheet(workspace, factoryId, month, organizationId);
  if (!actor || actor.role !== "leader" && !(actor.role === "factory-admin" && canFactorySubmitTimesheet(workspace, organizationId, factoryId)) || !factory || actor.role === "leader" && !settings?.leaderCanSubmitTimesheet || !/^\d{4}-\d{2}$/.test(month) || hasOpenMonthlyIssues(snapshot.rows)
    || !snapshot.rows.some((row) => row.kind === "shift" || row.kind === "absence")
    || ["submitted_to_agency", "accepted_by_agency", "submitted_by_factory", "accepted_by_factory"].includes(current?.status ?? "")) return false;
  const now = new Date().toISOString();
  const event = makeMonthlyTimesheetEvent(actor, "ready", current?.status, "ready_for_review", undefined, current?.currentVersion, now);
  const record = current ? { ...current, status: "ready_for_review" as const, history: [...current.history, event], updatedAt: now } : { ...makeMonthlyTimesheet(factoryId, month, actor, "ready_for_review", event), organizationId };
  const agencyIds = workspace.members.filter((member) => member.organizationId === organizationId && member.role === "agency" && member.id !== actor.id).map((member) => member.id);
  mutate((state) => ({
    ...state,
    monthlyTimesheets: current ? (state.monthlyTimesheets ?? []).map((item) => item.id === current.id ? record : item) : [...(state.monthlyTimesheets ?? []), record],
    notifications: [...agencyIds.map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId, recipientId, kind: "timesheet-ready" as const, subjectId: record.id, createdAt: now })), ...state.notifications],
  }));
  return true;
}

export function submitMonthlyTimesheet(factoryId: string, month: string, allowOpenIssues = false, organizationId = getActiveMember().organizationId): boolean {
  const workspace = readWorkspace();
  const actor = getTimesheetActor(workspace, organizationId, factoryId, "submit");
  const scoped = scopedWorkspace(workspace, organizationId);
  const factory = getFactoryInOrganization(workspace, organizationId, factoryId);
  const settings = factory && effectiveWorkflowSettings(factory);
  const current = getMonthlyTimesheet(workspace, factoryId, month, organizationId);
  if (!actor || !(actor.role === "agency" || actor.role === "leader" || actor.role === "factory-admin") || !factory || !settings || !/^\d{4}-\d{2}$/.test(month)
    || ["submitted_to_agency", "accepted_by_agency", "submitted_by_factory", "accepted_by_factory"].includes(current?.status ?? "")) return false;
  const snapshot = buildMonthlyTimesheetSnapshot(scoped, factoryId, month, actor.role === "agency" ? "agency" : "leader");
  if (!snapshot.rows.length || (hasOpenMonthlyIssues(snapshot.rows) && !allowOpenIssues)) return false;
  const now = new Date().toISOString();
  const versionNumber = (current?.currentVersion ?? 0) + 1;
  const version: DemoMonthlyTimesheetVersion = {
    id: `timesheet-version-${crypto.randomUUID()}`,
    number: versionNumber,
    createdAt: now,
    rows: snapshot.rows.map((row) => ({ ...row, shiftHistory: row.shiftHistory?.map((event) => ({ ...event })) })),
    totals: { ...snapshot.totals },
    signature: {
      signerId: actor.id,
      signerAccountUid: actor.accountUid ?? actor.id,
      signerName: actor.name,
      signerRole: actor.role,
      factoryId,
      factoryName: factory.name,
      month,
      version: versionNumber,
      signedAt: now,
      statement: "I confirm the accuracy of the submitted monthly timesheet.",
    },
  };
  const ownerWorkforce = factory.ownerWorkforce === true && workspace.organizations.find((item) => item.id === factory.organizationId)?.type === "factory";
  const submissionStatus = ownerWorkforce
    ? actor.role === "factory-admin" ? "accepted_by_factory" as const : "submitted_by_factory" as const
    : settings.agencyMustAcceptTimesheet ? "submitted_to_agency" as const : "accepted_by_agency" as const;
  const event = makeMonthlyTimesheetEvent(actor, versionNumber > 1 ? "resent" : "submitted", current?.status, submissionStatus, hasOpenMonthlyIssues(snapshot.rows) ? "submitted-with-open-issues" : undefined, versionNumber, now);
  const versions = [...(current?.versions ?? []), version];
  const record = current
    ? { ...current, status: submissionStatus, currentVersion: versionNumber, versions, history: [...current.history, event], updatedAt: now }
    : { ...makeMonthlyTimesheet(factoryId, month, actor, submissionStatus, event, versions), organizationId };
  const recipients = timesheetReviewerIds(scoped, factoryId).filter((id) => id !== actor.id);
  if (!recipients.length && actor.role !== "agency" && actor.role !== "factory-admin") return false;
  const kind: DemoWorkspace["notifications"][number]["kind"] = versionNumber > 1 ? "timesheet-resent" : "timesheet-submitted";
  mutate((state) => ({
    ...state,
    monthlyTimesheets: current ? (state.monthlyTimesheets ?? []).map((item) => item.id === current.id ? record : item) : [...(state.monthlyTimesheets ?? []), record],
    notifications: [...recipients.map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId, recipientId, kind, subjectId: record.id, createdAt: now })), ...state.notifications],
  }));
  return true;
}

export function acceptMonthlyTimesheet(timesheetId: string, note = ""): boolean {
  const workspace = readWorkspace();
  const current = (workspace.monthlyTimesheets ?? []).find((record) => record.id === timesheetId);
  const actor = current && getTimesheetActor(workspace, current.organizationId, current.factoryId, "review");
  const factory = current && getFactoryInOrganization(workspace, current.organizationId, current.factoryId);
  const factoryOwnedReview = Boolean(actor?.role === "factory-admin" && actor.organizationId === current?.organizationId && factory?.ownerWorkforce && current?.status === "submitted_by_factory");
  if (!actor || !current || !(actor.role === "agency" && current.status === "submitted_to_agency" || factoryOwnedReview)) return false;
  const now = new Date().toISOString();
  const nextStatus = factoryOwnedReview ? "accepted_by_factory" as const : "accepted_by_agency" as const;
  const event = makeMonthlyTimesheetEvent(actor, "accepted", current.status, nextStatus, note.trim() || undefined, current.currentVersion, now);
  const record = { ...current, status: nextStatus, history: [...current.history, event], updatedAt: now };
  const recipients = timesheetReviewerIds(scopedWorkspace(workspace, current.organizationId), current.factoryId).filter((id) => id !== actor.id);
  mutate((state) => ({ ...state, monthlyTimesheets: (state.monthlyTimesheets ?? []).map((item) => item.id === current.id ? record : item), notifications: [...recipients.map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId: current.organizationId, recipientId, kind: "timesheet-accepted" as const, subjectId: current.id, createdAt: now })), ...state.notifications] }));
  return true;
}

export function returnMonthlyTimesheet(timesheetId: string, reason: string): boolean {
  const workspace = readWorkspace();
  const current = (workspace.monthlyTimesheets ?? []).find((record) => record.id === timesheetId);
  const actor = current && getTimesheetActor(workspace, current.organizationId, current.factoryId, "review");
  const cleanReason = reason.trim();
  const factory = current && getFactoryInOrganization(workspace, current.organizationId, current.factoryId);
  const factoryOwnedReview = Boolean(actor?.role === "factory-admin" && actor.organizationId === current?.organizationId && factory?.ownerWorkforce && current?.status === "submitted_by_factory");
  if (!actor || !current || !(actor.role === "agency" && current.status === "submitted_to_agency" || factoryOwnedReview) || !cleanReason) return false;
  const now = new Date().toISOString();
  const event = makeMonthlyTimesheetEvent(actor, "returned", current.status, "returned_to_leader", cleanReason, current.currentVersion, now);
  const record = { ...current, status: "returned_to_leader" as const, history: [...current.history, event], updatedAt: now };
  const recipients = timesheetReviewerIds(scopedWorkspace(workspace, current.organizationId), current.factoryId).filter((id) => id !== actor.id && workspace.members.some((member) => member.id === id && member.organizationId === current.organizationId && member.role === "leader" && member.accessState !== "suspended" && member.accessState !== "revoked"));
  mutate((state) => ({ ...state, monthlyTimesheets: (state.monthlyTimesheets ?? []).map((item) => item.id === current.id ? record : item), notifications: [...recipients.map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId: current.organizationId, recipientId, kind: "timesheet-returned" as const, subjectId: current.id, createdAt: now })), ...state.notifications] }));
  return true;
}

export function reopenMonthlyTimesheet(timesheetId: string, reason: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const current = (workspace.monthlyTimesheets ?? []).find((record) => record.id === timesheetId && record.organizationId === actor.organizationId);
  const cleanReason = reason.trim();
  const factoryOwnedTimesheet = Boolean(actor.role === "factory-admin" && current && workspace.factories.some((factory) => factory.id === current.factoryId && factory.organizationId === current.organizationId && factory.ownerWorkforce));
  const allowedStatus = factoryOwnedTimesheet ? current?.status === "submitted_by_factory" || current?.status === "accepted_by_factory"
    : actor.role === "agency" && (current?.status === "submitted_to_agency" || current?.status === "accepted_by_agency");
  if (!current || !allowedStatus || !cleanReason) return false;
  const now = new Date().toISOString();
  const event = makeMonthlyTimesheetEvent(actor, "reopened", current.status, "reopened", cleanReason, current.currentVersion, now);
  const record = { ...current, status: "reopened" as const, history: [...current.history, event], updatedAt: now };
  const recipients = timesheetReviewerIds(scopedWorkspace(workspace, current.organizationId), current.factoryId).filter((id) => id !== actor.id && workspace.members.some((member) => member.id === id && member.organizationId === current.organizationId && member.role === "leader" && member.accessState !== "suspended" && member.accessState !== "revoked"));
  mutate((state) => ({ ...state, monthlyTimesheets: (state.monthlyTimesheets ?? []).map((item) => item.id === current.id ? record : item), notifications: [...recipients.map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId: current.organizationId, recipientId, kind: "timesheet-reopened" as const, subjectId: current.id, createdAt: now })), ...state.notifications] }));
  return true;
}

export function createFactoryWorkerMessage(workerId: string, subject: string, text: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === entity?.organizationId && item.role === "worker" && item.workerCategory === "factory" && item.businessEntityId === entity?.id);
  const employment = worker && workspace.employmentPeriods.find((period) => period.organizationId === worker.organizationId && period.workerId === worker.id && period.state === "active");
  const cleanSubject = subject.trim();
  const cleanText = text.trim();
  if (actor.role !== "factory-admin" || !entity || actor.businessEntityId !== entity.id || !worker || !employment || !cleanSubject || !cleanText) return false;
  const placement = employment.placements.find((item) => !item.endDate && workspace.factories.some((factory) => factory.id === item.factoryId && factory.organizationId === entity.organizationId && factory.ownerWorkforce));
  if (!placement) return false;
  const now = new Date().toISOString();
  const thread: DemoMessageThread = {
    id: `thread-${crypto.randomUUID()}`,
    organizationId: entity.organizationId,
    workerId: worker.id,
    factoryId: placement.factoryId,
    recipientType: "worker",
    recipientId: worker.id,
    participants: [actor.id, worker.id],
    subject: cleanSubject,
    state: "open",
    createdAt: now,
    updatedAt: now,
    messages: [{ id: `message-${crypto.randomUUID()}`, senderId: actor.id, text: cleanText, sentAt: now, readByIds: [actor.id] }],
  };
  mutate((state) => ({ ...state, messageThreads: [thread, ...state.messageThreads], notifications: [makeNotification(worker.id, "message-received", thread.id, entity.organizationId), ...state.notifications] }));
  return true;
}

function policyRequiresReview(workspace: DemoWorkspace, workerId: string, draft: ShiftDraft): boolean {
  const worker = workspace.members.find((member) => member.id === workerId);
  const factory = worker ? getFactoryInOrganization(workspace, worker.organizationId, draft.factoryId ?? worker.factoryId ?? "") : undefined;
  if (!factory?.requiredBreakMinutes) return false;
  if (draft.breakStatus !== "taken") return false;
  const values = deriveValues(draft);
  const treatmentMismatch = factory.requiredBreakTreatment && values.breakTreatment !== factory.requiredBreakTreatment;
  return Boolean(treatmentMismatch) || (factory.requiredBreakTreatment === "unpaid"
    ? values.unpaidBreakDurationMinutes < factory.requiredBreakMinutes
    : (values.totalBreakDurationMinutes ?? 0) < factory.requiredBreakMinutes);
}

export type WorkerShiftCreateResult = "created" | "duplicate" | "overlap" | "denied";

export interface WorkerShiftCreateOptions {
  submissionId?: string;
  confirmOverlap?: boolean;
}

export function createWorkerShift(draft: ShiftDraft, options: WorkerShiftCreateOptions = {}): WorkerShiftCreateResult {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const factoryId = draft.factoryId ?? member.factoryId;
  const factory = getFactory(workspace, factoryId);
  const preparedDraft = { ...draft, factoryId };
  const workflow = factory && effectiveWorkflowSettings(factory);
  const activePlacement = activeEmploymentAt(workspace, workspace.organization.id, member.id, factoryId ?? "", draft.localDate);
  const employment = activePlacement?.period;
  const placement = activePlacement?.placement;
  if (member.role !== "worker" || !factory || factory.archivedAt || !workflow?.workerCanRecordHours || factory.allowTimeDataSubmission === false || !employment || !placement || getWorkerAccess(workspace, member.id, factoryId) !== "self" || (factory.allowActualBreakReport === false && draft.breakStatus !== "not-reported") || !isValidShiftDraft(preparedDraft)) return "denied";
  if (options.submissionId && workspace.shifts.some((record) => record.organizationId === workspace.organization.id && record.clientSubmissionId === options.submissionId)) return "created";

  const values = deriveValues(preparedDraft);
  const existingShifts = workspace.shifts.filter((record) => record.organizationId === workspace.organization.id
    && record.shift.workerUid === member.id && !record.shift.deletedAt);
  const isIdentical = (shift: Shift) => shift.localStartDate === values.localDate
    && shift.startAt === values.startAt && shift.endAt === values.endAt;
  const duplicateExists = existingShifts.some((record) => isIdentical(record.shift));
  if (duplicateExists) return "duplicate";

  const overlapsExisting = existingShifts.some(({ shift }) => shift.startAt < values.endAt && values.startAt < shift.endAt);
  if (!duplicateExists && overlapsExisting && !options.confirmOverlap) return "overlap";

  const reviewRequired = policyRequiresReview(workspace, member.id, preparedDraft) || Boolean(workflow.leaderMustReviewShifts || workflow.agencyMustReviewShifts);
  const shift = { ...shiftFromDraft(member.id, preparedDraft, "worker", member.id, reviewRequired, "confirmed"), employmentId: employment.id };
  const record: DemoShiftRecord = {
    organizationId: workspace.organization.id,
    shift,
    clientSubmissionId: options.submissionId,
    plannedBreak: draft.plannedBreakStart || draft.plannedBreakEnd || draft.plannedBreakDurationMinutes || draft.plannedBreakTreatment ? { startTime: draft.plannedBreakStart, endTime: draft.plannedBreakEnd, durationMinutes: draft.plannedBreakDurationMinutes, treatment: draft.plannedBreakTreatment } : undefined,
    history: [makeHistoryEntry("created", member.id, 1, undefined, valuesFromShift(shift))],
    previousVersions: [],
  };
  mutate((state) => ({ ...state, shifts: [record, ...state.shifts] }));
  return "created";
}

export function editWorkerShift(shiftId: string, draft: ShiftDraft): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const factory = getFactory(workspace, record?.shift.factoryId);
  const workflow = factory && effectiveWorkflowSettings(factory);
  if (member.role !== "worker" || !record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || record.shift.workerUid !== member.id || record.shift.workerConfirmation !== "pending" || !workflow?.workerCanRecordHours || getWorkerAccess(workspace, member.id, record.shift.factoryId) !== "self" || !isValidShiftDraft({ ...draft, factoryId: record.shift.factoryId })) return false;
  if (factory?.allowActualBreakReport === false) {
    const current = valuesFromShift(record.shift);
    if (draft.breakStatus !== current.breakStatus || draft.breakTreatment !== current.breakTreatment || Number(draft.breakDurationMinutes ?? 0) !== (current.totalBreakDurationMinutes ?? 0) || (draft.breakStartTime ?? "") !== localTime(current.breakStartAt) || (draft.breakEndTime ?? "") !== localTime(current.breakEndAt)) return false;
  }
  const oldValues = valuesFromShift(record.shift);
  const preparedDraft = { ...draft, factoryId: record.shift.factoryId };
  const updatedShift = updateShiftFromDraft(record.shift, preparedDraft, member.id, "confirmed", policyRequiresReview(workspace, member.id, preparedDraft));
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id !== shiftId ? entry : {
      ...entry,
      shift: updatedShift,
      previousVersions: [...entry.previousVersions, oldValues],
      history: [...entry.history, makeHistoryEntry("edited", member.id, updatedShift.revision, oldValues, valuesFromShift(updatedShift))],
    }),
  }));
  return true;
}

export function resolveRequiredBreakReview(shiftId: string, decision: "approve" | "return", note: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const factoryId = record?.shift.factoryId;
  const cleanNote = note.trim();
  const factory = record && factoryId ? getFactoryInOrganization(workspace, record.organizationId, factoryId) : undefined;
  const workflow = factory && effectiveWorkflowSettings(factory);
  const membership = record && factoryId && active.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, factoryId, "canReviewShifts") : undefined;
  const actionActor = membership ?? active;
  const canReview = active.role === "agency" && workflow?.agencyMustReviewShifts
    || Boolean(membership && workflow?.leaderMustReviewShifts && record && canManageWorker(record.shift.workerUid, workspace, factoryId));
  if (!record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || !factoryId || !record.shift.breakPolicySnapshot.required || record.shift.reviewState !== "pending" || record.shift.actualBreak.reviewState !== "pending" || !cleanNote || !canReview) return false;
  const now = new Date().toISOString();
  const approved = decision === "approve";
  const shift = {
    ...record.shift,
    reviewState: approved ? "approved" as const : "returned" as const,
    actualBreak: { ...record.shift.actualBreak, reviewState: approved ? "approved" as const : "rejected" as const, exceptionReason: cleanNote },
    updatedByUid: actionActor.id,
    updatedAt: now,
    revision: record.shift.revision + 1,
  };
  const event = makeHistoryEntry(approved ? "break-reviewed" : "break-returned", actionActor.id, shift.revision, valuesFromShift(record.shift), valuesFromShift(shift), cleanNote);
  const agencyRecipients = active.role === "leader"
    ? workspace.members.filter((member) => member.organizationId === record.organizationId && member.role === "agency").map((member) => member.id)
    : [];
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((item) => item.shift.id === shiftId ? { ...item, shift, history: [...item.history, event] } : item),
    notifications: [makeNotification(record.shift.workerUid, "break-review-updated", shiftId, record.organizationId), ...agencyRecipients.map((recipient) => makeNotification(recipient, "break-review-updated", shiftId, record.organizationId)), ...state.notifications],
  }));
  return true;
}

export function reviewShiftRecord(shiftId: string, decision: "approve" | "return", note = ""): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const factoryId = record?.shift.factoryId;
  const factory = record && factoryId ? getFactoryInOrganization(workspace, record.organizationId, factoryId) : undefined;
  const workflow = factory && effectiveWorkflowSettings(factory);
  const membership = record && factoryId && actor.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, factoryId, "canReviewShifts") : undefined;
  const actionActor = membership ?? actor;
  const canReview = actor.role === "agency"
    ? Boolean(record && record.organizationId === actor.organizationId && workflow?.agencyMustReviewShifts)
    : Boolean(membership && workflow?.leaderMustReviewShifts && record && canManageWorker(record.shift.workerUid, workspace, factoryId));
  const cleanNote = note.trim();
  if (!record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || !factory || !factoryId || record.shift.reviewState !== "pending" || record.shift.breakPolicySnapshot.required && record.shift.actualBreak.reviewState === "pending" || !canReview || decision === "return" && !cleanNote) return false;
  const now = new Date().toISOString();
  const approved = decision === "approve";
  const shift = { ...record.shift, reviewState: approved ? "approved" as const : "returned" as const, updatedByUid: actionActor.id, updatedAt: now, revision: record.shift.revision + 1 };
  const event = makeHistoryEntry(approved ? "reviewed" : "returned", actionActor.id, shift.revision, valuesFromShift(record.shift), valuesFromShift(shift), cleanNote || undefined);
  const recipients = workspace.members.filter((member) => member.id === record.shift.workerUid || member.organizationId === record.organizationId && member.role === "agency" || member.role === "leader" && member.organizationId === record.organizationId && member.factoryId === factoryId && member.accessState !== "suspended" && member.accessState !== "revoked").map((member) => member.id);
  mutate((state) => ({ ...state,
    shifts: state.shifts.map((item) => item.shift.id === shiftId ? { ...item, shift, history: [...item.history, event] } : item),
    notifications: [...recipients.filter((recipientId) => recipientId !== actionActor.id).map((recipientId) => ({ id: `notice-${crypto.randomUUID()}`, organizationId: record.organizationId, recipientId, kind: "shift-updated" as const, subjectId: shiftId, createdAt: now })), ...state.notifications],
  }));
  return true;
}

export function confirmShiftForWorker(shiftId: string, note = ""): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const factoryId = record?.shift.factoryId;
  const factory = record && factoryId ? getFactoryInOrganization(workspace, record.organizationId, factoryId) : undefined;
  const settings = factory && effectiveWorkflowSettings(factory);
  const membership = record && factoryId && actor.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, factoryId, "canConfirmShifts") : undefined;
  if (!record || !factory || !factoryId || actor.role !== "leader" || !membership || !settings?.workerMustConfirmShifts
    || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || record.shift.workerConfirmation !== "pending"
    || !canManageWorker(record.shift.workerUid, workspace, factoryId)) return false;
  const now = new Date().toISOString();
  const shift = { ...record.shift, workerConfirmation: "confirmed" as const, updatedByUid: membership.id, updatedAt: now, revision: record.shift.revision + 1 };
  const event = makeHistoryEntry("leader-confirmed", membership.id, shift.revision, valuesFromShift(record.shift), valuesFromShift(shift), note.trim() || undefined);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, history: [...entry.history, event] } : entry),
    notifications: [makeNotification(record.shift.workerUid, "shift-updated", shiftId, record.organizationId), ...state.notifications],
  }));
  return true;
}

export function reportShiftBreak(shiftId: string, draft: ShiftDraft): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const factory = getFactory(workspace, record?.shift.factoryId);
  if (member.role !== "worker" || !record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || record.shift.workerUid !== member.id || !factory || !effectiveWorkflowSettings(factory).workerCanRecordHours || factory.allowActualBreakReport === false || !isValidShiftDraft({ ...draft, factoryId: record.shift.factoryId })) return false;
  const oldValues = valuesFromShift(record.shift);
  const preparedDraft = { ...draft, factoryId: record.shift.factoryId };
  const updatedShift = updateShiftFromDraft(record.shift, preparedDraft, member.id, record.shift.workerConfirmation, policyRequiresReview(workspace, member.id, preparedDraft));
  const history = makeHistoryEntry("break-reported", member.id, updatedShift.revision, oldValues, valuesFromShift(updatedShift));
  mutate((state) => ({ ...state, shifts: state.shifts.map((entry) => entry.shift.id !== shiftId ? entry : { ...entry, shift: updatedShift, previousVersions: [...entry.previousVersions, oldValues], history: [...entry.history, history] }) }));
  return true;
}

export type LeaderShiftCreateBlockReason = "wrong-role" | "leader-membership" | "factory-setting" | "factory-archived" | "leader-permission" | "submission-disabled" | "invalid-shift" | "choose-worker" | "worker-unavailable" | "employment" | "worker-assignment";

export function getLeaderShiftCreateBlockReason(workerIds: string[], draft: ShiftDraft): LeaderShiftCreateBlockReason | undefined {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  if (active.role !== "leader") return "wrong-role";
  const membership = activeLeaderMemberships(workspace, active).find((item) => item.organizationId === active.organizationId && item.factoryId === active.factoryId);
  if (!membership?.factoryId) return "leader-membership";
  const factory = getFactoryInOrganization(workspace, membership.organizationId, membership.factoryId);
  if (factory?.archivedAt) return "factory-archived";
  if (!factory || !effectiveWorkflowSettings(factory).leaderCanRecordHours) return "factory-setting";
  if (!effectiveLeaderPermissions(membership).canRecordHours) return "leader-permission";
  if (factory.allowTimeDataSubmission === false) return "submission-disabled";
  if (!isValidShiftDraft({ ...draft, factoryId: membership.factoryId })) return "invalid-shift";
  if (!workerIds.length) return "choose-worker";
  let foundWorker = false;
  let foundEmployment = false;
  for (const workerId of new Set(workerIds)) {
    const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker" && member.organizationId === membership.organizationId);
    if (!worker) continue;
    foundWorker = true;
    const employment = activeEmploymentAt(workspace, membership.organizationId, workerId, membership.factoryId, draft.localDate);
    if (!employment) continue;
    foundEmployment = true;
    if (canLeaderAccessAssignment(workspace, active, membership.organizationId, membership.factoryId, worker, { factoryId: membership.factoryId, groupId: employment.placement.groupId, leaderId: employment.placement.leaderId }, "canRecordHours")) return undefined;
  }
  if (!foundWorker) return "worker-unavailable";
  if (!foundEmployment) return "employment";
  return "worker-assignment";
}

export function createLeaderShifts(workerIds: string[], draft: ShiftDraft, submissionId?: string): number {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const membership = active.role === "leader" ? activeLeaderMemberships(workspace, active).find((item) => item.organizationId === active.organizationId && item.factoryId === active.factoryId) : undefined;
  const factory = membership ? getFactoryInOrganization(workspace, membership.organizationId, membership.factoryId ?? "") : undefined;
  const workflow = factory && effectiveWorkflowSettings(factory);
  const permissions = membership ? effectiveLeaderPermissions(membership) : undefined;
  if (active.role !== "leader" || !membership || !factory || factory.archivedAt || !workflow?.leaderCanRecordHours || !permissions?.canRecordHours || factory.allowTimeDataSubmission === false || !isValidShiftDraft({ ...draft, factoryId: membership.factoryId })) return 0;
  if (submissionId && workspace.shifts.some((record) => record.organizationId === workspace.organization.id && record.clientSubmissionId === submissionId)) {
    return workspace.shifts.filter((record) => record.organizationId === workspace.organization.id && record.clientSubmissionId === submissionId).length;
  }
  const validWorkers = [...new Set(workerIds)].flatMap((workerId) => {
    const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker" && member.organizationId === active.organizationId);
    const placement = activeEmploymentAt(workspace, membership.organizationId, workerId, membership.factoryId!, draft.localDate);
    return worker && placement && canLeaderAccessAssignment(workspace, active, membership.organizationId, membership.factoryId!, worker, { factoryId: membership.factoryId!, groupId: placement.placement.groupId, leaderId: placement.placement.leaderId }, "canRecordHours") ? [{ worker, period: placement.period }] : [];
  });
  if (!validWorkers.length) return 0;
  const knownFacts = new Set(workspace.shifts.map(factualShiftFingerprint).filter((key): key is string => Boolean(key)));
  const records = validWorkers.flatMap(({ worker, period }) => {
    const leaderDraft: ShiftDraft = { ...draft, factoryId: membership.factoryId };
    const workerId = worker.id;
    const requireReview = policyRequiresReview(workspace, workerId, leaderDraft) || workflow.agencyMustReviewShifts || workflow.leaderMustReviewShifts;
    const confirmation = workflow.workerMustConfirmShifts ? "pending" as const : "confirmed" as const;
    const shift = { ...shiftFromDraft(workerId, leaderDraft, "leader", active.id, requireReview, confirmation), employmentId: period.id };
    const record = {
      organizationId: workspace.organization.id,
      shift,
      clientSubmissionId: submissionId,
      plannedBreak: draft.plannedBreakStart || draft.plannedBreakEnd || draft.plannedBreakDurationMinutes || draft.plannedBreakTreatment ? { startTime: draft.plannedBreakStart, endTime: draft.plannedBreakEnd, durationMinutes: draft.plannedBreakDurationMinutes, treatment: draft.plannedBreakTreatment } : undefined,
      history: [makeHistoryEntry("created", active.id, 1, undefined, valuesFromShift(shift))],
      previousVersions: [],
    } satisfies DemoShiftRecord;
    const key = factualShiftFingerprint(record);
    if (!key || knownFacts.has(key)) return [];
    knownFacts.add(key);
    return [record];
  });
  if (!records.length) return 0;
  mutate((state) => ({
    ...state,
    shifts: [...records, ...state.shifts],
    notifications: [...records.map((record) => makeNotification(record.shift.workerUid, "shift-pending", record.shift.id)), ...state.notifications],
  }));
  return records.length;
}

export interface LeaderShiftTarget {
  organizationId: string;
  factoryId: string;
  workerId: string;
  employmentId: string;
}

export function createLeaderShiftBatch(targets: LeaderShiftTarget[], draft: ShiftDraft, submissionId?: string): number {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  if (actor.role !== "leader" || !isValidShiftDraft(draft)) return 0;
  if (submissionId && workspace.shifts.some((record) => record.clientSubmissionId === submissionId)) {
    return workspace.shifts.filter((record) => record.clientSubmissionId === submissionId).length;
  }
  const uniqueTargets = [...new Map(targets.map((target) => [`${target.organizationId}:${target.factoryId}:${target.workerId}`, target])).values()];
  const knownFacts = new Set(workspace.shifts.map(factualShiftFingerprint).filter((key): key is string => Boolean(key)));
  const accepted = uniqueTargets.flatMap((target) => {
    const worker = workspace.members.find((member) => member.id === target.workerId && member.organizationId === target.organizationId && member.role === "worker");
    const factory = getFactoryInOrganization(workspace, target.organizationId, target.factoryId);
    const period = workspace.employmentPeriods.find((item) => item.id === target.employmentId && item.organizationId === target.organizationId && item.workerId === target.workerId && item.state === "active" && item.startDate <= draft.localDate && (!item.endDate || item.endDate >= draft.localDate));
    const placement = period?.placements.find((item) => item.factoryId === target.factoryId && item.startDate <= draft.localDate && (!item.endDate || item.endDate >= draft.localDate));
    const membership = activeLeaderMemberships(workspace, actor).find((item) => item.organizationId === target.organizationId && item.factoryId === target.factoryId);
    if (!worker || !factory || factory.archivedAt || !period || !placement || !membership || factory.allowTimeDataSubmission === false || !effectiveWorkflowSettings(factory).leaderCanRecordHours
      || !effectiveLeaderPermissions(membership).canRecordHours
      || !canLeaderAccessAssignment(workspace, actor, target.organizationId, target.factoryId, worker, { factoryId: target.factoryId, groupId: placement.groupId, leaderId: placement.leaderId }, "canRecordHours")) return [];
    const preparedDraft = { ...draft, factoryId: target.factoryId };
    if (!isValidShiftDraft(preparedDraft)) return [];
    const workflow = effectiveWorkflowSettings(factory);
    const requiresReview = policyRequiresReview(workspace, worker.id, preparedDraft) || workflow.leaderMustReviewShifts || workflow.agencyMustReviewShifts;
    const confirmation = workflow.workerMustConfirmShifts ? "pending" as const : "confirmed" as const;
    const shift = { ...shiftFromDraft(worker.id, preparedDraft, "leader", membership.id, requiresReview, confirmation), employmentId: period.id };
    const record = { organizationId: target.organizationId, shift };
    const factualKey = factualShiftFingerprint(record);
    if (!factualKey || knownFacts.has(factualKey)) return [];
    knownFacts.add(factualKey);
    const now = new Date().toISOString();
    return [{ organizationId: target.organizationId, shift, clientSubmissionId: submissionId,
      plannedBreak: draft.plannedBreakStart || draft.plannedBreakEnd || draft.plannedBreakDurationMinutes || draft.plannedBreakTreatment ? { startTime: draft.plannedBreakStart, endTime: draft.plannedBreakEnd, durationMinutes: draft.plannedBreakDurationMinutes, treatment: draft.plannedBreakTreatment } : undefined,
      history: [makeHistoryEntry("created", membership.id, 1, undefined, valuesFromShift(shift))], previousVersions: [],
      notification: workflow.workerMustConfirmShifts ? { id: `notice-${crypto.randomUUID()}`, organizationId: target.organizationId, recipientId: worker.id, kind: "shift-pending" as const, subjectId: shift.id, createdAt: now } : undefined }];
  });
  if (!accepted.length) return 0;
  const records: DemoShiftRecord[] = accepted.map(({ notification: _notification, ...record }) => record);
  const notifications = accepted.flatMap((record) => record.notification ? [record.notification] : []);
  mutate((state) => ({ ...state, shifts: [...records, ...state.shifts], notifications: [...notifications, ...state.notifications] }));
  return records.length;
}

export function confirmShift(shiftId: string): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const factory = getFactory(workspace, record?.shift.factoryId);
  const workflow = factory && effectiveWorkflowSettings(factory);
  if (member.role !== "worker" || !record || !shiftEmploymentIsValid(workspace, record) || !workflow?.workerMustConfirmShifts || record.shift.deletedAt || record.shift.workerUid !== member.id || record.shift.workerConfirmation !== "pending") return false;
  const oldValues = valuesFromShift(record.shift);
  const shift = { ...record.shift, workerConfirmation: "confirmed" as const, updatedByUid: member.id, updatedAt: new Date().toISOString(), revision: record.shift.revision + 1 };
  const event = makeHistoryEntry("confirmed", member.id, shift.revision, oldValues, valuesFromShift(shift));
  const recipients = getProductionLeaderIds(workspace, record.shift.factoryId ?? "", shift.workerUid);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, history: [...entry.history, event] } : entry),
    notifications: [...recipients.map((recipient) => makeNotification(recipient, "shift-confirmed", shiftId)), ...state.notifications],
  }));
  return true;
}

export function disputeShift(shiftId: string, reason: string): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const cleanReason = reason.trim();
  const factory = getFactory(workspace, record?.shift.factoryId);
  const workflow = factory && effectiveWorkflowSettings(factory);
  if (member.role !== "worker" || !record || !shiftEmploymentIsValid(workspace, record) || !workflow?.workerCanDisputeShifts || record.shift.deletedAt || record.shift.workerUid !== member.id || record.shift.workerConfirmation !== "pending" && record.shift.workerConfirmation !== "confirmed" || !cleanReason) return false;
  const now = new Date().toISOString();
  const oldValues = valuesFromShift(record.shift);
  const shift = { ...record.shift, workerConfirmation: "disputed" as const, updatedByUid: member.id, updatedAt: now, revision: record.shift.revision + 1 };
  const event = makeHistoryEntry("disputed", member.id, shift.revision, oldValues, valuesFromShift(shift), cleanReason);
  const worker = workspace.members.find((item) => item.id === member.id)!;
  const assignment = getWorkerProductionAssignment(workspace, worker.id, record.shift.factoryId);
  const leaderId = assignment?.leaderId;
  const recipients = [...new Set([leaderId, ...getProductionLeaderIds(workspace, record.shift.factoryId ?? "", worker.id)].filter((value): value is string => Boolean(value)))];
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, dispute: { reason: cleanReason, submittedAt: now, state: "open" }, history: [...entry.history, event] } : entry),
    notifications: [...recipients.map((recipient) => makeNotification(recipient, "shift-disputed", shiftId)), ...state.notifications],
  }));
  return true;
}

export function correctDisputedShift(shiftId: string, draft: ShiftDraft, response: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const membership = record?.shift.factoryId && active.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, record.shift.factoryId, "canReviewShifts") : undefined;
  if (!membership || !record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || !record.dispute || record.dispute.state !== "open" || !canManageWorker(record.shift.workerUid, workspace, record.shift.factoryId) || !isValidShiftDraft({ ...draft, factoryId: record.shift.factoryId })) return false;
  const cleanResponse = response.trim();
  const oldValues = valuesFromShift(record.shift);
  const preparedDraft = { ...draft, factoryId: record.shift.factoryId };
  const shift = updateShiftFromDraft(record.shift, preparedDraft, membership.id, "pending", policyRequiresReview(workspace, record.shift.workerUid, preparedDraft));
  const now = new Date().toISOString();
  const event = makeHistoryEntry("corrected", membership.id, shift.revision, oldValues, valuesFromShift(shift), cleanResponse || undefined);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, dispute: { ...entry.dispute!, state: "accepted", leaderResponse: cleanResponse, resolvedAt: now }, previousVersions: [...entry.previousVersions, oldValues], history: [...entry.history, event] } : entry),
    notifications: [makeNotification(record.shift.workerUid, "shift-updated", shiftId, record.organizationId), ...state.notifications],
  }));
  return true;
}

export function declineDispute(shiftId: string, response: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const membership = record?.shift.factoryId && active.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, record.shift.factoryId, "canReviewShifts") : undefined;
  const cleanResponse = response.trim();
  if (!membership || !record || !shiftEmploymentIsValid(workspace, record) || !record.dispute || record.dispute.state !== "open" || !canManageWorker(record.shift.workerUid, workspace, record.shift.factoryId) || !cleanResponse) return false;
  const now = new Date().toISOString();
  const oldValues = valuesFromShift(record.shift);
  const shift = { ...record.shift, workerConfirmation: "confirmed" as const, updatedByUid: membership.id, updatedAt: now, revision: record.shift.revision + 1 };
  const event = makeHistoryEntry("declined", membership.id, shift.revision, oldValues, valuesFromShift(shift), cleanResponse);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, dispute: { ...entry.dispute!, state: "declined", leaderResponse: cleanResponse, resolvedAt: now }, history: [...entry.history, event] } : entry),
    notifications: [makeNotification(record.shift.workerUid, "shift-answer", shiftId, record.organizationId), ...state.notifications],
  }));
  return true;
}

function localTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function draftFromValues(values: DemoShiftValues): ShiftDraft {
  return {
    localDate: values.localDate,
    startTime: localTime(values.startAt),
    endTime: localTime(values.endAt),
    comment: values.comment,
    breakStatus: values.breakStatus,
    breakTreatment: values.breakTreatment,
    breakDurationMinutes: values.totalBreakDurationMinutes,
    breakStartTime: localTime(values.breakStartAt),
    breakEndTime: localTime(values.breakEndAt),
  };
}

export function editShiftAsAgency(shiftId: string, draft: ShiftDraft, reason: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const cleanReason = reason.trim();
  if (active.role !== "agency" || !record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || !cleanReason || !isValidShiftDraft({ ...draft, factoryId: record.shift.factoryId })) return false;
  const oldValues = valuesFromShift(record.shift);
  const preparedDraft = { ...draft, factoryId: record.shift.factoryId };
  const shift = updateShiftFromDraft(record.shift, preparedDraft, active.id, "pending", policyRequiresReview(workspace, record.shift.workerUid, preparedDraft));
  const event = makeHistoryEntry("organization-edited", active.id, shift.revision, oldValues, valuesFromShift(shift), cleanReason);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, previousVersions: [...entry.previousVersions, oldValues], history: [...entry.history, event] } : entry),
    notifications: [makeNotification(record.shift.workerUid, "shift-updated", shiftId), ...state.notifications],
  }));
  return true;
}

export function cancelShift(shiftId: string, reason: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId);
  const membership = record?.shift.factoryId && active.role === "leader" ? activeLeaderMembershipFor(workspace, record.organizationId, record.shift.factoryId, "canReviewShifts") : undefined;
  const actionActor = membership ?? active;
  const cleanReason = reason.trim();
  if (!record || !shiftEmploymentIsValid(workspace, record) || !cleanReason) return false;
  const allowed = active.role === "agency" && record.organizationId === active.organizationId && record.shift.agencyId === active.organizationId
    || Boolean(membership && canManageWorker(record.shift.workerUid, workspace, record.shift.factoryId));
  if (!allowed) return false;
  if (record.shift.deletedAt) return true;
  const now = new Date().toISOString();
  const shift = { ...record.shift, deletedAt: now, updatedAt: now, updatedByUid: actionActor.id, revision: record.shift.revision + 1 };
  const event = makeHistoryEntry("cancelled", actionActor.id, shift.revision, valuesFromShift(record.shift), valuesFromShift(shift), cleanReason);
  mutate((state) => ({
    ...state,
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, shift, cancelledAt: now, cancelledById: actionActor.id, cancellationReason: cleanReason, previousVersions: [...entry.previousVersions, valuesFromShift(record.shift)], history: [...entry.history, event] } : entry),
    notifications: [makeNotification(record.shift.workerUid, "shift-cancelled", shiftId, record.organizationId), ...state.notifications],
  }));
  return true;
}

function messageMembership(workspace: DemoWorkspace, thread: DemoMessageThread): DemoMember | undefined {
  const actor = getActiveMember(workspace);
  const identities = actor.role === "leader" ? activeLeaderMemberships(workspace, actor) : [actor];
  return identities.find((member) => {
    if (!thread.participants.includes(member.id) || member.accessState === "suspended" || member.accessState === "revoked") return false;
    if (member.organizationId === thread.organizationId) return true;
    if (member.role !== "factory-admin" || !member.businessEntityId || !thread.factoryId) return false;
    const factory = workspace.factories.find((item) => item.id === thread.factoryId && item.organizationId === thread.organizationId && !item.archivedAt);
    return Boolean(factory && workspace.agencyWorksites?.some((link) => link.organizationId === thread.organizationId && link.businessEntityId === member.businessEntityId && link.worksiteId === factory.worksiteId && link.state === "active"));
  });
}

export function getVisibleMessageThreads(workspace = readWorkspace()): DemoMessageThread[] {
  return workspace.messageThreads.filter((thread) => Boolean(messageMembership(workspace, thread)));
}

function messageNotice(workspace: DemoWorkspace, recipientId: string, thread: DemoMessageThread) {
  const recipient = workspace.members.find((item) => item.id === recipientId);
  return makeNotification(recipientId, "message-received", thread.id, recipient?.organizationId ?? thread.organizationId);
}

export function getWorkerMessageRecipient(recipientType: "agency" | "leader" | "production", factoryId?: string, workspace = readWorkspace()): { recipientId: string; factoryId?: string } | undefined {
  const worker = getActiveMember(workspace);
  if (worker.role !== "worker") return undefined;
  let recipientId: string | undefined;
  let selectedFactoryId: string | undefined;
  if (recipientType === "agency") recipientId = workspace.members.find((item) => item.organizationId === workspace.organization.id && item.role === "agency")?.id;
  else {
    const assignment = getWorkerProductionAssignment(workspace, worker.id, factoryId);
    if (!assignment) return undefined;
    selectedFactoryId = factoryId;
    const factory = workspace.factories.find((item) => item.id === factoryId && item.organizationId === worker.organizationId && !item.archivedAt);
    if (!factory || !getProductionWorkers(workspace, factory.id).some((item) => item.id === worker.id)) return undefined;
    if (recipientType === "leader") {
      const leader = workspace.members.find((item) => item.id === assignment.leaderId && item.role === "leader" && item.organizationId === worker.organizationId && item.factoryId === factory.id && item.accessState !== "suspended" && item.accessState !== "revoked");
      if (!leader || !getLeaderProductionParticipants(workspace, leader.id, factory.id).some((entry) => entry.worker.id === worker.id && entry.accessState === "active")) return undefined;
      recipientId = leader.id;
    } else {
      const site = workspace.worksites?.find((item) => item.id === factory.worksiteId);
      const entity = workspace.businessEntities?.find((item) => item.id === site?.businessEntityId);
      const connected = entity && (entity.organizationId === worker.organizationId || workspace.agencyWorksites?.some((link) => link.organizationId === worker.organizationId && link.businessEntityId === entity.id && link.worksiteId === site?.id && link.state === "active"));
      const admins = connected ? workspace.members.filter((item) => item.role === "factory-admin" && item.businessEntityId === entity.id && item.accessState !== "suspended" && item.accessState !== "revoked") : [];
      if (admins.length !== 1) return undefined;
      recipientId = admins[0].id;
    }
  }
  if (!recipientId) return undefined;
  return { recipientId, factoryId: selectedFactoryId };
}

export function createWorkerMessage(recipientType: "agency" | "leader" | "production", subject: string, text: string, factoryId?: string): boolean {
  const workspace = readWorkspace();
  const worker = getActiveMember(workspace);
  const cleanSubject = subject.trim();
  const cleanText = text.trim();
  if (worker.role !== "worker" || !cleanSubject || !cleanText) return false;
  const recipient = getWorkerMessageRecipient(recipientType, factoryId, workspace);
  if (!recipient) return false;
  const { recipientId, factoryId: selectedFactoryId } = recipient;
  const now = new Date().toISOString();
  const thread: DemoMessageThread = {
    id: `thread-${crypto.randomUUID()}`, organizationId: workspace.organization.id, workerId: worker.id,
    factoryId: selectedFactoryId, recipientType, recipientId, participants: [worker.id, recipientId], subject: cleanSubject,
    state: "open", createdAt: now, updatedAt: now,
    messages: [{ id: `message-${crypto.randomUUID()}`, senderId: worker.id, text: cleanText, sentAt: now, readByIds: [worker.id] }],
  };
  mutate((state) => ({ ...state, messageThreads: [thread, ...state.messageThreads], notifications: [messageNotice(state, recipientId!, thread), ...state.notifications] }));
  return true;
}

export function createAgencyMessage(input: {
  audience: "workers" | "production" | "group" | "leader";
  subject: string;
  text: string;
  workerIds?: string[];
  factoryId?: string;
  groupId?: string;
  leaderId?: string;
}): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const subject = input.subject.trim();
  const text = input.text.trim();
  if (actor.role !== "agency" || !subject || !text) return false;
  const now = new Date().toISOString();

  if (input.audience === "leader") {
    const factory = workspace.factories.find((item) => item.id === input.factoryId && item.organizationId === actor.organizationId && !item.archivedAt);
    const leader = workspace.members.find((item) => item.id === input.leaderId && item.organizationId === actor.organizationId && item.role === "leader" && item.accessState !== "suspended" && item.accessState !== "revoked");
    const membership = leader && activeLeaderMemberships(workspace, leader).find((item) => item.organizationId === actor.organizationId && item.factoryId === input.factoryId && effectiveLeaderPermissions(item).canViewWorkers);
    const leaderParticipants = factory && leader ? getLeaderProductionParticipants(scopedWorkspace(workspace, actor.organizationId), leader.id, factory.id)
      .filter((entry) => entry.accessState === "active" && workerPayer(workspace, entry.worker)?.payerType === "agency" && workerPayer(workspace, entry.worker)?.payerId === actor.organizationId) : [];
    if (!factory || !leader || !membership || leaderParticipants.length === 0) return false;
    const thread: DemoMessageThread = {
      id: `thread-${crypto.randomUUID()}`,
      organizationId: actor.organizationId,
      factoryId: factory.id,
      recipientType: "leader",
      recipientId: leader.id,
      participants: [actor.id, leader.id],
      subject,
      state: "open",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: `message-${crypto.randomUUID()}`, senderId: actor.id, text, sentAt: now, readByIds: [actor.id] }],
    };
    mutate((state) => ({ ...state, messageThreads: [thread, ...state.messageThreads], notifications: [makeNotification(leader.id, "message-received", thread.id, actor.organizationId), ...state.notifications] }));
    return true;
  }

  let recipients: DemoMember[] = [];
  if (input.audience === "workers") {
    const selectedIds = [...new Set(input.workerIds ?? [])];
    if (!selectedIds.length) return false;
    recipients = selectedIds.flatMap((id) => {
      const worker = workspace.members.find((item) => item.id === id && item.organizationId === actor.organizationId && item.role === "worker");
      const employed = workspace.employmentPeriods.some((period) => period.organizationId === actor.organizationId && period.workerId === id && period.state === "active" && period.startDate <= todayDate() && (!period.endDate || period.endDate >= todayDate()));
      const payer = worker && workerPayer(workspace, worker);
      if (!worker || !employed || payer?.payerType !== "agency" || payer.payerId !== actor.organizationId) return [];
      if (input.factoryId && !getWorkerProductionAssignment(workspace, id, input.factoryId, actor.organizationId)) return [];
      return [worker];
    });
    if (recipients.length !== selectedIds.length) return false;
  } else {
    const factory = workspace.factories.find((item) => item.id === input.factoryId && item.organizationId === actor.organizationId && !item.archivedAt);
    if (!factory) return false;
    recipients = getProductionWorkers(workspace, factory.id).filter((worker) => {
      const payer = workerPayer(workspace, worker);
      if (payer?.payerType !== "agency" || payer.payerId !== actor.organizationId) return false;
      return input.audience !== "group" || Boolean(input.groupId && workspace.groups.some((group) => group.id === input.groupId && group.factoryId === factory.id && group.organizationId === actor.organizationId && !group.archivedAt)
        && getWorkerProductionAssignment(workspace, worker.id, factory.id, actor.organizationId)?.groupId === input.groupId);
    });
    if (input.audience === "group" && !input.groupId) return false;
  }

  const uniqueRecipients = [...new Map(recipients.map((worker) => [worker.accountUid ?? worker.id, worker])).values()];
  if (!uniqueRecipients.length) return false;
  const threads = uniqueRecipients.map((worker): DemoMessageThread => {
    const factoryId = input.factoryId && getWorkerProductionAssignment(workspace, worker.id, input.factoryId, actor.organizationId) ? input.factoryId : undefined;
    return {
      id: `thread-${crypto.randomUUID()}`,
      organizationId: actor.organizationId,
      workerId: worker.id,
      factoryId,
      recipientType: "worker",
      recipientId: worker.id,
      participants: [actor.id, worker.id],
      subject,
      state: "open",
      createdAt: now,
      updatedAt: now,
      messages: [{ id: `message-${crypto.randomUUID()}`, senderId: actor.id, text, sentAt: now, readByIds: [actor.id] }],
    };
  });
  mutate((state) => ({
    ...state,
    messageThreads: [...threads, ...state.messageThreads],
    notifications: [...threads.map((thread) => makeNotification(thread.recipientId, "message-received", thread.id, actor.organizationId)), ...state.notifications],
  }));
  return true;
}

export function createLeaderWorkerMessage(leaderMembershipId: string, workerId: string, category: "service-note" | "complaint", subject: string, text: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const membership = actor.role === "leader" ? activeLeaderMemberships(workspace, actor).find((item) => item.id === leaderMembershipId) : undefined;
  const cleanSubject = subject.trim();
  const cleanText = text.trim();
  if (!membership || !effectiveLeaderPermissions(membership).canViewWorkers || !membership.factoryId || !cleanSubject || !cleanText) return false;
  const scoped = scopedWorkspace(workspace, membership.organizationId);
  const participant = getLeaderProductionParticipants(scoped, membership.id, membership.factoryId).find((item) => item.worker.id === workerId && item.accessState === "active");
  if (!participant) return false;
  const now = new Date().toISOString();
  const thread: DemoMessageThread = {
    id: `thread-${crypto.randomUUID()}`, organizationId: membership.organizationId, workerId,
    factoryId: membership.factoryId, recipientType: "worker", category, recipientId: workerId,
    participants: [membership.id, workerId], subject: cleanSubject, state: "open", createdAt: now, updatedAt: now,
    messages: [{ id: `message-${crypto.randomUUID()}`, senderId: membership.id, text: cleanText, sentAt: now, readByIds: [membership.id] }],
  };
  mutate((state) => ({ ...state, messageThreads: [thread, ...state.messageThreads], notifications: [makeNotification(workerId, "message-received", thread.id, membership.organizationId), ...state.notifications] }));
  return true;
}

export function replyToMessage(threadId: string, text: string): boolean {
  const workspace = readWorkspace();
  const thread = getVisibleMessageThreads(workspace).find((item) => item.id === threadId);
  const active = thread ? messageMembership(workspace, thread)! : getActiveMember(workspace);
  const cleanText = text.trim();
  if (!thread || !cleanText || thread.state === "closed") return false;
  const now = new Date().toISOString();
  const message = { id: `message-${crypto.randomUUID()}`, senderId: active.id, text: cleanText, sentAt: now, readByIds: [active.id] };
  const recipients = [...new Set(thread.participants)].filter((participantId) => participantId !== active.id);
  mutate((state) => ({
    ...state,
    messageThreads: state.messageThreads.map((item) => item.id === threadId ? { ...item, updatedAt: now, messages: [...item.messages.map((entry) => ({ ...entry })), message] } : item),
    notifications: [...recipients.map((recipientId) => messageNotice(state, recipientId, thread)), ...state.notifications],
  }));
  return true;
}

export function markMessageThreadRead(threadId: string): void {
  const workspace = readWorkspace();
  const thread = getVisibleMessageThreads(workspace).find((item) => item.id === threadId);
  const active = thread ? messageMembership(workspace, thread)! : getActiveMember(workspace);
  if (!thread || thread.messages.every((message) => message.senderId === active.id || message.readByIds.includes(active.id))) return;
  mutate((state) => ({
    ...state,
    messageThreads: state.messageThreads.map((item) => item.id === threadId ? { ...item, messages: item.messages.map((message) => ({ ...message, readByIds: message.senderId === active.id || message.readByIds.includes(active.id) ? message.readByIds : [...message.readByIds, active.id] })) } : item),
    notifications: state.notifications.map((notice) => notice.recipientId === active.id && notice.kind === "message-received" && notice.subjectId === threadId ? { ...notice, readAt: new Date().toISOString() } : notice),
  }));
}

export function getScheduleOccurrences(schedule: DemoSchedule, fromDate = schedule.startDate, toDate = schedule.endDate): string[] {
  if (schedule.state !== "active" || !schedule.weekdays.length || toDate < fromDate) return [];
  const start = fromDate < schedule.startDate ? schedule.startDate : fromDate;
  const end = toDate > schedule.endDate ? schedule.endDate : toDate;
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  const dates: string[] = [];
  while (cursor <= last && dates.length < 400) {
    if (schedule.weekdays.includes(cursor.getDay())) dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function createSchedule(input: Omit<DemoSchedule, "id" | "organizationId" | "state" | "createdById" | "createdAt" | "updatedAt" | "history">): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const factory = workspace.factories.find((item) => item.id === input.factoryId && (active.role === "factory-admin" || item.organizationId === workspace.organization.id));
  const workerIds = [...new Set(input.workerIds)];
  if (active.role !== "leader" || !factory || !canManageFactory(factory.id, workspace) || !workerIds.length || input.endDate < input.startDate || input.startTime === input.endTime || !input.weekdays.length) return false;
  if (workerIds.some((workerId) => !getWorkerProductionAssignment(workspace, workerId, factory.id, factory.organizationId) || !canManageWorker(workerId, workspace, factory.id))) return false;
  const now = new Date().toISOString();
  const schedule: DemoSchedule = { ...input, workerIds, id: `schedule-${crypto.randomUUID()}`, organizationId: factory.organizationId, state: "active", createdById: active.id, createdAt: now, updatedAt: now, history: [{ id: `schedule-event-${crypto.randomUUID()}`, actorId: active.id, action: "created", occurredAt: now }] };
  mutate((state) => ({ ...state, schedules: [schedule, ...state.schedules], notifications: [...workerIds.map((recipientId) => makeNotification(recipientId, "schedule-updated", schedule.id, schedule.organizationId)), ...state.notifications] }));
  return true;
}

export function updateSchedule(scheduleId: string, changes: Pick<DemoSchedule, "startDate" | "endDate" | "weekdays" | "startTime" | "endTime" | "plannedBreakStart" | "plannedBreakEnd">): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const schedule = workspace.schedules.find((item) => item.id === scheduleId && item.state === "active");
  if (active.role !== "leader" || !schedule || !canManageFactory(schedule.factoryId, workspace) || schedule.workerIds.some((workerId) => !canManageWorker(workerId, workspace, schedule.factoryId)) || changes.endDate < changes.startDate || changes.startTime === changes.endTime || !changes.weekdays.length) return false;
  const now = new Date().toISOString();
  const event = { id: `schedule-event-${crypto.randomUUID()}`, actorId: active.id, action: "updated" as const, occurredAt: now };
  mutate((state) => ({ ...state, schedules: state.schedules.map((item) => item.id === scheduleId ? { ...item, ...changes, updatedAt: now, history: [...item.history, event] } : item), notifications: [...schedule.workerIds.map((recipientId) => makeNotification(recipientId, "schedule-updated", scheduleId, schedule.organizationId)), ...state.notifications] }));
  return true;
}

export function cancelSchedule(scheduleId: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const schedule = workspace.schedules.find((item) => item.id === scheduleId && item.state === "active");
  if (active.role !== "leader" || !schedule || !canManageFactory(schedule.factoryId, workspace) || schedule.workerIds.some((workerId) => !canManageWorker(workerId, workspace, schedule.factoryId))) return false;
  const now = new Date().toISOString();
  const event = { id: `schedule-event-${crypto.randomUUID()}`, actorId: active.id, action: "cancelled" as const, occurredAt: now };
  mutate((state) => ({ ...state, schedules: state.schedules.map((item) => item.id === scheduleId ? { ...item, state: "cancelled", updatedAt: now, history: [...item.history, event] } : item), notifications: [...schedule.workerIds.map((recipientId) => makeNotification(recipientId, "schedule-updated", scheduleId, schedule.organizationId)), ...state.notifications] }));
  return true;
}

export function recordScheduleOutcome(scheduleId: string, workerId: string, localDate: string, outcome: DemoScheduleOutcome, note = ""): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const schedule = workspace.schedules.find((item) => item.id === scheduleId && item.state === "active");
  if (active.role !== "leader" || !schedule || !schedule.workerIds.includes(workerId) || !getScheduleOccurrences(schedule).includes(localDate) || !canManageFactory(schedule.factoryId, workspace) || !canManageWorker(workerId, workspace, schedule.factoryId)) return false;
  const now = new Date().toISOString();
  const event = { id: `schedule-event-${crypto.randomUUID()}`, actorId: active.id, action: "attendance-reviewed" as const, occurredAt: now, note: note.trim() || outcome };
  const existing = workspace.scheduleAttendanceReviews.find((item) => item.scheduleId === scheduleId && item.workerId === workerId && item.localDate === localDate);
  const review: DemoScheduleAttendanceReview = existing
    ? { ...existing, outcome, note: note.trim(), reviewedById: active.id, reviewedAt: now, history: [...existing.history, event] }
    : { id: `schedule-review-${crypto.randomUUID()}`, organizationId: schedule.organizationId, scheduleId, workerId, factoryId: schedule.factoryId, localDate, outcome, note: note.trim(), reviewedById: active.id, reviewedAt: now, history: [event] };
  mutate((state) => ({ ...state, scheduleAttendanceReviews: existing ? state.scheduleAttendanceReviews.map((item) => item.id === existing.id ? review : item) : [review, ...state.scheduleAttendanceReviews] }));
  return true;
}

export function submitShiftChangeRequest(shiftId: string, draft: ShiftDraft, reason: string, approverType: "agency" | "leader"): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.shifts.find((entry) => entry.shift.id === shiftId && entry.organizationId === workspace.organization.id);
  const factory = record && getFactory(workspace, record.shift.factoryId);
  const workflow = factory && effectiveWorkflowSettings(factory);
  const cleanReason = reason.trim();
  if (active.role !== "worker" || !record || !shiftEmploymentIsValid(workspace, record) || record.shift.deletedAt || record.shift.workerUid !== active.id || !workflow?.workerCanDisputeShifts || !cleanReason || !isValidShiftDraft({ ...draft, factoryId: record.shift.factoryId })) return false;
  const proposedValues = deriveValues({ ...draft, factoryId: record.shift.factoryId });
  if (hasWorkerShiftConflict(workspace, record.organizationId, active.id, shiftId, proposedValues.startAt, proposedValues.endAt)) return false;
  if ((workspace.changeRequests ?? []).some((request) => request.shiftId === shiftId && request.state === "open")) return false;
  const assignment = getWorkerProductionAssignment(workspace, active.id, record.shift.factoryId);
  const leaderApprover = workspace.members.find((item) => item.id === assignment?.leaderId && item.role === "leader" && item.organizationId === workspace.organization.id && item.factoryId === record.shift.factoryId && item.accessState !== "suspended" && item.accessState !== "revoked" && effectiveLeaderPermissions(item).canReviewShifts);
  if (approverType === "agency" && !workflow?.agencyMustReviewShifts || approverType === "leader" && (!workflow?.leaderMustReviewShifts || !leaderApprover)) return false;
  if (approverType === "leader" && !leaderApprover) return false;
  const approverId = approverType === "agency" ? workspace.members.find((item) => item.role === "agency" && item.organizationId === workspace.organization.id)?.id : leaderApprover?.id;
  if (!approverId) return false;
  const now = new Date().toISOString();
  const request: DemoChangeRequest = {
    id: `change-${crypto.randomUUID()}`,
    organizationId: workspace.organization.id,
    shiftId,
    workerId: active.id,
    approverType,
    approverId,
    state: "open",
    reason: cleanReason,
    proposedValues,
    originalValues: valuesFromShift(record.shift),
    originalRevision: record.shift.revision,
    requestedAt: now,
  };
  const event = makeHistoryEntry("change-requested", active.id, record.shift.revision, request.originalValues, request.proposedValues, cleanReason);
  const recipients = new Set([approverId]);
  if (approverType === "leader") {
    const leaderId = getWorkerProductionAssignment(workspace, active.id, record.shift.factoryId)?.leaderId;
    if (leaderId) recipients.add(leaderId);
  }
  mutate((state) => ({
    ...state,
    changeRequests: [...(state.changeRequests ?? []), request],
    shifts: state.shifts.map((entry) => entry.shift.id === shiftId ? { ...entry, history: [...entry.history, event] } : entry),
    notifications: [...[...recipients].map((recipient) => makeNotification(recipient, "change-requested", request.id)), ...state.notifications],
  }));
  return true;
}

export function respondToShiftChangeRequest(requestId: string, decision: "approve" | "reject", response: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const request = (workspace.changeRequests ?? []).find((item) => item.id === requestId && item.state === "open");
  const record = request && workspace.shifts.find((entry) => entry.shift.id === request.shiftId && entry.organizationId === request.organizationId);
  const factory = record && getFactoryInOrganization(workspace, record.organizationId, record.shift.factoryId ?? "");
  const workflow = factory && effectiveWorkflowSettings(factory);
  const membership = request?.approverType === "leader" && record?.shift.factoryId ? activeLeaderMembershipFor(workspace, request.organizationId, record.shift.factoryId, "canReviewShifts") : undefined;
  const actionActor = membership ?? active;
  const cleanResponse = response.trim();
  if (!request || !record || !factory || !workflow || !shiftEmploymentIsValid(workspace, record) || (decision === "reject" && !cleanResponse)) return false;
  const authorized = request.approverType === "agency"
    ? active.role === "agency" && active.organizationId === request.organizationId && workflow.agencyMustReviewShifts
    : Boolean(membership && membership.id === request.approverId && workflow.leaderMustReviewShifts && canManageWorker(request.workerId, workspace, record.shift.factoryId));
  if (!authorized) return false;
  const currentValues = valuesFromShift(record.shift);
  if (decision === "approve" && request.originalRevision !== undefined && record.shift.revision !== request.originalRevision) return false;
  const now = new Date().toISOString();
  const oldValues = currentValues;
  const approvedDraft = { ...draftFromValues(request.proposedValues), factoryId: record.shift.factoryId };
  const approvedValues = deriveValues(approvedDraft);
  if (decision === "approve" && hasWorkerShiftConflict(workspace, record.organizationId, request.workerId, record.shift.id, approvedValues.startAt, approvedValues.endAt)) return false;
  const requiresReview = policyRequiresReview(workspace, request.workerId, approvedDraft)
    || workflow.agencyMustReviewShifts && request.approverType !== "agency"
    || workflow.leaderMustReviewShifts && request.approverType !== "leader";
  const updatedShift = decision === "approve"
    ? updateShiftFromDraft(record.shift, approvedDraft, actionActor.id, "pending", requiresReview)
    : record.shift;
  const event = makeHistoryEntry(
    decision === "approve" ? "change-request-approved" : "change-request-declined",
    actionActor.id,
    updatedShift.revision,
    oldValues,
    decision === "approve" ? valuesFromShift(updatedShift) : oldValues,
    decision === "approve" ? cleanResponse || request.reason : cleanResponse,
  );
  mutate((state) => ({
    ...state,
    changeRequests: (state.changeRequests ?? []).map((item) => item.id === requestId ? { ...item, state: decision === "approve" ? "approved" : "rejected", resolvedAt: now, resolvedById: actionActor.id, response: cleanResponse } : item),
    shifts: state.shifts.map((entry) => entry.shift.id === record.shift.id ? {
      ...entry,
      shift: updatedShift,
      previousVersions: decision === "approve" ? [...entry.previousVersions, oldValues] : entry.previousVersions,
      history: [...entry.history, event],
    } : entry),
    notifications: [makeNotification(request.workerId, decision === "approve" ? "change-request-approved" : "change-request-rejected", requestId, request.organizationId), ...state.notifications],
  }));
  return true;
}

export function reportAbsence(localDate: string, reason: DemoAbsenceReason, message: string, factoryId = getActiveMember().factoryId): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  if (member.role !== "worker" || !factoryId || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return false;
  const activePlacement = activeEmploymentAt(workspace, workspace.organization.id, member.id, factoryId, localDate);
  if (!activePlacement) return false;
  const assignment = getWorkerProductionAssignment(workspace, member.id, factoryId);
  const now = new Date().toISOString();
  const record: DemoAbsence = {
    id: `absence-${crypto.randomUUID()}`, organizationId: workspace.organization.id, workerId: member.id, employmentId: activePlacement.period.id,
    factoryId, groupId: assignment?.groupId ?? "", localDate, reason, message: message.trim() || undefined, reportedAt: now,
    state: "reported", createdById: member.id,
    history: [{ id: `absence-event-${crypto.randomUUID()}`, actorId: member.id, actorName: member.name, action: "reported", occurredAt: now, after: { localDate, reason, message: message.trim() || undefined } }],
  };
  const absenceLeaders = getAbsenceLeaderRecipients(workspace, member.id, factoryId);
  const agencyId = workspace.members.find((item) => item.organizationId === workspace.organization.id && item.role === "agency")?.id;
  const recipients = [...new Set([...absenceLeaders, ...(agencyId ? [agencyId] : [])])];
  mutate((state) => ({ ...state, absences: [record, ...state.absences], notifications: [...recipients.map((recipient) => makeNotification(recipient, "absence-reported", record.id)), ...state.notifications] }));
  return true;
}

export function editOwnAbsenceReport(absenceId: string, localDate: string, reason: DemoAbsenceReason, message: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.workerId === actor.id && item.state !== "cancelled");
  if (actor.role !== "worker" || !record || !["reported", "clarification-requested", "rejected"].includes(record.state)
    || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !absenceEmploymentIsValid(workspace, record)) return false;
  const placement = activeEmploymentAt(workspace, record.organizationId, actor.id, record.factoryId, localDate);
  if (!placement || record.employmentId && placement.period.id !== record.employmentId) return false;
  const now = new Date().toISOString();
  const nextMessage = message.trim() || undefined;
  const before = { localDate: record.localDate, reason: record.reason, message: record.message };
  const after = { localDate, reason, message: nextMessage };
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: actor.id, actorName: actor.name, action: "edited", occurredAt: now, before, after };
  const recipients = [...new Set([...getAbsenceLeaderRecipients(workspace, actor.id, record.factoryId), ...workspace.members.filter((item) => item.organizationId === record.organizationId && item.role === "agency").map((item) => item.id)])];
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? { ...item, ...after, state: "reported", reportedAt: now, agencyCategory: undefined, agencyNote: undefined, clarificationRequest: undefined, clarificationReply: undefined, history: [...item.history, event] } : item),
    notifications: [...recipients.map((recipientId) => makeNotification(recipientId, "absence-reported", absenceId, record.organizationId)), ...state.notifications],
  }));
  return true;
}

export function cancelOwnAbsenceReport(absenceId: string, reason = ""): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.workerId === actor.id && item.state !== "cancelled");
  if (actor.role !== "worker" || !record || !["reported", "clarification-requested", "rejected"].includes(record.state) || !absenceEmploymentIsValid(workspace, record)) return false;
  const now = new Date().toISOString();
  const before = { localDate: record.localDate, reason: record.reason, message: record.message };
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: actor.id, actorName: actor.name, action: "cancelled", occurredAt: now, note: reason.trim() || undefined, before };
  const agencyIds = workspace.members.filter((item) => item.organizationId === record.organizationId && item.role === "agency").map((item) => item.id);
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? { ...item, state: "cancelled", agencyCategory: undefined, agencyNote: undefined, history: [...item.history, event] } : item),
    notifications: [...agencyIds.map((recipientId) => makeNotification(recipientId, "absence-agency-decision", absenceId, record.organizationId)), ...state.notifications],
  }));
  return true;
}

export function reviewAgencyAbsence(absenceId: string, decision: "confirm" | "reject", note = ""): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.organizationId === actor.organizationId);
  const cleanNote = note.trim();
  if (actor.role !== "agency" || !record || !absenceEmploymentIsValid(workspace, record)
    || record.state !== "reported" && record.state !== "clarification-requested"
    || decision === "reject" && !cleanNote
    || decision === "confirm" && getAgencyAbsenceConflictingShifts(absenceId, workspace).length > 0) return false;
  const now = new Date().toISOString();
  const action = decision === "confirm" ? "reviewed" : "rejected";
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: actor.id, actorName: actor.name, action, occurredAt: now, note: cleanNote || undefined };
  const workerId = record.workerId;
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? {
      ...item,
      state: decision === "confirm" ? "reviewed" : "rejected",
      agencyCategory: decision === "confirm" ? "confirmed-no-hours" : undefined,
      agencyNote: cleanNote || undefined,
      history: [...item.history, event],
    } : item),
    notifications: [makeNotification(workerId, "absence-agency-decision", absenceId, record.organizationId), ...state.notifications],
  }));
  return true;
}

export function decideAbsence(absenceId: string, decision: DemoAbsenceDecision, note = ""): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.organizationId === workspace.organization.id);
  const cleanNote = note.trim();
  if (active.role !== "leader" || !record || !absenceEmploymentIsValid(workspace, record) || record.factoryId !== active.factoryId || record.state !== "reported" && record.state !== "clarification-requested" || !effectiveLeaderPermissions(active).canReviewShifts || !canManageWorker(record.workerId, workspace, record.factoryId) || ((decision === "send-agency" || decision === "unreported") && !cleanNote)) return false;
  const now = new Date().toISOString();
  const agencyCategory = decision === "confirmed-no-hours" ? "confirmed-no-hours" : decision === "urlop-na-zadanie" ? "urlop-na-zadanie" : decision === "unreported" ? "unreported" : "attention";
  const historyAction = decision === "confirmed-no-hours" ? "confirmed-no-hours" : decision === "urlop-na-zadanie" ? "urlop-na-zadanie" : decision === "unreported" ? "marked-unreported" : "agency-notified";
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: historyAction, occurredAt: now, note: cleanNote || undefined };
  const noticeEvent: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: "agency-notified", occurredAt: now };
  const agencyId = workspace.members.find((item) => item.organizationId === workspace.organization.id && item.role === "agency")?.id;
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? {
      ...item,
      state: decision === "unreported" ? "unreported" : "reviewed",
      leaderNote: cleanNote || item.leaderNote,
      agencyCategory,
      agencyNote: decision === "send-agency" || decision === "unreported" ? cleanNote : undefined,
      history: [...item.history, event, ...(decision === "send-agency" ? [] : [noticeEvent])],
    } : item),
    notifications: agencyId ? [makeNotification(agencyId, "absence-agency-update", absenceId), ...state.notifications] : state.notifications,
  }));
  return true;
}

export function reviewAbsence(absenceId: string, note: string): boolean {
  return decideAbsence(absenceId, "confirmed-no-hours", note);
}

export function requestAbsenceClarification(absenceId: string, message: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.organizationId === workspace.organization.id);
  const cleanMessage = message.trim();
  if (active.role !== "leader" || !record || !absenceEmploymentIsValid(workspace, record) || record.factoryId !== active.factoryId || record.state !== "reported" || !effectiveLeaderPermissions(active).canReviewShifts || !canManageWorker(record.workerId, workspace, record.factoryId) || !cleanMessage) return false;
  const now = new Date().toISOString();
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: "clarification-requested", occurredAt: now, note: cleanMessage };
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? { ...item, state: "clarification-requested", clarificationRequest: cleanMessage, clarificationReply: undefined, history: [...item.history, event] } : item),
    notifications: [makeNotification(record.workerId, "absence-clarification-requested", absenceId), ...state.notifications],
  }));
  return true;
}

export function replyToAbsenceClarification(absenceId: string, message: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.organizationId === workspace.organization.id);
  const cleanMessage = message.trim();
  if (active.role !== "worker" || !record || !absenceEmploymentIsValid(workspace, record) || record.workerId !== active.id || record.state !== "clarification-requested" || !cleanMessage) return false;
  const now = new Date().toISOString();
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: "clarification-replied", occurredAt: now, note: cleanMessage };
  const leaderIds = getAbsenceLeaderRecipients(workspace, active.id, record.factoryId);
  mutate((state) => ({
    ...state,
    absences: state.absences.map((item) => item.id === absenceId ? { ...item, state: "reported", clarificationReply: cleanMessage, history: [...item.history, event] } : item),
    notifications: [...leaderIds.map((leaderId) => makeNotification(leaderId, "absence-reported", absenceId)), ...state.notifications],
  }));
  return true;
}

export function recordLeaderAbsence(workerId: string, localDate: string, reason: DemoAbsenceReason | "unreported", note = ""): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const worker = workspace.members.find((member) => member.id === workerId);
  const cleanNote = note.trim();
  const activePlacement = active.factoryId ? activeEmploymentAt(workspace, workspace.organization.id, workerId, active.factoryId, localDate) : undefined;
  if (active.role !== "leader" || !active.factoryId || !worker || !activePlacement || !effectiveLeaderPermissions(active).canReviewShifts || !canManageWorker(workerId, workspace, active.factoryId) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || (reason === "other" && !cleanNote) || (reason === "unreported" && !cleanNote)) return false;
  const assignment = getWorkerProductionAssignment(workspace, workerId, active.factoryId);
  const now = new Date().toISOString();
  const unreported = reason === "unreported";
  const record: DemoAbsence = {
    id: `absence-${crypto.randomUUID()}`, organizationId: workspace.organization.id, workerId, employmentId: activePlacement.period.id,
    factoryId: active.factoryId, groupId: assignment?.groupId ?? "", localDate, reason: unreported ? undefined : reason, state: unreported ? "unreported" : "reviewed", leaderNote: cleanNote || undefined, agencyCategory: unreported ? "unreported" : reason === "day-off" ? "agreed-day-off" : undefined, agencyNote: unreported ? cleanNote : undefined, createdById: active.id,
    history: [{ id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: unreported ? "marked-unreported" : "recorded", occurredAt: now, note: cleanNote || undefined }, ...(unreported ? [{ id: `absence-event-${crypto.randomUUID()}`, actorId: active.id, actorName: active.name, action: "agency-notified" as const, occurredAt: now, note: cleanNote }] : [])],
  };
  const agencyId = unreported ? workspace.members.find((item) => item.organizationId === workspace.organization.id && item.role === "agency")?.id : undefined;
  mutate((state) => ({ ...state, absences: [record, ...state.absences], notifications: agencyId ? [makeNotification(agencyId, "absence-agency-update", record.id), ...state.notifications] : state.notifications }));
  return true;
}

export function markUnreportedAbsence(workerId: string, localDate: string, note: string): boolean {
  return recordLeaderAbsence(workerId, localDate, "unreported", note);
}

export function markNotificationRead(notificationId: string) {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  mutate((state) => ({ ...state, notifications: state.notifications.map((notification) => notification.id === notificationId && notification.recipientId === member.id ? { ...notification, readAt: new Date().toISOString() } : notification) }));
}

export function saveTemplate(input: Omit<DemoTemplate, "id" | "organizationId" | "workerId" | "order">, templateId?: string): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  if (member.role !== "worker" || getWorkerAccess(workspace, member.id) !== "self" || !input.name.trim() || !input.startTime || !input.endTime || input.startTime === input.endTime) return false;
  const existing = templateId ? workspace.templates.find((template) => template.id === templateId && template.workerId === member.id) : undefined;
  if (existing) {
    mutate((state) => ({ ...state, templates: state.templates.map((template) => template.id === existing.id ? { ...template, ...input, name: input.name.trim() } : template) }));
  } else {
    const order = Math.max(-1, ...workspace.templates.filter((template) => template.workerId === member.id).map((template) => template.order)) + 1;
    const template: DemoTemplate = { ...input, name: input.name.trim(), id: `template-${crypto.randomUUID()}`, organizationId: workspace.organization.id, workerId: member.id, order };
    mutate((state) => ({ ...state, templates: [...state.templates, template] }));
  }
  return true;
}

export function deleteTemplate(templateId: string): boolean {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  if (member.role !== "worker" || !workspace.templates.some((template) => template.id === templateId && template.workerId === member.id)) return false;
  mutate((state) => ({ ...state, templates: state.templates.filter((template) => template.id !== templateId || template.workerId !== member.id) }));
  return true;
}

export function reorderTemplate(templateId: string, targetId: string) {
  const workspace = readWorkspace();
  const member = getActiveMember(workspace);
  const owned = workspace.templates.filter((template) => template.workerId === member.id).sort((a, b) => a.order - b.order);
  const from = owned.findIndex((template) => template.id === templateId);
  const to = owned.findIndex((template) => template.id === targetId);
  if (member.role !== "worker" || from < 0 || to < 0 || from === to) return;
  const [moved] = owned.splice(from, 1);
  owned.splice(to, 0, moved);
  const orderById = new Map(owned.map((template, order) => [template.id, order]));
  mutate((state) => ({ ...state, templates: state.templates.map((template) => orderById.has(template.id) ? { ...template, order: orderById.get(template.id)! } : template) }));
}

/** Legacy API retained for callers; agency-wide input modes are no longer configurable. */
export function setFactoryInputMode(_factoryId: string, _inputMode: ProductionInputMode): boolean { return false; }

export function createProduction(name: string, address = "", description = "", selectedWorksiteId?: string): DemoFactory | undefined {
  const workspace = readWorkspace();
  const cleanName = name.trim();
  const actor = getActiveMember(workspace);
  if (actor.role !== "agency" || !canManageEmployment(workspace) || !cleanName || !selectedWorksiteId) return undefined;
  const connection = (workspace.agencyWorksites ?? []).find((item) => item.organizationId === actor.organizationId && item.worksiteId === selectedWorksiteId && item.state === "active");
  const worksite = workspace.worksites?.find((item) => item.id === selectedWorksiteId && item.businessEntityId === connection?.businessEntityId);
  if (!connection || !worksite) return undefined;
  const existingFactory = workspace.factories.find((item) => item.organizationId === actor.organizationId && item.worksiteId === worksite.id && !item.archivedAt && item.name.trim().toLocaleLowerCase("en-US") === cleanName.toLocaleLowerCase("en-US"));
  if (existingFactory) return existingFactory;
  const factory: DemoFactory = {
    id: `factory-${crypto.randomUUID()}`,
    organizationId: actor.organizationId,
    worksiteId: worksite.id,
    name: cleanName,
    inputMode: "A",
    workerAccess: {},
    requiredBreakMinutes: 0,
    requiredBreakTreatment: "unpaid",
    allowActualBreakReport: true,
    allowTimeDataSubmission: true,
    address: address.trim() || worksite.address,
    description: description.trim(),
    workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] },
  };
  mutate((state) => ({ ...state, factories: [...state.factories, factory] }));
  return factory;
}

export function createAgencyWorkplace(input: { worksiteName: string; address: string; productionName: string }): { worksite: DemoWorksite; factory: DemoFactory } | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const worksiteName = input.worksiteName.trim();
  const address = input.address.trim();
  const productionName = input.productionName.trim();
  if (actor.role !== "agency" || !worksiteName || !address || !productionName) return undefined;
  const worksite = (workspace.worksites ?? []).find((site) => !site.businessEntityId
    && normalizeWorksiteAddress(site.address ?? "") === normalizeWorksiteAddress(address)
    && (workspace.factories.some((factory) => factory.organizationId === actor.organizationId && factory.worksiteId === site.id)))
    ?? { id: `worksite-${crypto.randomUUID()}`, name: worksiteName, address };
  const existing = workspace.factories.find((factory) => factory.organizationId === actor.organizationId && factory.worksiteId === worksite.id
    && !factory.archivedAt && factory.name.trim().toLocaleLowerCase("en-US") === productionName.toLocaleLowerCase("en-US"));
  if (existing) return { worksite, factory: existing };
  const factory = createAgencyFactory(actor.organizationId, worksite, productionName);
  factory.workflowSettings = {
    ...effectiveWorkflowSettings(factory),
    agencyCanSubmitTimesheet: true,
    agencyMustAcceptTimesheet: false,
  };
  mutate((state) => ({
    ...state,
    worksites: (state.worksites ?? []).some((site) => site.id === worksite.id) ? state.worksites : [...(state.worksites ?? []), worksite],
    factories: [...state.factories, factory],
  }));
  return { worksite, factory };
}

export function archiveProduction(factoryId: string): boolean {
  const workspace = readWorkspace();
  const factory = getFactory(workspace, factoryId);
  if (!canManageEmployment(workspace) || !factory || factory.archivedAt) return false;
  const archivedAt = new Date().toISOString();
  mutate((state) => ({ ...state, factories: state.factories.map((item) => item.id === factoryId && item.organizationId === workspace.organization.id ? { ...item, archivedAt } : item) }));
  return true;
}

export function restoreProduction(factoryId: string): boolean {
  const workspace = readWorkspace();
  const factory = getFactory(workspace, factoryId);
  if (!canManageEmployment(workspace) || !factory?.archivedAt) return false;
  const { archivedAt: _archivedAt, ...restored } = factory;
  mutate((state) => ({ ...state, factories: state.factories.map((item) => item.id === factoryId && item.organizationId === workspace.organization.id ? restored : item) }));
  return true;
}

export function createProductionLeader(factoryId: string, name: string, canManageAllWorkers = false, email = ""): DemoMember | undefined {
  const workspace = readWorkspace();
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLocaleLowerCase("en-US");
  if (!canManageEmployment(workspace, factoryId) || !getFactory(workspace, factoryId) || !cleanName || cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return undefined;
  const linkedAccount = cleanEmail ? workspace.members.find((member) => member.role === "leader" && member.email?.trim().toLocaleLowerCase("en-US") === cleanEmail) : undefined;
  const accountUid = linkedAccount?.accountUid ?? linkedAccount?.id ?? `account-leader-${crypto.randomUUID()}`;
  const existingMembership = workspace.members.find((member) => member.role === "leader" && member.organizationId === workspace.organization.id && member.factoryId === factoryId && (member.accountUid ?? member.id) === accountUid);
  if (existingMembership) return existingMembership.accessState !== "suspended" && existingMembership.accessState !== "revoked" ? existingMembership : undefined;
  const leader: DemoMember = {
    id: `leader-${crypto.randomUUID()}`,
    organizationId: workspace.organization.id,
    role: "leader",
    name: cleanName,
    email: cleanEmail || linkedAccount?.email,
    accountUid,
    factoryId,
    canManageGroups: true,
    canManageAllWorkers,
    accessState: "active",
    permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: true, canManageGroups: true },
    status: "active",
  };
  mutate((state) => ({ ...state, members: [...state.members, leader] }));
  return leader;
}

export function addLeaderProductionMembership(factoryId: string, name: string, accountUid: string, permissions: DemoMember["permissions"]): DemoMember | undefined {
  const workspace = readWorkspace();
  const factory = getFactory(workspace, factoryId);
  const cleanName = name.trim();
  const cleanAccountUid = accountUid.trim();
  if (!canManageEmployment(workspace, factoryId) || !factory || !cleanName || !cleanAccountUid || !permissions) return undefined;
  const existing = workspace.members.some((member) => member.role === "leader" && member.organizationId === workspace.organization.id && member.factoryId === factoryId && (member.accountUid ?? member.id) === cleanAccountUid && member.accessState !== "revoked");
  if (existing) return undefined;
  const leader: DemoMember = { id: `leader-${crypto.randomUUID()}`, organizationId: workspace.organization.id, role: "leader", name: cleanName, accountUid: cleanAccountUid, factoryId, canManageGroups: permissions.canManageGroups, canManageAllWorkers: false, accessState: "active", permissions, status: "active" };
  mutate((state) => ({ ...state, members: [...state.members, leader] }));
  return leader;
}

export function setLeaderMembershipAccess(factoryId: string, leaderId: string, accessState: "active" | "suspended" | "revoked"): boolean {
  const workspace = readWorkspace();
  const leader = workspace.members.find((member) => member.id === leaderId && member.role === "leader" && member.organizationId === workspace.organization.id && member.factoryId === factoryId);
  if (!canManageEmployment(workspace, factoryId) || !leader) return false;
  mutate((state) => ({ ...state, members: state.members.map((member) => member.id === leaderId && member.organizationId === workspace.organization.id && member.factoryId === factoryId ? { ...member, accessState } : member) }));
  return true;
}

export function updateLeaderMembershipPermissions(factoryId: string, leaderId: string, permissions: DemoMember["permissions"]): boolean {
  const workspace = readWorkspace();
  const leader = workspace.members.find((member) => member.id === leaderId && member.role === "leader" && member.organizationId === workspace.organization.id && member.factoryId === factoryId);
  if (!permissions || !canManageEmployment(workspace, factoryId) || !leader || !getFactory(workspace, factoryId)) return false;
  mutate((state) => ({ ...state, members: state.members.map((member) => member.id === leaderId && member.organizationId === workspace.organization.id && member.factoryId === factoryId
    ? { ...member, permissions: { ...permissions }, canManageGroups: permissions.canManageGroups }
    : member) }));
  return true;
}

export function updateProductionWorkflowSettings(factoryId: string, settings: DemoFactory["workflowSettings"]): boolean {
  const workspace = readWorkspace();
  if (!settings || !canManageEmployment(workspace, factoryId) || !getFactory(workspace, factoryId)) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, workflowSettings: { ...settings } } : factory) }));
  return true;
}

export function setLeaderProductionAccess(factoryId: string, leaderId: string, canManageAllWorkers: boolean): boolean {
  const workspace = readWorkspace();
  const leader = workspace.members.find((member) => member.id === leaderId && member.role === "leader" && member.organizationId === workspace.organization.id && member.factoryId === factoryId);
  if (!canManageEmployment(workspace, factoryId) || !leader) return false;
  mutate((state) => ({ ...state, members: state.members.map((member) => member.id === leaderId ? { ...member, canManageAllWorkers } : member) }));
  return true;
}

export function updateFactoryDetails(factoryId: string, details: { name: string; address: string; description: string }): boolean {
  const workspace = readWorkspace();
  if (!canManageEmployment(workspace, factoryId) || !getFactory(workspace, factoryId) || !details.name.trim()) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, name: details.name.trim(), address: details.address.trim(), description: details.description.trim() } : factory) }));
  return true;
}

export function setFactoryTimeDataSubmission(factoryId: string, allowed: boolean): boolean {
  const workspace = readWorkspace();
  if (!canManageEmployment(workspace, factoryId) || !getFactory(workspace, factoryId)) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, allowTimeDataSubmission: allowed } : factory) }));
  return true;
}

export function setFactoryTeamAssignmentRequirement(factoryId: string, required: boolean): boolean {
  const workspace = readWorkspace();
  if (!canManageEmployment(workspace, factoryId) || !getFactory(workspace, factoryId)) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, requireNewWorkerTeamAssignment: required } : factory) }));
  return true;
}

export function updateFactoryWorkCalendar(factoryId: string, workCalendar: DemoWorkCalendar): boolean {
  const workspace = readWorkspace();
  if (!canManageProductionRules(workspace, factoryId) || !getFactory(workspace, factoryId)) return false;
  const weekdays = [...new Set(workCalendar.workingWeekdays)].filter((day) => day >= 0 && day <= 6).sort();
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, workCalendar: { ...workCalendar, workingWeekdays: weekdays } } : factory) }));
  return true;
}

export function setWorkerInputAccess(factoryId: string, workerId: string, access: WorkerInputAccess): boolean {
  const workspace = readWorkspace();
  if (!canManageProductionRules(workspace, factoryId)) return false;
  const factory = getFactory(workspace, factoryId);
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker" && getWorkerProductionAssignment(workspace, workerId, factoryId));
  if (!factory || !worker || !canManageWorker(workerId, workspace) || !["self", "leader"].includes(access)) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((item) => item.id === factoryId ? { ...item, workerAccess: { ...item.workerAccess, [workerId]: access } } : item) }));
  return true;
}

function teamAssignmentNotifications(workspace: DemoWorkspace, factory: DemoFactory | undefined, workerId: string, placementId: string, required: boolean) {
  if (!factory) return [];
  const notices: DemoNotification[] = [];
  const requiredRecipients = required && factory.requireNewWorkerTeamAssignment
    ? workspace.members.filter((member) => member.role === "leader" && member.organizationId === factory.organizationId && member.factoryId === factory.id
      && member.accessState !== "suspended" && member.accessState !== "revoked"
      && effectiveLeaderPermissions(member).canViewWorkers && effectiveLeaderPermissions(member).canManageGroups
      && !isLeaderWorkerRemoved(workspace, member.id, factory.organizationId, factory.id, workerId))
    : [];
  notices.push(...requiredRecipients.map((member) => makeNotification(member.id, "team-assignment-needed", placementId, factory.organizationId)));

  const worksite = factory.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
  const businessEntity = worksite?.businessEntityId && (workspace.businessEntities ?? []).find((item) => item.id === worksite.businessEntityId);
  if (!worksite?.businessEntityId || !businessEntity) return notices;
  const companyAdmin = workspace.members.find((member) => member.id === businessEntity.adminMemberId && member.role === "factory-admin");
  if (companyAdmin) notices.push(connectionNotification(businessEntity.organizationId, companyAdmin.id, "worksite-worker-available", placementId));

  const requiredRecipientIds = new Set(requiredRecipients.map((member) => member.id));
  const worksiteLeaders = (workspace.leaderWorksiteMemberships ?? []).filter((leader) => leader.businessEntityId === businessEntity.id && leader.worksiteId === worksite.id && leader.state === "active");
  const scopedManagers = workspace.members.filter((member) => member.role === "leader" && member.organizationId === factory.organizationId && member.factoryId === factory.id
    && member.accessState !== "suspended" && member.accessState !== "revoked" && effectiveLeaderPermissions(member).canViewWorkers
    && worksiteLeaders.some((leader) => leader.accountUid === (member.accountUid ?? member.id) && (!leader.organizationIds?.length || leader.organizationIds.includes(factory.organizationId))));
  for (const manager of scopedManagers) if (!requiredRecipientIds.has(manager.id)) notices.push(connectionNotification(factory.organizationId, manager.id, "worksite-worker-available", placementId));
  return notices;
}

export function assignWorkerToProduction(factoryId: string, workerId: string, assigned: boolean, independentParticipant = false): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const factory = getFactory(workspace, factoryId);
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === workspace.organization.id && member.role === "worker");
  const period = workspace.employmentPeriods.find((item) => item.organizationId === workspace.organization.id && item.workerId === workerId && item.state === "active");
  if (!canManageEmployment(workspace, factoryId) || !factory || factory.archivedAt || !worker || !period) return false;
  const current = getWorkerProductionAssignments(workspace, workerId);
  const exists = current.some((item) => item.factoryId === factoryId);
  if (exists === assigned) return true;
  let nextAssignments: DemoProductionAssignment[];
  if (assigned) {
    nextAssignments = [...current, { factoryId }];
  } else {
    nextAssignments = current.filter((item) => item.factoryId !== factoryId);
  }
  const now = new Date().toISOString();
  const effectiveDate = todayDate();
  const event = { id: `employment-event-${crypto.randomUUID()}`, actorId: active.id, action: assigned ? "placement-added" as const : "placement-ended" as const, occurredAt: now };
  const placementId = `placement-${crypto.randomUUID()}`;
  const requiresTeamAssignment = assigned && !independentParticipant && factory.requireNewWorkerTeamAssignment === true;
  const placements = assigned
    ? [...period.placements, { id: placementId, factoryId, startDate: effectiveDate, createdAt: now, createdById: active.id, requiresTeamAssignment: requiresTeamAssignment || undefined }]
    : period.placements.map((placement) => placement.factoryId === factoryId && !placement.endDate ? { ...placement, endDate: effectiveDate, endedAt: now, endedById: active.id } : placement);
  mutate((state) => ({ ...state, employmentPeriods: state.employmentPeriods.map((item) => item.id === period.id ? { ...item, placements, history: [...item.history, event] } : item), members: state.members.map((member) => {
    if (member.id !== workerId) return member;
    const legacyAssignment = nextAssignments.find((item) => item.factoryId === member.factoryId) ?? nextAssignments[0];
    return {
      ...member,
      productionAssignments: assigned && factory.requireNewWorkerTeamAssignment
        ? nextAssignments.map((item) => item.factoryId === factoryId ? { ...item, requiresTeamAssignment: requiresTeamAssignment || undefined } : item)
        : nextAssignments,
      factoryId: legacyAssignment?.factoryId,
      groupId: legacyAssignment?.groupId,
      leaderId: legacyAssignment?.leaderId,
    };
  }), notifications: [...teamAssignmentNotifications(workspace, factory, workerId, placementId, requiresTeamAssignment), makeNotification(workerId, "employment-updated", period.id), ...state.notifications] }));
  return true;
}

export function assignWorkerToLeader(factoryId: string, workerId: string, leaderId: string): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const membership = active.role === "leader" ? activeLeaderMembershipFor(workspace, workspace.organization.id, factoryId, "canManageGroups") : undefined;
  const worker = workspace.members.find((item) => item.id === workerId && item.role === "worker" && item.organizationId === workspace.organization.id);
  const leader = workspace.members.find((item) => item.id === leaderId && item.role === "leader" && item.organizationId === workspace.organization.id && item.factoryId === factoryId && item.accessState !== "suspended" && item.accessState !== "revoked");
  const participant = getLeaderProductionParticipants(workspace, leaderId, factoryId).find((item) => item.worker.id === workerId);
  if (!membership || !leader || leaderId !== membership.id || !worker || !participant) return false;
  return setLeaderWorkerAccess(factoryId, workerId, "active");
}

export function setLeaderWorkerAccess(factoryId: string, workerId: string, accessState: "active" | "removed"): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const membership = actor.role === "leader" ? activeLeaderMembershipFor(workspace, workspace.organization.id, factoryId, "canManageGroups") : undefined;
  return membership ? setLeaderWorkerAccessForMembership(membership.id, workerId, accessState) : false;
}

export function setLeaderWorkerAccessForMembership(leaderMembershipId: string, workerId: string, accessState: "active" | "removed"): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const membership = actor.role === "leader" ? activeLeaderMemberships(workspace, actor).find((item) => item.id === leaderMembershipId) : undefined;
  if (!membership?.factoryId || !effectiveLeaderPermissions(membership).canManageGroups) return false;
  const scoped = scopedWorkspace(workspace, membership.organizationId);
  const participant = getLeaderProductionParticipants(scoped, membership.id, membership.factoryId).find((item) => item.worker.id === workerId);
  if (!participant) return false;
  const now = new Date().toISOString();
  const existing = workspace.leaderWorkerAccess?.find((item) => item.leaderMembershipId === membership.id && item.organizationId === membership.organizationId && item.factoryId === membership.factoryId && item.workerId === workerId);
  if (!existing && accessState === "active") return true;
  const entry: DemoLeaderWorkerAccess = existing
    ? { ...existing, state: accessState, changedAt: now, changedById: actor.id }
    : { id: `leader-worker-access-${crypto.randomUUID()}`, leaderMembershipId: membership.id, organizationId: membership.organizationId, factoryId: membership.factoryId, workerId, state: accessState, changedAt: now, changedById: actor.id };
  mutate((state) => ({ ...state, leaderWorkerAccess: [...(state.leaderWorkerAccess ?? []).filter((item) => item.id !== entry.id), entry] }));
  return true;
}

function canManageFactory(factoryId: string, workspace: DemoWorkspace): boolean {
  const active = getActiveMember(workspace);
  const factory = workspace.factories.find((item) => item.id === factoryId && (active.role === "factory-admin" || item.organizationId === workspace.organization.id));
  if (!factory) return false;
  if (active.role === "agency") return factory.organizationId === active.organizationId;
  if (active.role === "factory-admin") {
    const entity = getActiveBusinessEntity(workspace);
    const site = factory.worksiteId ? workspace.worksites?.find((item) => item.id === factory.worksiteId) : undefined;
    return Boolean(entity && active.businessEntityId === entity.id && site?.businessEntityId === entity.id && (factory.organizationId === entity.organizationId
      ? factory.ownerWorkforce
      : (workspace.agencyWorksites ?? []).some((item) => item.businessEntityId === entity.id && item.worksiteId === site.id && item.organizationId === factory.organizationId && item.state === "active")));
  }
  return active.role === "leader" && Boolean(activeLeaderMembershipFor(workspace, factory.organizationId, factoryId, "canManageGroups"));
}

export function canManageProductionRules(workspace: DemoWorkspace, factoryId: string): boolean {
  const factory = getFactory(workspace, factoryId);
  return Boolean(factory && activeLeaderMembershipFor(workspace, factory.organizationId, factoryId, "canManageGroups"));
}

function canManageEmployment(workspace: DemoWorkspace, _factoryId?: string): boolean {
  const active = getActiveMember(workspace);
  return active.role === "agency";
}

export function updateFactoryBreakRule(factoryId: string, requiredBreakMinutes: number, treatment: "unpaid" | "paid", allowActualBreakReport: boolean): boolean {
  const workspace = readWorkspace();
  if (!canManageProductionRules(workspace, factoryId) || !getFactory(workspace, factoryId) || !Number.isFinite(requiredBreakMinutes) || requiredBreakMinutes < 0) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((factory) => factory.id === factoryId ? { ...factory, requiredBreakMinutes: Math.round(requiredBreakMinutes), requiredBreakTreatment: treatment, allowActualBreakReport } : factory) }));
  return true;
}

export function createAgencyWorker(name: string, email = "", phone = "", accountUid?: string): DemoMember | undefined {
  const workspace = readWorkspace();
  const cleanName = name.trim();
  if (!canManageEmployment(workspace) || !cleanName) return undefined;
  const cleanAccountUid = accountUid?.trim();
  const cleanEmail = email.trim().toLocaleLowerCase("en-US");
  const linkedAccount = workspace.members.find((item) => item.role === "worker" && (cleanAccountUid && (item.accountUid ?? item.id) === cleanAccountUid || cleanEmail && item.email?.trim().toLocaleLowerCase("en-US") === cleanEmail));
  if (linkedAccount && workerPayer(workspace, linkedAccount)?.payerType === "factory") return undefined;
  const workerPayerOrganizationId = workspace.organization.id;
  const existingMembership = workspace.members.find((item) => item.role === "worker" && item.organizationId === workspace.organization.id
    && (cleanAccountUid && (item.accountUid ?? item.id) === cleanAccountUid || cleanEmail && item.email?.trim().toLocaleLowerCase("en-US") === cleanEmail));
  if (existingMembership) return existingMembership;
  if (!canAddAgencyWorker(workspace, workspace.organization.id)) return undefined;
  const worker: DemoMember = { id: `worker-${crypto.randomUUID()}`, accountUid: cleanAccountUid || linkedAccount?.accountUid || `account-${crypto.randomUUID()}`, organizationId: workspace.organization.id, role: "worker", workerCategory: "agency", workerPayerOrganizationId, name: cleanName, email: email.trim() || undefined, phone: phone.trim() || undefined, status: "active", productionAssignments: [] };
  mutate((state) => ({ ...state, members: [...state.members, worker] }));
  return worker;
}

export function updateAgencyWorker(workerId: string, input: { name: string; email?: string; phone?: string }): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === actor.organizationId && item.role === "worker" && item.workerCategory !== "factory");
  const name = input.name.trim();
  const email = input.email?.trim().toLocaleLowerCase("en-US") ?? "";
  const phone = input.phone?.trim() ?? "";
  if (actor.role !== "agency" || !worker || !name || email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  const duplicateEmail = email && workspace.members.some((item) => item.id !== worker.id && item.organizationId === actor.organizationId && item.role === "worker"
    && item.email?.trim().toLocaleLowerCase("en-US") === email && (item.accountUid ?? item.id) !== (worker.accountUid ?? worker.id));
  if (duplicateEmail) return false;
  mutate((state) => ({ ...state, members: state.members.map((item) => item.id === worker.id ? { ...item, name, email: email || undefined, phone: phone || undefined } : item) }));
  return true;
}

function normalizeWorkerInviteCode(value: string) {
  return value.normalize("NFKC").trim().toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

export function getWorkerInvitationByCode(code: string, workspace = readWorkspace()): DemoWorkerInvitation | undefined {
  const normalized = normalizeWorkerInviteCode(code);
  return (workspace.workerInvitations ?? []).find((item) => normalizeWorkerInviteCode(item.code) === normalized);
}

export function getWorkerInvitationUrl(code: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  return `${base}/register/worker?invitation=${encodeURIComponent(code)}`;
}

export function createAgencyWorkerInvitation(): DemoWorkerInvitation | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  if (actor.role !== "agency" || actor.organizationId !== workspace.organization.id) return undefined;
  let code = "";
  do { code = `TXW-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toLocaleUpperCase("en-US")}`; }
  while ((workspace.workerInvitations ?? []).some((item) => normalizeWorkerInviteCode(item.code) === normalizeWorkerInviteCode(code)));
  const now = new Date();
  const invitation: DemoWorkerInvitation = {
    id: `worker-invitation-${crypto.randomUUID()}`,
    code,
    organizationId: actor.organizationId,
    createdById: actor.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    state: "pending",
  };
  mutate((state) => ({ ...state, workerInvitations: [...(state.workerInvitations ?? []), invitation] }));
  return invitation;
}

export function revokeAgencyWorkerInvitation(invitationId: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const invitation = workspace.workerInvitations?.find((item) => item.id === invitationId && item.organizationId === actor.organizationId);
  if (actor.role !== "agency" || !invitation || invitation.state !== "pending") return false;
  mutate((state) => ({ ...state, workerInvitations: (state.workerInvitations ?? []).map((item) => item.id === invitationId ? { ...item, state: "revoked" } : item) }));
  return true;
}

export function registerWorkerJoinRequest(code: string, input: { name: string; email: string; phone?: string }): boolean {
  const workspace = readWorkspace();
  const invitation = getWorkerInvitationByCode(code, workspace);
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLocaleLowerCase("en-US");
  const cleanPhone = input.phone?.trim();
  if (!invitation || invitation.state !== "pending" || Date.parse(invitation.expiresAt) <= Date.now() || !cleanName
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return false;
  const emailMatches = workspace.members.filter((item) => item.role === "worker" && item.email?.trim().toLocaleLowerCase("en-US") === cleanEmail);
  const accountUids = new Set(emailMatches.map((item) => item.accountUid ?? item.id));
  if (accountUids.size > 1 || emailMatches.some((item) => item.workerCategory === "factory")) return false;
  const accountUid = emailMatches[0] ? emailMatches[0].accountUid ?? emailMatches[0].id : `account-${crypto.randomUUID()}`;
  const existingMembership = workspace.members.find((item) => item.organizationId === invitation.organizationId && item.role === "worker" && (item.accountUid ?? item.id) === accountUid);
  if (existingMembership || (workspace.workerInvitations ?? []).some((item) => item.organizationId === invitation.organizationId && item.id !== invitation.id
    && item.accountUid === accountUid && (item.state === "awaiting-approval" || item.state === "approved"))) return false;
  const registeredAt = new Date().toISOString();
  const agency = workspace.members.find((item) => item.organizationId === invitation.organizationId && item.role === "agency");
  mutate((state) => ({
    ...state,
    workerInvitations: (state.workerInvitations ?? []).map((item) => item.id === invitation.id ? {
      ...item, state: "awaiting-approval", registeredAt, accountUid, name: cleanName, email: cleanEmail, phone: cleanPhone,
    } : item),
    notifications: agency ? [makeNotification(agency.id, "agency-worker-join-requested", invitation.id, invitation.organizationId), ...state.notifications] : state.notifications,
  }));
  return true;
}

export function approveAgencyWorkerJoinRequest(invitationId: string): DemoMember | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const invitation = workspace.workerInvitations?.find((item) => item.id === invitationId && item.organizationId === actor.organizationId);
  if (actor.role !== "agency" || !invitation || invitation.state !== "awaiting-approval" || !invitation.accountUid || !invitation.name || !invitation.email) return undefined;
  const existingMembership = workspace.members.find((item) => item.organizationId === actor.organizationId && item.role === "worker" && (item.accountUid ?? item.id) === invitation.accountUid);
  const linkedAccount = workspace.members.find((item) => item.role === "worker" && (item.accountUid ?? item.id) === invitation.accountUid);
  if (linkedAccount && linkedAccount.workerCategory === "factory") return undefined;
  const worker: DemoMember = existingMembership ?? {
    id: `worker-${crypto.randomUUID()}`,
    accountUid: invitation.accountUid,
    organizationId: actor.organizationId,
    role: "worker",
    workerCategory: "agency",
    workerPayerOrganizationId: actor.organizationId,
    name: invitation.name,
    email: invitation.email,
    phone: invitation.phone,
    status: "active",
    productionAssignments: [],
  };
  const now = new Date().toISOString();
  mutate((state) => ({
    ...state,
    members: existingMembership ? state.members : [...state.members, worker],
    workerInvitations: (state.workerInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "approved", workerId: worker.id, resolvedAt: now, resolvedById: actor.id } : item),
  }));
  return worker;
}

export function declineAgencyWorkerJoinRequest(invitationId: string, reason = ""): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const invitation = workspace.workerInvitations?.find((item) => item.id === invitationId && item.organizationId === actor.organizationId);
  if (actor.role !== "agency" || !invitation || invitation.state !== "awaiting-approval") return false;
  const now = new Date().toISOString();
  mutate((state) => ({ ...state, workerInvitations: (state.workerInvitations ?? []).map((item) => item.id === invitation.id ? { ...item, state: "declined", response: reason.trim() || undefined, resolvedAt: now, resolvedById: actor.id } : item) }));
  return true;
}

function createOwnedWorkforceFactory(entity: DemoBusinessEntity, site: DemoWorksite): DemoFactory {
  return {
    id: `factory-own-workforce-${crypto.randomUUID()}`,
    organizationId: entity.organizationId,
    worksiteId: site.id,
    ownerWorkforce: true,
    name: site.name,
    inputMode: "A",
    workerAccess: {},
    requiredBreakMinutes: 0,
    requiredBreakTreatment: "unpaid",
    allowActualBreakReport: true,
    allowTimeDataSubmission: true,
    workflowSettings: {
      workerCanRecordHours: true,
      leaderCanRecordHours: false,
      leaderMustReviewShifts: true,
      agencyMustReviewShifts: false,
      workerMustConfirmShifts: true,
      workerCanDisputeShifts: true,
      leaderCanSubmitTimesheet: true,
      agencyCanSubmitTimesheet: false,
      agencyMustAcceptTimesheet: false,
    },
    address: site.address,
    workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] },
  };
}

export function createFactoryWorker(input: { name: string; email?: string; phone?: string; worksiteId: string }): DemoMember | undefined {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const entity = getActiveBusinessEntity(workspace);
  const site = workspace.worksites?.find((item) => item.id === input.worksiteId && item.businessEntityId === entity?.id);
  const name = input.name.trim();
  const email = input.email?.trim() || undefined;
  if (actor.role !== "factory-admin" || !entity || actor.businessEntityId !== entity.id || !site || !name || !canAddFactoryWorker(workspace, entity.id)) return undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined;
  if (email && workspace.members.some((member) => member.role === "worker" && member.email?.trim().toLocaleLowerCase("en-US") === email.toLocaleLowerCase("en-US"))) return undefined;

  const factory = workspace.factories.find((item) => item.organizationId === entity.organizationId && item.worksiteId === site.id && item.ownerWorkforce && !item.archivedAt)
    ?? createOwnedWorkforceFactory(entity, site);
  const now = new Date().toISOString();
  const startDate = todayDate();
  const workerId = `worker-${crypto.randomUUID()}`;
  const placementId = `placement-${crypto.randomUUID()}`;
  const worker: DemoMember = {
    id: workerId,
    organizationId: entity.organizationId,
    businessEntityId: entity.id,
    workerCategory: "factory",
    role: "worker",
    accountUid: `account-${crypto.randomUUID()}`,
    name,
    email,
    phone: input.phone?.trim() || undefined,
    status: "active",
    factoryId: factory.id,
    productionAssignments: [{ factoryId: factory.id }],
  };
  const period: DemoEmploymentPeriod = {
    id: `employment-${crypto.randomUUID()}`,
    organizationId: entity.organizationId,
    workerId,
    accountUid: worker.accountUid!,
    workerCategory: "factory",
    state: "active",
    startDate,
    createdAt: now,
    createdById: actor.id,
    placements: [{ id: placementId, factoryId: factory.id, startDate, createdAt: now, createdById: actor.id }],
    history: [{ id: `employment-event-${crypto.randomUUID()}`, actorId: actor.id, action: "hired", occurredAt: now }],
  };
  mutate((state) => ({
    ...state,
    factories: state.factories.some((item) => item.id === factory.id) ? state.factories : [...state.factories, factory],
    members: [...state.members, worker],
    employmentPeriods: [period, ...state.employmentPeriods],
    notifications: [...teamAssignmentNotifications(workspace, factory, workerId, placementId, false), ...state.notifications],
  }));
  return worker;
}

export function hireWorker(workerId: string, factoryId: string | undefined, groupId: string | undefined, startDate: string, independentParticipant = false): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === workspace.organization.id && item.role === "worker");
  const factory = factoryId ? getFactory(workspace, factoryId) : undefined;
  const activeEmploymentExists = workspace.employmentPeriods.some((period) => period.organizationId === workspace.organization.id && period.workerId === workerId && period.state === "active");
  const payer = worker ? workerPayer(workspace, worker) : undefined;
  if (!canManageEmployment(workspace, factoryId) || !worker || (factoryId && (!factory || factory.archivedAt)) || groupId || activeEmploymentExists || !startDate
    || payer?.payerType === "agency" && payer.payerId === workspace.organization.id && !canAddAgencyWorker(workspace, workspace.organization.id)) return false;
  const now = new Date().toISOString();
  const assignments = factoryId ? getWorkerProductionAssignments(workspace, workerId).filter((item) => item.factoryId !== factoryId) : [];
  if (factoryId) assignments.push({ factoryId });
  const placementId = `placement-${crypto.randomUUID()}`;
  const requiresTeamAssignment = Boolean(factory?.requireNewWorkerTeamAssignment && !independentParticipant);
  const period: DemoEmploymentPeriod = {
    id: `employment-${crypto.randomUUID()}`, organizationId: workspace.organization.id, workerId, accountUid: worker.accountUid ?? worker.id,
    workerCategory: worker.workerCategory ?? (workspace.organization.type === "factory" ? "factory" : "agency"),
    state: "active", startDate, createdAt: now, createdById: active.id,
    placements: factoryId ? [{ id: placementId, factoryId, startDate, createdAt: now, createdById: active.id, requiresTeamAssignment: requiresTeamAssignment || undefined }] : [],
    history: [{ id: `employment-event-${crypto.randomUUID()}`, actorId: active.id, action: workspace.employmentPeriods.some((item) => item.organizationId === workspace.organization.id && item.workerId === workerId) ? "rehired" : "hired", occurredAt: now }],
  };
  const nextAssignments = factoryId && factory?.requireNewWorkerTeamAssignment ? assignments.map((item) => item.factoryId === factoryId ? { ...item, requiresTeamAssignment: requiresTeamAssignment || undefined } : item) : assignments;
  mutate((state) => ({ ...state, members: state.members.map((item) => item.id === workerId ? { ...item, status: "active", productionAssignments: nextAssignments, factoryId, groupId: undefined, leaderId: undefined } : item), employmentPeriods: [period, ...state.employmentPeriods], notifications: [...teamAssignmentNotifications(workspace, factory, workerId, placementId, requiresTeamAssignment), makeNotification(workerId, "employment-updated", period.id), ...state.notifications] }));
  return true;
}

export function endWorkerEmployment(workerId: string, endDate: string, note = ""): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === workspace.organization.id && item.role === "worker");
  const period = workspace.employmentPeriods.find((item) => item.workerId === workerId && item.organizationId === workspace.organization.id && item.state === "active");
  if (!canManageEmployment(workspace) || !worker || !period || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < period.startDate || endDate > todayDate()
    || period.placements.some((placement) => !placement.endDate && endDate < placement.startDate)) return false;
  const now = new Date().toISOString();
  const event = { id: `employment-event-${crypto.randomUUID()}`, actorId: active.id, action: "ended" as const, occurredAt: now, note: note.trim() || undefined };
  const closed: DemoEmploymentPeriod = { ...period, state: "ended", endDate, endedAt: now, endedById: active.id, placements: period.placements.map((placement) => placement.endDate ? placement : { ...placement, endDate, endedAt: now, endedById: active.id }), history: [...period.history, event] };
  mutate((state) => ({ ...state, employmentPeriods: state.employmentPeriods.map((item) => item.id === period.id ? closed : item), members: state.members.map((item) => item.id === workerId ? { ...item, status: "away", productionAssignments: [], factoryId: undefined, groupId: undefined, leaderId: undefined } : item), notifications: [makeNotification(workerId, "employment-updated", period.id), ...state.notifications] }));
  return true;
}

export function transferWorkerProduction(workerId: string, fromFactoryId: string, toFactoryId: string, groupId: string | undefined, startDate: string, confirmed = false, independentParticipant = false): boolean {
  const workspace = readWorkspace();
  const active = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === workspace.organization.id && item.role === "worker");
  const activePeriods = workspace.employmentPeriods.filter((item) => item.workerId === workerId && item.organizationId === workspace.organization.id && item.state === "active" && item.startDate <= todayDate() && (!item.endDate || item.endDate >= todayDate()));
  const period = activePeriods.length === 1 ? activePeriods[0] : undefined;
  const fromFactory = getFactory(workspace, fromFactoryId);
  const toFactory = getFactory(workspace, toFactoryId);
  const sourcePlacements = period?.placements.filter((item) => item.factoryId === fromFactoryId && item.startDate <= startDate && (!item.endDate || item.endDate >= startDate)) ?? [];
  const sourcePlacement = sourcePlacements.length === 1 ? sourcePlacements[0] : undefined;
  const activeTargetPlacement = period?.placements.some((item) => item.factoryId === toFactoryId && item.startDate <= startDate && (!item.endDate || item.endDate >= startDate));
  if (!confirmed || !canManageEmployment(workspace, fromFactoryId) || !worker || !period || !fromFactory || fromFactory.archivedAt || !toFactory || toFactory.archivedAt || fromFactoryId === toFactoryId || !sourcePlacement || activeTargetPlacement || groupId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < sourcePlacement.startDate || startDate > todayDate()) return false;
  const now = new Date().toISOString();
  const event = { id: `employment-event-${crypto.randomUUID()}`, actorId: active.id, action: "transferred" as const, occurredAt: now, note: `${fromFactory.name} → ${toFactory.name}` };
  const previousDay = new Date(`${startDate}T00:00:00.000Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const sourceEndDate = startDate === sourcePlacement.startDate ? startDate : previousDay.toISOString().slice(0, 10);
  const placements = period.placements.map((item) => item.id === sourcePlacement.id ? { ...item, endDate: sourceEndDate, endedAt: now, endedById: active.id } : item);
  const targetPlacementId = `placement-${crypto.randomUUID()}`;
  const requiresTeamAssignment = Boolean(toFactory.requireNewWorkerTeamAssignment && !independentParticipant);
  placements.push({ id: targetPlacementId, factoryId: toFactoryId, startDate, createdAt: now, createdById: active.id, requiresTeamAssignment: requiresTeamAssignment || undefined });
  const assignments = getWorkerProductionAssignments(workspace, workerId).filter((item) => item.factoryId !== fromFactoryId && item.factoryId !== toFactoryId);
  assignments.push({ factoryId: toFactoryId, requiresTeamAssignment: requiresTeamAssignment || undefined });
  const legacy = assignments[0];
  mutate((state) => ({ ...state, employmentPeriods: state.employmentPeriods.map((item) => item.id === period.id ? { ...item, placements, history: [...item.history, event] } : item), members: state.members.map((item) => item.id === workerId ? { ...item, productionAssignments: assignments, factoryId: legacy?.factoryId, groupId: legacy?.groupId, leaderId: legacy?.leaderId } : item), notifications: [...teamAssignmentNotifications(workspace, toFactory, workerId, targetPlacementId, requiresTeamAssignment), makeNotification(workerId, "employment-updated", period.id), ...state.notifications] }));
  return true;
}

export function createGroup(factoryId: string, name: string): boolean {
  const workspace = readWorkspace();
  const membership = activeLeaderMembershipFor(workspace, workspace.organization.id, factoryId, "canManageGroups");
  const cleanName = name.trim();
  if (!membership || !getFactory(workspace, factoryId) || !cleanName) return false;
  const group: DemoGroup = { id: `group-${crypto.randomUUID()}`, organizationId: workspace.organization.id, factoryId, leaderId: membership.id, name: cleanName };
  mutate((state) => ({ ...state, groups: [...state.groups, group] }));
  return true;
}

export function renameGroup(groupId: string, name: string): boolean {
  const workspace = readWorkspace();
  const group = workspace.groups.find((item) => item.id === groupId && item.organizationId === workspace.organization.id);
  const membership = group ? activeLeaderMembershipFor(workspace, group.organizationId, group.factoryId, "canManageGroups") : undefined;
  const cleanName = name.trim();
  if (!membership || !group || group.leaderId !== membership.id && !membership.canManageAllWorkers || !cleanName) return false;
  mutate((state) => ({ ...state, groups: state.groups.map((item) => item.id === groupId ? { ...item, name: cleanName } : item) }));
  return true;
}

export function archiveGroup(groupId: string): boolean {
  const workspace = readWorkspace();
  const group = workspace.groups.find((item) => item.id === groupId && item.organizationId === workspace.organization.id);
  const membership = group ? activeLeaderMembershipFor(workspace, group.organizationId, group.factoryId, "canManageGroups") : undefined;
  if (!membership || !group || group.leaderId !== membership.id && !membership.canManageAllWorkers) return false;
  mutate((state) => ({ ...state, groups: state.groups.map((item) => item.id === groupId ? { ...item, archivedAt: new Date().toISOString() } : item) }));
  return true;
}

export function assignWorkerToGroup(workerId: string, groupId?: string, factoryIdOverride?: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === workspace.organization.id && member.role === "worker");
  const group = groupId ? workspace.groups.find((item) => item.id === groupId && item.organizationId === workspace.organization.id) : undefined;
  const factoryId = group?.factoryId ?? factoryIdOverride ?? actor.factoryId ?? (worker ? getWorkerProductionAssignments(workspace, workerId).find((item) => item.groupId)?.factoryId : undefined);
  const membership = factoryId && actor.role === "leader" ? activeLeaderMemberships(workspace, actor).find((item) => item.organizationId === workspace.organization.id && item.factoryId === factoryId) : undefined;
  return membership ? assignWorkerToGroupForMembership(membership.id, workerId, groupId) : false;
}

export function assignWorkerToGroupForMembership(leaderMembershipId: string, workerId: string, groupId?: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const membership = actor.role === "leader" ? activeLeaderMemberships(workspace, actor).find((item) => item.id === leaderMembershipId) : undefined;
  if (!membership?.factoryId || !effectiveLeaderPermissions(membership).canManageGroups) return false;
  const scoped = scopedWorkspace(workspace, membership.organizationId);
  const factoryId = membership.factoryId;
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === membership.organizationId && member.role === "worker");
  const group = groupId ? workspace.groups.find((item) => item.id === groupId && item.organizationId === membership.organizationId) : undefined;
  const assignment = worker && getWorkerProductionAssignment(scoped, workerId, factoryId);
  const participant = getLeaderProductionParticipants(scoped, membership.id, factoryId).find((item) => item.worker.id === workerId && item.accessState === "active");
  const currentGroup = assignment && workspace.groups.find((item) => item.id === assignment.groupId && item.organizationId === membership.organizationId);
  if (!worker || !assignment || !participant || (currentGroup && currentGroup.leaderId !== membership.id && !membership.canManageAllWorkers)
    || (groupId && (!group || group.factoryId !== factoryId || group.archivedAt || group.leaderId !== membership.id && !membership.canManageAllWorkers))) return false;
  const assignedLeaderId = group?.leaderId ?? membership.id;
  const productionAssignments = getWorkerProductionAssignments(scoped, workerId).map((item) => item.factoryId === factoryId
    ? group ? { ...item, groupId, leaderId: assignedLeaderId, requiresTeamAssignment: undefined } : { ...item, groupId: undefined, requiresTeamAssignment: undefined }
    : item);
  const today = todayDate();
  const activePeriod = workspace.employmentPeriods.find((period) => period.organizationId === membership.organizationId && period.workerId === workerId && period.state === "active" && period.startDate <= today && (!period.endDate || period.endDate >= today));
  const now = new Date().toISOString();
  const historyEntry = { id: `employment-event-${crypto.randomUUID()}`, actorId: membership.id, action: "group-changed" as const, occurredAt: now, note: group?.name ?? "" };
  const placements = activePeriod?.placements.map((placement) => placement.factoryId === factoryId && placement.startDate <= today && (!placement.endDate || placement.endDate >= today)
    ? { ...placement, groupId: group?.id, ...(group ? { leaderId: assignedLeaderId } : {}), requiresTeamAssignment: undefined }
    : placement) ?? [];
  mutate((state) => ({
    ...state,
    employmentPeriods: state.employmentPeriods.map((period) => period.id === activePeriod?.id ? { ...period, placements, history: [...period.history, historyEntry] } : period),
    members: state.members.map((member) => member.id === workerId && member.organizationId === membership.organizationId ? { ...member, productionAssignments, ...(member.factoryId === factoryId ? { groupId, ...(group ? { leaderId: assignedLeaderId } : {}) } : {}) } : member),
  }));
  return true;
}

export function createAgencyFolder(name: string): boolean {
  const workspace = readWorkspace();
  const cleanName = name.trim();
  if (getActiveMember(workspace).role !== "agency" || !cleanName) return false;
  const folder: DemoFolder = { id: `folder-${crypto.randomUUID()}`, organizationId: workspace.organization.id, name: cleanName };
  mutate((state) => ({ ...state, folders: [...(state.folders ?? []), folder] }));
  return true;
}

export function renameAgencyFolder(folderId: string, name: string): boolean {
  const workspace = readWorkspace();
  const folder = (workspace.folders ?? []).find((item) => item.id === folderId && item.organizationId === workspace.organization.id);
  const cleanName = name.trim();
  if (getActiveMember(workspace).role !== "agency" || !folder || !cleanName) return false;
  mutate((state) => ({ ...state, folders: (state.folders ?? []).map((item) => item.id === folderId ? { ...item, name: cleanName } : item) }));
  return true;
}

export function archiveAgencyFolder(folderId: string): boolean {
  const workspace = readWorkspace();
  if (getActiveMember(workspace).role !== "agency" || !(workspace.folders ?? []).some((folder) => folder.id === folderId)) return false;
  mutate((state) => ({ ...state, folders: (state.folders ?? []).map((folder) => folder.id === folderId ? { ...folder, archivedAt: new Date().toISOString() } : folder) }));
  return true;
}

export function assignWorkerToFolder(workerId: string, folderId?: string): boolean {
  const workspace = readWorkspace();
  if (getActiveMember(workspace).role !== "agency") return false;
  const worker = workspace.members.find((member) => member.id === workerId && member.organizationId === workspace.organization.id && member.role === "worker");
  const folder = folderId ? (workspace.folders ?? []).find((item) => item.id === folderId && item.organizationId === workspace.organization.id && !item.archivedAt) : undefined;
  if (!worker || (folderId && !folder)) return false;
  mutate((state) => ({ ...state, members: state.members.map((member) => member.id === workerId ? { ...member, folderId } : member) }));
  return true;
}


/** Local demo payroll: no tax assumptions, network calls or real delivery. */
export function savePayrollSettings(settings: PayrollSettings): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  if (actor.role !== "agency" || storageWritesBlocked || typeof settings.issueEnabled !== "boolean"
    || !calculatePayroll({ ...settings, dayHours: 0, nightHours: 0, additions: 0, deductions: 0, note: "" })) return false;
  mutate((state) => ({ ...state, payrollSettings: { ...state.payrollSettings, [actor.organizationId]: { ...settings } } }));
  return !storageWritesBlocked;
}

export function issueDemoPayslip(workerId: string, month: string, input: PayrollInput): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const worker = workspace.members.find((member) => member.id === workerId && member.role === "worker" && member.organizationId === actor.organizationId);
  const result = calculatePayroll(input);
  if (actor.role !== "agency" || storageWritesBlocked || !worker || !result || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || !workspace.payrollSettings?.[actor.organizationId]?.issueEnabled || !input.note.trim()) return false;
  const slip: DemoPayslip = { id: `payslip-${crypto.randomUUID()}`, organizationId: actor.organizationId, workerId,
    month, workerName: worker.name, organizationName: workspace.organizations.find((org) => org.id === actor.organizationId)?.name ?? "",
    issuedAt: new Date().toISOString(), issuedById: actor.id, input: { ...input, context: input.context ? { ...input.context } : undefined, note: input.note.trim() }, ...result, demo: true };
  // One current statement per worker/month; prevent repeated-click duplicates. Corrections are a later stage.
  if (workspace.payslips?.some((item) => item.organizationId === actor.organizationId && item.workerId === workerId && item.month === month)) return false;
  mutate((state) => ({ ...state, payslips: [...(state.payslips ?? []), slip] }));
  return !storageWritesBlocked;
}

export function getVisiblePayslips(workspace: DemoWorkspace): DemoPayslip[] {
  const actor = getActiveMember(workspace);
  if (actor.role === "agency") return (workspace.payslips ?? []).filter((item) => item.organizationId === actor.organizationId);
  if (actor.role !== "worker") return [];
  const identities = workspace.members.filter((member) => member.role === "worker" && (member.accountUid ?? member.id) === (actor.accountUid ?? actor.id));
  return (workspace.payslips ?? []).filter((item) => identities.some((member) => member.id === item.workerId && member.organizationId === item.organizationId));
}

export function setLeaderWorkerInputAccess(leaderMembershipId: string, workerId: string, access: WorkerInputAccess): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const member = actor.role === "leader" ? activeLeaderMemberships(workspace, actor).find((item) => item.id === leaderMembershipId) : undefined;
  if (!member?.factoryId || !effectiveLeaderPermissions(member).canManageGroups || !["self", "leader"].includes(access)) return false;
  const scoped = scopedWorkspace(workspace, member.organizationId);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === member.organizationId && item.role === "worker");
  const assignment = getWorkerProductionAssignment(scoped, workerId, member.factoryId);
  if (!worker || !assignment || !canLeaderAccessAssignment(scoped, actor, member.organizationId, member.factoryId, worker, assignment, "canManageGroups")) return false;
  mutate((state) => ({ ...state, factories: state.factories.map((item) => item.id === member.factoryId && item.organizationId === member.organizationId
    ? { ...item, workerAccess: { ...item.workerAccess, [workerId]: access } } : item) }));
  return !storageWritesBlocked;
}

export function createAgencyShift(workerId: string, draft: ShiftDraft): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const factory = getFactory(workspace, draft.factoryId);
  const site = workspace.worksites?.find((item) => item.id === factory?.worksiteId);
  const worker = workspace.members.find((item) => item.id === workerId && item.organizationId === actor.organizationId && item.role === "worker");
  if (actor.role !== "agency" || !factory || factory.archivedAt || site?.businessEntityId || !worker || storageWritesBlocked || !isValidShiftDraft(draft)) return false;
  const placement = activeEmploymentAt(workspace, actor.organizationId, workerId, factory.id, draft.localDate);
  if (!placement) return false;
  const shift = { ...shiftFromDraft(workerId, draft, "agency-admin", actor.id, policyRequiresReview(workspace, workerId, draft), "pending"), employmentId: placement.period.id };
  if (workspace.shifts.some((record) => record.organizationId === actor.organizationId && record.shift.workerUid === workerId && !record.shift.deletedAt
    && record.shift.startAt < shift.endAt && shift.startAt < record.shift.endAt)) return false;
  const record: DemoShiftRecord = { organizationId: actor.organizationId, shift, previousVersions: [], history: [makeHistoryEntry("created", actor.id, 1, undefined, valuesFromShift(shift))] };
  mutate((state) => ({ ...state, shifts: [record, ...state.shifts], notifications: [makeNotification(workerId, "shift-pending", shift.id), ...state.notifications] }));
  return !storageWritesBlocked;
}

export function savePersonalPayrollSettings(workerId: string, settings: PayrollSettings): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const worker = workspace.members.find((item) => item.id === workerId && item.role === "worker");
  if (actor.role !== "worker" || !worker || (worker.accountUid ?? worker.id) !== (actor.accountUid ?? actor.id) || storageWritesBlocked
    || !calculatePayroll({ ...settings, dayHours: 0, nightHours: 0, additions: 0, deductions: 0, note: "" })) return false;
  mutate((state) => ({ ...state, personalPayrollSettings: { ...state.personalPayrollSettings, [workerId]: { ...settings, issueEnabled: false } } }));
  return !storageWritesBlocked;
}

/** Attendance classification only: never generates a fine, pay deduction or legal decision. */
export function classifyRecordedAbsence(absenceId: string, category: "unreported" | "agreed-day-off", note: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const record = workspace.absences.find((item) => item.id === absenceId && item.organizationId === actor.organizationId);
  if (!record || !["unreported", "agreed-day-off"].includes(category) || !note.trim() || note.length > 500 || storageWritesBlocked
    || record.state === "cancelled" || record.state === "rejected" || !absenceEmploymentIsValid(workspace, record)
    || !(actor.role === "agency" || actor.role === "leader" && effectiveLeaderPermissions(actor).canReviewShifts && canManageWorker(record.workerId, workspace, record.factoryId))
    || workspace.shifts.some((item) => item.organizationId === record.organizationId && item.shift.workerUid === record.workerId && item.shift.factoryId === record.factoryId && item.shift.localStartDate === record.localDate && !item.shift.deletedAt)) return false;
  const reason = category === "agreed-day-off" ? "day-off" as const : undefined;
  const event: DemoAbsenceHistoryEntry = { id: `absence-event-${crypto.randomUUID()}`, actorId: actor.id, actorName: actor.name,
    action: category === "agreed-day-off" ? "agreed-day-off" : "marked-unreported", occurredAt: new Date().toISOString(), note: note.trim(),
    before: { localDate: record.localDate, reason: record.reason, message: record.message }, after: { localDate: record.localDate, reason, message: record.message } };
  mutate((state) => ({ ...state, absences: state.absences.map((item) => item.id === absenceId ? { ...item, reason, state: category === "agreed-day-off" ? "reviewed" : "unreported", agencyCategory: category, agencyNote: note.trim(), history: [...item.history, event] } : item),
    notifications: [makeNotification(record.workerId, "absence-agency-decision", absenceId, record.organizationId), ...state.notifications] }));
  return !storageWritesBlocked;
}

export function recordAgencyAbsence(workerId: string, factoryId: string, localDate: string, category: "unreported" | "agreed-day-off", note: string): boolean {
  const workspace = readWorkspace();
  const actor = getActiveMember(workspace);
  const placement = activeEmploymentAt(workspace, actor.organizationId, workerId, factoryId, localDate);
  if (actor.role !== "agency" || storageWritesBlocked || !placement || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isFinite(Date.parse(localDate)) || !note.trim() || note.length > 500 || !["unreported", "agreed-day-off"].includes(category)
    || workspace.absences.some((item) => item.organizationId === actor.organizationId && item.workerId === workerId && item.factoryId === factoryId && item.localDate === localDate && !["cancelled", "rejected"].includes(item.state))
    || workspace.shifts.some((item) => item.organizationId === actor.organizationId && item.shift.workerUid === workerId && item.shift.localStartDate === localDate && !item.shift.deletedAt)) return false;
  const now = new Date().toISOString();
  const record: DemoAbsence = { id: `absence-${crypto.randomUUID()}`, organizationId: actor.organizationId, workerId, factoryId, employmentId: placement.period.id,
    groupId: placement.placement.groupId ?? "", localDate, state: category === "agreed-day-off" ? "reviewed" : "unreported", reason: category === "agreed-day-off" ? "day-off" : undefined,
    agencyCategory: category, agencyNote: note.trim(), createdById: actor.id,
    history: [{ id: `absence-event-${crypto.randomUUID()}`, actorId: actor.id, actorName: actor.name, occurredAt: now, note: note.trim(), action: category === "agreed-day-off" ? "agreed-day-off" : "marked-unreported" }] };
  mutate((state) => ({ ...state, absences: [record, ...state.absences], notifications: [makeNotification(workerId, "absence-agency-decision", record.id), ...state.notifications] }));
  return !storageWritesBlocked;
}
