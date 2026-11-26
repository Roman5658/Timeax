import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createExportWorkbook } from "../src/modules/exports/domain/workbook.ts";

const columns = ["worker", "factory", "shiftDate", "shiftNote", "paidTime"].map((key, order) => ({ key, order, enabled: true }));
const columnHeaders = Object.fromEntries(["worker", "agency", "folder", "factory", "shiftDate", "weekday", "startTime", "endTime", "grossDuration", "breaks", "paidTime", "shiftNote", "comment", "confirmation", "absence"].map((key) => [key, key]));
const translate = (key) => key;

function worker(id, name, organizationId = "agency-a", productionAssignments = []) {
  return { id, name, organizationId, role: "worker", status: "away", productionAssignments };
}

function factory(id, name = id) {
  return { id, name, organizationId: "agency-a", inputMode: "A", workerAccess: {}, requiredBreakMinutes: 0, workCalendar: { workingWeekdays: [], exceptions: [] } };
}

function period(id, workerId, startDate, endDate, placements, organizationId = "agency-a") {
  return { id, workerId, organizationId, accountUid: workerId, state: endDate ? "ended" : "active", startDate, endDate, placements: placements.map((placement) => ({ id: `${id}-${placement.factoryId}`, ...placement })), history: [] };
}

function shift(id, workerUid, factoryId, date, employmentId, organizationId = "agency-a") {
  const stamp = (time) => `${date}T${time}:00.000Z`;
  return {
    organizationId,
    history: [],
    previousVersions: [],
    shift: {
      id, workerUid, agencyId: organizationId, factoryId, employmentId, localStartDate: date,
      startAt: stamp("06:00"), endAt: stamp("14:00"), timeZone: "UTC", grossDurationMinutes: 480,
      totalBreakDurationMinutes: 0, unpaidBreakDurationMinutes: 0, paidDurationMinutes: 480,
      actualBreak: { status: "not-reported", segments: [], reviewState: "not-required" },
      breakPolicySnapshot: { appliedRuleIds: [], required: false, allowedTreatments: ["paid", "unpaid"], workerMayEditActualTimes: true, workerMayChooseTreatment: true, noBreakRequiresReview: false, capturedAt: stamp("06:00"), version: 1 },
      source: "worker", createdByUid: workerUid, createdAt: stamp("06:00"), updatedByUid: workerUid, updatedAt: stamp("06:00"),
      revision: 1, workerConfirmation: "confirmed", reviewState: "approved",
    },
  };
}

