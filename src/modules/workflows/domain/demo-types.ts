import type { Shift } from "../../shifts/domain/types";

export type DemoRole = "worker" | "leader" | "agency" | "factory-admin";
export type ProductionInputMode = "A" | "B" | "C";
export type WorkerInputAccess = "self" | "leader";
export type DemoBreakRuleTreatment = "unpaid" | "paid";
export type DemoTemplateBreakType = "none" | "paid" | "unpaid";
export type DemoAbsenceReason = "day-off" | "vacation" | "illness" | "family" | "personal" | "other";
export type DemoAbsenceState = "reported" | "reviewed" | "rejected" | "cancelled" | "unreported" | "clarification-requested";
export type DemoAbsenceAgencyCategory = "confirmed-no-hours" | "urlop-na-zadanie" | "unreported" | "attention";
export type DemoAbsenceDecision = "confirmed-no-hours" | "urlop-na-zadanie" | "send-agency" | "unreported";
export type DemoShiftStatus = "open" | "accepted" | "declined";
export type DemoShiftAction = "created" | "edited" | "organization-edited" | "confirmed" | "leader-confirmed" | "disputed" | "corrected" | "declined" | "cancelled" | "reviewed" | "returned" | "break-reported" | "break-reviewed" | "break-returned" | "change-requested" | "change-request-approved" | "change-request-declined";
export type DemoScheduleOutcome = "worked" | "reported-absence" | "unreported-absence" | "approved-absence" | "cancelled-or-changed";
export type DemoMonthlyTimesheetStatus = "in_progress" | "ready_for_review" | "returned_to_leader" | "submitted_to_agency" | "accepted_by_agency" | "submitted_by_factory" | "accepted_by_factory" | "reopened";
export type DemoTimesheetEventAction = "ready" | "submitted" | "resent" | "accepted" | "returned" | "reopened";
export type DemoWorkerCategory = "agency" | "factory";
export type DemoSubscriptionPayerType = "agency" | "factory";
export type DemoSubscriptionStatus = "free" | "test-active" | "inactive";

export interface DemoOrganization {
  id: string;
  name: string;
  timezone: string;
  /** Kept for old demo records; production itself is never an account type. */
  type?: "agency" | "factory";
  billingScenario?: "agency-sponsored-factory" | "self-operated";
  payingOrganizationId?: string;
  contactEmail?: string;
  address?: string;
  description?: string;
}

export interface DemoWorkCalendar {
  workingWeekdays: number[];
  exceptions: Array<{ localDate: string; isWorkingDay: boolean; label?: string }>;
}

export interface DemoFactory {
  id: string;
  organizationId: string;
  /** Physical site shared by this agency-owned production. */
  worksiteId?: string;
  /** Factory-owned workforce operating at this site, inside the single factory account. */
  ownerWorkforce?: boolean;
  name: string;
  inputMode: ProductionInputMode;
  workerAccess: Record<string, WorkerInputAccess>;
  requiredBreakMinutes: number;
  requiredBreakTreatment?: DemoBreakRuleTreatment;
  allowActualBreakReport?: boolean;
  allowTimeDataSubmission?: boolean;
  /** New production placements may require a leader to assign the worker to a group or leave them independent. */
  requireNewWorkerTeamAssignment?: boolean;
  workflowSettings?: DemoProductionWorkflowSettings;
  address?: string;
  description?: string;
  workCalendar?: DemoWorkCalendar;
  archivedAt?: string;
}

export interface DemoGroup {
  id: string;
  organizationId: string;
  factoryId: string;
  leaderId?: string;
  departmentId?: string;
  name: string;
  archivedAt?: string;
}

export interface DemoFolder {
  id: string;
  organizationId: string;
  name: string;
  archivedAt?: string;
}

export interface DemoProductionAssignment {
  factoryId: string;
  groupId?: string;
  leaderId?: string;
  leaderAccountUid?: string;
  departmentId?: string;
  requiresTeamAssignment?: boolean;
}

/** Leader responsibility is independent from employment and production placement. */
export interface DemoLeaderWorkerAccess {
  id: string;
  leaderMembershipId: string;
  organizationId: string;
  factoryId: string;
  workerId: string;
  state: "active" | "removed";
  changedAt: string;
  changedById: string;
}

