#!/usr/bin/env node
// Read-only audit for iComfly rows saved with non-Kairo store IDs.
//
// Purpose:
// - Kairo stores use internal IDs from the stores table, for example 1/2.
// - iComfly uses external store IDs, for example 71.
// - Older sync attempts may have persisted the external ID as store_id.
//
// This script only reads data and prints counts. It never writes to Supabase.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TABLES = ["icomfly_orders", "icomfly_agents"];
const PAGE_SIZE = 1000;

loadEnvFile(".env.local");
loadEnvFile(".env");

const MAX_ROWS = Number(cleanEnv("AUDIT_MAX_ROWS") || 200000);
const supabaseUrl = cleanEnv("SUPABASE_URL");
const serviceRoleKey = cleanEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!Number.isFinite(MAX_ROWS) || MAX_ROWS < PAGE_SIZE) {
  console.error("AUDIT_MAX_ROWS must be a number greater than or equal to 1000.");
  process.exit(2);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("This audit is read-only, but it needs service-role access to inspect production tables.");
  process.exit(2);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function loadEnvFile(fileName) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsAt = line.indexOf("=");
    if (equalsAt < 1) continue;

    const key = line.slice(0, equalsAt).trim();
    let value = line.slice(equalsAt + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const current = process.env[key];
    if (current == null || String(current).trim() === "") process.env[key] = value;
  }
}

function increment(map, key) {
  const safeKey = key == null ? "NULL" : String(key);
  map.set(safeKey, (map.get(safeKey) || 0) + 1);
}

async function fetchStores() {
  const { data, error } = await db
    .from("stores")
    .select("id, code, name, active")
    .order("id", { ascending: true });
  if (error) throw new Error(`stores: ${error.message}`);
  return data || [];
}

async function countStoreIds(tableName) {
  const counts = new Map();
  let scanned = 0;

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(tableName)
      .select("store_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${tableName}: ${error.message}`);

    const rows = data || [];
    for (const row of rows) increment(counts, row.store_id);
    scanned += rows.length;

    if (rows.length < PAGE_SIZE) break;
  }

  return { counts, scanned, truncated: scanned >= MAX_ROWS };
}

function formatKnownStore(storeById, storeId) {
  const store = storeById.get(String(storeId));
  if (!store) return "LEGACY_OR_UNKNOWN";
  return `${store.code}${store.active ? "" : " (inactive)"}`;
}

async function main() {
  const stores = await fetchStores();
  const storeById = new Map(stores.map((store) => [String(store.id), store]));
  const legacyFindings = [];

  console.log("\nKairo stores");
  if (!stores.length) {
    console.log("  No stores found. Stop before any cleanup.");
  } else {
    for (const store of stores) {
      console.log(`  ${store.id}: ${store.code} - ${store.name} - ${store.active ? "active" : "inactive"}`);
    }
  }

  for (const tableName of TABLES) {
    const { counts, scanned, truncated } = await countStoreIds(tableName);
    console.log(`\n${tableName} by store_id`);

    if (!counts.size) {
      console.log("  No rows.");
      continue;
    }

    const entries = Array.from(counts.entries()).sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [storeId, count] of entries) {
      const status = formatKnownStore(storeById, storeId);
      console.log(`  store_id=${storeId} rows=${count} ${status}`);

      if (!storeById.has(String(storeId))) {
        legacyFindings.push({ tableName, storeId, count });
      }
    }

    if (truncated) {
      console.log(`  WARNING: stopped after AUDIT_MAX_ROWS=${MAX_ROWS}. Increase it for a full scan.`);
    }
    console.log(`  scanned=${scanned}`);
  }

  console.log("\nResult");
  if (!legacyFindings.length) {
    console.log("  OK: all iComfly rows point to known Kairo stores.");
    return;
  }

  console.log("  Review required: some iComfly rows use a store_id that is not in stores.");
  console.log("  Do not delete these rows. They may be legacy external iComfly IDs.");
  for (const finding of legacyFindings) {
    console.log(`  ${finding.tableName}: store_id=${finding.storeId} rows=${finding.count}`);
  }
}

main().catch((error) => {
  console.error("\nAudit failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
