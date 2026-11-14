import type { Shift } from "../shifts/domain/types";
import type { DemoAbsence, DemoEmploymentPeriod, DemoFactory, DemoGroup, DemoMember, DemoShiftRecord, DemoTemplate, DemoWorkspace, DemoWorksite } from "./domain/demo-types";

const organizationId = "org-demo-01";
const partnerOrganizationId = "org-partner-demo";
const independentFactoryOrganizationId = "org-independent-factory-demo";
const organizations = [
  { id: organizationId, name: "Agencja A", timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: "agency-a@example.test", address: "Warszawa, Polska" },
  { id: partnerOrganizationId, name: "Agencja B", timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: "agency-b@example.test", address: "Gdańsk, Polska" },
  { id: independentFactoryOrganizationId, name: "Agencja C", timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: "agency-c@example.test", address: "Łódź, Polska" },
];

const subscriptionTiers = [
  { id: "workers-30", minWorkers: 1, maxWorkers: 30, sortOrder: 1 },
  { id: "workers-70", minWorkers: 31, maxWorkers: 70, sortOrder: 2 },
  { id: "workers-200", minWorkers: 71, maxWorkers: 200, sortOrder: 3 },
  { id: "workers-500", minWorkers: 201, maxWorkers: 500, sortOrder: 4 },
  { id: "workers-custom", minWorkers: 501, maxWorkers: null, sortOrder: 5 },
];

function localDateOffset(offset: number): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function localDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function addOneDay(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + 1);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

const worksites: DemoWorksite[] = [
  { id: "worksite-alfa", name: "Zakład Alfa", address: "Warszawa, Polska" },
  { id: "worksite-beta", name: "Magazyn Beta", address: "Poznań, Polska" },
];

const factories: DemoFactory[] = [
  { id: "factory-alpha", organizationId, worksiteId: "worksite-alfa", name: "Zakład Alfa", inputMode: "A", workerAccess: {}, requiredBreakMinutes: 20, requiredBreakTreatment: "unpaid", allowActualBreakReport: true, allowTimeDataSubmission: true, address: "Warszawa", description: "Produkcja Agencji A przy Zakładzie Alfa.", workflowSettings: { workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: true, agencyMustReviewShifts: false, workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: false, agencyMustAcceptTimesheet: true }, workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] } },
  { id: "factory-beta", organizationId, worksiteId: "worksite-beta", name: "Magazyn Beta", inputMode: "B", workerAccess: {}, requiredBreakMinutes: 20, requiredBreakTreatment: "paid", allowActualBreakReport: true, allowTimeDataSubmission: true, workflowSettings: { workerCanRecordHours: true, leaderCanRecordHours: true, leaderMustReviewShifts: false, agencyMustReviewShifts: false, workerMustConfirmShifts: true, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: false, agencyMustAcceptTimesheet: true }, address: "Poznań", description: "Drugie produkcja Agencji A.", workCalendar: { workingWeekdays: [1, 2, 3, 4, 5, 6], exceptions: [] } },
  { id: "factory-partner", organizationId: partnerOrganizationId, worksiteId: "worksite-alfa", name: "Zakład Alfa", inputMode: "B", workerAccess: {}, requiredBreakMinutes: 15, requiredBreakTreatment: "unpaid", allowActualBreakReport: true, allowTimeDataSubmission: true, workflowSettings: { workerCanRecordHours: false, leaderCanRecordHours: true, leaderMustReviewShifts: false, agencyMustReviewShifts: false, workerMustConfirmShifts: true, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: false, agencyMustAcceptTimesheet: true }, address: "Warszawa", workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] } },
  { id: "factory-gamma", organizationId: independentFactoryOrganizationId, worksiteId: "worksite-alfa", name: "Zakład Alfa", inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0, requiredBreakTreatment: "unpaid", allowActualBreakReport: true, allowTimeDataSubmission: true, workflowSettings: { workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: false, agencyMustReviewShifts: true, workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: false, agencyCanSubmitTimesheet: true, agencyMustAcceptTimesheet: true }, address: "Warszawa", workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] } },
];