export interface DemoMember {
  id: string;
  organizationId: string;
  role: DemoRole;
  name: string;
  accountUid?: string;
  /** Set only for the single company-admin account attached to a business entity. */
  businessEntityId?: string;
  /** Worker ownership is explicit; older records infer it from the organization type. */
  workerCategory?: DemoWorkerCategory;
  /** A shared worker login is billed to its canonical owning agency only once. */
  workerPayerOrganizationId?: string;
  email?: string;
  phone?: string;
  factoryId?: string;
  groupId?: string;
  leaderId?: string;
  leaderAccountUid?: string;
  departmentId?: string;
  folderId?: string;
  canManageGroups?: boolean;
  canManageAllWorkers?: boolean;
  /** Access state is separate from worker presence and retains revoked history. */
  accessState?: "active" | "suspended" | "revoked";
  permissions?: DemoLeaderPermissions;
  productionAssignments?: DemoProductionAssignment[];
  status: "active" | "away";
}

export interface DemoTemplate {
  id: string;
  organizationId: string;
  workerId: string;
  name: string;
  icon: "sun" | "coffee" | "moon" | "zap";
  startTime: string;
  endTime: string;
  breakType?: DemoTemplateBreakType;
  breakStart?: string;
  breakEnd?: string;
  breakDurationMinutes?: number;
  enabled: boolean;
  order: number;
}

export interface DemoShiftValues {
  localDate: string;
  startAt: string;
  endAt: string;
  comment: string;
  breakStatus: Shift["actualBreak"]["status"];
  breakTreatment?: DemoBreakRuleTreatment;
  breakStartAt?: string;
  breakEndAt?: string;
  grossDurationMinutes: number;
  paidDurationMinutes: number;
  unpaidBreakDurationMinutes: number;
  totalBreakDurationMinutes?: number;
}

export interface DemoChangeRequest {
  id: string;
  organizationId: string;
  shiftId: string;
  workerId: string;
  approverType: "agency" | "leader";
  approverId: string;
  state: "open" | "approved" | "rejected";
  reason: string;
  proposedValues: DemoShiftValues;
  originalValues: DemoShiftValues;
  originalRevision?: number;
  requestedAt: string;
  resolvedAt?: string;
  resolvedById?: string;
  response?: string;
}

export interface DemoShiftHistoryEntry {
  id: string;
  action: DemoShiftAction;
  actorId: string;
  actorName: string;
  occurredAt: string;
  revision: number;
  oldValues?: DemoShiftValues;
  newValues?: DemoShiftValues;
  note?: string;
}

export interface DemoDispute {
  reason: string;
  submittedAt: string;
  state: DemoShiftStatus;
  leaderResponse?: string;
  resolvedAt?: string;
}

export interface DemoShiftRecord {
  organizationId: string;
  shift: Shift;
  clientSubmissionId?: string;
  plannedBreak?: { startTime?: string; endTime?: string; durationMinutes?: number; treatment?: DemoBreakRuleTreatment };
  dispute?: DemoDispute;
  cancelledAt?: string;
  cancelledById?: string;
  cancellationReason?: string;
  history: DemoShiftHistoryEntry[];
  previousVersions: DemoShiftValues[];
}

export interface DemoAbsenceHistoryEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: "reported" | "reviewed" | "edited" | "cancelled" | "rejected" | "recorded" | "marked-unreported" | "confirmed-no-hours" | "urlop-na-zadanie" | "agency-notified" | "clarification-requested" | "clarification-replied";
  occurredAt: string;
  note?: string;
  before?: { localDate: string; reason?: DemoAbsenceReason; message?: string };
  after?: { localDate: string; reason?: DemoAbsenceReason; message?: string };
}

export interface DemoAbsence {
  id: string;
  organizationId: string;
  workerId: string;
  employmentId?: string;
  factoryId: string;
  groupId: string;
  localDate: string;
  reason?: DemoAbsenceReason;
  message?: string;
  reportedAt?: string;
  state: DemoAbsenceState;
  leaderNote?: string;
  agencyCategory?: DemoAbsenceAgencyCategory;
  agencyNote?: string;
  clarificationRequest?: string;
  clarificationReply?: string;
  createdById: string;
  history: DemoAbsenceHistoryEntry[];
}

export interface DemoEmploymentPlacement {
  id: string;
  factoryId: string;
  groupId?: string;
  leaderId?: string;
  departmentId?: string;
  leaderAccountUid?: string;
  startDate: string;
  endDate?: string;
  createdAt: string;
  createdById: string;
  requiresTeamAssignment?: boolean;
  endedAt?: string;
  endedById?: string;
}

export interface DemoEmploymentEvent {
  id: string;
  actorId: string;
  action: "hired" | "rehired" | "transferred" | "leader-changed" | "department-changed" | "group-changed" | "placement-added" | "placement-ended" | "ended";
  occurredAt: string;
  note?: string;
}

