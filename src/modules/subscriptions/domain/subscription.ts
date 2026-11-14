import type { DemoMember, DemoSubscriptionPayerType, DemoSubscriptionStatus, DemoSubscriptionTier, DemoWorkspace } from "../../workflows/domain/demo-types";

export interface DemoPayerSummary {
  payerType: DemoSubscriptionPayerType;
  payerId: string;
  status: DemoSubscriptionStatus;
  tier?: DemoSubscriptionTier;
  usedWorkers: number;
  capacity: number | null;
  availableWorkers: number | null;
}

export function workerPayer(workspace: DemoWorkspace, worker: DemoMember): { payerType: DemoSubscriptionPayerType; payerId: string } | undefined {
  if (worker.role !== "worker") return undefined;
  const organization = workspace.organizations.find((item) => item.id === worker.organizationId);
  const category = worker.workerCategory ?? (organization?.type === "factory" ? "factory" : "agency");
  if (category === "factory") {
    const entity = (workspace.businessEntities ?? []).find((item) => item.id === worker.businessEntityId)
      ?? (workspace.businessEntities ?? []).find((item) => item.organizationId === worker.organizationId);
    if (!entity || entity.organizationId !== worker.organizationId) return undefined;
    return { payerType: "factory", payerId: entity.id };
  }
  if (organization?.type === "factory") return undefined;
  return { payerType: "agency", payerId: worker.organizationId };
}

export function countPayerWorkers(workspace: DemoWorkspace, payerType: DemoSubscriptionPayerType, payerId: string): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const accountUids = new Set<string>();
  for (const employment of workspace.employmentPeriods) {
    if (employment.state !== "active" || employment.startDate > today || employment.endDate && employment.endDate < today) continue;
    const worker = workspace.members.find((item) => item.role === "worker" && item.organizationId === employment.organizationId && item.id === employment.workerId);
    if (!worker) continue;
    const payer = workerPayer(workspace, { ...worker, workerCategory: employment.workerCategory ?? worker.workerCategory });
    if (payer?.payerType === payerType && payer.payerId === payerId) accountUids.add(worker.accountUid ?? worker.id);
  }
  return accountUids.size;
}

export function getPayerSummary(workspace: DemoWorkspace, payerType: DemoSubscriptionPayerType, payerId: string): DemoPayerSummary {
  const subscription = (workspace.subscriptions ?? []).find((item) => item.payerType === payerType && item.payerId === payerId);
  const status: DemoSubscriptionStatus = subscription?.status ?? "free";
  const tier = subscription ? (workspace.subscriptionTiers ?? []).find((item) => item.id === subscription.tierId) : undefined;
  const usedWorkers = countPayerWorkers(workspace, payerType, payerId);
  const capacity = tier?.maxWorkers ?? null;
  return { payerType, payerId, status, tier, usedWorkers, capacity, availableWorkers: capacity === null ? null : Math.max(0, capacity - usedWorkers) };
}

export function canAddFactoryWorker(workspace: DemoWorkspace, businessEntityId: string): boolean {
  const summary = getPayerSummary(workspace, "factory", businessEntityId);
  return summary.status === "test-active" && Boolean(summary.tier) && (summary.capacity === null || summary.usedWorkers < summary.capacity);
}

export function canAddAgencyWorker(workspace: DemoWorkspace, agencyOrganizationId: string): boolean {
  const subscription = (workspace.subscriptions ?? []).find((item) => item.payerType === "agency" && item.payerId === agencyOrganizationId);
  if (!subscription) return true;
  const summary = getPayerSummary(workspace, "agency", agencyOrganizationId);
  return summary.status === "test-active" && Boolean(summary.tier) && (summary.capacity === null || summary.usedWorkers < summary.capacity);
}

export function tierAcceptsCurrentWorkers(tier: DemoSubscriptionTier, currentWorkerCount: number): boolean {
  return currentWorkerCount >= 0 && currentWorkerCount <= (tier.maxWorkers ?? Number.POSITIVE_INFINITY);
}
