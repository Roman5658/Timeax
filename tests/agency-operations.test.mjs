import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorkspace } from "../src/modules/workflows/demo-data.ts";
import { buildMonthlyTimesheetSnapshot } from "../src/modules/monthly-timesheets/domain/timesheet.ts";

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + count);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function installStorage(workspace = createSeedWorkspace()) {
  const saved = new Map([["timeax-demo-workspace-v1", JSON.stringify(workspace)]]);
  globalThis.window = {
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    addEventListener() {}, removeEventListener() {},
  };
  return saved;
}

function readSaved(saved) {
  return JSON.parse(saved.get("timeax-demo-workspace-v1"));
}

test("agency worker profile edits stay within the agency and preserve the shared account and employment history", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  workspace.members.find((member) => member.id === "worker-03").email = "worker-03@timeax.example.test";
  const saved = installStorage(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?agency-worker-profile-edits");
    store.setActiveMember("agency-demo");
    const before = readSaved(saved);
    const accountUid = before.members.find((member) => member.id === "worker-02").accountUid;
    const partnerBefore = before.members.find((member) => member.id === "worker-02-partner");
    const periodsBefore = before.employmentPeriods;

    assert.equal(store.updateAgencyWorker("worker-02", { name: "Piotr Updated", email: "piotr-updated@timeax.example.test", phone: "+48 555 010 020" }), true);
    let after = readSaved(saved);
    assert.deepEqual(
      (({ name, email, phone, accountUid: uid }) => ({ name, email, phone, accountUid: uid }))(after.members.find((member) => member.id === "worker-02")),
      { name: "Piotr Updated", email: "piotr-updated@timeax.example.test", phone: "+48 555 010 020", accountUid },
    );
    assert.deepEqual(after.members.find((member) => member.id === "worker-02-partner"), partnerBefore);
    assert.deepEqual(after.employmentPeriods, periodsBefore);

    assert.equal(store.updateAgencyWorker("worker-02", { name: "Piotr Updated", email: "not-an-email" }), false);
    assert.equal(store.updateAgencyWorker("worker-02", { name: "Piotr Updated", email: "worker-03@timeax.example.test" }), false);
    store.setActiveMember("agency-demo-b");
    assert.equal(store.updateAgencyWorker("worker-02", { name: "Cross agency edit" }), false);
    after = readSaved(saved);
    assert.equal(after.members.find((member) => member.id === "worker-02").name, "Piotr Updated");
    assert.deepEqual(after.members.find((member) => member.id === "worker-02-partner"), partnerBefore);
  } finally {
    delete globalThis.window;
  }
});

