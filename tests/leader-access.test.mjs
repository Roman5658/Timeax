import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { effectiveWorkflowSettings, filterLeaderRoster, getLeaderRoster } from "../src/modules/workflows/domain/access.ts";
import { buildMonthlyTimesheetSnapshot } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("one Alfa worksite connects three separate agency productions and Beta remains separate", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const alfa = workspace.factories.filter((factory) => factory.worksiteId === "worksite-alfa");
  assert.equal(alfa.length, 3);
  assert.deepEqual(new Set(alfa.map((factory) => factory.organizationId)), new Set(["org-demo-01", "org-partner-demo", "org-independent-factory-demo"]));
  assert.equal(workspace.factories.find((factory) => factory.id === "factory-beta")?.worksiteId, "worksite-beta");
  assert.equal(workspace.worksites?.find((site) => site.id === "worksite-beta")?.name, "Magazyn Beta");
  assert.equal(new Set(alfa.map((factory) => factory.id)).size, 3);
});

test("Piotr uses one account identity with A and B membership access, while C stays hidden", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const memberships = workspace.members.filter((member) => member.role === "leader" && member.accountUid === "account-leader-piotr");
  assert.equal(memberships.length, 2);
  const roster = getLeaderRoster(workspace, memberships[0], today());
  assert.ok(roster.some((entry) => entry.organizationId === "org-demo-01"));
  assert.ok(roster.some((entry) => entry.organizationId === "org-partner-demo"));
  assert.equal(roster.some((entry) => entry.organizationId === "org-independent-factory-demo"), false);
  assert.ok(roster.every((entry) => entry.organizationName === "Agencja A" || entry.organizationName === "Agencja B"));
});

test("revoking A access leaves Piotr's B membership active", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const restricted = { ...workspace, members: workspace.members.map((member) => member.id === "leader-01" ? { ...member, accessState: "revoked" } : member) };
  const actor = restricted.members.find((member) => member.id === "leader-01");
  const roster = getLeaderRoster(restricted, actor, today());
  assert.equal(roster.some((entry) => entry.organizationId === "org-demo-01"), false);
  assert.ok(roster.length > 0);
  assert.ok(roster.every((entry) => entry.organizationId === "org-partner-demo"));
});

test("shared roster filters by agency, worker name and ungrouped status", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const memberships = workspace.members.filter((member) => member.role === "leader" && member.accountUid === "account-leader-piotr");
  const ungrouped = { ...workspace, employmentPeriods: workspace.employmentPeriods.map((period) => period.workerId === "worker-partner-02" ? { ...period, placements: period.placements.map((placement) => ({ ...placement, groupId: undefined })) } : period) };
  const roster = getLeaderRoster(ungrouped, memberships[0], today());
  const betaOlena = filterLeaderRoster(roster, { organizationId: "org-partner-demo", groupId: "none", search: "Olena", workerState: "active" });
  assert.equal(betaOlena.length, 1);
  assert.equal(betaOlena[0].worker.id, "worker-partner-02");
  assert.equal(filterLeaderRoster(roster, { organizationId: "org-independent-factory-demo" }).length, 0);
});

test("workflow scenarios keep input, review, confirmation and submission settings independent", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const byId = new Map(workspace.factories.map((factory) => [factory.id, effectiveWorkflowSettings(factory)]));
  assert.deepEqual([byId.get("factory-alpha").workerCanRecordHours, byId.get("factory-alpha").leaderCanRecordHours, byId.get("factory-alpha").leaderMustReviewShifts, byId.get("factory-alpha").leaderCanSubmitTimesheet, byId.get("factory-alpha").agencyMustAcceptTimesheet], [true, false, true, true, true]);
  assert.deepEqual([byId.get("factory-partner").workerCanRecordHours, byId.get("factory-partner").leaderCanRecordHours, byId.get("factory-partner").workerMustConfirmShifts, byId.get("factory-partner").leaderCanSubmitTimesheet], [false, true, true, true]);
  assert.deepEqual([byId.get("factory-gamma").workerCanRecordHours, byId.get("factory-gamma").leaderCanSubmitTimesheet, byId.get("factory-gamma").agencyMustReviewShifts, byId.get("factory-gamma").agencyCanSubmitTimesheet], [true, false, true, true]);
});

