import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { createExportWorkbook } from "../src/modules/exports/domain/workbook.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function installWorkspace(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = {
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    addEventListener() {}, removeEventListener() {},
  };
  return saved;
}

const exportColumns = ["worker", "factory", "shiftDate", "paidTime"].map((key, order) => ({ key, order, enabled: true }));
const columnHeaders = Object.fromEntries(["worker", "agency", "folder", "factory", "shiftDate", "weekday", "startTime", "endTime", "grossDuration", "breaks", "paidTime", "shiftNote", "comment", "confirmation", "absence"].map((key) => [key, key]));
const translate = (key) => key;

test("an agency can self-register locally while existing demo agencies and their records remain unchanged", async () => {
  const saved = installWorkspace(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?self-registered-agency-scenario");
    const before = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const demoAgencyIds = before.organizations.filter((organization) => organization.type === "agency").map((organization) => organization.id).sort();
    const created = store.registerDemoAgency({ organizationName: "Independent Agency", adminName: "Agency Admin", email: "admin@independent-agency.example.test" });
    assert.ok(created);
    assert.equal(created.role, "agency");
    assert.equal(store.getActiveMember().id, created.id);
    const after = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.deepEqual(after.organizations.filter((organization) => demoAgencyIds.includes(organization.id)).map((organization) => organization.id).sort(), demoAgencyIds);
    assert.equal(after.organizations.find((organization) => organization.id === created.organizationId).type, "agency");
    assert.deepEqual(after.members.filter((member) => member.organizationId === created.organizationId).map((member) => member.id), [created.id]);
    assert.equal(after.factories.length, before.factories.length);
    assert.equal(after.employmentPeriods.length, before.employmentPeriods.length);
    assert.equal(store.registerDemoAgency({ organizationName: "Independent Agency", adminName: "Duplicate Admin", email: "admin@independent-agency.example.test" }), undefined);
  } finally {
    delete globalThis.window;
  }
});

