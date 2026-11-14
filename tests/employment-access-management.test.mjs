import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { buildMonthlyTimesheetSnapshot } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function dayBefore(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function installWorkspace(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return { saved, read: () => JSON.parse(saved.get("timeax-demo-workspace-v1")) };
}

async function storeFor(name) {
  return import(`../src/modules/workflows/demo-store.ts?management-test=${name}`);
}

function draft(date = today()) {
  return { localDate: date, startTime: "08:00", endTime: "16:00", comment: "test shift", breakStatus: "not-reported", breakTreatment: "unpaid" };
}

test("archiving a production keeps its worksite, workforce history, and shift history", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-demo";
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("archive");
    const originalWorksites = runtime.read().worksites;
    const originalShifts = runtime.read().shifts.filter((record) => record.organizationId === "org-demo-01" && record.shift.factoryId === "factory-alpha");
    store.setActiveMember("agency-demo");
    assert.equal(store.archiveProduction("factory-alpha"), true);
    const archived = runtime.read();
    assert.ok(archived.factories.find((factory) => factory.id === "factory-alpha").archivedAt);
    assert.deepEqual(archived.worksites.map(({ id, name, address }) => ({ id, name, address })), originalWorksites.map(({ id, name, address }) => ({ id, name, address })));
    assert.ok(archived.worksites.every((site) => site.identifier), "migrated worksites keep their unique display identifiers when a production is archived");
    assert.equal(archived.factories.find((factory) => factory.id === "factory-partner").worksiteId, "worksite-alfa");
    assert.deepEqual(archived.shifts.filter((record) => record.organizationId === "org-demo-01" && record.shift.factoryId === "factory-alpha"), originalShifts);
    assert.equal(store.archiveProduction("factory-alpha"), false);
    const archivedHire = store.createAgencyWorker("Archived hire");
    assert.ok(archivedHire);
    assert.equal(store.hireWorker(archivedHire.id, "factory-alpha", undefined, today()), false);
    assert.equal(store.restoreProduction("factory-alpha"), true);
    assert.equal(runtime.read().factories.find((factory) => factory.id === "factory-alpha").archivedAt, undefined);
  } finally {
    delete globalThis.window;
  }
});

test("ending employment closes assignments without deleting the worker or past shifts", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-demo";
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("end-employment");
    const shiftsBefore = runtime.read().shifts;
    store.setActiveMember("agency-demo");
    assert.equal(store.endWorkerEmployment("worker-01", today(), "Employment ended"), true);
    const after = runtime.read();
    const worker = after.members.find((member) => member.id === "worker-01");
    const period = after.employmentPeriods.find((item) => item.id === "employment-worker-01-current");
    assert.equal(worker.status, "away");
    assert.deepEqual(worker.productionAssignments, []);
    assert.equal(period.state, "ended");
    assert.equal(period.endDate, today());
    assert.ok(period.placements.every((placement) => placement.endDate === today()));
    assert.deepEqual(after.shifts, shiftsBefore);
    assert.equal(store.endWorkerEmployment("worker-01", today(), "duplicate"), false);
    store.setActiveMember("worker-01");
    const workerView = runtime.read();
    const accountMemberships = store.getWorkerAccountMemberships(workerView, "worker-01");
    const accountMemberIds = new Set(accountMemberships.map((member) => member.id));
    const visibleHistory = workerView.shifts.filter((record) => accountMemberIds.has(record.shift.workerUid)
      && accountMemberships.some((member) => member.id === record.shift.workerUid && member.organizationId === record.organizationId));
    assert.ok(visibleHistory.some((record) => record.shift.id === "shift-seed-worker-01"));
    assert.ok(workerView.employmentPeriods.some((item) => item.id === period.id && item.state === "ended"));
  } finally {
    delete globalThis.window;
  }
});

