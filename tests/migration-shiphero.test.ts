import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.join(__dirname, "../supabase/migrations/20261106120000_marketing_shiphero_connection.sql"),
  "utf8",
);
const code = sql
  .replace(/\r\n/g, "\n")
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase();

describe("ShipHero migration", () => {
  it("is additive, idempotent and service-role only", () => {
    expect(code).toContain("create table if not exists public.marketing_shiphero_connection");
    expect(code).toContain("enable row level security");
    expect(code).toContain("revoke all on table public.marketing_shiphero_connection from public, anon, authenticated");
    expect(code).not.toMatch(/\bdrop\s/);
    expect(code).not.toMatch(/\btruncate\b/);
    expect(code).not.toMatch(/grant[^;]*\bdelete\b/);
    for (const grant of code.match(/\bgrant [^;]*;/g) ?? [])
      expect(grant).toMatch(/to service_role;$/);
  });

  it("only deletes that day's ShipHero snapshot (never CSV or older days)", () => {
    const deletes = code.match(/delete from[^;]*;/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("marketing_inventory_snapshots");
    expect(deletes[0]).toContain("snapshot_date = p_date");
    expect(deletes[0]).toContain("source = 'shiphero'");
    expect(deletes[0]).toContain("store_id = p_store");
  });

  it("saves a snapshot only while the connection is unchanged, tagged with its scope", () => {
    expect(code).toContain("add column if not exists scope_key");
    expect(code).toMatch(/marketing_replace_shiphero_snapshot\(\s*p_store bigint, p_date date, p_meta jsonb, p_items jsonb,\s*p_generation integer, p_scope text/);
    expect(code).toContain("for update");
    expect(code).toContain("v_conn.token_generation <> p_generation");
    // Same formula as shipheroScopeKey() in lib/shiphero-connection.ts.
    expect(code).toContain(
      "coalesce(v_conn.sh_account_id, '') || '|' || coalesce(v_conn.customer_account_id, '')\n        || '|' || coalesce(v_conn.warehouse_id, '') <> p_scope",
    );
    // The unguarded version of an earlier draft cannot be called, and is not dropped.
    expect(code).toContain("to_regprocedure('public.marketing_replace_shiphero_snapshot(bigint, date, jsonb, jsonb)')");
    expect(code).toMatch(/grant execute on function public\.marketing_replace_shiphero_snapshot\(bigint, date, jsonb, jsonb, integer, text\) to service_role;/);
  });

  it("never has a column for the password", () => {
    // 'password' only appears as an auth_method value.
    expect(code.replace(/'password'/g, "")).not.toMatch(/password/);
    expect(code).toContain("refresh_token_enc");
  });
});