export interface DemoEmploymentPeriod {
  id: string;
  organizationId: string;
  workerId: string;
  accountUid: string;
  workerCategory?: DemoWorkerCategory;
  state: "active" | "ended";
  startDate: string;
  endDate?: string;
  createdAt: string;
  createdById: string;
  endedAt?: string;
  endedById?: string;
  placements: DemoEmploymentPlacement[];
  history: DemoEmploymentEvent[];
}

export interface DemoMessage {
  id: string;
  senderId: string;
  text: string;
  sentAt: string;
  readByIds: string[];
}

export interface DemoMessageThread {
  id: string;
  organizationId: string;
  workerId?: string;
  factoryId?: string;
  recipientType: "agency" | "leader" | "production" | "worker";
  category?: "service-note" | "complaint";
  recipientId: string;
  participants: string[];
  subject: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  messages: DemoMessage[];
}

export interface DemoScheduleHistoryEntry {
  id: string;
  actorId: string;
  action: "created" | "updated" | "cancelled" | "attendance-reviewed";
  occurredAt: string;
  note?: string;
}

export interface DemoSchedule {
  id: string;
  organizationId: string;
  factoryId: string;
  workerIds: string[];
  startDate: string;
  endDate: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  plannedBreakStart?: string;
  plannedBreakEnd?: string;
  state: "active" | "cancelled";
  createdById: string;
  createdAt: string;
  updatedAt: string;
  history: DemoScheduleHistoryEntry[];
}

export interface DemoScheduleAttendanceReview {
  id: string;
  organizationId: string;
  scheduleId: string;
  workerId: string;
  factoryId: string;
  localDate: string;
  outcome: DemoScheduleOutcome;
  note?: string;
  reviewedById: string;
  reviewedAt: string;
  history: DemoScheduleHistoryEntry[];
}

export interface DemoMonthlyTimesheetRow {
  id: string;
  workerId: string;
  workerName: string;
  kind: "shift" | "absence";
  recordId: string;
  localDate: string;
  weekday: number;
  startAt?: string;
  endAt?: string;
  grossDurationMinutes: number;
  totalBreakDurationMinutes: number;
  unpaidBreakDurationMinutes: number;
  paidDurationMinutes: number;
  ordinaryDurationMinutes: number;
  nightDurationMinutes: number;
  overtimeDurationMinutes: number;
  nonWorkingDayDurationMinutes: number;
  holidayDurationMinutes: number;
  breakTreatment?: "paid" | "unpaid";
  workerConfirmation?: "not-required" | "pending" | "confirmed" | "disputed";
  reviewState?: "not-submitted" | "pending" | "approved" | "returned";
  dataMismatch?: boolean;
  attentionReasons?: Array<{
    code: "worker-confirmation" | "worker-dispute" | "shift-review" | "break-review" | "break-returned" | "review-returned" | "time-mismatch" | "absence-review" | "absence-unreported" | "absence-clarification";
    responsible: "worker" | "leader" | "agency";
    detail?: string;
  }>;
  absenceCategory?: DemoAbsenceAgencyCategory;
  absenceState?: DemoAbsenceState;
  comment?: string;
  shiftHistory?: DemoShiftHistoryEntry[];
}

export interface DemoMonthlyTimesheetTotals {
  workerCount: number;
  shiftCount: number;
  absenceCount: number;
  grossDurationMinutes: number;
  totalBreakDurationMinutes: number;
  unpaidBreakDurationMinutes: number;
  paidDurationMinutes: number;
  ordinaryDurationMinutes: number;
  nightDurationMinutes: number;
  overtimeDurationMinutes: number;
  nonWorkingDayDurationMinutes: number;
  holidayDurationMinutes: number;
}

export interface DemoMonthlyTimesheetSignature {
  signerId: string;
  signerAccountUid: string;
  signerName: string;
  signerRole: "leader" | "agency" | "factory-admin";
  signerRoleLabel?: string;
  factoryId: string;
  factoryName: string;
  month: string;
  version: number;
  signedAt: string;
  statement: string;
}

export interface DemoMonthlyTimesheetVersion {
  id: string;
  number: number;
  createdAt: string;
  rows: DemoMonthlyTimesheetRow[];
  totals: DemoMonthlyTimesheetTotals;
  signature: DemoMonthlyTimesheetSignature;
}

