import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

const demoOrganizations = ["org-demo-01", "org-demo-02", "org-demo-03"];
const demoAccounts = ["agency-demo", "agency-demo-b", "agency-demo-c"];
const scopedCollections = [
  "factories", "groups", "folders", "leaderWorkerAccess", "shifts", "templates", "absences", "employmentPeriods",
  "messageThreads", "schedules", "scheduleAttendanceReviews", "monthlyTimesheets", "changeRequests", "notifications",
  "departments", "connectionRequests", "agencyWorksiteLinks", "leaderTeamAssignments", "productionAssignments",
];

function createWorkspaceWithThreePopulatedAgencies() {
  const workspace = createSeedWorkspace();
  workspace.leaderWorkerAccess = [];
  workspace.departments = [];
  workspace.connectionRequests = [];
  workspace.agencyWorksiteLinks = [];
  workspace.leaderTeamAssignments = [];
  workspace.productionAssignments = [];
  workspace.organizations.push({ id: "org-other", name: "External Agency", timezone: "Europe/Warsaw", type: "agency" });
  workspace.members.push(
    { id: "agency-other", organizationId: "org-other", role: "agency", name: "External Agency", status: "active" },
    { id: "leader-other", organizationId: "org-other", role: "leader", name: "Shared Leader", accountUid: "shared-leader-user", factoryId: "factory-other", status: "active" },
    { id: "worker-other", organizationId: "org-other", role: "worker", name: "Shared Worker", accountUid: "shared-worker-user", factoryId: "factory-other", status: "active" },
  );
  workspace.worksites.push(
    { id: "worksite-shared", name: "Shared Factory Site" },
    { id: "worksite-other-only", name: "External Agency Site" },
    ...demoOrganizations.flatMap((organizationId) => [
      { id: `worksite-only-${organizationId}`, name: `Site for ${organizationId}` },
      { id: `worksite-request-only-${organizationId}`, name: `Requested site for ${organizationId}` },
    ]),
  );
  workspace.factories.push(
    { id: "factory-other", organizationId: "org-other", worksiteId: "worksite-shared", name: "Shared Factory", inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0 },
    ...demoOrganizations.flatMap((organizationId) => [
      { id: `factory-shared-${organizationId}`, organizationId, worksiteId: "worksite-shared", name: "Shared Factory", inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0 },
      { id: `factory-only-${organizationId}`, organizationId, worksiteId: `worksite-only-${organizationId}`, name: `Private Factory ${organizationId}`, inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0 },
    ]),
  );
  for (const [index, organizationId] of demoOrganizations.entries()) {
    const accountId = demoAccounts[index];
    const leaderId = `leader-${organizationId}`;
    const workerId = `worker-${organizationId}`;
    const factoryId = `factory-shared-${organizationId}`;
    const groupId = `group-${organizationId}`;
    workspace.members.push(
      { id: leaderId, organizationId, role: "leader", name: "Shared Leader", accountUid: "shared-leader-user", factoryId, status: "active" },
      { id: workerId, organizationId, role: "worker", name: "Shared Worker", accountUid: "shared-worker-user", factoryId, groupId, leaderId, productionAssignments: [{ factoryId, groupId, leaderId }], status: "active" },
      { id: `extra-agency-${organizationId}`, organizationId, role: "agency", name: "Extra agency member", status: "active" },
    );
    workspace.groups.push({ id: groupId, organizationId, factoryId, leaderId, name: `Group ${organizationId}` });
    workspace.folders.push({ id: `folder-${organizationId}`, organizationId, name: `Folder ${organizationId}` });
    workspace.leaderWorkerAccess.push({ id: `leader-access-${organizationId}`, leaderMembershipId: leaderId, organizationId, factoryId, workerId, state: "active", changedAt: "2026-11-01T00:00:00.000Z", changedById: accountId });
    workspace.employmentPeriods.push({ id: `employment-${organizationId}`, organizationId, workerId, accountUid: "shared-worker-user", state: "active", startDate: "2026-11-01", createdAt: "2026-11-01T00:00:00.000Z", createdById: accountId, placements: [{ id: `placement-${organizationId}`, factoryId, groupId, leaderId, startDate: "2026-11-01", createdAt: "2026-11-01T00:00:00.000Z", createdById: accountId }], history: [] });
    workspace.shifts.push({ organizationId, shift: { id: `shift-${organizationId}`, workerUid: workerId, factoryId } });
    workspace.templates.push({ id: `template-${organizationId}`, organizationId, workerId, name: "Template", icon: "sun", startTime: "08:00", endTime: "16:00", enabled: true, order: 0 });
    workspace.absences.push({ id: `absence-${organizationId}`, organizationId, workerId, factoryId, groupId, localDate: "2026-11-02", state: "reported", createdById: workerId, history: [] });
    workspace.messageThreads.push({ id: `thread-${organizationId}`, organizationId, workerId, factoryId, recipientType: "agency", recipientId: accountId, participants: [workerId, accountId], subject: "Message", state: "open", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", messages: [] });
    workspace.schedules.push({ id: `schedule-${organizationId}`, organizationId, factoryId, workerIds: [workerId], startDate: "2026-11-02", endDate: "2026-11-02", weekdays: [1], startTime: "08:00", endTime: "16:00", state: "active", createdById: accountId, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", history: [] });
    workspace.scheduleAttendanceReviews.push({ id: `review-${organizationId}`, organizationId, scheduleId: `schedule-${organizationId}`, workerId, factoryId, localDate: "2026-11-02", outcome: "worked", reviewedById: leaderId, reviewedAt: "2026-11-02T00:00:00.000Z", history: [] });
    workspace.monthlyTimesheets.push({ id: `timesheet-${organizationId}`, organizationId, factoryId, month: "2026-11", status: "in_progress", currentVersion: 0, versions: [], history: [], updatedAt: "2026-11-02T00:00:00.000Z" });
    workspace.changeRequests.push({ id: `request-${organizationId}`, organizationId, shiftId: `shift-${organizationId}`, workerId, approverType: "agency", approverId: accountId, state: "open" });
    workspace.notifications.push({ id: `notification-${organizationId}`, organizationId, recipientId: accountId, kind: "shift-pending", subjectId: `shift-${organizationId}`, createdAt: "2026-11-02T00:00:00.000Z" });
    workspace.departments.push({ id: `department-${organizationId}`, organizationId, worksiteId: "worksite-shared", name: "Department" });
    workspace.connectionRequests.push({ id: `connection-${organizationId}`, requestingOrganizationId: organizationId, worksiteId: `worksite-request-only-${organizationId}`, state: "pending" });
    workspace.agencyWorksiteLinks.push({ id: `link-${organizationId}`, organizationId, worksiteId: "worksite-shared", state: "active" });
    workspace.leaderTeamAssignments.push({ id: `team-assignment-${organizationId}`, organizationId, leaderId, workerId, factoryId, groupId });
    workspace.productionAssignments.push({ id: `production-assignment-${organizationId}`, organizationId, workerId, factoryId, groupId, leaderId });
  }
  workspace.departments.push({ id: "department-other", organizationId: "org-other", worksiteId: "worksite-shared", name: "External Department" });
  workspace.connectionRequests.push({ id: "connection-other", requestingOrganizationId: "org-other", worksiteId: "worksite-shared", state: "pending" });
  workspace.agencyWorksiteLinks.push({ id: "link-other", organizationId: "org-other", worksiteId: "worksite-shared", state: "active" });
  workspace.leaderTeamAssignments.push({ id: "team-assignment-other", organizationId: "org-other", leaderId: "leader-other", workerId: "worker-other", factoryId: "factory-other" });
  workspace.productionAssignments.push({ id: "production-assignment-other", organizationId: "org-other", workerId: "worker-other", factoryId: "factory-other" });
  return workspace;
}

test("the active agency reset removes its complete scope, keeps other agencies and shared records, and is idempotent", async () => {
  const workspace = createWorkspaceWithThreePopulatedAgencies();
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)], ["timeax-language", "pl"], ["timeax-theme", "dark"]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?three-agency-reset-isolation");
    for (const [index, organizationId] of demoOrganizations.entries()) {
      const accountId = demoAccounts[index];
      store.setActiveMember(accountId);
      const before = JSON.parse(saved.get("timeax-demo-workspace-v1"));
      const foreignBefore = Object.fromEntries([
        ["members", before.members.filter((item) => item.organizationId !== organizationId)],
        ["factories", before.factories.filter((item) => item.organizationId !== organizationId)],
        ["groups", before.groups.filter((item) => item.organizationId !== organizationId)],
        ...scopedCollections.filter((key) => Array.isArray(before[key])).map((key) => [key, before[key].filter((item) => item.organizationId !== organizationId && item.agencyId !== organizationId && item.requestingOrganizationId !== organizationId && item.requesterOrganizationId !== organizationId && item.sourceOrganizationId !== organizationId && item.targetOrganizationId !== organizationId && item.fromOrganizationId !== organizationId && item.toOrganizationId !== organizationId)]),
      ]);

      assert.equal(store.resetDemoWorkspace(true), true, `reset should succeed for ${organizationId}`);
      const reset = JSON.parse(saved.get("timeax-demo-workspace-v1"));
      assert.deepEqual(reset.organizations.filter((item) => demoOrganizations.includes(item.id)).map((item) => item.id).sort(), [...demoOrganizations].sort());
      assert.ok(reset.members.some((item) => item.id === accountId && item.organizationId === organizationId && item.role === "agency"));
      assert.deepEqual(reset.members.filter((item) => item.organizationId === organizationId).map((item) => item.id), [accountId]);
      assert.equal(reset.members.some((item) => item.id === `leader-${organizationId}` || item.id === `worker-${organizationId}` || item.id === `extra-agency-${organizationId}`), false);
      for (const key of scopedCollections) {
        if (!Array.isArray(reset[key])) continue;
        const rows = reset[key].filter((item) => ["organizationId", "agencyId", "agencyOrganizationId", "requestingOrganizationId", "requesterOrganizationId", "sourceOrganizationId", "targetOrganizationId", "fromOrganizationId", "toOrganizationId"].some((field) => item[field] === organizationId));
        assert.deepEqual(rows, [], `${key} must have no rows for ${organizationId}`);
        if (Object.hasOwn(foreignBefore, key)) {
          const afterForeign = reset[key].filter((item) => item.organizationId !== organizationId && item.agencyId !== organizationId && item.requestingOrganizationId !== organizationId && item.requesterOrganizationId !== organizationId && item.sourceOrganizationId !== organizationId && item.targetOrganizationId !== organizationId && item.fromOrganizationId !== organizationId && item.toOrganizationId !== organizationId);
          assert.deepEqual(afterForeign, foreignBefore[key], `${key} for other organizations must remain unchanged`);
        }
      }
      assert.ok(reset.factories.some((item) => item.id === "factory-other"));
      assert.ok(reset.worksites.some((item) => item.id === "worksite-shared"), "a worksite shared with another agency must remain");
      assert.equal(reset.worksites.some((item) => item.id === `worksite-only-${organizationId}`), false, "an unshared worksite from the reset agency must be removed");
      assert.equal(reset.worksites.some((item) => item.id === `worksite-request-only-${organizationId}`), false, "a worksite used only by the reset agency's request must be removed");
      assert.ok(reset.members.some((item) => item.id === "leader-other" && item.accountUid === "shared-leader-user"), "another membership of the shared leader account must remain");
      assert.ok(reset.members.some((item) => item.id === "worker-other" && item.accountUid === "shared-worker-user"), "another membership of the shared worker account must remain");
      assert.equal(saved.get("timeax-language"), "pl");
      assert.equal(saved.get("timeax-theme"), "dark");
    }

    const beforeRepeatedReset = saved.get("timeax-demo-workspace-v1");
    const backupsBeforeRepeatedReset = [...saved.keys()].filter((key) => key.startsWith("timeax-demo-workspace-v1-backup-")).length;
    assert.equal(store.resetDemoWorkspace(true), true);
    assert.equal(saved.get("timeax-demo-workspace-v1"), beforeRepeatedReset, "repeating a reset should not change the stored workspace");
    assert.equal([...saved.keys()].filter((key) => key.startsWith("timeax-demo-workspace-v1-backup-")).length, backupsBeforeRepeatedReset, "an idempotent reset should not create another backup");
  } finally {
    delete globalThis.window;
  }
});

test("a non-agency account cannot trigger an agency reset", async () => {
  const workspace = createSeedWorkspace();
  workspace.members.push({ id: "test-worker", organizationId: "org-demo-01", role: "worker", name: "Worker", status: "active" });
  workspace.activeMemberId = "test-worker";
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?non-agency-cannot-reset");
    assert.equal(store.resetDemoWorkspace(true), false);
    assert.ok(JSON.parse(saved.get("timeax-demo-workspace-v1")).members.some((member) => member.id === "test-worker"));
  } finally {
    delete globalThis.window;
  }
});
