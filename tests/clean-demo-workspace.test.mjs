import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("the default demo workspace starts with three independent agency accounts and no operational records", () => {
  const workspace = createSeedWorkspace();
  assert.equal(workspace.organizations.length, 3);
  assert.equal(workspace.organization.name, "Agencja Demo A");
  assert.deepEqual(workspace.organizations.map((item) => item.name), ["Agencja Demo A", "Agencja Demo B", "Agencja Demo C"]);
  assert.equal(workspace.members.length, 3);
  assert.equal(workspace.members[0].id, "agency-demo");
  assert.equal(workspace.members[0].role, "agency");
  assert.equal(workspace.members[0].organizationId, "org-demo-01");
  assert.equal(workspace.members[0].accountUid, "account-agency-demo-a");
  assert.equal(workspace.members[1].id, "agency-demo-b");
  assert.equal(workspace.members[1].role, "agency");
  assert.equal(workspace.members[1].organizationId, "org-demo-02");
  assert.equal(workspace.members[1].accountUid, "account-agency-demo-b");
  assert.equal(workspace.members[2].id, "agency-demo-c");
  assert.equal(workspace.members[2].role, "agency");
  assert.equal(workspace.members[2].organizationId, "org-demo-03");
  assert.equal(workspace.members[2].accountUid, "account-agency-demo-c");
  assert.equal(new Set(workspace.members.map((member) => member.accountUid)).size, 3);
  assert.equal(new Set(workspace.members.map((member) => member.organizationId)).size, 3);
  assert.equal(new Set(workspace.members.map((member) => member.id)).size, 3);
  assert.equal(workspace.activeMemberId, "agency-demo");
  for (const collection of ["worksites", "factories", "groups", "folders", "shifts", "templates", "absences", "employmentPeriods", "messageThreads", "schedules", "scheduleAttendanceReviews", "monthlyTimesheets", "changeRequests", "notifications"]) {
    assert.deepEqual(workspace[collection], [], `${collection} should start empty`);
  }
});

test("an existing saved agency keeps its data while the other empty demo agencies are added", async () => {
  const savedWorkspace = createSeedWorkspace();
  savedWorkspace.organizations = [savedWorkspace.organization];
  savedWorkspace.members = [savedWorkspace.members[0], { id: "saved-worker", organizationId: "org-demo-01", role: "worker", name: "Existing Worker", status: "active" }];
  savedWorkspace.shifts = [{ organizationId: "org-demo-01", shift: { id: "saved-shift", workerUid: "saved-worker" } }];
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(savedWorkspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?second-agency-merge");
    store.setActiveMember("agency-demo-b");
    const activeMember = store.getActiveMember();
    assert.deepEqual({ id: activeMember.id, organizationId: activeMember.organizationId, role: activeMember.role }, { id: "agency-demo-b", organizationId: "org-demo-02", role: "agency" });
    const persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.ok(persisted.organizations.some((item) => item.id === "org-demo-01"));
    assert.ok(persisted.organizations.some((item) => item.id === "org-demo-02"));
    assert.ok(persisted.organizations.some((item) => item.id === "org-demo-03"));
    assert.deepEqual(persisted.organizations.filter((item) => ["org-demo-01", "org-demo-02", "org-demo-03"].includes(item.id)).map((item) => item.name), ["Agencja Demo A", "Agencja Demo B", "Agencja Demo C"]);
    assert.ok(persisted.members.some((item) => item.id === "saved-worker" && item.organizationId === "org-demo-01"));
    assert.ok(persisted.members.some((item) => item.id === "agency-demo-c" && item.organizationId === "org-demo-03" && item.accountUid === "account-agency-demo-c"));
    assert.ok(persisted.shifts.some((item) => item.shift.id === "saved-shift" && item.organizationId === "org-demo-01"));
    assert.equal(persisted.activeMemberId, "agency-demo-b");
    for (const collection of ["factories", "groups", "folders", "shifts", "templates", "absences", "employmentPeriods", "messageThreads", "schedules", "scheduleAttendanceReviews", "monthlyTimesheets", "changeRequests", "notifications"]) {
      assert.equal(persisted[collection].some((item) => item.organizationId === "org-demo-02"), false, `${collection} should not be pre-created for agency B`);
    }
  } finally {
    delete globalThis.window;
  }
});