async function makeWorkbook({ workers, factories, employmentPeriods, shifts, factoryIds, dates }) {
  const buffer = await createExportWorkbook({
    organizationName: "Agency A", workers, factories, folders: [], employmentPeriods, shifts, absences: [],
    factoryIds, dates, columns, dateFormat: "yyyy-MM-dd", timeFormat: "24-hour", language: "en",
    columnHeaders, translate,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  return workbook;
}

test("current export excludes an ended worker's later erroneous shift and omits the empty worker sheet", async () => {
  const former = worker("worker-former", "Former Worker", "agency-a", [{ factoryId: "factory-a" }]);
  const completed = period("employment-former", former.id, "2026-01-01", "2026-03-31", [{ factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-03-31" }]);
  const workbook = await makeWorkbook({
    workers: [former], factories: [factory("factory-a")], employmentPeriods: [completed],
    shifts: [shift("invalid-november-shift", former.id, "factory-a", "2026-11-03", completed.id)],
    factoryIds: ["factory-a"], dates: ["2026-11-03"],
  });
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["monthlyTimesheets.productionTot"]);
});

test("historical export retains a former worker's shift from the completed employment", async () => {
  const former = worker("worker-former", "Former Worker");
  const completed = period("employment-former", former.id, "2026-01-01", "2026-03-31", [{ factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-03-31" }]);
  const workbook = await makeWorkbook({
    workers: [former], factories: [factory("factory-a")], employmentPeriods: [completed],
    shifts: [shift("valid-february-shift", former.id, "factory-a", "2026-02-12", completed.id)],
    factoryIds: ["factory-a"], dates: ["2026-02-12"],
  });
  assert.equal(workbook.worksheets.length, 2);
  assert.equal(workbook.worksheets[1].getColumn(4).values.filter((value) => value === "exports.shiftLabel").length, 1);
  let summaryShiftCount = 0;
  workbook.worksheets[0].eachRow((row) => { if (row.getCell(2).value === "Former Worker") summaryShiftCount = row.getCell(3).value; });
  assert.equal(summaryShiftCount, 1);
});

test("previous-month export keeps employment that was active during that month", async () => {
  const workerRecord = worker("worker-previous", "Previous Month Worker");
  const completed = period("employment-previous", workerRecord.id, "2026-01-01", "2026-10-31", [{ factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-10-31" }]);
  const workbook = await makeWorkbook({
    workers: [workerRecord], factories: [factory("factory-a")], employmentPeriods: [completed],
    shifts: [shift("valid-october-shift", workerRecord.id, "factory-a", "2026-10-15", completed.id)],
    factoryIds: ["factory-a"], dates: ["2026-10-15"],
  });
  assert.equal(workbook.worksheets.length, 2);
  let summaryShiftCount = 0;
  workbook.worksheets[0].eachRow((row) => { if (row.getCell(2).value === "Previous Month Worker") summaryShiftCount = row.getCell(3).value; });
  assert.equal(summaryShiftCount, 1);
});

test("rehire and production transfer exports follow employment and placement dates", async () => {
  const workerRecord = worker("worker-transfer", "Transferred Worker");
  const firstJob = period("employment-first", workerRecord.id, "2026-01-01", "2026-03-31", [
    { factoryId: "factory-a", startDate: "2026-01-01", endDate: "2026-02-15" },
    { factoryId: "factory-b", startDate: "2026-02-16", endDate: "2026-03-31" },
  ]);
  const rehire = period("employment-rehire", workerRecord.id, "2026-06-01", undefined, [{ factoryId: "factory-b", startDate: "2026-06-01" }]);
  const workbook = await makeWorkbook({
    workers: [workerRecord], factories: [factory("factory-a"), factory("factory-b")], employmentPeriods: [firstJob, rehire],
    shifts: [
      shift("before-transfer", workerRecord.id, "factory-a", "2026-02-14", firstJob.id),
      shift("after-transfer-wrong-factory", workerRecord.id, "factory-a", "2026-02-20", firstJob.id),
      shift("after-transfer-right-factory", workerRecord.id, "factory-b", "2026-02-20", firstJob.id),
      shift("after-rehire", workerRecord.id, "factory-b", "2026-07-03", rehire.id),
    ],
    factoryIds: ["factory-a", "factory-b"], dates: ["2026-02-14", "2026-02-20", "2026-07-03"],
  });
  const summary = workbook.worksheets[0];
  const workerRows = [];
  summary.eachRow((row) => { if (row.getCell(2).value === "Transferred Worker") workerRows.push([row.getCell(1).value, row.getCell(3).value]); });
  assert.deepEqual(workerRows, [["factory-a", 1], ["factory-b", 2]]);
  assert.equal(summary.getColumn(1).values.filter((value) => value === "monthlyTimesheets.productionTotal").length, 1);
});

test("duplicate production selection does not duplicate worker totals or production subtotals", async () => {
  const workerRecord = worker("worker-b", "Worker B");
  const current = period("employment-b", workerRecord.id, "2026-01-01", undefined, [{ factoryId: "factory-b", startDate: "2026-01-01" }]);
  const workbook = await makeWorkbook({
    workers: [workerRecord], factories: [factory("factory-b")], employmentPeriods: [current],
    shifts: [shift("b-shift", workerRecord.id, "factory-b", "2026-07-03", current.id)],
    factoryIds: ["factory-b", "factory-b"], dates: ["2026-07-03"],
  });
  const summary = workbook.worksheets[0];
  assert.equal(summary.getColumn(2).values.filter((value) => value === "Worker B").length, 1);
  assert.equal(summary.getColumn(1).values.filter((value) => value === "factory-b · monthlyTimesheets.productionTotal").length, 1);
  assert.equal(summary.getColumn(1).values.filter((value) => value === "monthlyTimesheets.productionTotal").length, 1);
});

test("preview and XLSX share sheets, all calendar rows, typed durations, absences and totals", async () => {
  const { buildExportWorkbook } = await import("../src/modules/exports/domain/workbook.ts");
  const { workbookPreview } = await import("../src/modules/exports/domain/preview.ts");
  const days = Array.from({length:30}, (_,i)=>`2026-11-${String(i+1).padStart(2,"0")}`);
  const a=worker("a","QA A"), b=worker("b","QA B");
  const fa=factory("fa"), fb=factory("fb"); fa.workCalendar.workingWeekdays=[1,2,3,4,5];
  const pa=period("pa","a","2026-11-01",undefined,[{factoryId:"fa",startDate:"2026-11-01"}]);
  const pb=period("pb","b","2026-11-01",undefined,[{factoryId:"fb",startDate:"2026-11-01"}]);
  const selectedColumns=Object.keys(columnHeaders).map((key,order)=>({key,order,enabled:true}));
  const input={organizationName:"QA Agency",workers:[a,b],factories:[fa,fb],folders:[],employmentPeriods:[pa,pb],shifts:[shift("sa","a","fa","2026-11-02","pa"),shift("sb","b","fb","2026-11-03","pb")],absences:[{id:"abs",organizationId:"agency-a",workerId:"a",factoryId:"fa",employmentId:"pa",localDate:"2026-11-04",state:"unreported",agencyCategory:"unreported",agencyNote:"QA absence"}],factoryIds:["fa","fb"],dates:days,columns:selectedColumns,dateFormat:"yyyy-MM-dd",timeFormat:"24-hour",language:"en",columnHeaders,translate};
  const planned=buildExportWorkbook(input); const serialized=await createExportWorkbook(input);
  const loaded=new ExcelJS.Workbook(); await loaded.xlsx.load(Buffer.from(serialized));
  assert.deepEqual(workbookPreview(loaded,"en"),workbookPreview(planned,"en"));
  assert.equal(loaded.worksheets.length,3);
  const detail=loaded.getWorksheet("QA A");
  const dateCol=selectedColumns.findIndex(c=>c.key==="shiftDate")+1;
  const paidCol=selectedColumns.findIndex(c=>c.key==="paidTime")+1;
  const typeCol=selectedColumns.findIndex(c=>c.key==="shiftNote")+1;
  assert.equal(Array.from({length:30},(_,i)=>detail.getCell(i+6,dateCol).value).filter(v=>v instanceof Date).length,30);
  assert.equal(planned.getWorksheet("QA A").getCell(7,paidCol).value,480/1440);
  assert.equal(detail.getCell(7,paidCol).numFmt,"[h]:mm");
  assert.equal(detail.getCell(9,typeCol).value,"exports.absenceLabel");
  assert.ok(workbookPreview(loaded,"en")[1].rows.flat().some(c=>c.text==="exports.notRecorded"));
  const summary=loaded.worksheets[0]; assert.equal(summary.lastRow.getCell(3).value,2); assert.equal(planned.worksheets[0].lastRow.getCell(6).value,960/1440); assert.equal(summary.lastRow.getCell(7).value,1);
});
