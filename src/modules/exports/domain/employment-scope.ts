export interface EmploymentPlacementWindow {
  factoryId: string;
  startDate: string;
  endDate?: string;
}

export interface EmploymentWindow {
  id: string;
  organizationId: string;
  workerId: string;
  state: "active" | "ended";
  startDate: string;
  endDate?: string;
  placements: EmploymentPlacementWindow[];
}

export function placementIsActiveOnDate(
  period: EmploymentWindow,
  placement: EmploymentPlacementWindow,
  factoryId: string,
  date: string,
  employmentId?: string,
): boolean {
  if (placement.factoryId !== factoryId || (employmentId && period.id !== employmentId)) return false;
  if (period.startDate > date || placement.startDate > date) return false;
  if (period.endDate ? period.endDate < date : period.state !== "active") return false;
  if (placement.endDate && placement.endDate < date) return false;
  return true;
}

export function workerHasProductionOnDate(
  periods: EmploymentWindow[],
  scope: { organizationId: string; workerId: string; factoryId: string; date: string; employmentId?: string },
  legacyFactoryIds: string[] = [],
): boolean {
  const workerPeriods = periods.filter((period) => period.organizationId === scope.organizationId && period.workerId === scope.workerId);
  if (!workerPeriods.length) return legacyFactoryIds.includes(scope.factoryId);
  return workerPeriods.some((period) => period.placements.some((placement) => placementIsActiveOnDate(
    period,
    placement,
    scope.factoryId,
    scope.date,
    scope.employmentId,
  )));
}
