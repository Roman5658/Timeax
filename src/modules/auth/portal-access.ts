import type { DemoRole } from "../workflows/domain/demo-types";

export type PortalRole = DemoRole | "admin";

export const portalHome = {
  worker: "/worker",
  agency: "/agency",
  leader: "/leader",
  "factory-admin": "/factory",
  admin: "/super-admin",
} satisfies Record<PortalRole, string>;

export function getPortalRole(value: unknown): PortalRole | undefined {
  if (typeof value !== "string" || !Object.hasOwn(portalHome, value)) return;
  return value as PortalRole;
}

export function getSignInDestination(from: unknown, role: PortalRole) {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//") || from.includes("\\")) {
    return portalHome[role];
  }
  const path = from.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
  if (path === "/settings" || path === portalHome[role] || (
    role !== "admin" && path.startsWith(`${portalHome[role]}/`)
  )) return from;
  return portalHome[role];
}
