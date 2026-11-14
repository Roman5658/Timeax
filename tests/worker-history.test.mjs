import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerHistory } from "../src/modules/workflows/worker-history.ts";

const shift = (id, date, paidDurationMinutes = 480, deletedAt) => ({
  organizationId: "agency-1",
  shift: { id, localStartDate: date, paidDurationMinutes, deletedAt },
  history: [],
  previousVersions: [],
});

const schedule = (id, startDate, endDate, weekdays) => ({
  id,
  state: "active",
  startDate,
  endDate,
  weekdays,
  workerIds: ["worker-1"],
});

const review = (id, localDate, outcome, scheduleId = "schedule-1") => ({
  id,
  workerId: "worker-1",
  organizationId: "agency-1",
  scheduleId,
  localDate,
  outcome,
});

test("history months only mark missed shifts when an explicit record says so", () => {
  const months = buildWorkerHistory({
    shifts: [],
    absences: [],
    schedules: [schedule("schedule-1", "2026-11-02", "2026-11-06", [1, 2, 3, 4, 5])],
    attendanceReviews: [review("review-missed", "2026-11-03", "unreported-absence")],
    today: "2026-11-09",
  });

  assert.deepEqual(months.map((month) => month.key), ["2026-11"]);
  assert.equal(months[0].missedDayCount, 1);
  assert.equal(months[0].days.find((day) => day.date === "2026-11-03").isConfirmedRestDay, false);
  assert.equal(months[0].days.some((day) => day.date === "2026-11-04"), false, "a scheduled day without an attendance result is not called a miss");
});

test("planned attendance and schedules never add paid hours to factual history", () => {
  const months = buildWorkerHistory({
    shifts: [shift("shift-1", "2026-11-02", 420), shift("shift-deleted", "2026-11-03", 600, "2026-11-04T10:00:00Z")],
    absences: [],
    schedules: [schedule("schedule-1", "2026-11-02", "2026-11-06", [1, 2, 3, 4, 5])],
    attendanceReviews: [review("review-worked", "2026-11-03", "worked")],
    today: "2026-11-09",
  });

  assert.equal(months[0].workedShiftCount, 1);
  assert.equal(months[0].paidMinutes, 420);
  assert.equal(months[0].missedDayCount, 0);
});

test("only known weekly-schedule rest days are gray and are ordered newest first", () => {
  const months = buildWorkerHistory({
    shifts: [shift("shift-oct", "2026-10-30", 300)],
    absences: [],
    schedules: [schedule("schedule-nov", "2026-11-02", "2026-11-08", [1, 2, 3, 4, 5])],
    attendanceReviews: [],
    today: "2026-11-09",
  });

  assert.deepEqual(months.map((month) => month.key), ["2026-11", "2026-10"]);
  assert.equal(months[0].restDayCount, 2, "weekend days inside a published Monday-Friday schedule are known days off");
  assert.equal(months[1].restDayCount, 0, "an ordinary day outside a schedule range stays unclassified");
});