test("an agency invite creates one factory account, then the agency hires its own worker and assigns a shared leader", async () => {
  const saved = new Map();
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  try {
    const store = await import("../src/modules/workflows/demo-store.ts");
    store.setActiveMember("agency-demo");
    const invite = store.startAgencyWorksiteAccess({ companyName: "Zakład Testowy Sp. z o.o.", nip: "1234567890", email: "representative@test-factory.example", city: "Warszawa", worksiteName: "Warszawa", address: "Warszawa, Testowa 1", productionName: "Pakowanie" });
    assert.equal(invite.kind, "invitation");
    assert.match(invite.url, /\/factory\/register\?invitation=/);
    const factoryAdmin = store.registerFactoryFromInvitation(invite.invitation.token, { name: "Anna Admin", email: "admin@example.test" });
    assert.equal(factoryAdmin.role, "factory-admin");
    assert.equal(store.registerFactoryFromInvitation(invite.invitation.token, { name: "Second Admin" }), undefined, "invitation is single use");
    const registered = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const acceptedInvitation = registered.factoryInvitations.find((item) => item.id === invite.invitation.id);
    const connectionRequest = registered.worksiteConnectionRequests.find((item) => item.invitationId === invite.invitation.id);
    assert.equal(connectionRequest.state, "pending");
    assert.equal(registered.agencyWorksites.length, 0, "the invitation does not activate the agency connection on registration");
    store.setActiveMember(factoryAdmin.id);
    assert.equal(store.resolveWorksiteConnectionRequest(connectionRequest.id, "approve"), true);
    const afterApproval = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    const factory = registered.factories.find((item) => item.organizationId === "org-demo-01" && item.worksiteId === acceptedInvitation.acceptedWorksiteId);
    assert.equal(factory, undefined, "registration alone has not created an active agency production");
    const connectedFactory = afterApproval.factories.find((item) => item.organizationId === "org-demo-01" && item.worksiteId === acceptedInvitation.acceptedWorksiteId);
    assert.ok(connectedFactory);
    assert.equal(afterApproval.businessEntities.length, 1);
    assert.equal(afterApproval.agencyWorksites.length, 1);
    assert.equal(store.createProduction("Unauthorized duplicate", "Warszawa"), undefined, "a factory administrator does not create an agency production");
    store.setActiveMember("agency-demo");
    const worker = store.createAgencyWorker("Pracownik Testowy", "worker@example.test");
    assert.ok(worker);
    assert.equal(store.hireWorker(worker.id, connectedFactory.id, undefined, today()), true);
    store.setActiveMember(factoryAdmin.id);
    const leaderInvite = store.createBusinessLeaderInvitation(acceptedInvitation.acceptedWorksiteId, { name: "Kierownik Testowy", email: "leader@example.test", organizationIds: ["org-demo-01"] });
    assert.ok(leaderInvite);
    assert.match(leaderInvite.url, /\/leader\/register\?invitation=/);
    const leader = store.registerLeaderFromInvitation(leaderInvite.invitation.token, { name: "Kierownik Testowy", email: "leader@example.test" });
    assert.ok(leader);
    store.setActiveMember(factoryAdmin.id);
    const globalLeader = JSON.parse(saved.get("timeax-demo-workspace-v1")).leaderWorksiteMemberships[0];
    assert.equal(store.assignBusinessWorkerToTeam({ worksiteId: acceptedInvitation.acceptedWorksiteId, workerId: worker.id, leaderAccountUid: globalLeader.accountUid }), true);

    const persisted = JSON.parse(saved.get("timeax-demo-workspace-v1"));
    assert.ok(persisted.factories.some((item) => item.id === connectedFactory.id));
    assert.ok(persisted.members.some((item) => item.id === worker.id && item.role === "worker"));
    assert.ok(persisted.employmentPeriods.some((item) => item.workerId === worker.id && item.placements.some((placement) => placement.factoryId === connectedFactory.id)));
    assert.ok(persisted.leaderWorksiteMemberships.some((item) => item.id === globalLeader.id && item.worksiteId === acceptedInvitation.acceptedWorksiteId));
    assert.ok(persisted.members.some((item) => item.role === "leader" && item.factoryId === connectedFactory.id && item.accountUid === globalLeader.accountUid));
  } finally {
    delete globalThis.window;
  }
});
