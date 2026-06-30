import { describe, expect, it } from "vitest";
import { parseMoovinResponse } from "@/lib/moovin";

// Cuando Moovin redespliega, el POST de Server Action (next-action) queda ciego.
// La via robusta es el GET a la pagina, que renderiza el tracking server-side y
// lo incrusta en el HTML como self.__next_f.push([1,"<chunk RSC>"]). Estos casos
// fijan que el parser reconstruye ese formato igual que la respuesta RSC directa.

// Arma el row RSC ("<n>:{...}\n") y lo envuelve en el script que usa Next.js.
function htmlWithFlight(flightRow: string): string {
  return (
    "<!DOCTYPE html><html><body>" +
    "<script>self.__next_f.push([0])</script>" +
    `<script>self.__next_f.push([1,${JSON.stringify(flightRow)}])</script>` +
    "</body></html>"
  );
}

const PAYLOAD = {
  idPackage: 2557364,
  nameProfile: "BOXFUL TECHNOLOGIES personal",
  serialNumber: "4d03618ef2ae4aa0",
  listStatus: [
    { date: "2026-06-29T17:06:00Z", status: "PREPARE", title: "Por preparar", comments: [] },
    { date: "2026-06-30T10:07:00Z", status: "INROUTE", title: "En sede local", comments: [] },
  ],
  coorList: [{ address: "Los bajos de la claudia", name: "Punto de entrega" }],
};

describe("parseMoovinResponse (HTML del GET)", () => {
  it("rescata el tracking incrustado en self.__next_f", () => {
    const html = htmlWithFlight(`1:${JSON.stringify(PAYLOAD)}\n`);
    const detail = parseMoovinResponse(html)!;
    expect(detail).not.toBeNull();
    expect(detail.tracking_number).toBe("4d03618ef2ae4aa0");
    expect(detail.profile).toBe("BOXFUL TECHNOLOGIES personal");
    expect(detail.delivery_address).toBe("Los bajos de la claudia");
    // El mas reciente queda primero tras ordenar por fecha desc.
    expect(detail.events[0].title).toBe("En sede local");
  });

  it("reensambla el payload partido en varios chunks self.__next_f", () => {
    const flightRow = `1:${JSON.stringify(PAYLOAD)}\n`;
    const mid = Math.floor(flightRow.length / 2);
    const html =
      "<script>self.__next_f.push([1," +
      JSON.stringify(flightRow.slice(0, mid)) +
      "])</script>" +
      "<script>self.__next_f.push([1," +
      JSON.stringify(flightRow.slice(mid)) +
      "])</script>";
    const detail = parseMoovinResponse(html)!;
    expect(detail.tracking_number).toBe("4d03618ef2ae4aa0");
    expect(detail.events).toHaveLength(2);
  });

  it("sigue interpretando la respuesta RSC directa del Server Action", () => {
    const rsc = `0:{"a":"x"}\n1:${JSON.stringify(PAYLOAD)}\n`;
    const detail = parseMoovinResponse(rsc)!;
    expect(detail.tracking_number).toBe("4d03618ef2ae4aa0");
  });

  it("HTML sin payload de tracking devuelve null", () => {
    const html = "<html><body><script>self.__next_f.push([1,\"3:[\\\"$\\\",\\\"div\\\"]\\n\"])</script></body></html>";
    expect(parseMoovinResponse(html)).toBeNull();
  });
});