test("agency worker invitations use a code or link, await approval, reuse the global worker account, and defer billing until hire", async () => {
  const workspace = createSeedWorkspace({ includeFeatureFixtures: true });
  const existingAccount = workspace.members.find((member) => member.id === "worker-02");
  existingAccount.email = "existing-worker@timeax.example.test";
  workspace.members.find((member) => member.id === "worker-02-partner").email = existingAccount.email;
  const saved = installStorage(workspace);
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?agency-worker-invitations");
    store.setActiveMember("agency-c");
    const organizationId = "org-independent-factory-demo";
    const usedBefore = store.getPayerSubscriptionSummary("agency", organizationId).usedWorkers;
    const employmentCountBefore = readSaved(saved).employmentPeriods.filter((period) => period.organizationId === organizationId).length;
    const invitation = store.createAgencyWorkerInvitation();
    assert.ok(invitation);
    const secondInvitation = store.createAgencyWorkerInvitation();
    assert.ok(secondInvitation);
    assert.notEqual(invitation.code, secondInvitation.code);
    const link = store.getWorkerInvitationUrl(invitation.code, "http://timeax.example.test");
    assert.match(link, /\/register\/worker\?invitation=/);
    const linkedCode = new URL(link).searchParams.get("invitation");
    assert.equal(store.getWorkerInvitationByCode(linkedCode.toLowerCase()).id, invitation.id);

    assert.equal(store.registerWorkerJoinRequest(linkedCode, { name: "Piotr Malinowski", email: "EXISTING-WORKER@TIMEAX.EXAMPLE.TEST" }), true);
    let after = readSaved(saved);
    const pending = after.workerInvitations.find((item) => item.id === invitation.id);
    assert.equal(pending.state, "awaiting-approval");
    assert.equal(pending.accountUid, existingAccount.accountUid);
    assert.equal(after.members.filter((member) => member.accountUid === existingAccount.accountUid).length, 2, "registration does not add an agency membership before approval");
    assert.equal(after.employmentPeriods.filter((period) => period.organizationId === organizationId).length, employmentCountBefore);
    assert.equal(store.getPayerSubscriptionSummary("agency", organizationId).usedWorkers, usedBefore);
    assert.ok(after.notifications.some((notice) => notice.kind === "agency-worker-join-requested" && notice.subjectId === invitation.id));

    const approvedWorker = store.approveAgencyWorkerJoinRequest(invitation.id);
    assert.equal(approvedWorker.accountUid, existingAccount.accountUid);
    assert.equal(approvedWorker.workerCategory, "agency");
    assert.equal(store.approveAgencyWorkerJoinRequest(invitation.id), undefined, "approval is one-time");
    after = readSaved(saved);
    assert.equal(after.members.filter((member) => member.accountUid === existingAccount.accountUid).length, 3, "approval adds a scoped membership without duplicating the global account");
    assert.equal(after.employmentPeriods.filter((period) => period.organizationId === organizationId && period.workerId === approvedWorker.id).length, 0, "approval does not create employment");
    assert.equal(store.getPayerSubscriptionSummary("agency", organizationId).usedWorkers, usedBefore);
    assert.equal(store.hireWorker(approvedWorker.id, "factory-gamma", undefined, today()), true);
    assert.equal(store.getPayerSubscriptionSummary("agency", organizationId).usedWorkers, usedBefore + 1);

    assert.equal(store.registerWorkerJoinRequest(secondInvitation.code, { name: "Declined Worker", email: "declined@timeax.example.test" }), true);
    assert.equal(store.declineAgencyWorkerJoinRequest(secondInvitation.id, "No open position"), true);
    assert.equal(readSaved(saved).workerInvitations.find((item) => item.id === secondInvitation.id).state, "declined");
    const revoked = store.createAgencyWorkerInvitation();
    assert.ok(revoked);
    assert.equal(store.revokeAgencyWorkerInvitation(revoked.id), true);
    assert.equal(store.registerWorkerJoinRequest(revoked.code, { name: "Revoked Worker", email: "revoked@timeax.example.test" }), false);
  } finally {
    delete globalThis.window;
  }
});

test("agency cannot create, edit, cancel, or review a leader's planned schedule", async () => {
  const saved = installStorage(createSeedWorkspace({ includeFeatureFixtures: true }));
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?agency-schedule-readonly");
    const startDate = addDays(today(), 1);
    const weekday = new Date(`${startDate}T12:00:00`).getDay();
    store.setActiveMember("leader-01");
    assert.equal(store.createSchedule({ factoryId: "factory-alpha", workerIds: ["worker-01"], startDate, endDate: addDays(startDate, 6), weekdays: [weekday], startTime: "07:00", endTime: "15:00" }), true);
    let after = readSaved(saved);
    const scheduled = after.schedules[0];
    const beforeIds = after.schedules.map((item) => item.id);
    store.setActiveMember("agency-demo");
    assert.equal(store.getScheduleOccurrences(scheduled, startDate, startDate).length, 1, "the existing plan remains readable for the agency");
    assert.equal(store.createSchedule({ factoryId: "factory-alpha", workerIds: ["worker-01"], startDate, endDate: startDate, weekdays: [1], startTime: "08:00", endTime: "16:00" }), false);
    assert.equal(store.updateSchedule(scheduled.id, { startDate, endDate: addDays(startDate, 7), weekdays: [1], startTime: "08:00", endTime: "16:00" }), false);
    assert.equal(store.cancelSchedule(scheduled.id), false);
    assert.equal(store.recordScheduleOutcome(scheduled.id, "worker-01", startDate, "worked"), false);
    after = readSaved(saved);
    assert.deepEqual(after.schedules.map((item) => item.id), beforeIds);
    assert.equal(after.schedules[0].state, "active");
    assert.equal(after.schedules[0].history.length, scheduled.history.length);
  } finally {
    delete globalThis.window;
  }
});

