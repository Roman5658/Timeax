import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("leader confirmation uses its own permission and membership without granting review rights", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  workspace.factories = workspace.factories.map((factory) => factory.id === "factory-partner" ? {
    ...factory,
    workflowSettings: { ...factory.workflowSettings, leaderMustReviewShifts: true },
  } : factory);
  workspace.members = workspace.members.map((member) => member.id === "leader-piotr-b" ? {
    ...member,
    permissions: { ...member.permissions, canConfirmShifts: true, canReviewShifts: false },
  } : member);
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    store.setActiveMember("leader-01");
    const date = today();
    assert.equal(store.createLeaderShiftBatch([
      { organizationId: "org-partner-demo", factoryId: "factory-partner", workerId: "worker-partner-04", employmentId: "employment-worker-partner-04-current" },
    ], { localDate: date, startTime: "08:00", endTime: "16:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }, "test-confirm-without-review"), 1);
    const shift = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((record) => record.clientSubmissionId === "test-confirm-without-review");
    assert.equal(shift.shift.reviewState, "pending");
    assert.equal(shift.shift.workerConfirmation, "pending");
    assert.equal(store.reviewShiftRecord(shift.shift.id, "approve"), false);
    assert.equal(store.confirmShiftForWorker(shift.shift.id), true);
    const updated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const confirmed = updated.shifts.find((record) => record.shift.id === shift.shift.id);
    assert.equal(confirmed.shift.reviewState, "pending");
    assert.equal(confirmed.shift.workerConfirmation, "confirmed");
    assert.equal(confirmed.history.at(-1).action, "leader-confirmed");
    assert.equal(confirmed.history.at(-1).actorId, "leader-piotr-b");
    assert.ok(updated.notifications.some((notice) => notice.subjectId === shift.shift.id && notice.organizationId === "org-partner-demo"));
  } finally {
    delete globalThis.window;
  }
});