test("production transfer requires confirmation and retains historical shift ownership", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-demo";
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("transfer");
    const shiftsBefore = runtime.read().shifts;
    store.setActiveMember("agency-demo");
    assert.equal(store.transferWorkerProduction("worker-01", "factory-alpha", "factory-beta", undefined, today()), false);
    assert.equal(runtime.read().employmentPeriods.find((item) => item.id === "employment-worker-01-current").placements.some((placement) => placement.factoryId === "factory-beta"), false);
    assert.equal(store.transferWorkerProduction("worker-01", "factory-alpha", "factory-beta", undefined, today(), true), true);
    const after = runtime.read();
    const period = after.employmentPeriods.find((item) => item.id === "employment-worker-01-current");
    assert.equal(period.placements.find((placement) => placement.factoryId === "factory-alpha").endDate, dayBefore(today()));
    assert.equal(period.placements.find((placement) => placement.factoryId === "factory-beta").startDate, today());
    assert.deepEqual(after.shifts, shiftsBefore);
    assert.ok(after.shifts.filter((record) => record.shift.workerUid === "worker-01").every((record) => record.shift.factoryId === "factory-alpha"));
    const agency = { ...after, organization: after.organizations.find((organization) => organization.id === "org-demo-01") };
    const betaSnapshot = buildMonthlyTimesheetSnapshot(agency, "factory-beta", today().slice(0, 7));
    assert.equal(betaSnapshot.rows.some((row) => row.workerId === "worker-01" && shiftsBefore.some((record) => record.shift.id === row.recordId)), false);
  } finally {
    delete globalThis.window;
  }
});

test("a worker can transfer on the first day of a production placement without rewriting shift history", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-demo";
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("same-day-transfer");
    store.setActiveMember("agency-demo");
    const worker = store.createAgencyWorker("Same day transfer");
    assert.ok(worker);
    assert.equal(store.hireWorker(worker.id, "factory-alpha", undefined, today()), true);
    const shiftsBefore = runtime.read().shifts;
    assert.equal(store.transferWorkerProduction(worker.id, "factory-alpha", "factory-beta", undefined, today(), true), true);
    const state = runtime.read();
    const period = state.employmentPeriods.find((item) => item.workerId === worker.id && item.state === "active");
    assert.equal(period.placements.find((placement) => placement.factoryId === "factory-alpha").endDate, today());
    assert.equal(period.placements.find((placement) => placement.factoryId === "factory-beta").startDate, today());
    assert.deepEqual(state.shifts, shiftsBefore);
  } finally {
    delete globalThis.window;
  }
});

test("a transfer is blocked when multiple active employment periods make its source ambiguous", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-demo";
  const originalPeriod = seed.employmentPeriods.find((period) => period.workerId === "worker-01" && period.state === "active");
  assert.ok(originalPeriod);
  seed.employmentPeriods.push({ ...originalPeriod, id: "employment-worker-01-duplicate", placements: originalPeriod.placements.map((placement) => ({ ...placement, id: `${placement.id}-duplicate` })) });
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("ambiguous-transfer");
    store.setActiveMember("agency-demo");
    assert.equal(store.transferWorkerProduction("worker-01", "factory-alpha", "factory-beta", undefined, today(), true), false);
    assert.equal(runtime.read().employmentPeriods.filter((period) => period.workerId === "worker-01" && period.state === "active").length, 2);
  } finally {
    delete globalThis.window;
  }
});

test("leaders can record for ungrouped production workers and remove team access without ending employment", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "leader-01";
  seed.factories = seed.factories.map((factory) => factory.id === "factory-alpha" ? { ...factory, workflowSettings: { ...factory.workflowSettings, leaderCanRecordHours: true } } : factory);
  seed.members = seed.members.map((member) => member.id === "leader-01" ? { ...member, permissions: { ...member.permissions, canRecordHours: true, canManageGroups: true } } : member);
  seed.employmentPeriods = seed.employmentPeriods.map((period) => period.workerId === "worker-01" ? { ...period, placements: period.placements.map((placement) => ({ ...placement, groupId: undefined })) } : period);
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("leader-access");
    store.setActiveMember("leader-01");
    assert.equal(store.createLeaderShifts(["worker-01"], draft()), 1);
    const shiftsBeforeRemoval = runtime.read().shifts;
    const employmentBeforeRemoval = runtime.read().employmentPeriods;
    assert.equal(store.setLeaderWorkerAccess("factory-alpha", "worker-01", "removed"), true);
    const afterRemoval = runtime.read();
    assert.deepEqual(afterRemoval.shifts, shiftsBeforeRemoval);
    assert.deepEqual(afterRemoval.employmentPeriods, employmentBeforeRemoval);
    assert.equal(afterRemoval.leaderWorkerAccess.find((item) => item.workerId === "worker-01").state, "removed");
    assert.equal(store.setLeaderWorkerAccess("factory-alpha", "worker-01", "active"), true);
    assert.equal(runtime.read().leaderWorkerAccess.find((item) => item.workerId === "worker-01").state, "active");
  } finally {
    delete globalThis.window;
  }
});

