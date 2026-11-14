import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("a multi-agency leader approves a change only through the correct membership", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "worker-01";
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    const date = today();
    store.setActiveMember("worker-01");
    assert.equal(store.createWorkerShift({ localDate: date, startTime: "07:00", endTime: "15:00", comment: "", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    const created = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((record) => record.organizationId === "org-demo-01" && record.shift.workerUid === "worker-01" && record.shift.localStartDate === date);
    assert.equal(store.submitShiftChangeRequest(created.shift.id, { localDate: date, startTime: "08:00", endTime: "15:00", comment: "Updated by worker", breakStatus: "not-reported", breakTreatment: "unpaid" }, "Please correct the start time", "leader"), true);
    const pendingState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const request = pendingState.changeRequests.find((item) => item.shiftId === created.shift.id);
    const unchangedShift = pendingState.shifts.find((record) => record.shift.id === created.shift.id);
    assert.equal(request.originalValues.paidDurationMinutes, 480);
    assert.equal(request.proposedValues.paidDurationMinutes, 420, "the proposed shift reflects seven hours of paid time");
    assert.equal(unchangedShift.shift.startAt, created.shift.startAt, "a request does not overwrite the approved values");
    assert.equal(unchangedShift.shift.paidDurationMinutes, created.shift.paidDurationMinutes);
    assert.equal(unchangedShift.previousVersions.length, 0);

    store.setActiveMember("agency-partner");
    assert.equal(store.respondToShiftChangeRequest(request.id, "approve", ""), false);
    store.setActiveMember("leader-piotr-b");
    assert.equal(store.respondToShiftChangeRequest(request.id, "approve", "Correction accepted"), true);
    const finalState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const updatedRequest = finalState.changeRequests.find((item) => item.id === request.id);
    assert.equal(updatedRequest.state, "approved");
    assert.equal(updatedRequest.resolvedById, "leader-01");
    const updatedShift = finalState.shifts.find((record) => record.shift.id === created.shift.id);
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: updatedShift.shift.timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(updatedShift.shift.startAt)), "08:00");
    assert.equal(updatedShift.previousVersions.at(-1).paidDurationMinutes, 480);
    assert.equal(updatedShift.history.at(-1).oldValues.paidDurationMinutes, 480);
    assert.equal(updatedShift.history.at(-1).newValues.paidDurationMinutes, 420);
    assert.equal(updatedShift.history.at(-1).actorId, "leader-01");
  } finally {
    delete globalThis.window;
  }
});

test("a worker correction to an approved shift keeps the original until review and archives it on approval", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "worker-01";
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?approved-shift-correction");
    store.setActiveMember("worker-01");
    const before = JSON.parse(saved.get("timeax-demo-workspace-v1")).shifts.find((record) => record.shift.id === "shift-seed-worker-01");
    assert.equal(before.shift.reviewState, "approved");
    assert.equal(before.shift.workerConfirmation, "confirmed");

    assert.equal(store.submitShiftChangeRequest(before.shift.id, {
      localDate: before.shift.localStartDate,
      startTime: "07:00",
      endTime: "14:00",
      comment: "Correcting my recorded hours",
      breakStatus: "taken",
      breakTreatment: "unpaid",
      breakDurationMinutes: 20,
      breakStartTime: "10:00",
      breakEndTime: "10:20",
    }, "My recorded end time is incorrect", "leader"), true);

    const pendingState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const pendingShift = pendingState.shifts.find((record) => record.shift.id === before.shift.id);
    const request = pendingState.changeRequests.find((item) => item.shiftId === before.shift.id && item.state === "open");
    assert.equal(pendingShift.shift.startAt, before.shift.startAt);
    assert.equal(pendingShift.shift.paidDurationMinutes, 460);
    assert.equal(pendingShift.previousVersions.length, before.previousVersions.length);
    assert.equal(request.originalValues.paidDurationMinutes, 460);
    assert.equal(request.proposedValues.paidDurationMinutes, 400);

    store.setActiveMember("leader-01");
    assert.equal(store.respondToShiftChangeRequest(request.id, "approve", "Correction accepted"), true);
    const finalState = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const correctedShift = finalState.shifts.find((record) => record.shift.id === before.shift.id);
    assert.equal(correctedShift.previousVersions.at(-1).paidDurationMinutes, 460);
    assert.equal(correctedShift.shift.paidDurationMinutes, 400);
    assert.equal(correctedShift.history.at(-1).oldValues.paidDurationMinutes, 460);
    assert.equal(correctedShift.history.at(-1).newValues.paidDurationMinutes, 400);
  } finally {
    delete globalThis.window;
  }
});
