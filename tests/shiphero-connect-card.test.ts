import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ShipHeroStatus } from "../lib/shiphero-connection";

// The card's states, rendered on the server with a fixed GET payload (no fetch).
const mocks = vi.hoisted(() => ({
  resource: { data: null as unknown, loading: true, error: "" },
}));
vi.mock("../components/marketing/useMarketing", () => ({
  useResource: () => ({ ...mocks.resource, setState: () => undefined }),
  sendMarketing: async () => ({ ok: false, error: "no" }),
}));
vi.mock("../components/marketing/dashboard.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("../components/marketing/team-report.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

import { ShipHeroConnect } from "../components/marketing/ShipHeroConnect";

const base: ShipHeroStatus = {
  key: { configured: true, message: null },
  state: "not_connected",
  authMethod: null,
  userEmail: null,
  accountKind: null,
  customer: null,
  warehouse: null,
  choices: { warehouses: [], customers: [], customersTruncated: false },
  connectedBy: null,
  connectedAt: null,
  lastSyncAt: null,
  lastSyncOkAt: null,
  lastSyncRows: null,
  incoming: null,
  lastError: null,
  staticEnv: false,
  syncInMs: 0,
};

function render(
  payload: unknown,
  { canEdit = true, loading = false } = {},
): string {
  mocks.resource = { data: payload, loading, error: "" };
  return renderToStaticMarkup(
    createElement(ShipHeroConnect, { canEdit, onChanged: () => undefined }),
  );
}
const ok = (connection: Partial<ShipHeroStatus>, canEdit = true) => ({
  status: "ok",
  connection: { ...base, ...connection },
  canEdit,
});

describe("ShipHeroConnect card", () => {
  it("loading and pending migration", () => {
    expect(render(null, { loading: true })).toContain("Consultando ShipHero…");
    const html = render({
      status: "pending_migration",
      message: "Pendiente: aplicar migración de ShipHero.",
      connection: { key: base.key, staticEnv: false },
      canEdit: true,
    });
    expect(html).toContain("Pendiente: aplicar migración de ShipHero.");
    expect(html).not.toContain("<form");
  });

  it("not connected: a POST-only form whose password field is never named password nor autofilled", () => {
    const html = render(ok({}));
    expect(html).toContain("Correo de ShipHero");
    expect(html).toContain('type="password"');
    expect(html).toContain('name="shiphero-secret"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toMatch(/autoComplete="(current|new)-password"/i);
    expect(html).not.toMatch(/autocomplete="(current|new)-password"/i);
    expect(html).not.toMatch(/<form[^>]*(action|method)=/);
    expect(html).toContain("Kairo no la guarda");
    expect(html).toContain("Tengo un token de desarrollador");
  });

  it("key missing: says the pending variable and disables the form", () => {
    const html = render(
      ok({
        key: {
          configured: false,
          message: "Pendiente: configurar SHIPHERO_TOKEN_KEY.",
        },
      }),
    );
    expect(html).toContain("Pendiente: configurar SHIPHERO_TOKEN_KEY.");
    expect(html).toMatch(/<button type="submit" disabled/);
  });

  it("needs a choice: customer (3PL) and warehouse selects", () => {
    const html = render(
      ok({
        state: "needs_scope",
        accountKind: "3pl",
        userEmail: "ops@boxful.test",
        choices: {
          warehouses: [
            { id: "w1", name: "Costa Rica", active: true },
            { id: "w2", name: "Guatemala", active: true },
          ],
          customers: [
            { id: "c1", name: "Mireva" },
            { id: "c2", name: "Otra marca" },
          ],
          customersTruncated: false,
        },
      }),
    );
    expect(html).toContain("Elige qué inventario leer.");
    expect(html).toContain("Cliente");
    expect(html).toContain("Mireva");
    expect(html).toContain("Almacén");
    expect(html).toContain("Guatemala");
    expect(html).not.toContain("<form");
  });

  it("connected: who, warehouse, last snapshot and the actions", () => {
    const html = render(
      ok({
        state: "connected",
        authMethod: "password",
        userEmail: "ana@mireva.cr",
        accountKind: "cuenta",
        warehouse: { id: "w1", name: "Costa Rica" },
        choices: {
          warehouses: [
            { id: "w1", name: "Costa Rica", active: true },
            { id: "w2", name: "Guatemala", active: true },
          ],
          customers: [],
          customersTruncated: false,
        },
        lastSyncOkAt: "2026-11-06T16:13:00Z",
        lastSyncRows: 512,
        incoming: true,
      }),
    );
    expect(html).toContain("ana@mireva.cr");
    expect(html).toContain("Almacén: Costa Rica");
    expect(html).toContain("512 SKU");
    expect(html).toContain("aproximado");
    expect(html).toContain("Sincronizar ahora");
    expect(html).toContain("Cambiar almacén");
    expect(html).toContain("Desconectar");
    expect(html).not.toContain("<form");
  });

  it("connected during the cooldown: the sync button waits", () => {
    const html = render(
      ok({ state: "connected", userEmail: "ana@mireva.cr", syncInMs: 300_000 }),
    );
    expect(html).toContain("Espera unos minutos");
    expect(html).not.toContain("Sincronizar ahora");
  });

  it("reconnect: warns and offers the form again", () => {
    const html = render(
      ok({
        state: "reconnect",
        lastError: "ShipHero rechazó el acceso guardado. Vuelve a conectar.",
      }),
    );
    expect(html).toContain("ShipHero pide volver a conectar.");
    expect(html).toContain("ShipHero rechazó el acceso guardado.");
    expect(html).toContain("<form");
  });

  it("static env only: says so and still offers the form", () => {
    const html = render(ok({ staticEnv: true }));
    expect(html).toContain("SHIPHERO_CR_*");
    expect(html).toContain("<form");
  });

  it("viewers see the status but never the form", () => {
    const html = render(
      ok({ state: "connected", userEmail: "ana@mireva.cr" }, false),
      { canEdit: false },
    );
    expect(html).toContain("ana@mireva.cr");
    expect(html).toContain("Solo quien edita Marketing puede conectar ShipHero.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Sincronizar ahora");
  });
});
