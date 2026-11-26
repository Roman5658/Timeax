import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isThemeName, readThemePreference, saveThemePreference, themeStorageKey } from "../src/app/theme-preference.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

function luminance(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((total, x, i) => total + x * [.2126, .7152, .0722][i], 0);
}

test("landing, portals and settings provide the same accessible localized Pink selection", () => {
  const themeToggle = read("src/components/ThemeToggle.tsx");
  assert.match(themeToggle, /pink: PinkThemeIcon/);
  assert.match(themeToggle, /aria-hidden="true" focusable="false"/);
  assert.match(themeToggle, /<select className="theme-picker-select" aria-label=\{t\("common.theme"\)\} value=\{theme\}/);
  assert.match(themeToggle, /themes.map/);
  assert.match(read("src/components/TopBar.tsx"), /<ThemeToggle\b/);
  assert.match(read("src/app/PortalShell.tsx"), /<ThemeToggle\b/);
  assert.match(read("src/modules/auth/pages/SettingsPage.tsx"), /<ThemeToggle expanded\s*\/>/);
  const labels = { en: "Pink", pl: "Różowy", ru: "Розовая", uk: "Рожева" };
  for (const [lang, label] of Object.entries(labels)) {
    const { common } = JSON.parse(read(`src/i18n/locales/${lang}.json`));
    assert.equal(common.pink, label);
    assert.equal(new Set([common.pink, common.light, common.dark, common.mint, common.turquoise]).size, 5);
  }
});

test("Pink persists using the existing preference key and never changes system defaults", () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  assert.equal(readThemePreference(storage, true), "dark");
  assert.equal(readThemePreference(storage, false), "light");
  assert.equal(isThemeName("pink"), true);
  saveThemePreference(storage, "pink");
  assert.equal(entries.get(themeStorageKey), "pink");
  assert.equal(readThemePreference(storage, false), "pink");
  assert.equal(readThemePreference(storage, true), "pink");
  saveThemePreference(storage, "turquoise");
  assert.equal(readThemePreference(storage, true), "turquoise");
});

test("Pink text, statuses, inputs and focus stay readable on intended surfaces", () => {
  const css = read("src/styles/theme-pink.css");
  const vars = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(([, key, color]) => [key, color]));
  const pairs = [
    ["--ink", "--surface", 4.5], ["--ink", "--pink-glow", 4.5], ["--muted", "--surface-muted", 4.5],
    ["--muted", "--mint", 4.5], ["--muted", "--pink-glow", 4.5], ["--muted-strong", "--mint", 4.5],
    ["--pink-accent-ink", "--accent", 4.5], ["--pink-accent-ink", "--pink-accent-hover", 4.5],
    ["--pink-active-ink", "--mint", 4.5], ["--pink-active-ink", "--surface", 4.5],
    ["--pink-warning-ink", "--pink-warning-surface", 4.5], ["--pink-error-ink", "--pink-error-surface", 4.5],
    ["--pink-success-ink", "--pink-success-surface", 4.5], ["--pink-info-ink", "--blue", 4.5],
    ["--pink-absence-ink", "--violet", 4.5], ["--pink-peach-ink", "--peach", 4.5],
    ["--ink", "--pink-field", 4.5], ["--line-strong", "--pink-field", 3],
    ["--theme-focus", "--surface", 3], ["--theme-focus", "--pink-glow", 3], ["--theme-focus", "--accent", 3],
    ["#f3f6f2", "--navy-deep", 4.5], ["--pink-accent-hover", "--navy-deep", 3],
  ];
  for (const [fg, bg, min] of pairs) {
    const [high, low] = [luminance(vars[fg] ?? fg), luminance(vars[bg] ?? bg)].sort((a, b) => b - a);
    const ratio = (high + .05) / (low + .05);
    assert.ok(ratio >= min, `${fg}/${bg}: ${ratio.toFixed(2)} < ${min}`);
  }
});

test("Pink illustration and CSS are local, decorative and confined to the selected theme", () => {
  const css = read("src/styles/theme-pink.css");
  assert.ok(read("src/main.tsx").indexOf("theme-pink.css") > read("src/main.tsx").indexOf("theme-turquoise.css"));
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /pointer-events: none/);
  assert.ok(css.split("\n").filter((line) => /^[a-z.*#\[]/.test(line)).every((line) => line.startsWith(':root[data-theme="pink"]')));
  for (const name of ["timeax-pink-mouse-happy.svg", "timeax-pink-mouse-wink.svg", "timeax-pink-mouse-giggle.svg", "timeax-pink-sticker-trio.svg", "timeax-pink-bow.svg"]) {
    assert.ok(css.includes(`url("/${name}")`));
    assert.match(read(`public/${name}`), /^<svg [^>]+viewBox=/);
  }
});

test("Pink stickers fill existing decorative slots without changing labels or layout", () => {
  const css = read("src/styles/theme-pink.css");
  assert.match(css, /\.settings-card--appearance \{[\s\S]*?background-image: url\("\/timeax-pink-sticker-trio\.svg"\)/);
  assert.match(css, /\.workflow-stat-grid \.workflow-stat-card > \.stat-icon \{[\s\S]*?background-image: var\(--pink-stat-sticker/);
  assert.match(css, /nth-child\(3n \+ 2\)[\s\S]*?timeax-pink-mouse-wink\.svg/);
  assert.match(css, /nth-child\(3n\)[\s\S]*?timeax-pink-mouse-giggle\.svg/);
  assert.match(css, /\.factory-daily-overview > \.panel-heading \{\s*background:/);
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*?background-image: none;[\s\S]*?visibility: visible;/);
  assert.ok(!css.match(/\b(?:grid-template-columns|margin|padding|display)\s*:/));
});