const folders = [
  { id: "folder-alpha", organizationId, name: "Zakład Alfa" },
  { id: "folder-beta", organizationId, name: "Zakład Beta" },
  { id: "folder-construction", organizationId, name: "Budowa" },
  { id: "folder-partner", organizationId: partnerOrganizationId, name: "Zakład Północ" },
];

const groups: DemoGroup[] = [
  { id: "group-alpha-day", organizationId, factoryId: "factory-alpha", leaderId: "leader-01", name: "Zmiana dzienna" },
  { id: "group-alpha-night", organizationId, factoryId: "factory-alpha", leaderId: "leader-01", name: "Zmiana nocna" },
  { id: "group-beta-pack", organizationId, factoryId: "factory-beta", leaderId: "leader-02", name: "Pakowanie" },
  { id: "group-beta-line", organizationId, factoryId: "factory-beta", leaderId: "leader-02", name: "Linia produkcyjna" },
  { id: "group-partner", organizationId: partnerOrganizationId, factoryId: "factory-partner", leaderId: "leader-piotr-b", name: "Zmiana produkcyjna" },
];

const members: DemoMember[] = [
  { id: "agency-demo", organizationId, role: "agency", name: "Marta Kowalska", status: "active" },
  { id: "leader-01", organizationId, role: "leader", name: "Piotr Nowak", accountUid: "account-leader-piotr", factoryId: "factory-alpha", canManageGroups: true, permissions: { canViewWorkers: true, canRecordHours: false, canReviewShifts: true, canConfirmShifts: false, canSubmitTimesheet: true, canManageGroups: true }, status: "active" },
  { id: "leader-02", organizationId, role: "leader", name: "Anna Zielińska", factoryId: "factory-beta", canManageGroups: true, canManageAllWorkers: true, status: "active" },
  { id: "worker-01", organizationId, role: "worker", name: "Iwan Petrenko", factoryId: "factory-alpha", groupId: "group-alpha-day", leaderId: "leader-01", folderId: "folder-alpha", status: "active" },
  { id: "worker-02", organizationId, role: "worker", name: "Piotr Malinowski", accountUid: "account-worker-02", factoryId: "factory-alpha", groupId: "group-alpha-day", leaderId: "leader-01", folderId: "folder-alpha", status: "active" },
  { id: "worker-03", organizationId, role: "worker", name: "Andrij Bondar", factoryId: "factory-alpha", groupId: "group-alpha-night", leaderId: "leader-01", folderId: "folder-alpha", status: "active" },
  { id: "worker-04", organizationId, role: "worker", name: "Mikołaj Dąbrowski", factoryId: "factory-alpha", groupId: "group-alpha-night", leaderId: "leader-01", folderId: "folder-alpha", status: "active" },
  { id: "worker-05", organizationId, role: "worker", name: "Serhij Kowal", factoryId: "factory-beta", groupId: "group-beta-pack", leaderId: "leader-02", folderId: "folder-beta", status: "active" },
  { id: "worker-06", organizationId, role: "worker", name: "Dmytro Lewandowski", factoryId: "factory-beta", groupId: "group-beta-pack", leaderId: "leader-02", folderId: "folder-beta", status: "active" },
  { id: "worker-07", organizationId, role: "worker", name: "Nazar Szymański", factoryId: "factory-beta", groupId: "group-beta-line", leaderId: "leader-02", folderId: "folder-beta", status: "active" },
  { id: "worker-08", organizationId, role: "worker", name: "Kacper Melnyk", factoryId: "factory-beta", groupId: "group-beta-line", leaderId: "leader-02", folderId: "folder-beta", status: "away" },
  { id: "worker-09", organizationId: independentFactoryOrganizationId, role: "worker", name: "Maksym Kamiński", factoryId: "factory-gamma", status: "active" },
  { id: "worker-10", organizationId: independentFactoryOrganizationId, role: "worker", name: "Oleh Wójcik", factoryId: "factory-gamma", status: "active" },
  { id: "worker-11", organizationId: independentFactoryOrganizationId, role: "worker", name: "Jan Hrytsenko", factoryId: "factory-gamma", status: "active" },
  { id: "worker-12", organizationId: independentFactoryOrganizationId, role: "worker", name: "Artem Kamińska", factoryId: "factory-gamma", status: "active" },
  { id: "worker-c-05", organizationId: independentFactoryOrganizationId, role: "worker", name: "Daria Melnyk", factoryId: "factory-gamma", status: "active" },
  { id: "worker-13", organizationId, role: "worker", name: "Natalia Danyliuk", factoryId: "factory-alpha", groupId: "group-alpha-day", leaderId: "leader-01", folderId: "folder-alpha", status: "active" },
  { id: "worker-15", organizationId, role: "worker", name: "Karolina Zielińska", accountUid: "account-worker-15", status: "away" },
  { id: "agency-partner", organizationId: partnerOrganizationId, role: "agency", name: "Katarzyna Lewandowska", status: "active" },
  { id: "leader-piotr-b", organizationId: partnerOrganizationId, role: "leader", name: "Piotr Nowak", accountUid: "account-leader-piotr", factoryId: "factory-partner", permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: true, canManageGroups: false }, status: "active" },
  { id: "worker-02-partner", organizationId: partnerOrganizationId, role: "worker", name: "Piotr Malinowski", accountUid: "account-worker-02", factoryId: "factory-partner", groupId: "group-partner", leaderId: "leader-piotr-b", folderId: "folder-partner", status: "active" },
  { id: "worker-partner-02", organizationId: partnerOrganizationId, role: "worker", name: "Olena Marchenko", factoryId: "factory-partner", groupId: "group-partner", leaderId: "leader-piotr-b", folderId: "folder-partner", status: "active" },
  { id: "worker-partner-03", organizationId: partnerOrganizationId, role: "worker", name: "Roman Shevchenko", factoryId: "factory-partner", groupId: "group-partner", leaderId: "leader-piotr-b", folderId: "folder-partner", status: "active" },
  { id: "worker-partner-04", organizationId: partnerOrganizationId, role: "worker", name: "Iryna Bilan", factoryId: "factory-partner", groupId: "group-partner", leaderId: "leader-piotr-b", folderId: "folder-partner", status: "active" },
  { id: "agency-c", organizationId: independentFactoryOrganizationId, role: "agency", name: "Agnieszka Pawlak", status: "active" },
];

