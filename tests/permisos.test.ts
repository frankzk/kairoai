// Que exige cada ruta, y que ninguna ruta quede abierta por olvido.

import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  cumple,
  exigenciaDe,
  inicioDe,
  pantallasDe,
  permisosDeRoles,
  reglaDe,
  rutaInternaSegura,
  type Permiso,
} from "../lib/permisos";

const ROOT = path.resolve(__dirname, "..");

function rutasDeApi(dir = path.join(ROOT, "app/api")): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...rutasDeApi(p));
    else if (n === "route.ts") {
      out.push("/" + path.relative(path.join(ROOT, "app"), path.dirname(p)).split(path.sep).join("/").replace(/\[[^\]]+\]/g, "123"));
    }
  }
  return out;
}

function paginas(dir = path.join(ROOT, "app")): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "api") out.push(...paginas(p));
    } else if (n === "page.tsx") {
      const rel = path.relative(path.join(ROOT, "app"), path.dirname(p)).split(path.sep).join("/");
      out.push(rel ? `/${rel}` : "/");
    }
  }
  return out;
}

describe("toda ruta tiene su regla", () => {
  it("cada route.ts de app/api tiene una regla explicita (lo no mapeado queda cerrado)", () => {
    const sinRegla = rutasDeApi().filter((r) => !reglaDe(r, "GET") && !reglaDe(r, "POST"));
    expect(sinRegla, `Rutas sin regla en lib/permisos.ts: ${sinRegla.join(", ")}`).toEqual([]);
    expect(rutasDeApi().length).toBeGreaterThan(60);
  });

  it("cada pagina tiene su regla", () => {
    const sinRegla = paginas().filter((r) => !reglaDe(r));
    expect(sinRegla, `Paginas sin regla: ${sinRegla.join(", ")}`).toEqual([]);
  });

  it("lo que no tiene regla exige el permiso de usuarios (cerrado por defecto)", () => {
    expect(exigenciaDe("/api/algo-nuevo")).toEqual({ tipo: "permiso", alguno: ["usuarios"] });
  });
});

describe("exigenciaDe", () => {
  it("login y webhooks son publicos", () => {
    for (const r of ["/login", "/api/auth/login", "/api/shopify/webhook", "/api/zadarma/webhook", "/api/retell/llm", "/api/shopify/auth/callback"]) {
      expect(exigenciaDe(r, "POST").tipo, r).toBe("publico");
    }
  });

  it("los crons tienen su propia puerta", () => {
    expect(exigenciaDe("/api/cron/moovin").tipo).toBe("cron");
  });

  it("gana la regla mas especifica", () => {
    // /api/finance es de finanzas, pero los pedidos los ve tambien logistica.
    expect(exigenciaDe("/api/finance/expenses")).toEqual({ tipo: "permiso", alguno: ["finanzas"] });
    expect(cumple(exigenciaDe("/api/finance/orders"), ["pedidos"])).toBe(true);
    expect(cumple(exigenciaDe("/api/finance/expenses"), ["pedidos"])).toBe(false);
  });

  it("el segmento [leadId] coincide con cualquier id", () => {
    expect(cumple(exigenciaDe("/api/leads/987/disposition", "POST"), ["leads"])).toBe(true);
    // El chat (mensajes) lo usan tambien Novedades; gestionar el lead no.
    expect(cumple(exigenciaDe("/api/leads/987/messages"), ["novedades"])).toBe(true);
    expect(cumple(exigenciaDe("/api/leads/987/disposition", "POST"), ["novedades"])).toBe(false);
  });

  it("la lista de asesoras se lee con cualquier sesion, pero modificarla no", () => {
    expect(exigenciaDe("/api/finance/payroll-staff", "GET").tipo).toBe("sesion");
    expect(cumple(exigenciaDe("/api/finance/payroll-staff", "POST"), ["leads"])).toBe(false);
  });

  it("el inicio '/' no coincide con todo", () => {
    expect(exigenciaDe("/")).toEqual({ tipo: "permiso", alguno: ["panel"] });
    expect(cumple(exigenciaDe("/admin/leads"), ["leads"])).toBe(true);
  });
});

describe("lo que puede hacer cada rol", () => {
  const puede = (perms: Permiso[], ruta: string, metodo = "GET") => cumple(exigenciaDe(ruta, metodo), perms);

  it("asesora: Leads y su chat; nada de Finanzas, Novedades, usuarios ni configuracion", () => {
    const a = permisosDeRoles(["asesora"]);
    expect(a).toEqual(["leads"]);
    expect(puede(a, "/admin/leads")).toBe(true);
    expect(puede(a, "/api/leads/5/send", "POST")).toBe(true);
    expect(puede(a, "/admin/finance")).toBe(false);
    expect(puede(a, "/api/finance/settlements")).toBe(false);
    expect(puede(a, "/admin/incidencias")).toBe(false);
    expect(puede(a, "/api/users")).toBe(false);
    expect(puede(a, "/admin/settings")).toBe(false);
    expect(puede(a, "/")).toBe(false);
  });

  it("logistica: Novedades y Gestion de pedidos, sin Finanzas", () => {
    const l = permisosDeRoles(["logistica"]);
    expect(puede(l, "/admin/incidencias")).toBe(true);
    expect(puede(l, "/admin/finance")).toBe(true);
    expect(puede(l, "/api/finance/orders")).toBe(true);
    expect(puede(l, "/api/finance/settlements")).toBe(false);
    expect(puede(l, "/api/finance/product-costs")).toBe(false);
  });

  it("varios roles SUMAN permisos", () => {
    expect(permisosDeRoles(["asesora", "logistica"])).toEqual(["leads", "novedades", "pedidos"]);
  });

  it("solo usuarios administra usuarios", () => {
    expect(puede(permisosDeRoles(["jefa_tienda"]), "/api/users")).toBe(false);
    expect(puede(permisosDeRoles(["admin"]), "/api/users", "POST")).toBe(true);
  });
});

describe("inicio y pantallas", () => {
  it("cada persona arranca en la primera pantalla que puede ver", () => {
    expect(inicioDe(["leads"])).toBe("/admin/leads");
    expect(inicioDe(["novedades", "pedidos"])).toBe("/admin/incidencias");
    expect(inicioDe(["finanzas"])).toBe("/admin/finance");
    expect(inicioDe([])).toBe("/cuenta");
  });

  it("la navegacion solo muestra lo permitido", () => {
    expect(pantallasDe(["leads"]).map((p) => p.ruta)).toEqual(["/admin/leads"]);
  });

  it("solo redirige a rutas internas", () => {
    expect(rutaInternaSegura("/admin/leads")).toBe(true);
    expect(rutaInternaSegura("//evil.com")).toBe(false);
    expect(rutaInternaSegura("https://evil.com")).toBe(false);
    expect(rutaInternaSegura("/\\evil.com")).toBe(false);
  });
});
