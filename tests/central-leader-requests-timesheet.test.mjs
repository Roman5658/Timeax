import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { buildMonthlyTimesheetSnapshot } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function installStorage(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

function readSaved(saved) {
  return JSON.parse(saved.get("timeax-demo-workspace-v1"));
}

test("same-NIP central offices stay territorial and require the agency to select one", async () => {
  const saved = installStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?same-nip-territories");
    const torun = store.registerFactoryWorkspace({ companyName: "Nomet", nip: "1234567890", city: "Toruń", adminName: "Toruń Admin", email: "torun-admin@nomet.example.test", worksiteName: "Toruń plant", address: "Toruń, Fabryczna 1" });
    const warsaw = store.registerFactoryWorkspace({ companyName: "Nomet", nip: "1234567890", city: "Warszawa", adminName: "Warszawa Admin", email: "warsaw-admin@nomet.example.test", worksiteName: "Warszawa plant", address: "Warszawa, Fabryczna 1" });
    assert.equal(torun.kind, "created");
    assert.equal(warsaw.kind, "created");
    assert.notEqual(torun.businessEntity.id, warsaw.businessEntity.id);
    assert.notEqual(torun.businessEntity.identifier, warsaw.businessEntity.identifier);
    assert.notEqual(torun.worksite.identifier, warsaw.worksite.identifier);
    assert.equal(store.registerFactoryWorkspace({ companyName: "Duplicate name", nip: "1234567890", city: "Toruń", adminName: "Duplicate Admin", email: "duplicate@nomet.example.test", worksiteName: "Another site", address: "Toruń, Fabryczna 2" }).kind, "existing");

    const centrals = store.searchRegisteredCentralsByNip("1234567890");
    assert.equal(centrals.length, 2);
    assert.deepEqual(new Set(centrals.map((central) => central.city)), new Set(["Toruń", "Warszawa"]));
    assert.equal(store.searchRegisteredCentralsByIdentifier(torun.businessEntity.identifier)[0].businessEntityId, torun.businessEntity.id);

    store.setActiveMember("agency-demo-b");
    const ambiguous = store.startAgencyWorksiteAccess({ companyName: "Nomet", nip: "1234567890", worksiteName: "Toruń plant", address: torun.worksite.address, productionName: "Agency B line" });
    assert.equal(ambiguous.kind, "invalid", "a NIP match never selects a central office automatically");
    const request = store.requestAgencyWorksiteConnection({ businessEntityId: torun.businessEntity.id, worksiteId: torun.worksite.id, productionName: "Agency B line" });
    assert.equal(request.kind, "request");
    assert.equal(readSaved(saved).agencyWorksites.length, 0, "a request is not an active connection");

    store.setActiveMember(warsaw.admin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(request.request.id, "approve"), false, "the other territorial administrator cannot approve this request");
    store.setActiveMember(torun.admin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(request.request.id, "approve"), true);
    const connected = readSaved(saved);
    assert.deepEqual(connected.agencyWorksites.filter((item) => item.organizationId === "org-demo-02" && item.state === "active").map((item) => item.businessEntityId), [torun.businessEntity.id]);
    assert.equal(connected.factories.some((factory) => factory.organizationId === "org-demo-02" && factory.worksiteId === warsaw.worksite.id), false);
  } finally {
    delete globalThis.window;
  }
});