function seededShift(index: number, worker: DemoMember, override?: { localDate?: string; startTime?: string; endTime?: string }): DemoShiftRecord {
  const localDate = override?.localDate ?? localDateOffset(-(index % 5) - 1);
  const overnight = !override && (index === 2 || index === 8);
  const startTime = override?.startTime ?? (overnight ? "22:00" : index % 2 === 0 ? "06:00" : "14:00");
  const endTime = override?.endTime ?? (overnight ? "06:00" : index % 2 === 0 ? "14:00" : "22:00");
  const endDate = overnight ? addOneDay(localDate) : localDate;
  const start = localDateTime(localDate, startTime);
  const end = localDateTime(endDate, endTime);
  const status = index === 0 || index === 6 ? "confirmed" : index === 1 || index === 4 ? "pending" : index === 3 || index === 8 ? "disputed" : "confirmed";
  const breakTaken = status === "confirmed" && index % 2 === 0;
  const breakStartTime = overnight ? "01:00" : "10:00";
  const breakEndTime = overnight ? "01:20" : "10:20";
  const breakDate = overnight ? endDate : localDate;
  const breakStart = localDateTime(breakDate, breakStartTime);
  const breakEnd = localDateTime(breakDate, breakEndTime);
  const grossDurationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const factory = factories.find((item) => item.id === worker.factoryId && item.organizationId === worker.organizationId);
  const breakTreatment = factory?.requiredBreakTreatment ?? "unpaid";
  const totalBreakDurationMinutes = breakTaken ? 20 : 0;
  const unpaidBreakDurationMinutes = breakTaken && breakTreatment === "unpaid" ? 20 : 0;
  const agencyActorId = members.find((member) => member.organizationId === worker.organizationId && member.role === "agency")?.id ?? "agency-demo";
  const createdByUid = factory?.inputMode === "B" ? worker.leaderId ?? agencyActorId : worker.id;
  const employmentId = worker.id === "worker-13" ? "employment-worker-13-current"
    : worker.id === "worker-15" ? "employment-worker-15-ended"
      : `employment-${worker.id}-current`;
  const createdAt = localDateTime(localDate, startTime).toISOString();
  const shift: Shift = {
    id: `shift-seed-${worker.id}`,
    workerUid: worker.id,
    agencyId: worker.organizationId,
    factoryId: worker.factoryId,
    employmentId,
    folderId: worker.folderId,
    localStartDate: localDate,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timeZone: "Europe/Warsaw",
    grossDurationMinutes,
    totalBreakDurationMinutes,
    unpaidBreakDurationMinutes,
    paidDurationMinutes: grossDurationMinutes - unpaidBreakDurationMinutes,
    actualBreak: {
      status: breakTaken ? "taken" : "not-reported",
      segments: breakTaken ? [{ startAt: breakStart.toISOString(), endAt: breakEnd.toISOString(), treatment: breakTreatment, durationMinutes: 20 }] : [],
      reportedByUid: breakTaken ? worker.id : undefined,
      reportedAt: breakTaken ? end.toISOString() : undefined,
      reviewState: "not-required",
    },
    breakPolicySnapshot: {
      appliedRuleIds: factory?.requiredBreakMinutes ? [`policy-${worker.factoryId}`] : [],
      required: Boolean(factory?.requiredBreakMinutes),
      allowedTreatments: factory?.requiredBreakMinutes ? [breakTreatment] : ["paid", "unpaid"],
      workerMayEditActualTimes: true,
      workerMayChooseTreatment: true,
      noBreakRequiresReview: Boolean(factory?.requiredBreakMinutes),
      capturedAt: createdAt,
      version: 1,
    },
    source: createdByUid === worker.id ? "worker" : worker.leaderId && createdByUid === worker.leaderId ? "leader" : "agency-admin",
    createdByUid,
    createdAt,
    updatedByUid: createdByUid,
    updatedAt: createdAt,
    revision: 1,
    workerConfirmation: status === "confirmed" ? "confirmed" : status === "pending" ? "pending" : "disputed",
    reviewState: factory?.workflowSettings?.leaderMustReviewShifts || factory?.workflowSettings?.agencyMustReviewShifts
      ? breakTaken ? "approved" : "pending"
      : breakTaken ? "approved" : createdByUid === worker.id ? "not-submitted" : "pending",
  };
  const dispute = status === "disputed" ? { reason: "seed-time-question", submittedAt: createdAt, state: "open" as const } : undefined;
  return {
    organizationId: worker.organizationId,
    shift,
    plannedBreak: { startTime: breakStartTime, endTime: breakEndTime },
    dispute,
    previousVersions: [],
    history: [{ id: `history-seed-${worker.id}`, action: "created", actorId: createdByUid, actorName: members.find((member) => member.id === createdByUid)?.name ?? "Timeax", occurredAt: createdAt, revision: 1 }],
  };
}

