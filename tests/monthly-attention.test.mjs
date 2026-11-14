import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { buildMonthlyTimesheetSnapshot, hasOpenMonthlyIssues, monthlyAttentionReasons, monthlyRecordFlags } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("a confirmed clean shift is checked, while a required review explains its owner", () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.organization = workspace.organizations.find((organization) => organization.id === "org-demo-01");
  const factory = workspace.factories.find((item) => item.id === "factory-alpha");
  factory.workflowSettings = { ...factory.workflowSettings, leaderMustReviewShifts: true, agencyMustReviewShifts: false };
  const record = workspace.shifts.find((item) => item.organizationId === workspace.organization.id && item.shift.factoryId === factory.id && item.shift.workerUid === "worker-01");
  record.shift = {
    ...record.shift,
    localStartDate: today(),
    workerConfirmation: "confirmed",
    reviewState: "pending",
    totalBreakDurationMinutes: 0,
    unpaidBreakDurationMinutes: 0,
    paidDurationMinutes: record.shift.grossDurationMinutes,
    actualBreak: { status: "not-taken", segments: [], reviewState: "not-required" },
    breakPolicySnapshot: { ...record.shift.breakPolicySnapshot, required: false },
  };

  let snapshot = buildMonthlyTimesheetSnapshot(workspace, factory.id, today().slice(0, 7));
  let row = snapshot.rows.find((item) => item.recordId === record.shift.id);
  assert.deepEqual(row.attentionReasons.map((reason) => [reason.code, reason.responsible]), [["shift-review", "leader"]]);
  assert.deepEqual(monthlyRecordFlags(row), ["check"]);
  assert.equal(hasOpenMonthlyIssues([row]), true);

  record.shift.reviewState = "approved";
  snapshot = buildMonthlyTimesheetSnapshot(workspace, factory.id, today().slice(0, 7));
  row = snapshot.rows.find((item) => item.recordId === record.shift.id);
  assert.deepEqual(monthlyAttentionReasons(row), []);
  assert.deepEqual(monthlyRecordFlags(row), ["ready"]);
  assert.equal(hasOpenMonthlyIssues([row]), false);

  record.shift.reviewState = "not-submitted";
  row = buildMonthlyTimesheetSnapshot(workspace, factory.id, today().slice(0, 7)).rows.find((item) => item.recordId === record.shift.id);
  assert.deepEqual(monthlyRecordFlags(row), ["ready"]);

  const clarification = { ...row, kind: "absence", absenceState: "clarification-requested", absenceCategory: "attention", attentionReasons: undefined };
  assert.deepEqual(monthlyAttentionReasons(clarification).map((reason) => [reason.code, reason.responsible]), [["absence-clarification", "worker"]]);
  assert.deepEqual(monthlyRecordFlags(clarification), ["absence", "check"]);
});
