import { describe, expect, it } from "vitest";
import { extractActionIds, parseMoovinResponse } from "@/lib/moovin";

// Respuesta real del Server Action de Moovin (formato RSC: lineas "<n>:{...}"),
// capturada de la guia 2557364. Fija que el parser saca el tracking del payload
// tal cual lo manda Moovin hoy.
const REAL_RESPONSE =
  '0:{"a":"$@1","f":"","b":"Zf3sTqjOlfv98l1uAiD3a"}\n' +
  '1:{"idPackage":2557364,"nameProfile":"BOXFUL TECHNOLOGIES personal","serialNumber":"4d03618ef2ae4aa0","enterpriseCode":"6a42ec66976347e19364c0cc","weight":1,"size":"S","listStatus":[' +
  '{"idStatus":44605525,"date":"2026-06-30T15:07:14Z","status":"INMOOVIN","comments":[],"title":"Sede de Moovin","description":"El paquete se encuentra en alguna de las sedes de Moovin."},' +
  '{"idStatus":44605524,"date":"2026-06-30T15:07:14Z","status":"RECIEVEDDELEGATED","comments":[],"title":"En sede local","description":"Tu paquete se encuentra en la sede mas proxima."},' +
  '{"idStatus":44579780,"date":"2026-06-29T22:06:33Z","status":"PICKUP","comments":[],"title":"Recoleccion solicitada","description":"El remitente ha solicitado la recoleccion."},' +
  '{"idStatus":44579777,"date":"2026-06-29T22:06:31Z","status":"PREPARE","comments":[],"title":"Por preparar","description":"El remitente esta preparando el paquete."}' +
  '],"coorList":[' +
  '{"lat":8.53,"lng":-83.30,"address":"50 m norte del Alamo, Puerto Jimenez","name":"Punto de entrega"},' +
  '{"lat":9.95,"lng":-84.16,"address":"Parque Empresarial Blum, Bodega G4","name":"Punto de recoleccion"}' +
  '],"invoice":"NOT_INVOICE"}\n';

describe("parseMoovinResponse (respuesta real del Server Action)", () => {
  it("extrae numero de tracking, perfil y direccion de entrega", () => {
    const detail = parseMoovinResponse(REAL_RESPONSE)!;
    expect(detail).not.toBeNull();
    expect(detail.tracking_number).toBe("4d03618ef2ae4aa0");
    expect(detail.profile).toBe("BOXFUL TECHNOLOGIES personal");
    expect(detail.delivery_address).toBe("50 m norte del Alamo, Puerto Jimenez");
  });

  it("ordena por fecha desc y toma el estado mas reciente", () => {
    const detail = parseMoovinResponse(REAL_RESPONSE)!;
    expect(detail.events[0].title).toBe("Sede de Moovin");
    expect(detail.events[0].group).toBe("in_progress");
    expect(detail.events.map((e) => e.code)).toEqual([
      "INMOOVIN",
      "RECIEVEDDELEGATED",
      "PICKUP",
      "PREPARE",
    ]);
  });
});

// El id de Server Action lo emite Next.js como literal en el bundle, dentro de
// createServerReference("<id>", ...). discoverActionIds lo raspa de ahi para
// auto-repararse cuando Moovin redespliega.
describe("extractActionIds", () => {
  it("saca el id de la forma minificada (0,o.createServerReference)(\"id\")", () => {
    const js =
      'var x=(0,o.createServerReference)("7f6d3afc07259da244f5fca31a6a6122df262750a5",o.callServer,void 0,o.findSourceMapURL,"$$ACTION_0");';
    expect(extractActionIds(js)).toEqual(["7f6d3afc07259da244f5fca31a6a6122df262750a5"]);
  });

  it("saca el id de la forma directa createServerReference(\"id\")", () => {
    const js = 'createServerReference("7fae531bab4ee20b1f874b0fafcfa412a52a5a165f",a,b)';
    expect(extractActionIds(js)).toEqual(["7fae531bab4ee20b1f874b0fafcfa412a52a5a165f"]);
  });

  it("deduplica multiples referencias al mismo id", () => {
    const id = "7f6d3afc07259da244f5fca31a6a6122df262750a5";
    const js = `createServerReference("${id}",a);(0,o.createServerReference)("${id}",b);`;
    expect(extractActionIds(js)).toEqual([id]);
  });

  it("cae al respaldo de hex 40-44 cuando no aparece createServerReference", () => {
    const id = "7f6d3afc07259da244f5fca31a6a6122df262750a5";
    expect(extractActionIds(`t.bind(null,"${id}")`)).toEqual([id]);
  });

  it("no inventa ids cuando no hay ninguno", () => {
    expect(extractActionIds("function x(){return 42}")).toEqual([]);
  });
});
