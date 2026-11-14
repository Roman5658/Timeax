import type { AgencyId, FactoryId, IanaTimeZone, IsoDateTime, UserUid } from "../../shifts/domain/types";

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WorkCalendarPolicy {
  id: string;
  scope: "agency" | "factory" | "worker";
  scopeId: string;
  timeZone: IanaTimeZone;
  workingWeekdays: Weekday[];
  holidays: Array<{ localDate: string; label?: string; isWorkingDay: boolean }>;
  createdByUid: UserUid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  version: number;
}

export interface PlannedShift {
  id: string;
  workerUid: UserUid;
  agencyId: AgencyId;
  factoryId?: FactoryId;
  localDate: string;
  templateId?: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  timeZone: IanaTimeZone;
  createdByUid: UserUid;
}

export type AttendanceReviewReason = "missing-shift-entry" | "reported-absence";

/** Missing shift input is a review item, never an automatic absence or violation. */
export interface AttendanceReviewItem {
  id: string;
  agencyId: AgencyId;
  factoryId?: FactoryId;
  workerUid: UserUid;
  localDate: string;
  reason: AttendanceReviewReason;
  note?: string;
  state: "open" | "reviewed" | "resolved";
  createdAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
  resolvedByUid?: UserUid;
}
