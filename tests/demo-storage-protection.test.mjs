import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

test("malformed demo storage is preserved until an explicit reset", async () => {
  const saved = new Map([["timeax-demo-workspace-v1", "{ invalid json"]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    assert.equal(store.isDemoStorageProtected(), true);
    store.setActiveMember("leader-01");
    assert.equal(saved.get("timeax-demo-workspace-v1"), "{ invalid json");
    assert.equal(store.resetDemoWorkspace(false), false);
    assert.equal(saved.get("timeax-demo-workspace-v1"), "{ invalid json");
    assert.equal(store.resetDemoWorkspace(true), true);
    const backups = [...saved.entries()].filter(([key]) => key.startsWith("timeax-demo-workspace-v1-backup-"));
    assert.equal(backups.length, 1);
    assert.equal(backups[0][1], "{ invalid json");
    const workspace = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(workspace.schemaVersion, 8);
    assert.equal(workspace.organizations.length, 3);
    assert.deepEqual(workspace.factories, []);
    assert.deepEqual(workspace.members.map((member) => member.role), ["agency", "agency", "agency"]);
  } finally {
    delete globalThis.window;
  }
});

test("cross-tab updates accept schema 8 and preserve the last valid state on stale updates", async () => {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(createSeedWorkspace())]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?cross-tab-schema-v8");
    store.getActiveMember();
    const current = createSeedWorkspace();
    current.activeMemberId = "agency-demo-b";
    current.organization = current.organizations.find((item) => item.id === "org-demo-02");
    assert.equal(store.applyCrossTabWorkspaceUpdate({ key: "timeax-demo-workspace-v1", newValue: JSON.stringify(current) }), true);
    assert.equal(store.getActiveMember().id, "agency-demo-b");

    const stale = { ...current, schemaVersion: 7, activeMemberId: "agency-demo" };
    assert.equal(store.applyCrossTabWorkspaceUpdate({ key: "timeax-demo-workspace-v1", newValue: JSON.stringify(stale) }), false);
    assert.equal(store.getActiveMember().id, "agency-demo-b", "a stale tab cannot replace the last schema 8 snapshot");
  } finally {
    delete globalThis.window;
  }
});

test("resetting Agencja Demo A clears only its organization and preserves shared sites and other organization data", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.activeMemberId = "agency-demo";
  workspace.worksites.push({ id: "orphan-other-agency", name: "Unlinked partner site" });
  workspace.monthlyTimesheets = [
    { id: "timesheet-demo", organizationId: "org-demo-01", factoryId: "factory-alpha", month: "2026-11", status: "in_progress", currentVersion: 0, versions: [], history: [], updatedAt: new Date().toISOString() },
    { id: "timesheet-partner", organizationId: "org-partner-demo", factoryId: "factory-partner", month: "2026-11", status: "in_progress", currentVersion: 0, versions: [], history: [], updatedAt: new Date().toISOString() },
  ];
  const saved = new Map([
    ["timeax-demo-workspace-v1", JSON.stringify(workspace)],
    ["timeax-language", "pl"],
    ["timeax-theme", "dark"],
  ]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?scoped-reset");
    assert.equal(store.resetDemoWorkspace(true), true);
    const reset = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const targetRows = (key) => reset[key].filter((item) => item.organizationId === "org-demo-01");
    assert.deepEqual(reset.members.filter((member) => member.organizationId === "org-demo-01").map((member) => member.role), ["agency"]);
    for (const key of ["factories", "groups", "folders", "leaderWorkerAccess", "shifts", "templates", "absences", "employmentPeriods", "messageThreads", "schedules", "scheduleAttendanceReviews", "monthlyTimesheets", "changeRequests", "notifications"]) {
      assert.deepEqual(targetRows(key), [], `${key} for Agencja Demo should be removed`);
    }
    assert.ok(reset.organizations.some((organization) => organization.id === "org-demo-01"));
    assert.ok(reset.organizations.some((organization) => organization.id === "org-demo-02"));
    assert.ok(reset.organizations.some((organization) => organization.id === "org-demo-03"));
    assert.ok(reset.members.some((member) => member.id === "agency-demo-b" && member.organizationId === "org-demo-02"));
    assert.ok(reset.members.some((member) => member.id === "agency-demo-c" && member.organizationId === "org-demo-03"));
    assert.equal(reset.factories.some((factory) => factory.organizationId === "org-demo-02"), false);
    assert.ok(reset.factories.some((factory) => factory.organizationId === "org-partner-demo"));
    assert.ok(reset.members.some((member) => member.id === "worker-02-partner"));
    assert.ok(reset.shifts.some((record) => record.organizationId === "org-partner-demo"));
    assert.ok(reset.monthlyTimesheets.some((timesheet) => timesheet.id === "timesheet-partner"));
    assert.equal(reset.worksites.some((site) => site.id === "worksite-beta"), false);
    assert.ok(reset.worksites.some((site) => site.id === "orphan-other-agency"));
    assert.equal(saved.get("timeax-language"), "pl");
    assert.equal(saved.get("timeax-theme"), "dark");
  } finally {
    delete globalThis.window;
  }
});
