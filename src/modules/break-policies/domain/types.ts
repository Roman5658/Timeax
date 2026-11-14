import type { BreakTreatment, IsoDateTime, UserUid } from "../../shifts/domain/types";

export type BreakRuleScope = "agency" | "factory";
export type BreakPolicyTreatment = BreakTreatment | "none";
export type BreakPolicyEditorRole = "agency-owner" | "agency-admin" | "factory-admin";

export interface BreakPolicyRule {
  id: string;
  scope: BreakRuleScope;
  scopeId: string;
  required: boolean;
  defaultTreatment: BreakPolicyTreatment;
  minimumMinutes?: number;
  allowedTreatments: BreakPolicyTreatment[];
  editableByRoles: BreakPolicyEditorRole[];
  workerMayEditActualTimes: boolean;
  workerMayChooseTreatment: boolean;
  noBreakRequiresReview: boolean;
  createdByUid: UserUid;
  createdAt: IsoDateTime;
  updatedByUid: UserUid;
  updatedAt: IsoDateTime;
  effectiveFrom: IsoDateTime;
  version: number;
}

/** Personal defaults are preferences and never replace an organization rule. */
export interface WorkerBreakPreference {
  workerUid: UserUid;
  agencyId: string;
  factoryId?: string;
  preferredTreatment?: BreakPolicyTreatment;
  preferredBreaks: Array<{ startLocalTime?: string; durationMinutes?: number }>;
  updatedByUid: UserUid;
  updatedAt: IsoDateTime;
  version: number;
}

/**
 * Resolution is explicit: a mandatory rule from either organization remains
 * mandatory (required = agency.required OR factory.required). Allowed treatments
 * are the intersection; when required, `none` is removed. An empty intersection
 * is a configuration conflict. Factory defaults win over agency defaults only
 * for non-mandatory defaults.
 * Worker preferences apply only when permitted by the resolved organization rule.
 */
export interface BreakPolicyResolution {
  agencyRuleId: string;
  factoryRuleId?: string;
  workerPreferenceWorkerUid?: UserUid;
  required: boolean;
  allowedTreatments: BreakPolicyTreatment[];
  minimumMinutes?: number;
  workerMayEditActualTimes: boolean;
  workerMayChooseTreatment: boolean;
  noBreakRequiresReview: boolean;
  resolvedAt: IsoDateTime;
}
