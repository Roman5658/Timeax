import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routePageTurnPath, shouldTurnRoutePage } from "../src/app/route-page-turn.ts";

test("page-turn follows real pathname changes, not same-page updates or the hosted auth book", () => {
  assert.equal(routePageTurnPath("/workspace/abc/timecards/"), "/workspace/abc/timecards");
  assert.equal(shouldTurnRoutePage("/workspace/abc/timecards", "/workspace/abc/timecards/", true), false);
  assert.equal(shouldTurnRoutePage("/workspace/abc/timecards", "/workspace/abc/payslips", true), true);
  assert.equal(shouldTurnRoutePage("/workspace/abc/payslips", "/workspace/abc/timecards", true), true);
  assert.equal(shouldTurnRoutePage("/workspace/abc", "/login", true), true);
  assert.equal(shouldTurnRoutePage("/", "/register", true), false);
  assert.equal(shouldTurnRoutePage("/login", "/", true), false);
  assert.equal(shouldTurnRoutePage("/register/", "/register/agency", true), false);
  assert.equal(shouldTurnRoutePage("/", "/login", false), true);
});

test("route decoration is independent from rendered content and windows open without taking over existing close behavior", () => {
  const read = name => readFileSync(new URL("../src/" + name, import.meta.url), "utf8");
  assert.match(read("hosted/main.tsx"), /<InstalledAppResume>\s*<HostedApp\/>\s*<\/InstalledAppResume>\s*<RoutePageTurn hostedAuthPanels\/>/);
  assert.match(read("app/App.tsx"), /<RoutePageTurn \/>\s*<Suspense/);
  assert.match(read("app/RoutePageTurn.tsx"), /const \{ pathname \} = useLocation\(\)/);
  assert.match(read("app/RoutePageTurn.tsx"), /aria-hidden="true"/);
  assert.match(read("app/RoutePageTurn.tsx"), /prefers-reduced-motion: reduce/);
  const css = read("styles/page-turn.css");
  assert.match(css, /prefers-reduced-motion: no-preference/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /right-drawer-backdrop:not\(\.is-closing\)/);
  assert.match(css, /notification-popover\.is-positioned/);
  assert.match(css, /dialog\[open\]:not\(\.auth-book\)/);
  assert.match(css, /worker-profile-dialog/);
  assert.match(css, /portal-sidebar\.is-open/);
});

test("public authentication keeps the book mounted through its closing animation",()=>{
 const read=name=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
 const app=read("hosted/HostedApp.tsx");
 assert.match(app,/pathname==="\/"\?lastPanel:pathname/);
 assert.match(app,/e\.animationName==="auth-page-unturn"/);
 assert.match(app,/setTimeout\(onClosed,460\)/);
 assert.match(app,/prefers-reduced-motion: reduce/);
 const css=read("styles/public-experience.css");
 assert.match(css,/is-closing \{ animation:auth-page-unturn/);
 assert.match(css,/@keyframes auth-backdrop-out/);
 assert.match(read("modules/auth/pages/HostedStartPage.tsx"),/<WorkspacePreview id="features" \/>/);
});
