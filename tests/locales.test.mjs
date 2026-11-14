import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dateLocale } from "../src/shared/date-locale.ts";

const localeDirectory = new URL("../src/i18n/locales/", import.meta.url);
const languages = ["pl", "uk", "ru", "en"];

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? flatten(child, path) : [[path, child]];
  });
}

function placeholders(value) {
  return [...String(value).matchAll(/{{\s*([^}\s]+)\s*}}/g)].map((match) => match[1]).sort();
}

test("all four locale files contain matching keys and interpolation placeholders", () => {
  const locales = Object.fromEntries(languages.map((language) => [
    language,
    new Map(flatten(JSON.parse(readFileSync(new URL(`${language}.json`, localeDirectory), "utf8")))),
  ]));
  const reference = locales.pl;

  for (const language of languages) {
    const locale = locales[language];
    assert.deepEqual([...locale.keys()].sort(), [...reference.keys()].sort(), `${language} locale keys differ from Polish`);
    for (const [key, value] of reference) {
      assert.deepEqual(placeholders(locale.get(key)), placeholders(value), `${language}:${key} has different interpolation placeholders`);
      assert.equal(typeof locale.get(key), "string", `${language}:${key} is not a string`);
      assert.ok(locale.get(key).trim().length > 0, `${language}:${key} is empty`);
    }
  }
});

test("English is enabled and language changes are wired to localStorage persistence and restore", () => {
  const i18nSource = readFileSync(new URL("../src/i18n/index.ts", import.meta.url), "utf8");
  const switcherSource = readFileSync(new URL("../src/components/LanguageSwitcher.tsx", import.meta.url), "utf8");
  assert.match(i18nSource, /languageCodes\s*=\s*\["pl",\s*"uk",\s*"ru",\s*"en"\]/);
  assert.match(switcherSource, /code:\s*"en",\s*nativeName:\s*"English"/);
  assert.match(switcherSource, /changeLanguage\(event\.target\.value\)/);
  assert.match(i18nSource, /on\("languageChanged"/);
  assert.match(i18nSource, /localStorage\.setItem\("timeax-language",\s*normalized\)/);
  assert.match(i18nSource, /localStorage\.getItem\("timeax-language"\)/);
  assert.match(i18nSource, /normalizeLanguage\(saved\)/);
  assert.match(i18nSource, /document\.documentElement\.lang\s*=\s*getInitialLanguage\(\)/);
});

test("date and time formatters follow Polish, Ukrainian, Russian, and English", () => {
  const month = new Date("2026-11-01T12:00:00");
  const expectedMonths = [
    ["pl", "listopad 2026"],
    ["uk", "листопад 2026 р."],
    ["ru", "ноябрь 2026 г."],
    ["en", "November 2026"],
  ];
  for (const [language, expected] of expectedMonths) {
    const locale = dateLocale(language);
    assert.equal(new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month), expected, `${language} date formatting`);
    assert.match(new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(month), /^\d{2}:\d{2}$/, `${language} time formatting`);
  }
});

test("every statically referenced translation key exists in every locale", () => {
  const locales = Object.fromEntries(languages.map((language) => [
    language,
    new Set(flatten(JSON.parse(readFileSync(new URL(`${language}.json`, localeDirectory), "utf8"))).map(([key]) => key)),
  ]));
  const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const sourceFiles = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !path.includes(`${join("src", "i18n")}`)) sourceFiles.push(path);
    }
  }
  collect(sourceRoot);
  const missing = [];
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:\bt|\bi18n\.t)\(\s*["']([^"']+)["']/g)) {
      const key = match[1];
      if (key.endsWith(".")) continue;
      for (const language of languages) if (!locales[language].has(key)) missing.push(`${language}:${key} (${file})`);
    }
  }
  assert.deepEqual(missing, []);
});

