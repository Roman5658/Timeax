import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function dateToday() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function subscriptionFixture() {
  const workspace = createSeedWorkspace();
  workspace.subscriptionTiers.push({ id: "workers-2", minWorkers: 1, maxWorkers: 2, sortOrder: 0 });
  const companyOrganization = { id: "org-factory-sub-test", name: "Factory Demo", timezone: "Europe/Warsaw", type: "factory" };
  const businessEntity = { id: "business-factory-sub-test", organizationId: companyOrganization.id, name: "Factory Demo", nip: "1234567890", adminMemberId: "factory-admin-sub-test", createdAt: new Date().toISOString() };
  const admin = { id: businessEntity.adminMemberId, accountUid: "account-factory-admin-sub-test", organizationId: companyOrganization.id, businessEntityId: businessEntity.id, role: "factory-admin", name: "Factory Admin", status: "active" };
  workspace.organizations.push(companyOrganization);
  workspace.organization = companyOrganization;
  workspace.businessEntities.push(businessEntity);
  workspace.members.push(admin);
  workspace.activeMemberId = admin.id;
  const site = { id: "worksite-sub-test", businessEntityId: businessEntity.id, name: "Test site", address: "Warszawa" };
  workspace.worksites.push(site);

  for (const [index, agencyId] of ["org-demo-01", "org-demo-02"].entries()) {
    const productionId = `factory-agency-${index}`;
    const workerId = `worker-agency-${index}`;
    workspace.agencyWorksites.push({ id: `connection-${index}`, organizationId: agencyId, businessEntityId: businessEntity.id, worksiteId: site.id, state: "active", createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedByMemberId: admin.id, source: "request" });
    workspace.factories.push({ id: productionId, organizationId: agencyId, worksiteId: site.id, name: `Agency production ${index}`, inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0, requiredBreakTreatment: "unpaid", allowActualBreakReport: true, allowTimeDataSubmission: true, workflowSettings: { workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: false, agencyMustReviewShifts: false, workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: false, agencyMustAcceptTimesheet: true }, workCalendar: { workingWeekdays: [1, 2, 3, 4, 5], exceptions: [] } });
    const agencyAccount = workspace.members.find((member) => member.organizationId === agencyId && member.role === "agency");
    const worker = { id: workerId, accountUid: `account-${workerId}`, organizationId: agencyId, role: "worker", workerCategory: "agency", name: `Agency worker ${index}`, status: "active", factoryId: productionId, productionAssignments: [{ factoryId: productionId }] };
    workspace.members.push(worker);
    workspace.employmentPeriods.push({ id: `employment-${workerId}`, organizationId: agencyId, workerId, accountUid: worker.accountUid, workerCategory: "agency", state: "active", startDate: dateToday(), createdAt: new Date().toISOString(), createdById: agencyAccount.id, placements: [{ id: `placement-${workerId}`, factoryId: productionId, startDate: dateToday(), createdAt: new Date().toISOString(), createdById: agencyAccount.id }], history: [] });
  }
  return { workspace, companyOrganization, businessEntity, admin, site };
}

