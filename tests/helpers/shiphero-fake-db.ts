// Fake supabase client for the ShipHero tests: one connection row in memory,
// every call recorded (to assert no delete and no secret in any argument).
import type { ConnectionRow } from "../../lib/shiphero-connection";

export interface FakeCall {
  table: string;
  op: string;
  args: unknown[];
}

export function baseRow(over: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    store_id: 1,
    state: "connected",
    auth_method: "password",
    refresh_token_enc: null,
    access_token_enc: null,
    access_expires_at: null,
    token_generation: 1,
    sh_user_email: "ana@mireva.cr",
    sh_account_id: Buffer.from("Account:42").toString("base64"),
    sh_account_legacy_id: 42,
    is_3pl: false,
    customer_account_id: null,
    customer_name: null,
    warehouse_id: null,
    warehouse_name: null,
    choices: { warehouses: [], customers: [] },
    connected_by: "7:Ana",
    connected_at: "2026-11-06T15:00:00.000Z",
    last_sync_at: null,
    last_sync_ok_at: null,
    last_sync_rows: null,
    last_sync_incoming: null,
    last_error: null,
    ...over,
  };
}

type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: unknown };

export function createFakeDb() {
  const state = {
    row: null as ConnectionRow | null,
    calls: [] as FakeCall[],
    missingTable: false,
    rpc: new Map<string, RpcHandler>(),
    snapshots: [] as Array<Record<string, unknown>>,
    items: {} as Record<string, Array<Record<string, unknown>>>,
  };
  const missing = { code: "PGRST205", message: "private detail" };

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let op = "select";
    let values: Record<string, unknown> | null = null;
    const record = (name: string, args: unknown[]) =>
      state.calls.push({ table, op: name, args });
    const result = () => {
      if (state.missingTable && table === "marketing_shiphero_connection")
        return { data: null, error: missing };
      if (table === "marketing_inventory_snapshots")
        return {
          // Only the scope filter matters here (one store, one source in the tests).
          data: state.snapshots.filter(
            (snap) => !("scope_key" in filters) || snap.scope_key === filters.scope_key,
          ),
          error: null,
        };
      if (table === "marketing_inventory_items")
        return { data: state.items[String(filters.snapshot_id)] ?? [], error: null };
      if (op === "update") {
        const row = state.row;
        const matches =
          row &&
          Object.entries(filters).every(
            ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value,
          );
        if (!matches) return { data: [], error: null };
        Object.assign(row!, values);
        return { data: [{ store_id: row!.store_id }], error: null };
      }
      if (op === "upsert") {
        state.row = { ...(state.row ?? {}), ...(values as object) } as typeof state.row;
        return { data: null, error: null };
      }
      return { data: state.row ? [state.row] : [], error: null };
    };
    const query = {
      select: (...args: unknown[]) => {
        record(op === "select" ? "select" : `${op}.select`, args);
        return query;
      },
      update: (next: Record<string, unknown>) => {
        op = "update";
        values = next;
        record("update", [next]);
        return query;
      },
      upsert: (next: Record<string, unknown>, options: unknown) => {
        op = "upsert";
        values = next;
        record("upsert", [next, options]);
        return query;
      },
      insert: (next: unknown) => {
        record("insert", [next]);
        return query;
      },
      delete: () => {
        record("delete", []);
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters[key] = value;
        return query;
      },
      order: () => query,
      limit: () => query,
      range: () => query,
      maybeSingle: () => {
        const out = result();
        return Promise.resolve(
          out.error ? out : { data: state.row ? { ...state.row } : null, error: null },
        );
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  }

  const db = {
    from,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ table: "rpc", op: name, args: [args] });
      if (state.missingTable) return Promise.resolve({ data: null, error: missing });
      const handler = state.rpc.get(name);
      return Promise.resolve(handler ? handler(args) : { data: null, error: null });
    },
  };

  function reset() {
    state.row = null;
    state.calls = [];
    state.missingTable = false;
    state.snapshots = [];
    state.items = {};
    state.rpc = new Map<string, RpcHandler>([
      ["marketing_shiphero_lease", () => ({ data: "lease-1", error: null })],
      ["marketing_shiphero_release", () => ({ data: null, error: null })],
      ["marketing_shiphero_connect_attempt", () => ({ data: true, error: null })],
      // Like the SQL guard: saves only if generation and scope are unchanged.
      [
        "marketing_replace_shiphero_snapshot",
        (args) => {
          const row = state.row;
          const scope = row
            ? `${row.sh_account_id ?? ""}|${row.customer_account_id ?? ""}|${row.warehouse_id ?? ""}`
            : null;
          const same =
            row &&
            row.token_generation === args.p_generation &&
            ["connected", "reconnect"].includes(row.state) &&
            Boolean(row.refresh_token_enc) &&
            scope === args.p_scope;
          return { data: same ? "snap-1" : null, error: null };
        },
      ],
    ]);
  }
  reset();
  return { db, state, reset };
}

/** One shared instance for vi.mock("@/lib/db") and the test body. */
export const fakeDb = createFakeDb();

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Routes ShipHero calls by path (and GraphQL operation name). */
export function shipheroFetcher(handlers: {
  token?: (body: Record<string, unknown>) => Response;
  refresh?: (body: Record<string, unknown>) => Response;
  graphql?: (body: { query: string; variables: Record<string, unknown> }, auth: string) => Response;
}) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
    if (url.endsWith("/auth/token") && handlers.token) return handlers.token(body);
    if (url.endsWith("/auth/refresh") && handlers.refresh) return handlers.refresh(body);
    if (url.endsWith("/graphql") && handlers.graphql) return handlers.graphql(body, auth);
    throw new Error(`unexpected call ${url}`);
  };
}
