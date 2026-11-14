import type { IsoDateTime, UserUid } from "../../shifts/domain/types";

export type ExportColumnKey =
  | "worker"
  | "agency"
  | "folder"
  | "factory"
  | "shiftDate"
  | "weekday"
  | "startTime"
  | "endTime"
  | "grossDuration"
  | "breaks"
  | "paidTime"
  | "shiftNote"
  | "comment"
  | "confirmation"
  | "absence";

export interface ExportColumnConfig {
  key: ExportColumnKey;
  enabled: boolean;
  order: number;
  headerOverride?: string;
}

export type ExportScopeKind =
  | "worker"
  | "selected-workers"
  | "folder"
  | "selected-folders"
  | "all-folders"
  | "group"
  | "selected-groups"
  | "factory"
  | "selected-factories"
  | "all-factories"
  | "all-workers";

export interface ExportPeriod {
  kind: "month" | "year" | "date-range" | "date" | "all";
  year?: string;
  month?: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ExcelExportTemplate {
  id: string;
  organizationId: string;
  ownerType: "agency" | "factory";
  agencyId?: string;
  factoryId?: string;
  name: string;
  schemaVersion: number;
  columns: ExportColumnConfig[];
  scope?: ExportScopeKind;
  workerUids?: UserUid[];
  folderIds?: string[];
  groupIds?: string[];
  factoryIds?: string[];
  period?: ExportPeriod;
  dateFormat: "dd.MM.yyyy" | "yyyy-MM-dd" | "localized-long";
  timeFormat: "24-hour" | "12-hour";
  showComments: boolean;
  breakDisplay: "hidden" | "duration" | "intervals-and-duration";
  showPaidTime: boolean;
  showGrossDuration: boolean;
  showWeekendsAndAbsences: boolean;
  isDefault: boolean;
  createdByUid: UserUid;
  createdAt: IsoDateTime;
  updatedByUid: UserUid;
  updatedAt: IsoDateTime;
  archivedAt?: IsoDateTime;
}

export interface ExportRequestDraft {
  agencyId: string;
  scope: ExportScopeKind;
  workerUids: UserUid[];
  folderIds: string[];
  groupIds: string[];
  factoryIds: string[];
  period: ExportPeriod;
  templateId?: string;
}
