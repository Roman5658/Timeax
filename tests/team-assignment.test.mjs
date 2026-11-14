import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function installWorkspace(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

test("group changes persist on the active placement without ending employment or deleting shift history", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  const saved = installWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?team-group-history");
    const before = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const shiftsBefore = before.shifts.filter((record) => record.shift.workerUid === "worker-01").length;

    assert.equal(store.assignWorkerToGroup("worker-01", "group-alpha-night", "factory-alpha"), true);
    let updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    let placement = updated.employmentPeriods.find((period) => period.id === "employment-worker-01-current").placements.find((item) => item.factoryId === "factory-alpha" && !item.endDate);
    assert.equal(placement.groupId, "group-alpha-night");

    assert.equal(store.assignWorkerToGroup("worker-01", undefined, "factory-alpha"), true);
    updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const period = updated.employmentPeriods.find((item) => item.id === "employment-worker-01-current");
    placement = period.placements.find((item) => item.factoryId === "factory-alpha" && !item.endDate);
    assert.equal(placement.groupId, undefined);
    assert.equal(placement.leaderId, "leader-01");
    assert.equal(period.state, "active");
    assert.equal(updated.shifts.filter((record) => record.shift.workerUid === "worker-01").length, shiftsBefore);
    assert.equal(period.history.filter((event) => event.action === "group-changed").length, 2);
  } finally {
    delete globalThis.window;
  }
});

test("required team assignment sends one leader notice and lets the agency mark an independent participant", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "agency-demo";
  const saved = installWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?new-worker-assignment");
    assert.equal(store.setFactoryTeamAssignmentRequirement("factory-alpha", true), true);
    const needsTeam = store.createAgencyWorker("New Team Member");
    assert.ok(needsTeam);
    assert.equal(store.hireWorker(needsTeam.id, "factory-alpha", undefined, today()), true);

    let updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const notice = updated.notifications.find((item) => item.kind === "team-assignment-needed" && item.recipientId === "leader-01");
    assert.ok(notice);
    assert.equal(updated.notifications.filter((item) => item.kind === "team-assignment-needed" && item.subjectId === notice.subjectId).length, 1);
    let period = updated.employmentPeriods.find((item) => item.workerId === needsTeam.id && item.state === "active");
    assert.equal(period.placements[0].requiresTeamAssignment, true);

    store.setActiveMember("leader-01");
    assert.equal(store.assignWorkerToGroup(needsTeam.id, undefined, "factory-alpha"), true);
    updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    period = updated.employmentPeriods.find((item) => item.id === period.id);
    assert.equal(period.placements[0].requiresTeamAssignment, undefined);
    assert.equal(updated.notifications.filter((item) => item.kind === "team-assignment-needed" && item.subjectId === notice.subjectId).length, 1);

    store.setActiveMember("agency-demo");
    const independent = store.createAgencyWorker("Independent Participant");
    assert.ok(independent);
    assert.equal(store.hireWorker(independent.id, "factory-alpha", undefined, today(), true), true);
    updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const independentPeriod = updated.employmentPeriods.find((item) => item.workerId === independent.id && item.state === "active");
    assert.equal(independentPeriod.placements[0].requiresTeamAssignment, undefined);
    assert.equal(updated.notifications.some((item) => item.kind === "team-assignment-needed" && item.subjectId === independentPeriod.placements[0].id), false);

    const pageRead = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    store.getLeaderProductionParticipants(pageRead, "leader-01", "factory-alpha");
    store.getLeaderProductionParticipants(pageRead, "leader-01", "factory-alpha");
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).notifications.filter((item) => item.kind === "team-assignment-needed" && item.subjectId === notice.subjectId).length, 1);
  } finally {
    delete globalThis.window;
  }
});

test("unified team actions stay scoped to the selected leader membership and store a worker-facing note", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  const partnerMembership = workspace.members.find((member) => member.id === "leader-piotr-b");
  partnerMembership.permissions.canManageGroups = true;
  partnerMembership.canManageGroups = true;
  const saved = installWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?unified-team-actions");
    const partnerPeriodBefore = workspace.employmentPeriods.find((period) => period.organizationId === partnerMembership.organizationId && period.workerId === "worker-02-partner" && period.state === "active");
    const partnerShiftCount = workspace.shifts.filter((record) => record.organizationId === partnerMembership.organizationId && record.shift.workerUid === "worker-02-partner").length;
    const primaryGroupBefore = workspace.members.find((member) => member.id === "worker-02").productionAssignments.find((item) => item.factoryId === "factory-alpha").groupId;

    assert.equal(store.assignWorkerToGroupForMembership(partnerMembership.id, "worker-02-partner", undefined), true);
    assert.equal(store.assignWorkerToGroupForMembership(partnerMembership.id, "worker-02-partner", "group-partner"), true);
    assert.equal(store.createLeaderWorkerMessage(partnerMembership.id, "worker-02-partner", "service-note", "Safety reminder", "Please keep the entry clear."), true);
    assert.equal(store.setLeaderWorkerAccessForMembership(partnerMembership.id, "worker-02-partner", "removed"), true);

    const updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const partnerPeriod = updated.employmentPeriods.find((period) => period.id === partnerPeriodBefore.id);
    const activePlacement = partnerPeriod.placements.find((placement) => placement.factoryId === "factory-partner" && !placement.endDate);
    assert.equal(activePlacement.groupId, "group-partner");
    assert.equal(partnerPeriod.state, "active");
    assert.equal(updated.shifts.filter((record) => record.organizationId === partnerMembership.organizationId && record.shift.workerUid === "worker-02-partner").length, partnerShiftCount);
    assert.equal(updated.members.find((member) => member.id === "worker-02").productionAssignments.find((item) => item.factoryId === "factory-alpha").groupId, primaryGroupBefore);
    assert.equal(updated.leaderWorkerAccess.find((entry) => entry.workerId === "worker-02-partner").organizationId, partnerMembership.organizationId);
    const thread = updated.messageThreads.find((item) => item.workerId === "worker-02-partner" && item.category === "service-note");
    assert.equal(thread.recipientType, "worker");
    assert.equal(thread.messages[0].senderId, partnerMembership.id);
    assert.ok(updated.notifications.some((item) => item.recipientId === "worker-02-partner" && item.subjectId === thread.id));
  } finally {
    delete globalThis.window;
  }
});
