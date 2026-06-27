import { describe, expect, it } from "vitest";
import { anyRoleHasPermission, roleHasPermission } from "../lib/access-control";

describe("access-control role matrix", () => {
  it("admin and owner can manage users and write finance", () => {
    expect(roleHasPermission("owner", "users:manage")).toBe(true);
    expect(roleHasPermission("admin", "finance:write")).toBe(true);
  });

  it("finance cannot manage incidents or users", () => {
    expect(roleHasPermission("finance", "finance:write")).toBe(true);
    expect(roleHasPermission("finance", "incidents:write")).toBe(false);
    expect(roleHasPermission("finance", "users:manage")).toBe(false);
  });

  it("ops can work incidents and sync couriers without finance writes", () => {
    expect(roleHasPermission("ops", "incidents:write")).toBe(true);
    expect(roleHasPermission("ops", "courier:sync")).toBe(true);
    expect(roleHasPermission("ops", "finance:write")).toBe(false);
  });

  it("viewer is read-only", () => {
    expect(roleHasPermission("viewer", "finance:read")).toBe(true);
    expect(roleHasPermission("viewer", "incidents:read")).toBe(true);
    expect(roleHasPermission("viewer", "finance:write")).toBe(false);
  });

  it("checks a set of roles", () => {
    expect(anyRoleHasPermission(["viewer", "ops"], "incidents:write")).toBe(true);
    expect(anyRoleHasPermission(["viewer"], "courier:sync")).toBe(false);
  });
});