test("all keys used for role, status, mode, date, schedule, and template variants are translated", () => {
  const locales = Object.fromEntries(languages.map((language) => [
    language,
    new Set(flatten(JSON.parse(readFileSync(new URL(`${language}.json`, localeDirectory), "utf8"))).map(([key]) => key)),
  ]));
  const dynamicKeyParts = {
    "nav.": ["workerHome", "agencyHome", "factoryHome", "leaderHome", "adminHome"],
    "auth.": ["worker", "agency", "workerDescription", "agencyDescription", "registrationTitleWorker", "registrationTitleAgency", "registrationLeadWorker", "registrationLeadAgency"],
    "workflow.agency.modeName.": ["A", "B", "C"],
    "workflow.production.access": ["Active", "Suspended", "Revoked"],
    "workflow.absence.state.": ["reported", "reviewed", "rejected", "cancelled", "unreported", "clarification-requested"],
    "workflow.absence.reasons.": ["illness", "family", "personal", "other", "day-off", "vacation"],
    "workflow.absence.agencyCategory.": ["confirmed-no-hours", "urlop-na-zadanie", "unreported", "attention"],
    "workflow.absence.decisions.": ["confirmed-no-hours", "urlop-na-zadanie", "send-agency", "unreported"],
    "workflow.absence.historyAction.": ["reported", "reviewed", "edited", "cancelled", "rejected", "recorded", "marked-unreported", "confirmed-no-hours", "urlop-na-zadanie", "agency-notified", "clarification-requested", "clarification-replied"],
    "workflow.shiftStatus.": ["not-required", "pending", "confirmed", "disputed"],
    "workflow.role.": ["worker", "leader", "agency"],
    "workflow.shiftConflicts.": ["duplicate", "overlap", "confirmDuplicate", "confirmOverlap"],
    "workflow.employment.status.": ["active", "ended"],
    "workflow.employment.event.": ["hired", "rehired", "transferred", "leader-changed", "group-changed", "placement-added", "placement-ended", "ended"],
    "workflow.history.action.": ["created", "edited", "reviewed", "returned", "organization-edited", "confirmed", "leader-confirmed", "disputed", "corrected", "declined", "cancelled", "break-reported", "break-reviewed", "break-returned", "change-requested", "change-request-approved", "change-request-declined"],
    "workflow.notifications.": ["shift-pending", "shift-confirmed", "shift-disputed", "shift-answer", "shift-updated", "shift-cancelled", "break-review-updated", "absence-reported", "absence-agency-update", "absence-clarification-requested", "absence-agency-decision", "agency-worker-join-requested", "change-requested", "change-request-approved", "change-request-rejected", "message-received", "schedule-updated", "employment-updated", "team-assignment-needed", "timesheet-ready", "timesheet-submitted", "timesheet-resent", "timesheet-accepted", "timesheet-returned", "timesheet-reopened", "agency-connection-invited", "agency-connection-accepted", "agency-invitation-declined"],
    "agencyWorkerInvitations.status.": ["pending", "awaiting-approval", "approved", "declined", "revoked", "expired"],
    "workflow.changeRequests.": ["open", "approved", "rejected"],
    "workflow.calendar.days.": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    "workflow.schedule.days.": ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
    "workflow.schedule.state.": ["active", "cancelled"],
    "workflow.schedule.outcomes.": ["worked", "reported-absence", "unreported-absence", "approved-absence", "cancelled-or-changed"],
    "workflow.templates.icons.": ["sun", "coffee", "moon", "zap"],
    "workflow.memberState.": ["active", "away"],
    "workflow.leader.shiftCreateErrors.": ["wrong-role", "leader-membership", "factory-setting", "factory-archived", "leader-permission", "submission-disabled", "invalid-shift", "choose-worker", "worker-unavailable", "employment", "worker-assignment"],
    "workflow.production.permission.": ["canViewWorkers", "canRecordHours", "canReviewShifts", "canConfirmShifts", "canSubmitTimesheet", "canManageGroups"],
    "workflow.production.workflow.": ["workerCanRecordHours", "leaderCanRecordHours", "leaderMustReviewShifts", "agencyMustReviewShifts", "workerMustConfirmShifts", "workerCanDisputeShifts", "leaderCanSubmitTimesheet", "agencyCanSubmitTimesheet", "agencyMustAcceptTimesheet"],
    "monthlyTimesheets.status.": ["in_progress", "ready_for_review", "returned_to_leader", "submitted_to_agency", "accepted_by_agency", "reopened"],
    "monthlyTimesheets.recordStatus.": ["ready", "check", "problem", "absence"],
    "monthlyTimesheets.event.": ["ready", "submitted", "resent", "accepted", "returned", "reopened"],
    "monthlyTimesheets.breakTreatment.": ["paid", "unpaid"],
    "monthlyTimesheets.attention.role.": ["worker", "leader", "agency"],
    "monthlyTimesheets.attention.reason.": ["worker-confirmation", "worker-dispute", "shift-review", "break-review", "break-returned", "review-returned", "time-mismatch", "absence-review", "absence-unreported", "absence-clarification"],
    "monthlyTimesheets.attention.action.": ["worker-confirmation", "worker-dispute", "shift-review", "break-review", "break-returned", "review-returned", "time-mismatch", "absence-review", "absence-unreported", "absence-clarification"],
  };
  for (const language of languages) {
    for (const [prefix, suffixes] of Object.entries(dynamicKeyParts)) {
      for (const suffix of suffixes) assert.ok(locales[language].has(`${prefix}${suffix}`), `${language}:${prefix}${suffix} is missing`);
    }
  }
});

test("login offers a separate demo entry button for each agency account", () => {
  const authSource = readFileSync(new URL("../src/modules/auth/pages/AuthPages.tsx", import.meta.url), "utf8");
  assert.match(authSource, /workspace\.members\.filter\(\(member\) => member\.role === "agency"\)/);
  assert.match(authSource, /agencyAccounts\.map\(/);
  assert.match(authSource, /setActiveMember\(agencyAccount\.id\)/);
  assert.match(authSource, /organizationName/);
  assert.match(authSource, /auth\.demoAgencyAccessFor/);
});