test("a factory can self-register once, manage its staff independently, and later connect all demo agencies", async () => {
  const saved = installWorkspace(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?self-registered-factory-scenario");
    store.setActiveMember("agency-demo");
    const invitationCreatedBeforeRegistration = store.startAgencyWorksiteAccess({ companyName: "Factory Self Demo", nip: "1234567890", email: "representative@factory-self.example.test", city: "Warszawa", worksiteName: "Main Site", address: "Warszawa, Fabryczna 10", productionName: "Line org-demo-01" });
    assert.equal(invitationCreatedBeforeRegistration.kind, "invitation");
    const registration = store.registerFactoryWorkspace({
      companyName: "Factory Self Demo", nip: "123-456-78-90", adminName: "Factory Admin", email: "admin@factory-self.example.test",
      worksiteName: "Main Site", address: "Warszawa, Fabryczna 10",
    });
    assert.equal(registration.kind, "created");
    const { admin, businessEntity, worksite } = registration;
    assert.equal(store.getActiveMember().id, admin.id);
    assert.equal(store.getFactorySubscriptionSummary().status, "free");
    assert.deepEqual(JSON.parse(saved.get("timeax-demo-workspace-v1")).agencyWorksites, []);
    store.setActiveMember(admin.id);
    const existingFactoryAdmin = store.registerFactoryFromInvitation(invitationCreatedBeforeRegistration.invitation.token, { name: "Second factory admin", email: "second-admin@factory-self.example.test" });
    assert.equal(existingFactoryAdmin.id, admin.id, "accepting an old agency invite reuses the self-registered factory account");
    let afterInviteAcceptance = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(afterInviteAcceptance.businessEntities.length, 1);
    assert.equal(afterInviteAcceptance.worksites.filter((site) => site.businessEntityId === businessEntity.id).length, 1);
    const invitationRequest = afterInviteAcceptance.worksiteConnectionRequests.find((request) => request.invitationId === invitationCreatedBeforeRegistration.invitation.id);
    assert.equal(invitationRequest.state, "pending");
    assert.equal(store.resolveWorksiteConnectionRequest(invitationRequest.id, "approve"), true);
    assert.equal(store.createFactoryWorker({ name: "Blocked before plan", worksiteId: worksite.id }), undefined);
    assert.equal(store.registerFactoryWorkspace({ companyName: "Duplicate", nip: "1234567890", adminName: "Second Admin", email: "second@factory-self.example.test", worksiteName: "Main Site", address: "Warszawa, Fabryczna 10" }).kind, "existing");

    const duplicateAddress = store.createBusinessWorksite({ name: "Duplicate site name", address: " warszawa, FABRYCZNA 10 " });
    assert.equal(duplicateAddress.id, worksite.id);
    const secondSite = store.createBusinessWorksite({ name: "Sorting", address: "Warszawa, Sortowa 5" });
    assert.ok(secondSite);
    assert.equal(store.activateFactoryDemoSubscription("workers-30"), true);
    const worker = store.createFactoryWorker({ name: "Own employee", email: "own@factory-self.example.test", worksiteId: worksite.id });
    assert.ok(worker);
    assert.equal(worker.workerCategory, "factory");
    assert.equal(store.getFactorySubscriptionSummary().usedWorkers, 1);
    const department = store.createBusinessDepartment(worksite.id, "Assembly");
    assert.ok(department);
    const invitation = store.createBusinessLeaderInvitation(worksite.id, {
      name: "Own workforce manager", email: "manager@factory-self.example.test", organizationIds: [businessEntity.organizationId], departmentIds: [department.id],
      permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: true, canManageGroups: true },
    });
    assert.ok(invitation);
    const manager = store.registerLeaderFromInvitation(invitation.invitation.token, { name: invitation.invitation.name, email: invitation.invitation.email });
    assert.ok(manager);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId: worksite.id, workerId: worker.id, departmentId: department.id, leaderAccountUid: manager.accountUid }), true);
    const persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const ownProduction = persisted.factories.find((factory) => factory.ownerWorkforce && factory.worksiteId === worksite.id);
    assert.ok(ownProduction);
    assert.equal(store.createSchedule({ factoryId: ownProduction.id, workerIds: [worker.id], startDate: today(), endDate: today(), weekdays: [new Date().getDay()], startTime: "08:00", endTime: "16:00" }), true);

    store.setActiveMember(worker.id);
    assert.equal(store.createWorkerShift({ localDate: today(), startTime: "08:00", endTime: "16:00", comment: "factory-owned actual time", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    store.setActiveMember(admin.id);
    assert.equal(store.submitMonthlyTimesheet(ownProduction.id, today().slice(0, 7), true, businessEntity.organizationId), true);
    let workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(workspace.monthlyTimesheets[0].organizationId, businessEntity.organizationId);

    for (const agencyId of ["org-demo-01", "org-demo-02", "org-demo-03"]) {
      const agencyAccount = workspace.members.find((member) => member.organizationId === agencyId && member.role === "agency");
      store.setActiveMember(agencyAccount.id);
      const requestResult = store.requestAgencyWorksiteConnection({ businessEntityId: businessEntity.id, worksiteId: worksite.id, productionName: `Line ${agencyId}` });
      if (agencyId === "org-demo-01") {
        assert.equal(requestResult.kind, "connected", "the pending invitation was reused to connect the agency to the existing factory");
      } else {
        assert.equal(requestResult.kind, "request");
        store.setActiveMember(admin.id);
        assert.equal(store.resolveWorksiteConnectionRequest(requestResult.request.id, "approve"), true);
      }
      workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    }
    assert.equal(workspace.businessEntities.filter((entity) => entity.nip === "1234567890").length, 1);
    assert.equal(workspace.agencyWorksites.filter((connection) => connection.businessEntityId === businessEntity.id && connection.worksiteId === worksite.id && connection.state === "active").length, 3);
    assert.equal(workspace.monthlyTimesheets.length, 1, "connecting agencies does not create or merge official factory staff timesheets");
  } finally {
    delete globalThis.window;
  }
});