test("one leader batch writes separate A and B shifts under each active employment and tab", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  workspace.factories = workspace.factories.map((factory) => factory.id === "factory-alpha" ? { ...factory, workflowSettings: { ...factory.workflowSettings, leaderCanRecordHours: true } } : factory);
  workspace.members = workspace.members.map((member) => member.id === "leader-01" ? { ...member, permissions: { ...member.permissions, canRecordHours: true } } : member);
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    store.setActiveMember("leader-01");
    const date = today();
    const count = store.createLeaderShiftBatch([
      { organizationId: "org-demo-01", factoryId: "factory-alpha", workerId: "worker-01", employmentId: "employment-worker-01-current" },
      { organizationId: "org-partner-demo", factoryId: "factory-partner", workerId: "worker-partner-02", employmentId: "employment-worker-partner-02-current" },
      { organizationId: "org-independent-factory-demo", factoryId: "factory-gamma", workerId: "worker-09", employmentId: "employment-worker-09-current" },
    ], { localDate: date, startTime: "06:00", endTime: "14:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }, "test-cross-agency-batch");
    assert.equal(count, 2);
    const after = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const records = after.shifts.filter((record) => record.clientSubmissionId === "test-cross-agency-batch");
    assert.deepEqual(records.map((record) => record.organizationId).sort(), ["org-demo-01", "org-partner-demo"]);
    assert.ok(records.every((record) => record.shift.employmentId && record.shift.agencyId === record.organizationId));
    const aTab = buildMonthlyTimesheetSnapshot({ ...after, organization: after.organizations.find((org) => org.id === "org-demo-01") }, "factory-alpha", date.slice(0, 7)).rows;
    const bTab = buildMonthlyTimesheetSnapshot({ ...after, organization: after.organizations.find((org) => org.id === "org-partner-demo") }, "factory-partner", date.slice(0, 7)).rows;
    assert.ok(aTab.some((row) => row.workerId === "worker-01"));
    assert.equal(aTab.some((row) => row.workerId === "worker-partner-02"), false);
    assert.ok(bTab.some((row) => row.workerId === "worker-partner-02"));
    assert.equal(bTab.some((row) => row.workerId === "worker-01"), false);

    const aShift = records.find((record) => record.organizationId === "org-demo-01");
    const bShift = records.find((record) => record.organizationId === "org-partner-demo");
    store.setActiveMember("worker-partner-02");
    assert.equal(store.confirmShift(bShift.shift.id), true);
    store.setActiveMember("leader-01");
    assert.equal(store.resolveRequiredBreakReview(aShift.shift.id, "approve", "Break reviewed"), true);
    assert.equal(store.submitMonthlyTimesheet("factory-alpha", date.slice(0, 7), true, "org-demo-01"), true);
    const aTimesheet = JSON.parse(saved.get("timeax-demo-workspace-v1")).monthlyTimesheets.find((item) => item.organizationId === "org-demo-01" && item.factoryId === "factory-alpha");
    assert.equal(aTimesheet.status, "submitted_to_agency");
    store.setActiveMember("agency-demo");
    assert.equal(store.acceptMonthlyTimesheet(aTimesheet.id), true);
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).monthlyTimesheets.find((item) => item.id === aTimesheet.id).status, "accepted_by_agency");

    store.setActiveMember("worker-09");
    assert.equal(store.createWorkerShift({ localDate: date, startTime: "16:00", endTime: "22:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    const cShift = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((record) => record.organizationId === "org-independent-factory-demo" && record.shift.localStartDate === date && record.shift.workerUid === "worker-09");
    assert.ok(cShift.shift.employmentId);
    assert.equal(cShift.shift.reviewState, "pending");
    store.setActiveMember("agency-c");
    assert.equal(store.reviewShiftRecord(cShift.shift.id, "approve"), true);
    assert.equal(store.submitMonthlyTimesheet("factory-gamma", date.slice(0, 7), true, "org-independent-factory-demo"), true);
    const cTimesheet = JSON.parse(saved.get("timeax-demo-workspace-v1")).monthlyTimesheets.find((item) => item.organizationId === "org-independent-factory-demo" && item.factoryId === "factory-gamma");
    assert.equal(cTimesheet.status, "submitted_to_agency");
    assert.equal(store.acceptMonthlyTimesheet(cTimesheet.id), true);
    assert.equal(JSON.parse(saved.get("timeax-demo-workspace-v1")).monthlyTimesheets.find((item) => item.id === cTimesheet.id).status, "accepted_by_agency");
  } finally {
    delete globalThis.window;
  }
});
