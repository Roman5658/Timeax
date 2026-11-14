import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function storageFor(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

test("an invited shared worksite can operate without leaders, accept a later leader membership, and retain its records after revocation", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "agency-c";
  const saved = storageFor(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    store.setActiveMember("agency-c");
    const invite = store.startAgencyWorksiteAccess({ companyName: "Factory C", nip: "2345678901", email: "representative@factory-c.example.test", city: "Test City", worksiteName: "Test site C", address: "Test address C", productionName: "Bez kierownika" });
    assert.equal(invite.kind, "invitation");
    const factoryAdmin = store.registerFactoryFromInvitation(invite.invitation.token, { name: "Factory Admin C", email: "admin-c@example.test" });
    assert.equal(factoryAdmin.role, "factory-admin");
    const onboarding = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const acceptedInvite = onboarding.factoryInvitations.find((item) => item.id === invite.invitation.id);
    const connectionRequest = onboarding.worksiteConnectionRequests.find((item) => item.invitationId === invite.invitation.id);
    assert.equal(connectionRequest.state, "pending");
    assert.equal(onboarding.agencyWorksites.some((item) => item.worksiteId === acceptedInvite.acceptedWorksiteId), false);
    assert.equal(onboarding.factories.some((item) => item.organizationId === "org-independent-factory-demo" && item.worksiteId === acceptedInvite.acceptedWorksiteId), false);
    assert.equal(store.resolveWorksiteConnectionRequest(connectionRequest.id, "approve"), true);
    const approvedOnboarding = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const factory = approvedOnboarding.factories.find((item) => item.organizationId === "org-independent-factory-demo" && item.worksiteId === acceptedInvite.acceptedWorksiteId);
    assert.ok(factory);
    assert.equal(onboarding.members.some((member) => member.role === "leader" && member.factoryId === factory.id), false);
    store.setActiveMember("agency-c");

    const settings = {
      workerCanRecordHours: true,
      leaderCanRecordHours: true,
      leaderMustReviewShifts: false,
      agencyMustReviewShifts: true,
      workerMustConfirmShifts: false,
      workerCanDisputeShifts: true,
      leaderCanSubmitTimesheet: true,
      agencyCanSubmitTimesheet: true,
      agencyMustAcceptTimesheet: true,
    };
    assert.equal(store.updateProductionWorkflowSettings(factory.id, settings), true);
    const worker = store.createAgencyWorker("New worker");
    assert.ok(worker);
    assert.equal(store.hireWorker(worker.id, factory.id, undefined, today()), true);

    store.setActiveMember(worker.id);
    assert.equal(store.createWorkerShift({ localDate: today(), startTime: "08:00", endTime: "16:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    let afterShift = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const shift = afterShift.shifts.find((record) => record.organizationId === "org-independent-factory-demo" && record.shift.workerUid === worker.id && record.shift.factoryId === factory.id);
    assert.ok(shift.shift.employmentId);
    assert.equal(shift.shift.reviewState, "pending");

    store.setActiveMember("agency-c");
    assert.equal(store.reviewShiftRecord(shift.shift.id, "approve"), true);
    assert.equal(store.submitMonthlyTimesheet(factory.id, today().slice(0, 7), false, "org-independent-factory-demo"), true);
    afterShift = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const timesheet = afterShift.monthlyTimesheets.find((record) => record.organizationId === "org-independent-factory-demo" && record.factoryId === factory.id);
    assert.equal(timesheet.status, "submitted_to_agency");
    assert.equal(store.acceptMonthlyTimesheet(timesheet.id), true);

    store.setActiveMember(factoryAdmin.id);
    const leaderInvite = store.createBusinessLeaderInvitation(acceptedInvite.acceptedWorksiteId, { name: "Piotr Nowak", email: "piotr@example.test", organizationIds: ["org-independent-factory-demo"], permissions: {
      canViewWorkers: true, canRecordHours: false, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: true, canManageGroups: false,
    } });
    assert.ok(leaderInvite);
    const globalLeader = store.registerLeaderFromInvitation(leaderInvite.invitation.token, { name: "Piotr Nowak", email: "piotr@example.test" });
    assert.ok(globalLeader);
    store.setActiveMember(factoryAdmin.id);
    const globalIdentity = JSON.parse(saved.get("timeax-demo-workspace-v1")).leaderWorksiteMemberships.find((item) => item.worksiteId === acceptedInvite.acceptedWorksiteId);
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId: acceptedInvite.acceptedWorksiteId, workerId: worker.id, leaderAccountUid: globalIdentity.accountUid }), true);
    store.setActiveMember("agency-c");
    const laterLeader = JSON.parse(saved.get("timeax-demo-workspace-v1")).members.find((member) => member.role === "leader" && member.organizationId === "org-independent-factory-demo" && member.factoryId === factory.id && member.accountUid === globalIdentity.accountUid);
    assert.ok(laterLeader);
    assert.equal(store.setLeaderMembershipAccess(factory.id, laterLeader.id, "revoked"), true);
    const finalState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.ok(finalState.members.some((member) => member.id === worker.id));
    assert.ok(finalState.employmentPeriods.some((period) => period.workerId === worker.id && period.id === shift.shift.employmentId));
    assert.ok(finalState.shifts.some((record) => record.shift.id === shift.shift.id));
    assert.equal(finalState.monthlyTimesheets.find((record) => record.id === timesheet.id).status, "accepted_by_agency");
    assert.ok(finalState.monthlyTimesheets.find((record) => record.id === timesheet.id).history.length >= 2);
  } finally {
    delete globalThis.window;
  }
});

test("leader permission and access changes only affect the selected production membership", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "agency-demo";
  workspace.members.push({ ...workspace.members.find((member) => member.id === "leader-01"), id: "leader-01-beta", factoryId: "factory-beta", accessState: "active" });
  const saved = storageFor(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?leader-membership-scope");
    store.setActiveMember("agency-demo");
    const permissions = { canViewWorkers: true, canRecordHours: true, canReviewShifts: false, canConfirmShifts: false, canSubmitTimesheet: false, canManageGroups: false };
    assert.equal(store.updateLeaderMembershipPermissions("factory-alpha", "leader-01", permissions), true);
    assert.equal(store.setLeaderMembershipAccess("factory-alpha", "leader-01", "suspended"), true);
    const state = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const alpha = state.members.find((member) => member.id === "leader-01");
    const beta = state.members.find((member) => member.id === "leader-01-beta");
    assert.deepEqual(alpha.permissions, permissions);
    assert.equal(alpha.canManageGroups, false);
    assert.equal(alpha.accessState, "suspended");
    assert.notDeepEqual(beta.permissions, permissions);
    assert.equal(beta.accessState, "active");
  } finally {
    delete globalThis.window;
  }
});

