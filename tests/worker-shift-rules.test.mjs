import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + count);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function availableDate(workspace) {
  const baseSeed = createSeedWorkspace();
  const period = workspace.employmentPeriods.find((item) => item.workerId === "worker-01" && item.state === "active");
  assert.ok(period);
  const firstDate = today() < period.startDate ? period.startDate : today();
  for (let offset = 0; offset < 180; offset += 1) {
    const date = addDays(firstDate, offset);
    if (period.endDate && date > period.endDate) break;
    const occupied = [workspace.shifts, baseSeed.shifts].some((records) => records.some((item) => item.organizationId === "org-demo-01"
      && item.shift.workerUid === "worker-01" && item.shift.localStartDate === date && !item.shift.deletedAt));
    if (!occupied) return date;
  }
  assert.fail("No free date found in the active employment period");
}

function isolateWorkspace(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

const shiftDraft = (localDate, startTime, endTime) => ({
  localDate,
  startTime,
  endTime,
  comment: "",
  breakStatus: "not-reported",
  breakTreatment: "unpaid",
  breakDurationMinutes: 0,
  breakStartTime: "",
  breakEndTime: "",
});

test("workers can enter a past shift during their active employment period", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "worker-01";
  const period = workspace.employmentPeriods.find((item) => item.workerId === "worker-01" && item.state === "active");
  assert.ok(period);
  const targetDate = addDays(today(), -7) < period.startDate ? period.startDate : addDays(today(), -7);
  const saved = isolateWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?worker-past-shift");
    store.setActiveMember("worker-01");
    assert.equal(store.createWorkerShift(shiftDraft(targetDate, "07:00", "15:00")), "created");
    const state = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.ok(state.shifts.some((item) => item.organizationId === "org-demo-01" && item.shift.workerUid === "worker-01" && item.shift.localStartDate === targetDate));
  } finally {
    delete globalThis.window;
  }
});

test("the exact same shift cannot be added twice even when the old duplicate override is supplied", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "worker-01";
  const date = availableDate(workspace);
  const saved = isolateWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?worker-duplicate-shift");
    store.setActiveMember("worker-01");
    assert.equal(store.createWorkerShift(shiftDraft(date, "07:00", "15:00")), "created");
    assert.equal(store.createWorkerShift(shiftDraft(date, "07:00", "15:00"), { confirmDuplicate: true }), "duplicate");
    const state = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(state.shifts.filter((item) => item.organizationId === "org-demo-01" && item.shift.workerUid === "worker-01" && item.shift.localStartDate === date && !item.shift.deletedAt).length, 1);
  } finally {
    delete globalThis.window;
  }
});

test("a change request cannot move a shift into another existing shift", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "worker-01";
  const date = availableDate(workspace);
  isolateWorkspace(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?worker-shift-change-conflict");
    store.setActiveMember("worker-01");
    assert.equal(store.createWorkerShift(shiftDraft(date, "07:00", "15:00")), "created");
    assert.equal(store.createWorkerShift(shiftDraft(date, "16:00", "20:00")), "created");
    const state = JSON.parse(globalThis.window.localStorage.getItem("timeax-demo-workspace-v1"));
    const first = state.shifts.find((item) => item.organizationId === "org-demo-01" && item.shift.workerUid === "worker-01" && item.shift.localStartDate === date && new Date(item.shift.startAt).getHours() === 7);
    assert.ok(first);
    assert.equal(store.submitShiftChangeRequest(first.shift.id, shiftDraft(date, "16:00", "20:00"), "Correct my time", "leader"), false);
  } finally {
    delete globalThis.window;
  }
});