test("an agency can hire, schedule, record, submit and export its own workers before connecting to a factory", async () => {
  const saved = installWorkspace(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?independent-agency-scenario");
    store.setActiveMember("agency-demo");
    const workplace = store.createAgencyWorkplace({ worksiteName: "Agency Office", address: "Gdańsk, Portowa 4", productionName: "Independent Team" });
    assert.ok(workplace);
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).agencyWorksites.length, 0);
    const worker = store.createAgencyWorker("Independent employee", "independent@agency.example.test");
    assert.ok(worker);
    assert.equal(store.hireWorker(worker.id, workplace.factory.id, undefined, today()), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").usedWorkers, 1);
    const manager = store.createProductionLeader(workplace.factory.id, "Agency production manager", false, "manager@agency.example.test");
    assert.ok(manager);
    assert.equal(manager.role, "leader");
    assert.equal(manager.organizationId, "org-demo-01");
    const secondWorkplace = store.createAgencyWorkplace({ worksiteName: "Second agency office", address: "Gdynia, Portowa 9", productionName: "Second team" });
    assert.ok(secondWorkplace);
    const reusedManagerAccount = store.createProductionLeader(secondWorkplace.factory.id, "Agency production manager", false, "MANAGER@AGENCY.EXAMPLE.TEST");
    assert.ok(reusedManagerAccount);
    assert.notEqual(reusedManagerAccount.id, manager.id, "each production has its own scoped membership");
    assert.equal(reusedManagerAccount.accountUid, manager.accountUid, "the same email reuses one global manager identity");
    assert.equal(store.createProductionLeader(workplace.factory.id, "Agency production manager", false, "manager@agency.example.test").id, manager.id, "repeating manager creation for the same production is idempotent");
    store.setActiveMember(manager.id);
    assert.equal(store.createGroup(workplace.factory.id, "Independent team"), true);
    const managerGroup = JSON.parse(saved.get("timeax-demo-workspace-v1")).groups.find((group) => group.factoryId === workplace.factory.id && group.leaderId === manager.id);
    assert.ok(managerGroup);
    assert.equal(store.assignWorkerToGroup(worker.id, managerGroup.id), true);
    store.setActiveMember("agency-demo");
    assert.equal(store.createSchedule({ factoryId: workplace.factory.id, workerIds: [worker.id], startDate: today(), endDate: today(), weekdays: [new Date().getDay()], startTime: "07:00", endTime: "15:00" }), false, "agency admins cannot plan shifts");
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).schedules.length, 0, "agency-owned productions still leave planning to leaders");
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.length, 0, "planning stays separate from actual time");

    store.setActiveMember(worker.id);
    assert.equal(store.createWorkerShift({ localDate: today(), startTime: "07:00", endTime: "15:00", comment: "independent actual time", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    store.setActiveMember("agency-demo");
    assert.equal(store.submitMonthlyTimesheet(workplace.factory.id, today().slice(0, 7), true, "org-demo-01"), true);
    let workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(workspace.monthlyTimesheets[0].status, "accepted_by_agency");
    const buffer = await createExportWorkbook({
      organizationName: "Agency A", workers: workspace.members.filter((member) => member.organizationId === "org-demo-01" && member.role === "worker"),
      factories: [workplace.factory], folders: workspace.folders.filter((folder) => folder.organizationId === "org-demo-01"),
      employmentPeriods: workspace.employmentPeriods.filter((period) => period.organizationId === "org-demo-01"),
      shifts: workspace.shifts.filter((record) => record.organizationId === "org-demo-01"),
      absences: workspace.absences.filter((absence) => absence.organizationId === "org-demo-01"), factoryIds: [workplace.factory.id], dates: [today()],
      columns: exportColumns, dateFormat: "yyyy-MM-dd", timeFormat: "24-hour", language: "en", columnHeaders, translate,
    });
    assert.ok(buffer.byteLength > 0);

    const registration = store.registerFactoryWorkspace({ companyName: "Later Connected Factory", nip: "9876543210", adminName: "Factory Admin", email: "admin@later-factory.example.test", worksiteName: "Port Site", address: "Gdańsk, Portowa 4" });
    assert.equal(registration.kind, "created");
    store.setActiveMember("agency-demo");
    const request = store.requestAgencyWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, productionName: "Shared Line" });
    assert.equal(request.kind, "request");
    store.setActiveMember(registration.admin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(request.request.id, "approve"), true);
    workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const connectedProduction = workspace.factories.find((factory) => factory.organizationId === "org-demo-01" && factory.worksiteId === registration.worksite.id);
    assert.ok(connectedProduction);
    store.setActiveMember("agency-demo");
    assert.equal(store.assignWorkerToProduction(connectedProduction.id, worker.id, true), true);
    workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(workspace.employmentPeriods.filter((period) => period.organizationId === "org-demo-01" && period.workerId === worker.id).length, 1);
    assert.equal(workspace.shifts.filter((record) => record.organizationId === "org-demo-01" && record.shift.workerUid === worker.id).length, 1);
    assert.equal(workspace.monthlyTimesheets.filter((timesheet) => timesheet.organizationId === "org-demo-01").length, 1);
    assert.equal(workspace.monthlyTimesheets[0].factoryId, workplace.factory.id);
  } finally {
    delete globalThis.window;
  }
});