test("factory test subscription gates only owned workers and preserves owned-staff timesheets after deactivation", async () => {
  const { workspace, companyOrganization, businessEntity, admin, site } = subscriptionFixture();
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?factory-subscription-test");
    const today = dateToday();
    const weekday = new Date(`${today}T12:00:00`).getDay();

    assert.equal(store.createFactoryWorker({ name: "Blocked worker", worksiteId: site.id }), undefined);
    assert.deepEqual(store.getBusinessWorksiteRoster(site.id).map((row) => row.workerCategory).sort(), ["agency", "agency"]);
    assert.equal(store.getPayerSubscriptionSummary("factory", businessEntity.id).usedWorkers, 0);
    assert.equal(store.createSchedule({ factoryId: "factory-agency-0", workerIds: ["worker-agency-0"], startDate: today, endDate: today, weekdays: [weekday], startTime: "08:00", endTime: "16:00" }), false, "planning is reserved for leaders");
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).schedules.length, 0, "other roles cannot create planned shifts");
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.length, 0, "planning must not create actual hours");

    store.setActiveMember("agency-demo");
    const agencyOnlyWorker = store.createAgencyWorker("Agency-only worker", "agency-only@example.test");
    assert.ok(agencyOnlyWorker);
    assert.equal(store.hireWorker(agencyOnlyWorker.id, undefined, undefined, today), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").usedWorkers, 2);
    store.setActiveMember("agency-demo-b");
    const secondAgencyMembership = store.createAgencyWorker("Shared worker membership", "agency-only@example.test", "", agencyOnlyWorker.accountUid);
    assert.ok(secondAgencyMembership);
    assert.equal(secondAgencyMembership.accountUid, agencyOnlyWorker.accountUid);
    assert.equal(store.hireWorker(secondAgencyMembership.id, undefined, undefined, today), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").usedWorkers, 2);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-02").usedWorkers, 2, "a distinct active employment is billed to its own agency");
    assert.equal(store.getPayerSubscriptionSummary("factory", businessEntity.id).usedWorkers, 0);

    store.setActiveMember("agency-demo");
    assert.equal(store.setDemoSubscription("agency", "workers-2", true), true);
    store.setActiveMember("agency-demo-b");
    assert.equal(store.setDemoSubscription("agency", "workers-70", true), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").status, "test-active");
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-02").status, "test-active");
    store.setActiveMember("agency-demo");
    assert.equal(store.createAgencyWorker("Over capacity worker", "over-capacity@example.test"), undefined);
    assert.equal(store.setDemoSubscription("agency", "workers-30", false), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").status, "inactive");
    assert.equal(store.createAgencyWorker("Blocked while agency plan is inactive", "inactive-agency@example.test"), undefined);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-02").status, "test-active");
    assert.equal(store.setDemoSubscription("agency", "workers-30", true), true);

    store.setActiveMember("agency-demo");
    assert.equal(store.updateProductionWorkflowSettings("factory-agency-0", {
      workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: false, agencyMustReviewShifts: false,
      workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: true, agencyMustAcceptTimesheet: true,
    }), true);
    store.setActiveMember("worker-agency-0");
    assert.equal(store.createWorkerShift({ localDate: dateToday(), startTime: "08:00", endTime: "16:00", comment: "agency actual time", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    store.setActiveMember("agency-demo");
    const month = today.slice(0, 7);
    assert.equal(store.submitMonthlyTimesheet("factory-agency-0", month, false, "org-demo-01"), true);

    store.setActiveMember(admin.id);
    assert.equal(store.activateFactoryDemoSubscription("workers-30"), true);
    const ownedWorker = store.createFactoryWorker({ name: "Factory-owned worker", email: "owned@example.test", worksiteId: site.id });
    assert.ok(ownedWorker);
    assert.equal(ownedWorker.workerCategory, "factory");
    assert.equal(store.getPayerSubscriptionSummary("factory", businessEntity.id).usedWorkers, 1);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").usedWorkers, 2);
    assert.equal(store.createFactoryWorker({ name: "Duplicate email", email: "OWNED@example.test", worksiteId: site.id }), undefined);
    const department = store.createBusinessDepartment(site.id, "Assembly");
    assert.ok(department);
    const leaderInvitation = store.createBusinessLeaderInvitation(site.id, {
      name: "Factory manager",
      email: "factory-manager@example.test",
      organizationIds: [companyOrganization.id],
      departmentIds: [department.id],
      permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: true, canManageGroups: true },
    });
    assert.ok(leaderInvitation);
    const factoryLeader = store.registerLeaderFromInvitation(leaderInvitation.invitation.token, { name: "Factory manager", email: "factory-manager@example.test" });
    assert.ok(factoryLeader);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId: site.id, workerId: ownedWorker.id, departmentId: department.id, leaderAccountUid: factoryLeader.accountUid }), true);
    assert.deepEqual(store.getBusinessWorksiteRoster(site.id).map((row) => row.worker.id), [ownedWorker.id]);
    store.setActiveMember(admin.id);
    assert.equal(store.createFactoryWorkerMessage(ownedWorker.id, "Schedule note", "Please confirm the proposed hours."), true);
    const factoryThread = JSON.parse(saved.get("timeax-demo-workspace-v1")).messageThreads.find((thread) => thread.organizationId === companyOrganization.id);
    assert.ok(factoryThread);
    store.setActiveMember(ownedWorker.id);
    assert.equal(store.replyToMessage(factoryThread.id, "Received."), true);
    store.setActiveMember(admin.id);

    let persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const ownerFactory = persisted.factories.find((factory) => factory.ownerWorkforce && factory.worksiteId === site.id);
    assert.ok(ownerFactory);
    store.setActiveMember(factoryLeader.id);
    assert.equal(store.createSchedule({ factoryId: ownerFactory.id, workerIds: [ownedWorker.id], startDate: today, endDate: today, weekdays: [weekday], startTime: "08:00", endTime: "16:00" }), true);
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.some((record) => record.shift.workerUid === ownedWorker.id), false, "a planned schedule must not create factory-owned actual hours");

    store.setActiveMember(ownedWorker.id);
    assert.equal(store.createWorkerShift({ localDate: today, startTime: "08:00", endTime: "16:00", comment: "actual time", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    store.setActiveMember(admin.id);
    assert.equal(store.submitMonthlyTimesheet(ownerFactory.id, month, true, companyOrganization.id), true);
    persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(persisted.monthlyTimesheets.length, 2);
    const factoryTimesheet = persisted.monthlyTimesheets.find((timesheet) => timesheet.organizationId === companyOrganization.id);
    const agencyTimesheet = persisted.monthlyTimesheets.find((timesheet) => timesheet.organizationId === "org-demo-01");
    assert.equal(factoryTimesheet.status, "accepted_by_factory");
    assert.deepEqual(factoryTimesheet.versions[0].rows.map((row) => row.workerId), [ownedWorker.id]);
    assert.equal(factoryTimesheet.versions[0].rows.some((row) => row.workerId === "worker-agency-0"), false);
    assert.deepEqual(agencyTimesheet.versions[0].rows.map((row) => row.workerId), ["worker-agency-0"]);
    assert.equal(agencyTimesheet.versions[0].rows.some((row) => row.workerId === ownedWorker.id), false);

    assert.equal(store.deactivateFactoryDemoSubscription(), true);
    assert.equal(store.createFactoryWorker({ name: "Blocked after expiry", worksiteId: site.id }), undefined);
    persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.ok(persisted.members.some((member) => member.id === ownedWorker.id));
    assert.ok(persisted.shifts.some((record) => record.shift.workerUid === ownedWorker.id));
    assert.equal(persisted.monthlyTimesheets.find((timesheet) => timesheet.organizationId === companyOrganization.id).status, "accepted_by_factory");
    assert.equal(persisted.subscriptions.find((item) => item.payerType === "factory" && item.payerId === businessEntity.id).status, "inactive");
    assert.equal(store.activateFactoryDemoSubscription("workers-30"), true);
    const workerAfterReactivation = store.createFactoryWorker({ name: "Worker after reactivation", worksiteId: site.id });
    assert.ok(workerAfterReactivation);
    assert.equal(store.getPayerSubscriptionSummary("factory", businessEntity.id).usedWorkers, 2);
    persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(persisted.subscriptions.find((item) => item.payerType === "factory" && item.payerId === businessEntity.id).status, "test-active");
    assert.equal(persisted.subscriptions.find((item) => item.payerType === "agency" && item.payerId === "org-demo-01").status, "test-active");
    assert.equal(persisted.subscriptions.find((item) => item.payerType === "agency" && item.payerId === "org-demo-02").status, "test-active");
    assert.equal(persisted.members.filter((member) => member.workerCategory === "factory").length, 2);
  } finally {
    delete globalThis.window;
  }
});
