import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function setupStorage(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

function readSaved(saved) {
  return JSON.parse(saved.get("timeax-demo-workspace-v1"));
}

test("one invited factory site connects agency B by approval and keeps workers, leaders, shifts, and official tabs scoped", async () => {
  const saved = setupStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?shared-factory-scenario");
    store.setActiveMember("agency-demo");
    const factoryInvite = store.startAgencyWorksiteAccess({ companyName: "Wspólny Zakład Sp. z o.o.", nip: "9876543210", email: "representative@shared-factory.test", city: "Łódź", worksiteName: "Hala Główna", address: "Łódź, Przemysłowa 4", productionName: "Pakowanie A" });
    assert.equal(factoryInvite.kind, "invitation");
    assert.equal(store.createProduction("Agency cannot create the factory", "Łódź"), undefined);
    assert.equal(readSaved(saved).businessEntities.length, 0, "the agency invitation does not create the factory account");
    assert.equal(readSaved(saved).factories.length, 0);

    const factoryAdmin = store.registerFactoryFromInvitation(factoryInvite.invitation.token, { name: "Factory Admin", email: "admin@shared-factory.test" });
    assert.equal(factoryAdmin.role, "factory-admin");
    const registered = readSaved(saved);
    const acceptedFactoryInvite = registered.factoryInvitations.find((item) => item.id === factoryInvite.invitation.id);
    const worksiteId = acceptedFactoryInvite.acceptedWorksiteId;
    const invitationRequest = registered.worksiteConnectionRequests.find((item) => item.invitationId === factoryInvite.invitation.id);
    assert.equal(invitationRequest.state, "pending", "registration alone does not activate the agency link");
    assert.equal(registered.agencyWorksites.some((item) => item.worksiteId === worksiteId && item.state === "active"), false);
    assert.equal(registered.factories.some((item) => item.organizationId === "org-demo-01" && item.worksiteId === worksiteId), false);
    assert.equal(registered.businessEntities.length, 1);
    assert.equal(registered.organizations.filter((item) => item.type === "factory").length, 1);

    store.setActiveMember(factoryAdmin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(invitationRequest.id, "approve"), true, "the factory administrator confirms the invitation request");
    let state = readSaved(saved);
    const factoryA = state.factories.find((item) => item.organizationId === "org-demo-01" && item.worksiteId === worksiteId);
    assert.ok(factoryA);

    store.setActiveMember("agency-demo-b");
    const businessEntityId = state.businessEntities[0].id;
    const accessB = store.requestAgencyWorksiteConnection({ businessEntityId, worksiteId, productionName: "Pakowanie B" });
    assert.equal(accessB.kind, "request");
    const duplicateAccessB = store.requestAgencyWorksiteConnection({ businessEntityId, worksiteId, productionName: "Pakowanie B" });
    assert.equal(duplicateAccessB.kind, "request");
    assert.equal(duplicateAccessB.request.id, accessB.request.id, "repeating the same request is idempotent");
    assert.equal(readSaved(saved).factories.filter((item) => item.organizationId === "org-demo-02").length, 0);

    store.setActiveMember(factoryAdmin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(accessB.request.id, "approve"), true);
    assert.equal(store.resolveWorksiteConnectionRequest(accessB.request.id, "approve"), false, "an approved request cannot create duplicate links");
    state = readSaved(saved);
    const factoryB = state.factories.find((item) => item.organizationId === "org-demo-02" && item.worksiteId === worksiteId);
    assert.ok(factoryB);
    assert.equal(state.businessEntities.length, 1);
    assert.equal(state.organizations.filter((item) => item.type === "factory").length, 1);
    assert.equal(state.agencyWorksites.filter((item) => item.worksiteId === worksiteId && item.state === "active").length, 2);
    assert.equal(state.factories.filter((item) => item.worksiteId === worksiteId).length, 2, "agency productions are separate rows that point at one site");

    store.setActiveMember("agency-demo");
    const workerA = store.createAgencyWorker("Worker A");
    assert.ok(workerA);
    assert.equal(store.hireWorker(workerA.id, factoryA.id, undefined, today()), true);
    store.setActiveMember("agency-demo-b");
    const workerB = store.createAgencyWorker("Worker B");
    assert.ok(workerB);
    assert.equal(store.hireWorker(workerB.id, factoryB.id, undefined, today()), true);

    store.setActiveMember(factoryAdmin.id);
    const leaderInvite = store.createBusinessLeaderInvitation(worksiteId, {
      name: "Shared Manager",
      email: "manager@shared-factory.test",
      organizationIds: ["org-demo-01", "org-demo-02"],
    });
    assert.ok(leaderInvite);
    const leaderA = store.registerLeaderFromInvitation(leaderInvite.invitation.token, { name: "Shared Manager", email: "manager@shared-factory.test" });
    assert.equal(leaderA.role, "leader");
    assert.equal(store.registerLeaderFromInvitation(leaderInvite.invitation.token, { name: "Shared Manager", email: "manager@shared-factory.test" }), undefined, "a manager invitation can only be accepted once");
    state = readSaved(saved);
    const globalLeader = state.leaderWorksiteMemberships.find((item) => item.worksiteId === worksiteId);
    assert.ok(globalLeader);
    const leaderMemberships = state.members.filter((item) => item.role === "leader" && item.accountUid === globalLeader.accountUid);
    assert.deepEqual(new Set(leaderMemberships.map((item) => item.organizationId)), new Set(["org-demo-01", "org-demo-02"]));
    assert.equal(state.leaderWorksiteMemberships.filter((item) => item.worksiteId === worksiteId && item.accountUid === globalLeader.accountUid).length, 1);

    store.setActiveMember(factoryAdmin.id);
    const revokedManagerInvite = store.createBusinessLeaderInvitation(worksiteId, { name: "Revoked Manager", email: "revoked@shared-factory.test", organizationIds: ["org-demo-01"] });
    assert.ok(revokedManagerInvite);
    assert.equal(store.revokeBusinessLeaderInvitation(revokedManagerInvite.invitation.id), true);
    assert.equal(store.registerLeaderFromInvitation(revokedManagerInvite.invitation.token, { name: "Revoked Manager", email: "revoked@shared-factory.test" }), undefined);

    store.setActiveMember(factoryAdmin.id);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId, workerId: workerA.id, leaderAccountUid: globalLeader.accountUid }), true);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId, workerId: workerB.id, leaderAccountUid: globalLeader.accountUid }), true);
    state = readSaved(saved);
    const roster = store.getBusinessWorksiteRoster(worksiteId);
    assert.equal(roster.length, 2);
    assert.deepEqual(new Set(roster.map((row) => row.organizationId)), new Set(["org-demo-01", "org-demo-02"]));
    assert.deepEqual(new Set(roster.map((row) => row.worker.id)), new Set([workerA.id, workerB.id]));
    store.setActiveMember("agency-demo");
    assert.deepEqual(store.getBusinessWorksiteRoster(worksiteId), [], "agency accounts cannot use the factory-wide roster");
    assert.deepEqual(new Set(store.getProductionWorkers({ ...state, organization: state.organizations.find((item) => item.id === "org-demo-01") }, factoryA.id).map((worker) => worker.id)), new Set([workerA.id]));
    assert.deepEqual(new Set(store.getProductionWorkers({ ...state, organization: state.organizations.find((item) => item.id === "org-demo-02") }, factoryB.id).map((worker) => worker.id)), new Set([workerB.id]));

    store.setActiveMember(factoryAdmin.id);
    const aOnlyInvite = store.createBusinessLeaderInvitation(worksiteId, {
      name: "A Only Manager",
      email: "a-only@shared-factory.test",
      organizationIds: ["org-demo-01"],
      permissions: { canViewWorkers: true, canRecordHours: false, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: false, canManageGroups: true },
    });
    assert.ok(aOnlyInvite);
    const aOnlyLeader = store.registerLeaderFromInvitation(aOnlyInvite.invitation.token, { name: "A Only Manager", email: "a-only@shared-factory.test" });
    assert.ok(aOnlyLeader);
    store.setActiveMember(aOnlyLeader.id);
    const aOnlyRoster = store.getBusinessWorksiteRoster(worksiteId);
    assert.deepEqual(new Set(aOnlyRoster.map((row) => row.organizationId)), new Set(["org-demo-01"]));
    assert.equal(aOnlyRoster.some((row) => row.worker.id === workerB.id), false);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId, workerId: workerB.id, leaderAccountUid: aOnlyLeader.accountUid }), false, "a manager cannot be assigned to an agency outside the invitation scope");

    store.setActiveMember("agency-demo");
    const workflow = {
      workerCanRecordHours: true,
      leaderCanRecordHours: false,
      leaderMustReviewShifts: false,
      agencyMustReviewShifts: true,
      workerMustConfirmShifts: false,
      workerCanDisputeShifts: true,
      leaderCanSubmitTimesheet: true,
      agencyCanSubmitTimesheet: true,
      agencyMustAcceptTimesheet: true,
    };
    assert.equal(store.updateProductionWorkflowSettings(factoryA.id, workflow), true);
    store.setActiveMember("agency-demo-b");
    assert.equal(store.updateProductionWorkflowSettings(factoryB.id, workflow), true);
    store.setActiveMember(workerA.id);
    assert.equal(store.createWorkerShift({ localDate: today(), startTime: "08:00", endTime: "16:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    store.setActiveMember(workerB.id);
    assert.equal(store.createWorkerShift({ localDate: today(), startTime: "09:00", endTime: "17:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    state = readSaved(saved);
    const shiftA = state.shifts.find((record) => record.organizationId === "org-demo-01" && record.shift.workerUid === workerA.id);
    const shiftB = state.shifts.find((record) => record.organizationId === "org-demo-02" && record.shift.workerUid === workerB.id);
    assert.ok(shiftA && shiftB);
    store.setActiveMember("agency-demo");
    assert.equal(store.reviewShiftRecord(shiftA.shift.id, "approve"), true);
    assert.equal(store.submitMonthlyTimesheet(factoryA.id, today().slice(0, 7), false, "org-demo-01"), true);
    store.setActiveMember("agency-demo-b");
    assert.equal(store.reviewShiftRecord(shiftB.shift.id, "approve"), true);
    assert.equal(store.submitMonthlyTimesheet(factoryB.id, today().slice(0, 7), false, "org-demo-02"), true);
    state = readSaved(saved);
    const timesheetA = state.monthlyTimesheets.find((item) => item.organizationId === "org-demo-01" && item.factoryId === factoryA.id);
    const timesheetB = state.monthlyTimesheets.find((item) => item.organizationId === "org-demo-02" && item.factoryId === factoryB.id);
    assert.ok(timesheetA && timesheetB);
    assert.ok(timesheetA.versions[0].rows.some((row) => row.workerId === workerA.id));
    assert.equal(timesheetA.versions[0].rows.some((row) => row.workerId === workerB.id), false);
    assert.ok(timesheetB.versions[0].rows.some((row) => row.workerId === workerB.id));
    assert.equal(timesheetB.versions[0].rows.some((row) => row.workerId === workerA.id), false);

    store.setActiveMember(factoryAdmin.id);
    const summary = store.getBusinessWorksiteActualSummary(worksiteId, today().slice(0, 7));
    assert.equal(summary.length, 2);
    assert.deepEqual(new Set(summary.map((row) => row.organizationId)), new Set(["org-demo-01", "org-demo-02"]));
    assert.ok(summary.every((row) => row.shiftCount === 1 && row.paidMinutes > 0));

    store.setActiveMember("agency-demo-c");
    const otherSiteRequest = store.requestAgencyWorksiteConnection({ businessEntityId, worksiteName: "Hala Druga", address: "Łódź, Inna 9", productionName: "Pakowanie C" });
    assert.equal(otherSiteRequest.kind, "request", "same NIP with another address requires a distinct connection request");
    assert.equal(otherSiteRequest.request.worksiteId, undefined);
    state = readSaved(saved);
    assert.equal(state.agencyWorksites.some((item) => item.organizationId === "org-demo-03"), false);
    assert.equal(state.factories.some((item) => item.organizationId === "org-demo-03"), false);

    const anotherCompanyInvite = store.startAgencyWorksiteAccess({ companyName: "C-only Company", nip: "1112223334", email: "representative@c-only.test", city: "Łódź", worksiteName: "C site", address: "Łódź, C 1", productionName: "C production" });
    assert.equal(anotherCompanyInvite.kind, "invitation");
    assert.equal(store.revokeFactoryInvitation(anotherCompanyInvite.invitation.id), true);
    assert.equal(store.registerFactoryFromInvitation(anotherCompanyInvite.invitation.token, { name: "Should not register" }), undefined);
    assert.equal(readSaved(saved).businessEntities.length, 1);
  } finally {
    delete globalThis.window;
  }
});
