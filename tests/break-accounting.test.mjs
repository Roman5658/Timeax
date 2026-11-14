import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { buildMonthlyTimesheetSnapshot } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function dateOffset(offset) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function storageFor(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

test("optional, paid, and unpaid breaks calculate net time without exact break times", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.factories = workspace.factories.map((factory) => factory.id === "factory-alpha" ? {
    ...factory,
    requiredBreakMinutes: 30,
    requiredBreakTreatment: "unpaid",
    workflowSettings: { ...factory.workflowSettings, leaderMustReviewShifts: false, agencyMustReviewShifts: false },
  } : factory);
  const saved = storageFor(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?optional-breaks");
    const base = { startTime: "22:00", endTime: "06:00", comment: "", factoryId: "factory-alpha" };
    const cases = [
      { localDate: dateOffset(0), breakStatus: "not-reported", breakTreatment: "unpaid", breakDurationMinutes: 0, paid: 480, treatment: undefined },
      { localDate: dateOffset(1), breakStatus: "taken", breakTreatment: "paid", breakDurationMinutes: 0, paid: 480, treatment: "paid" },
      { localDate: dateOffset(2), breakStatus: "taken", breakTreatment: "unpaid", breakDurationMinutes: 30, paid: 450, treatment: "unpaid" },
    ];
    for (const item of cases) {
      const { paid, treatment, ...draft } = item;
      assert.equal(store.createWorkerShift({ ...base, ...draft }), "created");
      const record = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((entry) => entry.shift.localStartDate === item.localDate && entry.shift.workerUid === "worker-01");
      assert.equal(record.shift.grossDurationMinutes, 480);
      assert.equal(record.shift.paidDurationMinutes, paid);
      assert.equal(record.shift.actualBreak.treatment, treatment);
      assert.equal(record.shift.actualBreak.segments.length, 0);
      assert.equal(record.shift.actualBreak.reviewState, treatment === "paid" ? "pending" : "not-required");
      const row = buildMonthlyTimesheetSnapshot(JSON.parse(saved.get("timeax-demo-workspace-v1")), "factory-alpha", item.localDate.slice(0, 7)).rows.find((entry) => entry.recordId === record.shift.id);
      assert.equal(row.paidDurationMinutes, paid);
      assert.equal(row.nightDurationMinutes, paid);
      assert.equal(row.breakTreatment, treatment);
    }
  } finally {
    delete globalThis.window;
  }
});

test("leader access allows production participants without group ownership and suppresses no-op history values", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  workspace.factories = workspace.factories.map((factory) => factory.id === "factory-alpha" ? {
    ...factory,
    requiredBreakMinutes: 0,
    workflowSettings: { ...factory.workflowSettings, leaderCanRecordHours: true, leaderMustReviewShifts: true },
  } : factory);
  workspace.members = workspace.members.map((member) => member.id === "leader-01" ? { ...member, permissions: { ...member.permissions, canRecordHours: true, canReviewShifts: true } } : member);
  const saved = storageFor(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?leader-break-accounting");
    store.setActiveMember("leader-01");
    const draft = { localDate: dateOffset(0), startTime: "22:00", endTime: "06:00", comment: "", breakStatus: "taken", breakTreatment: "unpaid", breakDurationMinutes: 30 };
    assert.equal(store.getLeaderShiftCreateBlockReason(["worker-01"], draft), undefined);
    assert.equal(store.createLeaderShifts(["worker-01"], draft), 1);
    let record = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((entry) => entry.shift.workerUid === "worker-01" && entry.shift.localStartDate === draft.localDate);
    assert.equal(record.shift.paidDurationMinutes, 450);
    assert.equal(store.reviewShiftRecord(record.shift.id, "approve"), true);
    record = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((entry) => entry.shift.id === record.shift.id);
    assert.equal(record.history.at(-1).action, "reviewed");
    assert.equal(record.history.at(-1).oldValues, undefined);
    assert.equal(record.history.at(-1).newValues, undefined);

    const deniedState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    deniedState.employmentPeriods = deniedState.employmentPeriods.map((period) => period.workerId === "worker-01" ? { ...period, placements: period.placements.map((placement) => ({ ...placement, leaderId: undefined, groupId: undefined })) } : period);
    deniedState.members = deniedState.members.map((member) => member.id === "worker-01" ? { ...member, groupId: undefined, leaderId: undefined, productionAssignments: member.productionAssignments?.map((assignment) => ({ ...assignment, leaderId: undefined, groupId: undefined })) } : member);
    saved.set("timeax-demo-workspace-v1", JSON.stringify(deniedState));
    const deniedStore = await import("../src/modules/workflows/demo-store.ts?leader-assignment-denial");
    assert.equal(deniedStore.getLeaderShiftCreateBlockReason(["worker-01"], draft), undefined);
    assert.equal(deniedStore.createLeaderShifts(["worker-01"], { ...draft, localDate: dateOffset(1) }), 1);
    assert.equal(deniedStore.assignWorkerToLeader("factory-alpha", "worker-01", "leader-01"), true);
    assert.equal(deniedStore.getLeaderShiftCreateBlockReason(["worker-01"], { ...draft, localDate: dateOffset(1) }), undefined);
    assert.equal(deniedStore.createLeaderShifts(["worker-01"], { ...draft, localDate: dateOffset(2) }), 1);
  } finally {
    delete globalThis.window;
  }
});
