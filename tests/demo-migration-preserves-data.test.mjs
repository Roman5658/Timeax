import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

test("opening old saved demo data preserves its agencies, workers, productions and shifts", async () => {
  const oldWorkspace = createSeedWorkspace({ includeFeatureFixtures: true });
  oldWorkspace.schemaVersion = 7;
  oldWorkspace.members.push({ id: "worker-manually-added", organizationId: "org-demo-01", role: "worker", name: "Manually Added Worker", status: "active" });
  oldWorkspace.organizations.push({ id: "org-own-staff", name: "Factory Owned Staff", timezone: "Europe/Warsaw", type: "factory" });
  oldWorkspace.members.push({ id: "factory-worker-former", organizationId: "org-own-staff", role: "worker", name: "Former Factory Worker", status: "away" });
  oldWorkspace.employmentPeriods.push({ id: "employment-factory-worker-former", organizationId: "org-own-staff", workerId: "factory-worker-former", accountUid: "factory-worker-former", state: "ended", startDate: "2026-01-01", endDate: "2026-02-01", createdAt: "2026-01-01T00:00:00.000Z", createdById: "factory-admin", placements: [], history: [] });
  oldWorkspace.members = oldWorkspace.members.map(({ workerCategory: _workerCategory, workerPayerOrganizationId: _workerPayerOrganizationId, ...member }) => member);
  oldWorkspace.employmentPeriods = oldWorkspace.employmentPeriods.map(({ workerCategory: _workerCategory, ...period }) => period);
  const priorFactoryIds = oldWorkspace.factories.map((factory) => factory.id);
  const priorShiftIds = oldWorkspace.shifts.map((record) => record.shift.id);
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(oldWorkspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?legacy-category-migration");
    store.setActiveMember("agency-demo");
    const migrated = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.equal(migrated.schemaVersion, 8, "the latest supported legacy schema is saved forward to version 8");
    assert.ok(migrated.members.some((member) => member.id === "worker-manually-added"));
    assert.deepEqual(migrated.factories.map((factory) => factory.id), priorFactoryIds);
    assert.ok(priorShiftIds.every((id) => migrated.shifts.some((record) => record.shift.id === id)));
    assert.equal(migrated.organizations.length, oldWorkspace.organizations.length + 2);
    assert.ok(oldWorkspace.organizations.every((organization) => migrated.organizations.some((item) => item.id === organization.id)));
    assert.ok(migrated.organizations.some((organization) => organization.id === "org-demo-02"));
    assert.ok(migrated.organizations.some((organization) => organization.id === "org-demo-03"));
    assert.ok(migrated.employmentPeriods.every((period) => period.workerCategory === "agency" || period.workerCategory === "factory"));
    assert.equal(migrated.employmentPeriods.find((period) => period.id === "employment-factory-worker-former")?.workerCategory, "factory");
  } finally {
    delete globalThis.window;
  }
});