export interface DemoMonthlyTimesheetEvent {
  id: string;
  action: DemoTimesheetEventAction;
  fromStatus?: DemoMonthlyTimesheetStatus;
  toStatus: DemoMonthlyTimesheetStatus;
  actorId: string;
  actorAccountUid: string;
  actorName: string;
  actorRole: DemoRole;
  occurredAt: string;
  note?: string;
  version?: number;
}

export interface DemoMonthlyTimesheet {
  id: string;
  organizationId: string;
  factoryId: string;
  month: string;
  status: DemoMonthlyTimesheetStatus;
  currentVersion: number;
  versions: DemoMonthlyTimesheetVersion[];
  history: DemoMonthlyTimesheetEvent[];
  updatedAt: string;
}

export interface DemoNotification {
  id: string;
  organizationId: string;
  recipientId: string;
  kind: "shift-pending" | "shift-confirmed" | "shift-disputed" | "shift-answer" | "shift-updated" | "shift-cancelled" | "break-review-updated" | "absence-reported" | "absence-agency-update" | "absence-clarification-requested" | "change-requested" | "change-request-approved" | "change-request-rejected" | "message-received" | "schedule-updated" | "employment-updated" | "team-assignment-needed" | "worksite-worker-available" | "timesheet-ready" | "timesheet-submitted" | "timesheet-resent" | "timesheet-accepted" | "timesheet-returned" | "timesheet-reopened" | "agency-connection-requested" | "agency-connection-invited" | "agency-connection-accepted" | "agency-invitation-declined" | "agency-connection-declined" | "agency-connected" | "factory-invitation-registered" | "leader-invitation-accepted" | "leader-connection-requested" | "worksite-worker-assigned" | "agency-worker-join-requested" | "absence-agency-decision";
  subjectId: string;
  createdAt: string;
  readAt?: string;
}

export interface DemoWorksite {
  id: string;
  businessEntityId?: string;
  name: string;
  address?: string;
  description?: string;
  identifier?: string;
}

export interface DemoBusinessWorksiteRosterEntry {
  worksiteId: string;
  organizationId: string;
  organizationName: string;
  factoryId: string;
  factoryName: string;
  worker: DemoMember;
  workerCategory: DemoWorkerCategory;
  employmentId: string;
  departmentId?: string;
  departmentName?: string;
  leaderAccountUid?: string;
  leaderName?: string;
}

/** One independent territorial central cabinet owns its worksites and operating data. */
export interface DemoBusinessEntity {
  id: string;
  organizationId: string;
  name: string;
  nip?: string;
  city?: string;
  identifier?: string;
  adminMemberId: string;
  createdAt: string;
}

export interface DemoCentralSearchResult {
  businessEntityId: string;
  name: string;
  nip?: string;
  city?: string;
  identifier?: string;
  registrationStatus: "registered";
  matchedWorksiteId?: string;
  worksites: Array<{ id: string; name: string; address?: string; identifier?: string }>;
}

/** An agency receives access only after a business admin approves this link. */
export interface DemoAgencyWorksite {
  id: string;
  organizationId: string;
  businessEntityId: string;
  worksiteId: string;
  state: "active" | "revoked";
  createdAt: string;
  approvedAt: string;
  approvedByMemberId: string;
  source: "invitation" | "request";
}

export interface DemoWorksiteConnectionRequest {
  id: string;
  organizationId: string;
  businessEntityId: string;
  worksiteId?: string;
  requestedWorksiteName: string;
  requestedAddress: string;
  requestedIdentifier?: string;
  productionName: string;
  source?: "search" | "invitation";
  direction?: "agency-request" | "factory-invitation";
  invitationId?: string;
  state: "pending" | "approved" | "declined";
  createdById: string;
  createdAt: string;
  resolvedByMemberId?: string;
  resolvedAt?: string;
  response?: string;
}

export interface DemoFactoryInvitation {
  id: string;
  token: string;
  organizationId: string;
  email?: string;
  companyName?: string;
  nip?: string;
  city?: string;
  worksiteName?: string;
  worksiteAddress?: string;
  worksiteIdentifier?: string;
  productionName?: string;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "accepted" | "revoked" | "expired";
  acceptedBusinessEntityId?: string;
  acceptedWorksiteId?: string;
  acceptedByMemberId?: string;
  simulatedEmailSentAt?: string;
}

export interface DemoLeaderConnectionRequest {
  id: string;
  businessEntityId: string;
  worksiteId: string;
  accountUid: string;
  name: string;
  email: string;
  state: "pending" | "approved" | "declined";
  createdAt: string;
  resolvedByMemberId?: string;
  resolvedAt?: string;
  response?: string;
  acceptedOrganizationIds?: string[];
}

