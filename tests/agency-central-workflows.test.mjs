import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function installStorage(workspace) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = { localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {}, removeEventListener() {} };
  return saved;
}

function readSaved(saved) {
  return JSON.parse(saved.get("timeax-demo-workspace-v1"));
}

test("factory invites an agency into one exact site, then assigns its workers through a reusable department team", async () => {
  const saved = installStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?factory-originated-agency-invite");
    const registration = store.registerFactoryWorkspace({ companyName: "Central Workflows", nip: "7142583690", city: "Warszawa", adminName: "Factory Admin", email: "central-admin@workflows.example.test", worksiteName: "Main plant", address: "Warszawa, Fabryczna 12" });
    assert.equal(registration.kind, "created");

    const invitation = store.createAgencyConnectionInvitation("org-demo-02", registration.worksite.id);
    assert.equal(invitation.kind, "created");
    assert.equal(store.createAgencyConnectionInvitation("org-demo-02", registration.worksite.id).kind, "pending");
    let workspace = readSaved(saved);
    assert.equal(workspace.worksiteConnectionRequests.filter((item) => item.direction === "factory-invitation" && item.organizationId === "org-demo-02").length, 1);
    assert.equal(workspace.agencyWorksites.some((item) => item.organizationId === "org-demo-02" && item.worksiteId === registration.worksite.id && item.state === "active"), false);
    assert.ok(workspace.notifications.some((item) => item.kind === "agency-connection-invited" && item.recipientId === "agency-demo-b" && item.subjectId === invitation.request.id));

    store.setActiveMember("agency-demo-b");
    const matchingRequest = store.requestAgencyWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: registration.worksite.id, productionName: "A different label" });
    assert.equal(matchingRequest.kind, "invited", "the agency can review the exact central/site invitation instead of creating a duplicate request");
    assert.equal(store.resolveAgencyWorksiteInvitation(invitation.request.id, "accept"), true);
    assert.equal(store.resolveAgencyWorksiteInvitation(invitation.request.id, "accept"), false, "an invitation can only be accepted once");
    workspace = readSaved(saved);
    assert.equal(workspace.agencyWorksites.filter((item) => item.organizationId === "org-demo-02" && item.businessEntityId === registration.businessEntity.id && item.worksiteId === registration.worksite.id && item.state === "active").length, 1);
    const agencyFactory = workspace.factories.find((item) => item.organizationId === "org-demo-02" && item.worksiteId === registration.worksite.id);
    assert.ok(agencyFactory);
    store.setActiveMember(registration.admin.id);
    assert.equal(store.createAgencyConnectionInvitation("org-demo-02", registration.worksite.id).kind, "connected");

    store.setActiveMember("agency-demo-b");
    assert.equal(store.setDemoSubscription("agency", "workers-30", true), true);
    const firstWorker = store.createAgencyWorker("Team worker A", "team-a@workflows.example.test");
    const secondWorker = store.createAgencyWorker("Team worker B", "team-b@workflows.example.test");
    assert.ok(firstWorker && secondWorker);
    assert.equal(store.hireWorker(firstWorker.id, agencyFactory.id, undefined, today()), true);
    assert.equal(store.hireWorker(secondWorker.id, agencyFactory.id, undefined, today()), true);

    store.setActiveMember(registration.admin.id);
    const department = store.createBusinessDepartment(registration.worksite.id, "Assembly");
    assert.ok(department);
    const leaderInvitation = store.createBusinessLeaderInvitation(registration.worksite.id, {
      name: "Assembly Manager",
      email: "assembly-manager@workflows.example.test",
      organizationIds: ["org-demo-02"],
      departmentIds: [department.id],
      permissions: { canViewWorkers: true, canRecordHours: true, canReviewShifts: true, canConfirmShifts: true, canSubmitTimesheet: true, canManageGroups: true },
    });
    assert.ok(leaderInvitation);
    const leader = store.registerLeaderFromInvitation(leaderInvitation.invitation.token, { name: "Assembly Manager", email: "assembly-manager@workflows.example.test" });
    assert.ok(leader);
    store.setActiveMember(registration.admin.id);
    const assigned = { worksiteId: registration.worksite.id, workerIds: [firstWorker.id, secondWorker.id], name: "Assembly team", departmentId: department.id, leaderAccountUid: leader.accountUid };
    assert.equal(store.createBusinessGroupForWorkers(assigned), true);

    workspace = readSaved(saved);
    const group = workspace.groups.find((item) => item.name === "Assembly team" && item.organizationId === "org-demo-02" && item.factoryId === agencyFactory.id);
    assert.ok(group);
    const placements = workspace.employmentPeriods.filter((period) => [firstWorker.id, secondWorker.id].includes(period.workerId) && period.state === "active").map((period) => period.placements.find((item) => item.factoryId === agencyFactory.id && !item.endDate));
    assert.equal(placements.length, 2);
    assert.ok(placements.every((item) => item.departmentId === department.id && item.groupId === group.id && item.leaderAccountUid === leader.accountUid));
    assert.ok(workspace.members.some((item) => item.role === "leader" && item.organizationId === "org-demo-02" && item.accountUid === leader.accountUid && item.factoryId === agencyFactory.id));
    const assignmentNotices = workspace.notifications.filter((item) => item.kind === "worksite-worker-assigned").length;

    assert.equal(store.createBusinessGroupForWorkers(assigned), true);
    workspace = readSaved(saved);
    assert.equal(workspace.groups.filter((item) => item.name === "Assembly team" && item.organizationId === "org-demo-02" && item.factoryId === agencyFactory.id).length, 1);
    assert.equal(workspace.notifications.filter((item) => item.kind === "worksite-worker-assigned").length, assignmentNotices, "reopening the same assignment does not create duplicate notices");

    store.setActiveMember(registration.admin.id);
    const secondSite = store.createBusinessWorksite({ name: "Second plant", address: "Warszawa, Fabryczna 99" });
    assert.ok(secondSite);
    store.setActiveMember("agency-demo-b");
    const request = store.requestAgencyWorksiteConnection({ businessEntityId: registration.businessEntity.id, worksiteId: secondSite.id, productionName: "Second line" });
    assert.equal(request.kind, "request");
    store.setActiveMember(registration.admin.id);
    assert.equal(store.createAgencyConnectionInvitation("org-demo-02", secondSite.id).kind, "requested", "an agency request for the same exact site is not duplicated by an invitation");
    assert.equal(readSaved(saved).agencyWorksites.some((item) => item.organizationId === "org-demo-02" && item.worksiteId === secondSite.id && item.state === "active"), false);
  } finally {
    delete globalThis.window;
  }
});