function seededTemplates(): DemoTemplate[] {
  const bases: Array<Omit<DemoTemplate, "id" | "organizationId" | "workerId" | "order">> = [
    { name: "Zmiana poranna", icon: "sun", startTime: "06:00", endTime: "14:00", breakType: "unpaid", breakStart: "10:00", breakEnd: "10:20", breakDurationMinutes: 20, enabled: true },
    { name: "Zmiana popołudniowa", icon: "coffee", startTime: "14:00", endTime: "22:00", breakType: "paid", breakStart: "18:00", breakEnd: "18:20", breakDurationMinutes: 20, enabled: true },
    { name: "Zmiana nocna", icon: "moon", startTime: "22:00", endTime: "06:00", breakType: "none", breakStart: "", breakEnd: "", breakDurationMinutes: 0, enabled: true },
  ];
  return bases.map((template, order) => ({ ...template, id: `template-worker-01-${order + 1}`, organizationId, workerId: "worker-01", order }));
}

function seededAbsences(): DemoAbsence[] {
  const reportedAt = new Date().toISOString();
  const reported: DemoAbsence = {
    id: "absence-reported-01", organizationId, workerId: "worker-02", employmentId: "employment-worker-02-current", factoryId: "factory-alpha", groupId: "group-alpha-day", localDate: localDateOffset(0),
    reason: "illness", message: "", reportedAt, state: "reported", createdById: "worker-02",
    history: [{ id: "absence-history-01", actorId: "worker-02", actorName: members.find((member) => member.id === "worker-02")!.name, action: "reported", occurredAt: reportedAt }],
  };
  const unreported: DemoAbsence = {
    id: "absence-unreported-01", organizationId, workerId: "worker-04", employmentId: "employment-worker-04-current", factoryId: "factory-alpha", groupId: "group-alpha-night", localDate: localDateOffset(-1),
    state: "unreported", leaderNote: "", createdById: "leader-01",
    history: [{ id: "absence-history-02", actorId: "leader-01", actorName: members.find((member) => member.id === "leader-01")!.name, action: "marked-unreported", occurredAt: reportedAt }],
  };
  return [reported, unreported];
}