export interface DemoDepartment {
  id: string;
  businessEntityId: string;
  worksiteId: string;
  name: string;
  createdAt: string;
  archivedAt?: string;
}

/** Site-level leader permissions are global; DemoMember rows remain agency/worksite memberships. */
export interface DemoLeaderWorksiteMembership {
  id: string;
  businessEntityId: string;
  worksiteId: string;
  accountUid: string;
  name: string;
  email?: string;
  departmentIds: string[];
  /** Agency scopes explicitly granted to this identity by the factory administrator. */
  organizationIds?: string[];
  permissions: DemoLeaderPermissions;
  state: "active" | "suspended" | "revoked";
  createdAt: string;
}

export interface DemoLeaderInvitation {
  id: string;
  token: string;
  businessEntityId: string;
  worksiteId: string;
  organizationIds: string[];
  name: string;
  email: string;
  departmentIds: string[];
  permissions: DemoLeaderPermissions;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "accepted" | "revoked" | "expired";
  acceptedAccountUid?: string;
  acceptedAt?: string;
  simulatedEmailSentAt?: string;
}

/** Worker join requests become an organization membership only after agency approval. */
export interface DemoWorkerInvitation {
  id: string;
  code: string;
  organizationId: string;
  createdById: string;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "awaiting-approval" | "approved" | "declined" | "revoked" | "expired";
  registeredAt?: string;
  accountUid?: string;
  workerId?: string;
  name?: string;
  email?: string;
  phone?: string;
  resolvedAt?: string;
  resolvedById?: string;
  response?: string;
}

export interface DemoProductionWorkflowSettings {
  workerCanRecordHours: boolean;
  leaderCanRecordHours: boolean;
  leaderMustReviewShifts: boolean;
  agencyMustReviewShifts: boolean;
  workerMustConfirmShifts: boolean;
  workerCanDisputeShifts: boolean;
  leaderCanSubmitTimesheet: boolean;
  agencyCanSubmitTimesheet: boolean;
  agencyMustAcceptTimesheet: boolean;
}

export interface DemoLeaderPermissions {
  canViewWorkers: boolean;
  canRecordHours: boolean;
  canReviewShifts: boolean;
  canConfirmShifts: boolean;
  canSubmitTimesheet: boolean;
  canManageGroups: boolean;
}

export interface DemoWorkspace {
  schemaVersion: 8;
  organization: DemoOrganization;
  organizations: DemoOrganization[];
  worksites?: DemoWorksite[];
  businessEntities?: DemoBusinessEntity[];
  agencyWorksites?: DemoAgencyWorksite[];
  worksiteConnectionRequests?: DemoWorksiteConnectionRequest[];
  factoryInvitations?: DemoFactoryInvitation[];
  departments?: DemoDepartment[];
  leaderWorksiteMemberships?: DemoLeaderWorksiteMembership[];
  leaderInvitations?: DemoLeaderInvitation[];
  workerInvitations?: DemoWorkerInvitation[];
  leaderConnectionRequests?: DemoLeaderConnectionRequest[];
  subscriptions?: DemoSubscription[];
  subscriptionTiers?: DemoSubscriptionTier[];
  members: DemoMember[];
  factories: DemoFactory[];
  groups: DemoGroup[];
  leaderWorkerAccess?: DemoLeaderWorkerAccess[];
  folders?: DemoFolder[];
  activeMemberId: string;
  shifts: DemoShiftRecord[];
  templates: DemoTemplate[];
  absences: DemoAbsence[];
  employmentPeriods: DemoEmploymentPeriod[];
  messageThreads: DemoMessageThread[];
  schedules: DemoSchedule[];
  scheduleAttendanceReviews: DemoScheduleAttendanceReview[];
  monthlyTimesheets?: DemoMonthlyTimesheet[];
  changeRequests?: DemoChangeRequest[];
  notifications: DemoNotification[];
}

/** One demo entitlement per paying agency or factory; test mode never represents a real payment. */
export interface DemoSubscription {
  id: string;
  payerType: DemoSubscriptionPayerType;
  payerId: string;
  status: Exclude<DemoSubscriptionStatus, "free">;
  tierId: string;
  activatedAt: string;
  updatedAt: string;
  demo: true;
}

/** Commercial brackets are workspace configuration, not hard-coded feature branches. */
export interface DemoSubscriptionTier {
  id: string;
  minWorkers: number;
  maxWorkers: number | null;
  sortOrder: number;
}
