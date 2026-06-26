import { getDB } from "@/lib/db";

export type StoreRole = "owner" | "admin" | "finance" | "ops" | "viewer";
export type StorePermission =
  | "store:read"
  | "store:admin"
  | "finance:read"
  | "finance:write"
  | "incidents:read"
  | "incidents:write"
  | "courier:sync"
  | "users:manage";

const ROLE_PERMISSIONS: Record<StoreRole, StorePermission[]> = {
  owner: [
    "store:read",
    "store:admin",
    "finance:read",
    "finance:write",
    "incidents:read",
    "incidents:write",
    "courier:sync",
    "users:manage",
  ],
  admin: [
    "store:read",
    "store:admin",
    "finance:read",
    "finance:write",
    "incidents:read",
    "incidents:write",
    "courier:sync",
    "users:manage",
  ],
  finance: ["store:read", "finance:read", "finance:write"],
  ops: ["store:read", "incidents:read", "incidents:write", "courier:sync"],
  viewer: ["store:read", "finance:read", "incidents:read"],
};

export interface StoreAccess {
  user_id: string;
  store_id: number;
  role: StoreRole;
}

export function roleHasPermission(role: StoreRole, permission: StorePermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function anyRoleHasPermission(roles: StoreRole[], permission: StorePermission): boolean {
  return roles.some((role) => roleHasPermission(role, permission));
}

export async function listUserStoreAccess(userId: string): Promise<StoreAccess[]> {
  const { data, error } = await getDB()
    .from("user_store_roles")
    .select("user_id, store_id, role")
    .eq("user_id", userId);

  if (error) throw new Error(`listUserStoreAccess: ${error.message}`);
  return (data ?? []) as StoreAccess[];
}

export async function userCanAccessStore(
  userId: string,
  storeId: number,
  permission: StorePermission
): Promise<boolean> {
  const access = await listUserStoreAccess(userId);
  return anyRoleHasPermission(
    access.filter((row) => row.store_id === storeId).map((row) => row.role),
    permission
  );
}

// Compatibility bridge for the current password-based admin session. Once
// Supabase Auth is enabled, API routes should pass the authenticated user id
// and stop using this global-admin fallback.
export function isLegacyGlobalAdminEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD || process.env.APP_SECRET);
}

export function assertPermissionOrThrow(
  allowed: boolean,
  message = "No tienes permiso para esta tienda"
): void {
  if (!allowed) throw new Error(message);
}
