import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + count);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("creating a planned schedule does not create factual shift records", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "leader-01";
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    store.setActiveMember("leader-01");
    const before = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const shiftIds = before.shifts.map((record) => record.shift.id).sort();
    const startDate = addDays(today(), 1);
    const endDate = addDays(startDate, 13);
    assert.equal(store.createSchedule({
      factoryId: "factory-alpha", workerIds: ["worker-01"], startDate, endDate, weekdays: [1, 2, 3, 4, 5],
      startTime: "07:00", endTime: "15:00", plannedBreakStart: "11:00", plannedBreakEnd: "11:20",
    }), true);
    const after = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(after.schedules.length, before.schedules.length + 1);
    assert.deepEqual(after.shifts.map((record) => record.shift.id).sort(), shiftIds);
  } finally {
    delete globalThis.window;
  }
});