test("a worker account can be hired by another agency while timesheet records stay organization-scoped", async () => {
  const seed = createSeedWorkspace({ includeFeatureFixtures: true });
  seed.activeMemberId = "agency-c";
  const runtime = installWorkspace(seed);
  try {
    const store = await storeFor("shared-worker-account");
    const original = runtime.read().members.find((member) => member.id === "worker-01");
    store.setActiveMember("agency-c");
    const secondMembership = store.createAgencyWorker(original.name, original.email ?? "", original.phone ?? "", original.accountUid);
    assert.ok(secondMembership);
    assert.notEqual(secondMembership.id, original.id);
    assert.equal(secondMembership.accountUid, original.accountUid);
    assert.equal(store.hireWorker(secondMembership.id, "factory-gamma", undefined, today()), true);
    store.setActiveMember(secondMembership.id);
    assert.equal(store.createWorkerShift(draft()), "created");
    const after = runtime.read();
    const memberships = store.getWorkerAccountMemberships(after, secondMembership.id);
    assert.deepEqual(new Set(memberships.map((member) => member.id)), new Set(["worker-01", secondMembership.id]));
    const agencyA = { ...after, organization: after.organizations.find((organization) => organization.id === "org-demo-01") };
    const agencyC = { ...after, organization: after.organizations.find((organization) => organization.id === "org-independent-factory-demo") };
    const aRows = buildMonthlyTimesheetSnapshot(agencyA, "factory-alpha", today().slice(0, 7)).rows;
    const cRows = buildMonthlyTimesheetSnapshot(agencyC, "factory-gamma", today().slice(0, 7)).rows;
    assert.ok(aRows.some((row) => row.workerId === "worker-01"));
    assert.equal(aRows.some((row) => row.workerId === secondMembership.id), false);
    assert.ok(cRows.some((row) => row.workerId === secondMembership.id));
    assert.equal(cRows.some((row) => row.workerId === "worker-01"), false);
  } finally {
    delete globalThis.window;
  }
});

test("leader dashboard keeps one attendance workspace and renders the unified accessible team roster", async () => {
  const source = await readFile(new URL("../src/modules/reviews/pages/LeaderDashboardPage.tsx", import.meta.url), "utf8");
  const teamSource = await readFile(new URL("../src/modules/reviews/components/LeaderTeamPanel.tsx", import.meta.url), "utf8");
  const productionSource = await readFile(new URL("../src/modules/agencies/pages/AgencyProductionsPage.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/<ScheduleCenter\b/g) ?? []).length, 1);
  assert.doesNotMatch(source, /SharedLeaderRoster/);
  assert.equal((source.match(/onClick=\{openAttendanceForm\}/g) ?? []).length, 1);
  assert.match(source, /<LeaderTeamPanel \/>/);
  assert.match(teamSource, /leader-participants-table/);
  assert.match(teamSource, /getLeaderProductionParticipants/);
  assert.match(teamSource, /agencyFilter/);
  assert.match(teamSource, /productionFilter/);
  assert.match(teamSource, /assignWorkerToGroupForMembership/);
  assert.match(productionSource, /allFactories\.filter\(\(item\) => !item\.archivedAt\)/);
  assert.match(productionSource, /archivedFactories\.map/);
});