test("agency messages support selected workers, production groups, and direct managers without duplicate recipients", async () => {
  const saved = installStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?agency-message-audiences");
    store.setActiveMember("agency-demo");
    const workplace = store.createAgencyWorkplace({ worksiteName: "Agency Worksite", address: "Gdańsk, Testowa 1", productionName: "Packing" });
    const worker = store.createAgencyWorker("Agency Worker", "message-worker@timeax.example.test");
    const otherWorker = store.createAgencyWorker("Another Worker", "another-worker@timeax.example.test");
    assert.ok(workplace && worker && otherWorker);
    assert.equal(store.hireWorker(worker.id, workplace.factory.id, undefined, today()), true);
    const leader = store.createProductionLeader(workplace.factory.id, "Agency Manager", false, "manager@timeax.example.test");
    assert.ok(leader);

    assert.equal(store.createAgencyMessage({ audience: "workers", workerIds: [worker.id, worker.id], factoryId: workplace.factory.id, subject: "Selected workers", text: "Daily update" }), true);
    let after = readSaved(saved);
    const selectedThread = after.messageThreads.find((thread) => thread.subject === "Selected workers");
    assert.equal(after.messageThreads.filter((thread) => thread.subject === "Selected workers").length, 1);
    assert.deepEqual(selectedThread.participants.sort(), ["agency-demo", worker.id].sort());

    store.setActiveMember(leader.id);
    assert.equal(store.createGroup(workplace.factory.id, "Packing Team"), true);
    const group = readSaved(saved).groups.find((item) => item.factoryId === workplace.factory.id && item.name === "Packing Team");
    assert.equal(store.assignWorkerToGroup(worker.id, group.id), true);
    store.setActiveMember("agency-demo");
    assert.equal(store.createAgencyMessage({ audience: "group", factoryId: workplace.factory.id, groupId: group.id, subject: "Group update", text: "Group message" }), true);
    assert.equal(store.createAgencyMessage({ audience: "production", factoryId: workplace.factory.id, subject: "Production update", text: "All production workers" }), true);
    assert.equal(store.createAgencyMessage({ audience: "leader", factoryId: workplace.factory.id, leaderId: leader.id, subject: "Manager update", text: "First message" }), true);

    after = readSaved(saved);
    assert.equal(after.messageThreads.filter((thread) => thread.subject === "Group update").length, 1);
    assert.equal(after.messageThreads.filter((thread) => thread.subject === "Production update").length, 1);
    const managerThread = after.messageThreads.find((thread) => thread.subject === "Manager update");
    assert.ok(managerThread);
    assert.equal(managerThread.workerId, undefined);
    assert.deepEqual(managerThread.participants.sort(), ["agency-demo", leader.id].sort());

    store.setActiveMember(worker.id);
    assert.equal(store.replyToMessage(selectedThread.id, "Seen"), true);
    assert.equal(store.replyToMessage(managerThread.id, "This is private to the manager"), false);
    store.setActiveMember(otherWorker.id);
    assert.equal(store.replyToMessage(selectedThread.id, "Not my conversation"), false);
    store.setActiveMember(leader.id);
    assert.equal(store.replyToMessage(managerThread.id, "Thanks"), true);
    after = readSaved(saved);
    assert.equal(after.messageThreads.find((thread) => thread.id === managerThread.id).messages.length, 2);
  } finally {
    delete globalThis.window;
  }
});

