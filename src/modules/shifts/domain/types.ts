export type UserUid = string;
export type ShiftId = string;
export type AgencyId = string;
export type FactoryId = string;
export type IsoDateTime = string;
export type IanaTimeZone = string;

export type ShiftEntrySource = "worker" | "leader" | "agency-admin" | "factory-admin";
export type WorkerConfirmation = "not-required" | "pending" | "confirmed" | "disputed";
export type ShiftReviewState = "not-submitted" | "pending" | "approved" | "returned";
export type BreakTreatment = "paid" | "unpaid";
export type ActualBreakStatus = "taken" | "not-taken" | "not-reported";

export interface TimeInterval {
  startAt: IsoDateTime;
  endAt: IsoDateTime;
}

export interface BreakSegment extends TimeInterval {
  treatment: BreakTreatment;
  durationMinutes: number;
}

/** A planned break is only a template value; it does not prove that a break occurred. */
export interface PlannedBreakSegment {
  startLocalTime: string;
  endLocalTime: string;
  treatment: BreakTreatment;
}

export interface ActualBreakReport {
  status: ActualBreakStatus;
  /** Treatment selected when the break is reported only as an aggregate duration. */
  treatment?: BreakTreatment;
  segments: BreakSegment[];
  reportedByUid?: UserUid;
  reportedAt?: IsoDateTime;
  lastChangedByUid?: UserUid;
  lastChangedAt?: IsoDateTime;
  exceptionReason?: string;
  reviewState: "not-required" | "pending" | "approved" | "rejected";
}

export interface ResolvedBreakPolicySnapshot {
  appliedRuleIds: string[];
  required: boolean;
  allowedTreatments: BreakTreatment[];
  workerMayEditActualTimes: boolean;
  workerMayChooseTreatment: boolean;
  noBreakRequiresReview: boolean;
  capturedAt: IsoDateTime;
  version: number;
}

export interface Shift {
  id: ShiftId;
  workerUid: UserUid;
  agencyId: AgencyId;
  factoryId?: FactoryId;
  /** Agency-specific employment that authorized this shift; optional on legacy records. */
  employmentId?: string;
  folderId?: string;
  assignmentId?: string;
  localStartDate: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  timeZone: IanaTimeZone;
  /** Server-calculated elapsed time, before subtracting unpaid breaks. */
  grossDurationMinutes: number;
  totalBreakDurationMinutes: number;
  unpaidBreakDurationMinutes: number;
  /** Server-calculated time after subtracting only unpaid break segments. */
  paidDurationMinutes: number;
  actualBreak: ActualBreakReport;
  breakPolicySnapshot: ResolvedBreakPolicySnapshot;
  comment?: string;
  source: ShiftEntrySource;
  createdByUid: UserUid;
  createdAt: IsoDateTime;
  updatedByUid: UserUid;
  updatedAt: IsoDateTime;
  revision: number;
  workerConfirmation: WorkerConfirmation;
  reviewState: ShiftReviewState;
  deletedAt?: IsoDateTime;
}

export type ShiftEventAction =
  | "created"
  | "time-changed"
  | "break-reported"
  | "break-changed"
  | "worker-confirmed"
  | "disputed"
  | "approved"
  | "returned"
  | "archived"
  | "restored";

export interface ShiftChangeEvent {
  id: string;
  shiftId: ShiftId;
  agencyId: AgencyId;
  actorUid: UserUid;
  action: ShiftEventAction;
  occurredAt: IsoDateTime;
  revision: number;
  reason?: string;
  changedFields: string[];
  requestId: string;
}

export interface ShiftTemplate {
  id: string;
  organizationId: AgencyId | FactoryId | UserUid;
  ownerType: "agency" | "factory" | "worker";
  name: string;
  startLocalTime: string;
  endLocalTime: string;
  plannedBreaks: PlannedBreakSegment[];
  createdByUid: UserUid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isDefault: boolean;
  archivedAt?: IsoDateTime;
}