function seededEmploymentPeriods(): DemoEmploymentPeriod[] {
  const now = new Date().toISOString();
  const workers = members.filter((member) => member.role === "worker");
  const periods: DemoEmploymentPeriod[] = workers.filter((worker) => worker.id !== "worker-13" && worker.id !== "worker-15").map((worker) => ({
    id: `employment-${worker.id}-current`, organizationId: worker.organizationId, workerId: worker.id, accountUid: worker.accountUid ?? worker.id,
    state: "active" as const, startDate: localDateOffset(-180), createdAt: now,
    createdById: worker.organizationId === organizationId ? "agency-demo" : worker.organizationId === partnerOrganizationId ? "agency-partner" : "agency-c",
    placements: worker.factoryId ? [{ id: `placement-${worker.id}-${worker.factoryId}`, factoryId: worker.factoryId, groupId: worker.groupId, leaderId: worker.leaderId, startDate: localDateOffset(-180), createdAt: now, createdById: worker.organizationId === organizationId ? "agency-demo" : worker.organizationId === partnerOrganizationId ? "agency-partner" : "agency-c" }] : [],
    history: [{ id: `employment-event-${worker.id}-started`, actorId: worker.organizationId === organizationId ? "agency-demo" : worker.organizationId === partnerOrganizationId ? "agency-partner" : "agency-c", action: "hired" as const, occurredAt: now }],
  }));
  const rehire = workers.find((worker) => worker.id === "worker-13")!;
  periods.push(
    { id: "employment-worker-13-previous", organizationId, workerId: rehire.id, accountUid: rehire.accountUid ?? rehire.id, state: "ended", startDate: localDateOffset(-400), endDate: localDateOffset(-220), createdAt: now, createdById: "agency-demo", endedAt: now, endedById: "agency-demo", placements: [{ id: "placement-worker-13-alpha-old", factoryId: "factory-alpha", groupId: "group-alpha-day", leaderId: "leader-01", startDate: localDateOffset(-400), endDate: localDateOffset(-220), createdAt: now, createdById: "agency-demo", endedAt: now, endedById: "agency-demo" }], history: [{ id: "employment-worker-13-prev-hired", actorId: "agency-demo", action: "hired", occurredAt: now }, { id: "employment-worker-13-prev-ended", actorId: "agency-demo", action: "ended", occurredAt: now }] },
    { id: "employment-worker-13-current", organizationId, workerId: rehire.id, accountUid: rehire.accountUid ?? rehire.id, state: "active", startDate: localDateOffset(-30), createdAt: now, createdById: "agency-demo", placements: [{ id: "placement-worker-13-alpha", factoryId: "factory-alpha", groupId: "group-alpha-day", leaderId: "leader-01", startDate: localDateOffset(-30), createdAt: now, createdById: "agency-demo" }], history: [{ id: "employment-worker-13-current-rehired", actorId: "agency-demo", action: "rehired", occurredAt: now }] },
    { id: "employment-worker-15-ended", organizationId, workerId: "worker-15", accountUid: "account-worker-15", state: "ended", startDate: localDateOffset(-220), endDate: localDateOffset(-45), createdAt: now, createdById: "agency-demo", endedAt: now, endedById: "agency-demo", placements: [{ id: "placement-worker-15-beta", factoryId: "factory-beta", groupId: "group-beta-pack", leaderId: "leader-02", startDate: localDateOffset(-220), endDate: localDateOffset(-45), createdAt: now, createdById: "agency-demo", endedAt: now, endedById: "agency-demo" }], history: [{ id: "employment-worker-15-hired", actorId: "agency-demo", action: "hired", occurredAt: now }, { id: "employment-worker-15-ended-event", actorId: "agency-demo", action: "ended", occurredAt: now }] },
  );
  return periods;
}

