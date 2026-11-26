import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isThemeName, readThemePreference, saveThemePreference, themes, themeStorageKey } from '../src/app/theme-preference.ts';

test('Color themes are optional; legacy themes and the system default are preserved', () => {
  assert.deepEqual(themes, ['light','dark','mint','turquoise','pink']);
  assert.equal(readThemePreference(undefined, false), 'light');
  assert.equal(readThemePreference(undefined, true), 'dark');
  assert.equal(readThemePreference({getItem: () => 'unknown'}, false), 'light');
  assert.equal(readThemePreference({getItem: () => 'unknown'}, true), 'dark');
  assert.equal(readThemePreference({getItem: () => 'light'}, true), 'light');
  assert.equal(readThemePreference({getItem: () => 'dark'}, false), 'dark');
  assert.equal(isThemeName('mint'), true);
  assert.equal(isThemeName('system'), false);
});
test('each explicit theme switches and survives reopening with the existing storage key', () => {
  const state = new Map();
  const storage = {setItem: (key, value) => state.set(key, value), getItem: (key) => state.get(key) ?? null};
  for (const theme of ['dark','mint','turquoise','pink','light','mint']) {
    saveThemePreference(storage, theme);
    assert.equal(state.size, 1);
    assert.equal(state.get(themeStorageKey), theme);
    assert.equal(readThemePreference(storage, false), theme);
    assert.equal(readThemePreference(storage, true), theme);
  }
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readThemePreference(blocked, true), 'dark');
  assert.doesNotThrow(() => saveThemePreference(blocked, 'mint'));
});

function luminance(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, idx) => sum + channel * [0.2126, 0.7152, 0.0722][idx], 0);
}
function contrast(a, b) {
  const levels = [luminance(a), luminance(b)].sort((l, r) => r - l);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}
test('major Mint text, status, button, focus, and form boundary color pairs meet selected contrast targets', () => {
  const css = fs.readFileSync(new URL('../src/styles/theme-mint.css', import.meta.url), 'utf8');
  const values = Object.fromEntries([...css.matchAll(/(--[a-z-]+):\s*(#[\da-f]{6});/gi)].map(([,key,color])=>[key,color]));
  const cases = [
    ['--ink', '--surface', 4.5], ['--muted', '--surface-soft', 4.5], ['--muted', '#276659', 4.5],
    ['--muted-strong', '--mint-active-surface', 4.5], ['--mint-active-ink', '--mint-active-surface', 4.5],
    ['#122e31', '--accent', 4.5], ['--mint-warning-ink', '--mint-warning-surface', 4.5],
    ['--mint-attention-ink', '--peach', 4.5], ['--mint-absence-ink', '--violet', 4.5],
    ['--mint-info-ink', '--blue', 4.5], ['--ink', '--mint-field', 4.5],
    ['--line-strong', '--mint-field', 3], ['--theme-focus', '#276659', 3],
  ];
  for (const [left, right, threshold] of cases) {
    assert.ok(contrast(values[left] ?? left, values[right] ?? right) >= threshold, `${left} / ${right}`);
  }
  const index = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.ok(index.indexOf('./styles/theme-mint.css') > index.indexOf('./styles/global.css'));
  assert.match(css, /:root\[data-theme="mint"\]\s*\{/);
  for (const lang of ['en','pl','ru','uk']) {
    const locale = JSON.parse(fs.readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'));
    assert.ok(locale.common.mint);
  }
});