test("leaders request scoped access, duplicate submissions count once, and both leaders feed one agency timesheet", async () => {
  const saved = installStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?leader-shared-agency-timesheet");
    const registration = store.registerFactoryWorkspace({ companyName: "Shared Factory", nip: "9876543210", city: "Łódź", adminName: "Factory Admin", email: "admin@shared-factory.example.test", worksiteName: "Main site", address: "Łódź, Main 1" });
    assert.equal(registration.kind, "created");

    store.setActiveMember("agency-demo");
    const agencyARequest = store.requestAgencyWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, productionName: "Agency A line" });
    assert.equal(agencyARequest.kind, "request");
    store.setActiveMember(registration.admin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(agencyARequest.request.id, "approve"), true);
    const factoryA = readSaved(saved).factories.find((item) => item.organizationId === "org-demo-01" && item.worksiteId === registration.worksite.id);
    assert.ok(factoryA);

    store.setActiveMember("agency-demo-b");
    const agencyBRequest = store.requestAgencyWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, productionName: "Agency B line" });
    assert.equal(agencyBRequest.kind, "request");
    store.setActiveMember(registration.admin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(agencyBRequest.request.id, "approve"), true);
    const factoryB = readSaved(saved).factories.find((item) => item.organizationId === "org-demo-02" && item.worksiteId === registration.worksite.id);
    assert.ok(factoryB);

    store.setActiveMember("agency-demo");
    const workerA = store.createAgencyWorker("Agency A worker", "worker-a@shared.example.test");
    const workerB = store.createAgencyWorker("Agency A second worker", "worker-b@shared.example.test");
    assert.ok(workerA && workerB);
    assert.equal(store.hireWorker(workerA.id, factoryA.id, undefined, today()), true);
    assert.equal(store.hireWorker(workerB.id, factoryA.id, undefined, today()), true);
    assert.equal(store.updateProductionWorkflowSettings(factoryA.id, {
      workerCanRecordHours: true, leaderCanRecordHours: true, leaderMustReviewShifts: false, agencyMustReviewShifts: false,
      workerMustConfirmShifts: false, workerCanDisputeShifts: true, leaderCanSubmitTimesheet: true, agencyCanSubmitTimesheet: true, agencyMustAcceptTimesheet: true,
    }), true);

    const nipResults = store.searchRegisteredCentralsByNip("9876543210");
    assert.equal(nipResults.length, 1);
    assert.equal(nipResults[0].businessEntityId, registration.businessEntity.id);
    assert.equal(nipResults[0].worksites[0].address, registration.worksite.address);
    const firstRequest = store.requestLeaderWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, name: "Leader A", email: "leader-a@shared.example.test" });
    const secondRequest = store.requestLeaderWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, name: "Leader B", email: "leader-b@shared.example.test" });
    assert.equal(firstRequest.state, "pending");
    assert.equal(secondRequest.state, "pending");
    let state = readSaved(saved);
    assert.equal(state.members.some((member) => member.role === "leader" && member.email === firstRequest.email), false, "a pending request grants no membership");
    assert.ok(state.notifications.some((item) => item.kind === "leader-connection-requested" && item.subjectId === firstRequest.id));

    const scopedAccess = { organizationIds: ["org-demo-01"], departmentIds: [], permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: false, canManageGroups: false } };
    store.setActiveMember(registration.admin.id);
    assert.equal(store.resolveLeaderConnectionRequest(firstRequest.id, "approve", scopedAccess), true);
    assert.equal(store.resolveLeaderConnectionRequest(secondRequest.id, "approve", scopedAccess), true);
    state = readSaved(saved);
    const leaderA = state.members.find((member) => member.role === "leader" && member.email === firstRequest.email && member.factoryId === factoryA.id);
    const leaderB = state.members.find((member) => member.role === "leader" && member.email === secondRequest.email && member.factoryId === factoryA.id);
    assert.ok(leaderA && leaderB);
    assert.equal(state.members.some((member) => member.role === "leader" && member.email === firstRequest.email && member.organizationId === "org-demo-02"), false, "granted scopes do not include other connected agencies");
    assert.deepEqual(state.leaderWorksiteMemberships.find((item) => item.email === firstRequest.email).organizationIds, ["org-demo-01"]);

    const todayDate = today();
    const periodA = state.employmentPeriods.find((period) => period.workerId === workerA.id && period.state === "active");
    const periodB = state.employmentPeriods.find((period) => period.workerId === workerB.id && period.state === "active");
    const targetA = { organizationId: "org-demo-01", factoryId: factoryA.id, workerId: workerA.id, employmentId: periodA.id };
    const targetB = { organizationId: "org-demo-01", factoryId: factoryA.id, workerId: workerB.id, employmentId: periodB.id };
    const draft = { localDate: todayDate, startTime: "08:00", endTime: "16:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" };
    store.setActiveMember(leaderA.id);
    assert.equal(store.createLeaderShiftBatch([targetA], draft), 1);
    assert.equal(store.createLeaderShiftBatch([targetA], draft), 0, "repeat clicks without a submission id are idempotent");
    assert.equal(store.createLeaderShiftBatch([targetB], draft, "leader-b-submission"), 1);
    store.setActiveMember(leaderB.id);
    assert.equal(store.createLeaderShiftBatch([targetA], draft), 0, "another leader cannot submit the same factual shift");
    assert.equal(store.createLeaderShiftBatch([targetB], draft, "leader-b-submission"), 1, "a repeated client submission returns its existing result");
    assert.equal(store.createLeaderShiftBatch([{ organizationId: "org-demo-02", factoryId: factoryB.id, workerId: workerA.id, employmentId: periodA.id }], draft), 0, "a leader cannot work outside granted organization scopes");

    store.setActiveMember("agency-demo");
    assert.equal(store.submitMonthlyTimesheet(factoryA.id, todayDate.slice(0, 7), false, "org-demo-01"), false, "leader-entered shifts need worker confirmation");
    for (const worker of [workerA, workerB]) {
      store.setActiveMember(worker.id);
      const shift = readSaved(saved).shifts.find((record) => record.shift.workerUid === worker.id && record.shift.factoryId === factoryA.id);
      assert.equal(store.confirmShift(shift.shift.id), true);
    }
    store.setActiveMember(registration.admin.id);
    assert.equal(store.canFactorySubmitTimesheet(readSaved(saved), "org-demo-01", factoryA.id), true);
    assert.equal(store.canFactorySubmitTimesheet(readSaved(saved), "org-demo-02", factoryA.id), false, "mismatched organization is denied");
    assert.equal(store.submitMonthlyTimesheet(factoryA.id, todayDate.slice(0, 7), false, "org-demo-02"), false);
    assert.equal(store.submitMonthlyTimesheet(factoryA.id, todayDate.slice(0, 7), false, "org-demo-01"), true);
    state = readSaved(saved);
    const timesheet = state.monthlyTimesheets.find((item) => item.organizationId === "org-demo-01" && item.factoryId === factoryA.id);
    assert.ok(timesheet);
    assert.equal(timesheet.versions[0].signature.signerRole, "factory-admin");
    assert.equal(timesheet.organizationId, "org-demo-01");
    assert.equal(timesheet.versions[0].rows.filter((row) => row.kind === "shift").length, 2);
    assert.deepEqual(new Set(timesheet.versions[0].rows.map((row) => row.workerId)), new Set([workerA.id, workerB.id]));
    assert.equal(state.monthlyTimesheets.some((item) => item.organizationId === "org-demo-02" && item.factoryId === factoryB.id), false);

    const shiftA = state.shifts.find((record) => record.organizationId === "org-demo-01" && record.shift.workerUid === workerA.id);
    const duplicatedLegacyRecord = { ...shiftA, shift: { ...shiftA.shift, id: "legacy-duplicate-shift" }, clientSubmissionId: undefined };
    const snapshot = buildMonthlyTimesheetSnapshot({ ...state, organization: state.organizations.find((item) => item.id === "org-demo-01"), shifts: [...state.shifts, duplicatedLegacyRecord] }, factoryA.id, todayDate.slice(0, 7));
    assert.equal(snapshot.rows.filter((row) => row.kind === "shift").length, 2, "legacy duplicate records are collapsed in a snapshot without deleting history");
    assert.equal(snapshot.totals.shiftCount, 2);
  } finally {
    delete globalThis.window;
  }
});