function seededSchedules() {
  const now = new Date().toISOString();
  return [{ id: "schedule-alpha-day", organizationId, factoryId: "factory-alpha", workerIds: ["worker-01", "worker-02"], startDate: localDateOffset(1), endDate: localDateOffset(14), weekdays: [1, 2, 3, 4, 5], startTime: "06:00", endTime: "14:00", plannedBreakStart: "10:00", plannedBreakEnd: "10:20", state: "active" as const, createdById: "leader-01", createdAt: now, updatedAt: now, history: [{ id: "schedule-alpha-created", actorId: "leader-01", action: "created" as const, occurredAt: now }] }];
}

function seededMessages() {
  const now = new Date().toISOString();
  return [{ id: "thread-worker-01-agency", organizationId, workerId: "worker-01", factoryId: "factory-alpha", recipientType: "agency" as const, recipientId: "agency-demo", participants: ["worker-01", "agency-demo"], subject: "Pytanie o rozliczenie zmiany", state: "open" as const, createdAt: now, updatedAt: now, messages: [{ id: "message-worker-01-seed", senderId: "worker-01", text: "Proszę o informację, kiedy pojawi się potwierdzenie ostatniej zmiany.", sentAt: now, readByIds: ["worker-01"] }] }];
}

export function createSeedWorkspace(options: { includeFeatureFixtures?: boolean } = {}): DemoWorkspace {
  if (!options.includeFeatureFixtures) {
    const organization = { ...organizations[0], name: "Agencja Demo A", contactEmail: "agency-demo@example.test" };
    const secondDemoOrganization = { id: "org-demo-02", name: "Agencja Demo B", timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: "agency-demo-b@example.test" };
    const thirdDemoOrganization = { id: "org-demo-03", name: "Agencja Demo C", timezone: "Europe/Warsaw", type: "agency" as const, contactEmail: "agency-demo-c@example.test" };
    const firstDemoAgency: DemoMember = { id: "agency-demo", organizationId: organization.id, role: "agency", name: "Agencja Demo A", accountUid: "account-agency-demo-a", status: "active" };
    const secondDemoAgency: DemoMember = { id: "agency-demo-b", organizationId: secondDemoOrganization.id, role: "agency", name: "Agencja Demo B", accountUid: "account-agency-demo-b", status: "active" };
    const thirdDemoAgency: DemoMember = { id: "agency-demo-c", organizationId: thirdDemoOrganization.id, role: "agency", name: "Agencja Demo C", accountUid: "account-agency-demo-c", status: "active" };
    return {
      schemaVersion: 8,
      organization,
      organizations: [organization, secondDemoOrganization, thirdDemoOrganization],
      worksites: [],
      businessEntities: [],
      agencyWorksites: [],
      worksiteConnectionRequests: [],
      factoryInvitations: [],
      departments: [],
      leaderWorksiteMemberships: [],
      leaderInvitations: [],
      workerInvitations: [],
      leaderConnectionRequests: [],
      subscriptions: [],
      subscriptionTiers,
      members: [firstDemoAgency, secondDemoAgency, thirdDemoAgency],
      factories: [],
      groups: [],
      folders: [],
      activeMemberId: "agency-demo",
      shifts: [],
      templates: [],
      absences: [],
      employmentPeriods: [],
      messageThreads: [],
      schedules: [],
      scheduleAttendanceReviews: [],
      monthlyTimesheets: [],
      changeRequests: [],
      notifications: [],
    };
  }

  const workers = members.filter((member) => member.role === "worker");
  const shifts = workers.filter((worker) => worker.id !== "worker-15").map((worker, index) => seededShift(index, worker, worker.id === "worker-partner-02" ? { localDate: localDateOffset(-1), startTime: "06:00", endTime: "14:00" } : undefined));
  const formerWorker = workers.find((worker) => worker.id === "worker-15");
  if (formerWorker) shifts.push(seededShift(14, { ...formerWorker, factoryId: "factory-beta", groupId: "group-beta-pack", leaderId: "leader-02" }));
  return {
    schemaVersion: 8,
    organization: organizations[0],
    organizations,
    worksites,
    businessEntities: [],
    agencyWorksites: [],
    worksiteConnectionRequests: [],
    factoryInvitations: [],
    departments: [],
    leaderWorksiteMemberships: [],
    leaderInvitations: [],
    workerInvitations: [],
    leaderConnectionRequests: [],
    subscriptions: [],
    subscriptionTiers,
    members: members.map((member) => member.role === "worker" && member.factoryId
      ? { ...member, accountUid: member.accountUid ?? member.id, productionAssignments: [{ factoryId: member.factoryId, groupId: member.groupId, leaderId: member.leaderId }] }
      : member),
    factories,
    groups,
    folders,
    activeMemberId: "worker-01",
    shifts,
    templates: seededTemplates(),
    absences: seededAbsences(),
    employmentPeriods: seededEmploymentPeriods(),
    messageThreads: seededMessages(),
    schedules: seededSchedules(),
    scheduleAttendanceReviews: [],
    changeRequests: [],
    notifications: [
      { id: "notice-worker-01", organizationId, recipientId: "worker-01", kind: "shift-confirmed", subjectId: "shift-seed-worker-01", createdAt: new Date().toISOString() },
      { id: "notice-worker-05", organizationId, recipientId: "worker-05", kind: "shift-pending", subjectId: "shift-seed-worker-05", createdAt: new Date().toISOString() },
      { id: "notice-leader-01-absence", organizationId, recipientId: "leader-01", kind: "absence-reported", subjectId: "absence-reported-01", createdAt: new Date().toISOString() },
      { id: "notice-agency-c-shift", organizationId: independentFactoryOrganizationId, recipientId: "agency-c", kind: "shift-disputed", subjectId: `shift-seed-worker-09`, createdAt: new Date().toISOString() },
      { id: "notice-agency-01", organizationId, recipientId: "agency-demo", kind: "absence-reported", subjectId: "absence-reported-01", createdAt: new Date().toISOString(), readAt: new Date().toISOString() },
      { id: "notice-agency-message-01", organizationId, recipientId: "agency-demo", kind: "message-received", subjectId: "thread-worker-01-agency", createdAt: new Date().toISOString() },
      { id: "notice-worker-schedule-01", organizationId, recipientId: "worker-01", kind: "schedule-updated", subjectId: "schedule-alpha-day", createdAt: new Date().toISOString() },
    ],
  };
}
