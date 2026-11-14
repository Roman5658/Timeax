import test from "node:test";
import assert from "node:assert/strict";
import { placementIsActiveOnDate, workerHasProductionOnDate } from "../src/modules/exports/domain/employment-scope.ts";

const endedPeriod = {
  id: "employment-old",
  organizationId: "agency-a",
  workerId: "worker-a",
  state: "ended",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  placements: [{ factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-03-31" }],
};
const rehiredPeriod = {
  id: "employment-new",
  organizationId: "agency-a",
  workerId: "worker-a",
  state: "active",
  startDate: "2026-06-01",
  placements: [{ factoryId: "factory-b", startDate: "2026-06-01" }],
};

test("former worker records stay out of a current period after employment ended", () => {
  assert.equal(workerHasProductionOnDate([endedPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-a", date: "2026-11-03",
  }), false);
});

test("historical exports include shifts within a completed employment", () => {
  assert.equal(workerHasProductionOnDate([endedPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-a", date: "2026-02-12",
  }), true);
});

test("rehiring is scoped to the new employment and production", () => {
  assert.equal(workerHasProductionOnDate([endedPeriod, rehiredPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-b", date: "2026-07-03", employmentId: "employment-new",
  }), true);
  assert.equal(workerHasProductionOnDate([endedPeriod, rehiredPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-a", date: "2026-07-03", employmentId: "employment-old",
  }), false);
});

test("production transfers use placement dates, even during one employment", () => {
  const transfer = {
    id: "employment-transfer",
    organizationId: "agency-a",
    workerId: "worker-b",
    state: "active",
    startDate: "2026-01-01",
    placements: [
      { factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-02-15" },
      { factoryId: "factory-b", startDate: "2026-02-16" },
    ],
  };
  assert.equal(workerHasProductionOnDate([transfer], {
    organizationId: "agency-a", workerId: "worker-b", factoryId: "factory-a", date: "2026-02-14",
  }), true);
  assert.equal(workerHasProductionOnDate([transfer], {
    organizationId: "agency-a", workerId: "worker-b", factoryId: "factory-a", date: "2026-02-20",
  }), false);
  assert.equal(workerHasProductionOnDate([transfer], {
    organizationId: "agency-a", workerId: "worker-b", factoryId: "factory-b", date: "2026-02-20",
  }), true);
});

test("legacy current assignments are used only when no employment history exists", () => {
  assert.equal(workerHasProductionOnDate([], {
    organizationId: "agency-a", workerId: "worker-c", factoryId: "factory-a", date: "2026-07-03",
  }, ["factory-a"]), true);
  assert.equal(workerHasProductionOnDate([endedPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-a", date: "2026-07-03",
  }, ["factory-a"]), false);
});

test("a missing period produces no record for the requested date", () => {
  assert.equal(workerHasProductionOnDate([endedPeriod], {
    organizationId: "agency-a", workerId: "worker-a", factoryId: "factory-a", date: "2025-12-31",
  }), false);
});