test("pending absences do not block timesheets, factual conflicts require cancellation, and revisions preserve history", async () => {
  const saved = installStorage(createSeedWorkspace());
  try {
    const store = await import("../src/modules/workflows/demo-store.ts?agency-absence-review");
    store.setActiveMember("agency-demo");
    const workplace = store.createAgencyWorkplace({ worksiteName: "Absence Worksite", address: "Gdańsk, Testowa 8", productionName: "Assembly" });
    const worker = store.createAgencyWorker("Absence Worker", "absence-worker@timeax.example.test");
    assert.ok(workplace && worker);
    assert.equal(store.hireWorker(worker.id, workplace.factory.id, undefined, today()), true);
    const workerId = worker.id;
    const factoryId = workplace.factory.id;
    const date = today();

    store.setActiveMember(workerId);
    assert.equal(store.createWorkerShift({ localDate: date, startTime: "07:00", endTime: "15:00", comment: "Reported hours", breakStatus: "not-reported", breakTreatment: "unpaid" }), "created");
    assert.equal(store.reportAbsence(date, "illness", "Not feeling well", factoryId), true);
    let after = readSaved(saved);
    const absence = after.absences.find((item) => item.workerId === workerId && item.localDate === date);
    assert.ok(absence);
    assert.equal(after.notifications.some((notice) => notice.recipientId === "agency-demo" && notice.kind === "absence-reported" && notice.subjectId === absence.id), true);

    store.setActiveMember("agency-demo");
    assert.deepEqual(store.getAgencyAbsenceConflictingShifts(absence.id).map((record) => record.shift.localStartDate), [date]);
    assert.equal(store.reviewAgencyAbsence(absence.id, "confirm"), false, "an absence cannot silently replace recorded hours");
    assert.equal(store.reviewAgencyAbsence(absence.id, "reject"), false, "a rejection must include a reason");
    assert.equal(store.submitMonthlyTimesheet(factoryId, date.slice(0, 7), true, "org-demo-01"), true, "a pending report does not block a timesheet with factual hours");
    after = readSaved(saved);
    const firstTimesheet = after.monthlyTimesheets.find((item) => item.factoryId === factoryId && item.month === date.slice(0, 7));
    assert.equal(firstTimesheet.currentVersion, 1);
    assert.equal(firstTimesheet.versions[0].rows.filter((row) => row.kind === "absence").length, 0, "unreviewed absence stays out of payroll rows");

    const shift = after.shifts.find((record) => record.shift.workerUid === workerId && record.shift.localStartDate === date);
    assert.equal(store.cancelShift(shift.shift.id, "The hours were entered by mistake"), true);
    assert.equal(store.reviewAgencyAbsence(absence.id, "confirm"), true);
    after = readSaved(saved);
    const reviewedAbsence = after.absences.find((item) => item.id === absence.id);
    assert.equal(reviewedAbsence.state, "reviewed");
    assert.equal(reviewedAbsence.agencyCategory, "confirmed-no-hours");
    assert.equal(reviewedAbsence.history.at(-1).actorId, "agency-demo");
    assert.equal(after.monthlyTimesheets.find((item) => item.id === firstTimesheet.id).status, "reopened");

    const snapshot = buildMonthlyTimesheetSnapshot({ ...after, organization: after.organizations.find((item) => item.id === "org-demo-01") }, factoryId, date.slice(0, 7), "agency");
    assert.equal(snapshot.rows.some((row) => row.kind === "shift" && row.recordId === shift.shift.id), false, "cancelled time is excluded");
    const absenceRow = snapshot.rows.find((row) => row.kind === "absence" && row.recordId === absence.id);
    assert.ok(absenceRow);
    assert.equal(absenceRow.paidDurationMinutes, 0);
    assert.equal(snapshot.totals.paidDurationMinutes, 0);
    assert.equal(store.submitMonthlyTimesheet(factoryId, date.slice(0, 7), true, "org-demo-01"), true);
    after = readSaved(saved);
    const secondTimesheet = after.monthlyTimesheets.find((item) => item.id === firstTimesheet.id);
    assert.equal(secondTimesheet.currentVersion, 2);
    assert.deepEqual(secondTimesheet.versions.map((version) => version.number), [1, 2]);
    assert.equal(secondTimesheet.versions[1].rows.some((row) => row.kind === "absence" && row.recordId === absence.id), true);
    assert.equal(secondTimesheet.versions[0].rows.some((row) => row.kind === "shift" && row.recordId === shift.shift.id), true, "the original submitted version remains unchanged");

    store.setActiveMember(workerId);
    assert.equal(store.reportAbsence(addDays(date, 1), "personal", "Need a day off", factoryId), true);
    after = readSaved(saved);
    const nextAbsence = after.absences.find((item) => item.workerId === workerId && item.localDate === addDays(date, 1));
    store.setActiveMember("agency-demo");
    assert.equal(store.reviewAgencyAbsence(nextAbsence.id, "reject", "Please provide supporting details"), true);
    store.setActiveMember(workerId);
    assert.equal(store.editOwnAbsenceReport(nextAbsence.id, addDays(date, 2), "personal", "Updated request"), true);
    assert.equal(store.cancelOwnAbsenceReport(nextAbsence.id, "Plans changed"), true);
    after = readSaved(saved);
    const cancelled = after.absences.find((item) => item.id === nextAbsence.id);
    assert.equal(cancelled.state, "cancelled");
    assert.deepEqual(cancelled.history.map((entry) => entry.action), ["reported", "rejected", "edited", "cancelled"]);
    assert.equal(cancelled.history[1].actorId, "agency-demo");
    assert.equal(cancelled.history[1].note, "Please provide supporting details");
    assert.equal(cancelled.history[2].before.localDate, addDays(date, 1));
    assert.equal(cancelled.history[2].after.localDate, addDays(date, 2));
    assert.equal(cancelled.history[3].actorId, workerId);
  } finally {
    delete globalThis.window;
  }
});