test("three agencies connected to one factory keep worker records and official timesheets separate", async () => {
  const saved = installWorkspace(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?three-agencies-one-factory");
    const registration = store.registerFactoryWorkspace({ companyName: "Three Agency Factory", nip: "5555555555", adminName: "Factory Admin", email: "admin@three-agency.example.test", worksiteName: "Shared Site", address: "Poznań, Wspólna 1" });
    assert.equal(registration.kind, "created");
    const { admin, businessEntity, worksite } = registration;
    const agencyIds = ["org-demo-01", "org-demo-02", "org-demo-03"];
    const workers = [];
    const productionByAgency = new Map();
    for (const [index, agencyId] of agencyIds.entries()) {
      let workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
      const agencyAccount = workspace.members.find((member) => member.organizationId === agencyId && member.role === "agency");
      store.setActiveMember(agencyAccount.id);
      const request = store.requestAgencyWorksiteConnection({ businessEntityId: businessEntity.id, worksiteId: worksite.id, productionName: `Agency ${index + 1} line` });
      assert.equal(request.kind, "request");
      store.setActiveMember(admin.id);
      assert.equal(store.resolveWorksiteConnectionRequest(request.request.id, "approve"), true);
      workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
      const production = workspace.factories.find((factory) => factory.organizationId === agencyId && factory.worksiteId === worksite.id);
      assert.ok(production);
      productionByAgency.set(agencyId, production);

      store.setActiveMember(agencyAccount.id);
      const worker = store.createAgencyWorker(`Agency ${index + 1} worker`, `worker${index + 1}@three-agency.example.test`);
      assert.ok(worker);
      assert.equal(store.hireWorker(worker.id, production.id, undefined, today()), true);
      assert.equal(store.updateProductionWorkflowSettings(production.id, {
        workerCanRecordHours: true, leaderCanRecordHours: false, leaderMustReviewShifts: false, agencyMustReviewShifts: false,
        workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: true, agencyMustAcceptTimesheet: false,
      }), true);
      store.setActiveMember(worker.id);
      assert.equal(store.createWorkerShift({ localDate: today(), startTime: "08:00", endTime: `${16 + index}:00`, comment: "actual time", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
      store.setActiveMember(agencyAccount.id);
      assert.equal(store.submitMonthlyTimesheet(production.id, today().slice(0, 7), false, agencyId), true);
      workers.push(worker);
    }

    let workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(workspace.businessEntities.filter((entity) => entity.id === businessEntity.id).length, 1);
    assert.equal(workspace.worksites.filter((site) => site.businessEntityId === businessEntity.id).length, 1);
    assert.equal(workspace.agencyWorksites.filter((connection) => connection.businessEntityId === businessEntity.id && connection.state === "active").length, 3);
    const officialTabs = workspace.monthlyTimesheets.filter((timesheet) => agencyIds.includes(timesheet.organizationId));
    assert.equal(officialTabs.length, 3);
    for (const [index, agencyId] of agencyIds.entries()) {
      const tab = officialTabs.find((timesheet) => timesheet.organizationId === agencyId);
      assert.ok(tab);
      assert.equal(tab.factoryId, productionByAgency.get(agencyId).id);
      assert.deepEqual(new Set(tab.versions[0].rows.map((row) => row.workerId)), new Set([workers[index].id]));
      store.setActiveMember(workspace.members.find((member) => member.organizationId === agencyId && member.role === "agency").id);
      assert.deepEqual(store.getBusinessWorksiteRoster(worksite.id), [], "an agency cannot read the factory-wide roster");
    }
    store.setActiveMember(admin.id);
    const factorySummary = store.getBusinessWorksiteActualSummary(worksite.id, today().slice(0, 7));
    assert.equal(factorySummary.length, 3);
    assert.deepEqual(new Set(factorySummary.map((row) => row.organizationId)), new Set(agencyIds));
    assert.ok(factorySummary.every((row) => row.shiftCount === 1));
  } finally {
    delete globalThis.window;
  }
});

test("subscriptions count active employments once per payer, including separate agency employments for one global account", async () => {
  const saved = installWorkspace(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?active-employment-billing");
    store.setActiveMember("agency-demo");
    const workplaceA = store.createAgencyWorkplace({ worksiteName: "A Site", address: "Warszawa, A 1", productionName: "A Team" });
    const workerA = store.createAgencyWorker("Shared person", "shared@person.example.test");
    assert.ok(workerA);
    assert.equal(store.hireWorker(workerA.id, workplaceA.factory.id, undefined, today()), true);

    store.setActiveMember("agency-demo-b");
    const workplaceB = store.createAgencyWorkplace({ worksiteName: "B Site", address: "Łódź, B 2", productionName: "B Team" });
    const workerB = store.createAgencyWorker("Shared person", "shared@person.example.test", "", workerA.accountUid);
    assert.ok(workerB);
    assert.equal(workerB.accountUid, workerA.accountUid);
    assert.equal(store.hireWorker(workerB.id, workplaceB.factory.id, undefined, today()), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").usedWorkers, 1);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-02").usedWorkers, 1);

    const beforeDuplicate = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const periodA = beforeDuplicate.employmentPeriods.find((period) => period.organizationId === "org-demo-01" && period.workerId === workerA.id);
    beforeDuplicate.employmentPeriods.push({ ...periodA, id: "duplicate-period-record", placements: periodA.placements.map((placement) => ({ ...placement, id: "duplicate-placement-record" })) });
    saved.set("timeax-demo-workspace-v1", JSON.stringify(beforeDuplicate));
    const refreshed = store.getPayerSubscriptionSummary("agency", "org-demo-01");
    assert.equal(refreshed.usedWorkers, 1, "duplicate employment rows for one person at one payer do not use duplicate seats");

    assert.equal(store.setDemoSubscription("agency", "workers-30", true), true);
    store.setActiveMember("agency-demo");
    assert.equal(store.setDemoSubscription("agency", "workers-30", true), true);
    assert.equal(store.setDemoSubscription("agency", "workers-30", false), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-01").status, "inactive");
    store.setActiveMember("agency-demo-b");
    assert.equal(store.getPayerSubscriptionSummary("agency", "org-demo-02").status, "test-active");
    assert.equal(store.getPayerSubscriptionSummary("factory", "missing-company").usedWorkers, 0);
  } finally {
    delete globalThis.window;
  }
});
