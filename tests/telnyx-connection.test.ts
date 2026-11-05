import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  phoneError,
  startPhoneConnection,
  type PhoneClient,
} from "../lib/telnyx-connection";
class FakeClient implements PhoneClient {
  listeners = new Map<string, (value: unknown) => void>();
  on(event: string, callback: (value: unknown) => void) {
    this.listeners.set(event, callback);
  }
  emit(event: string, value?: unknown) {
    this.listeners.get(event)?.(value);
  }
  connect = vi.fn(async () => {});
  clearReconnectToken = vi.fn();
  disconnect = vi.fn(async () => {
    this.emit("telnyx.socket.close");
    this.emit("telnyx.error", { error: { code: 45002 } });
  });
}
function setup() {
  const clients: FakeClient[] = [];
  const options = {
    token: vi.fn(async (_force: boolean) => "private-token"),
    create: vi.fn(async (_token: string) => {
      const c = new FakeClient();
      clients.push(c);
      return c;
    }),
    client: vi.fn(),
    ready: vi.fn(),
    error: vi.fn(),
    notification: vi.fn(),
  };
  const connection = startPhoneConnection(options);
  return { connection, options, clients };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};
describe("ciclo de conexión Telnyx", () => {
  it("una caída causa un único reintento y los eventos del cliente retirado no desconectan al nuevo", async () => {
    const { connection, options, clients } = setup();
    await settle();
    clients[0].emit("telnyx.ready");
    clients[0].emit("telnyx.socket.close");
    expect(clients[0].clearReconnectToken).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000);
    expect(clients).toHaveLength(2);
    clients[1].emit("telnyx.ready");
    clients[0].emit("telnyx.ready");
    clients[0].emit("telnyx.socket.close");
    clients[0].emit("telnyx.notification", { type: "callUpdate" });
    await vi.advanceTimersByTimeAsync(120000);
    expect(clients).toHaveLength(2);
    expect(options.ready).toHaveBeenLastCalledWith(true);
    expect(options.notification).not.toHaveBeenCalled();
    connection.stop();
  });
  it("un error anidado de autenticación renueva el JWT sin esperar socket.close", async () => {
    const { connection, options, clients } = setup();
    await settle();
    clients[0].emit("telnyx.error", {
      error: { code: 46001, message: "JWT private-token" },
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(options.token.mock.calls.map((args) => args[0])).toEqual([
      false,
      true,
    ]);
    expect(options.error.mock.calls.flat().join()).not.toContain(
      "private-token",
    );
    expect(clients).toHaveLength(2);
    connection.stop();
  });
  it("un socket que nunca llega a ready tiene límite de espera y reintentos acotados", async () => {
    const { connection, options, clients } = setup();
    await settle();
    await vi.advanceTimersByTimeAsync(900000);
    expect(clients).toHaveLength(9);
    expect(options.error).toHaveBeenLastCalledWith(
      expect.stringContaining("Pulsa Reconectar"),
    );
    const count = clients.length;
    await vi.advanceTimersByTimeAsync(900000);
    expect(clients).toHaveLength(count);
    connection.stop();
  });
  it("desmontar mientras se pide el JWT impide crear un teléfono después", async () => {
    let resolve!: (token: string) => void;
    const options = {
      token: vi.fn(
        () =>
          new Promise<string>((r) => {
            resolve = r;
          }),
      ),
      create: vi.fn(async () => new FakeClient()),
      client: vi.fn(),
      ready: vi.fn(),
      error: vi.fn(),
      notification: vi.fn(),
    };
    const c = startPhoneConnection(options);
    await settle();
    c.stop();
    resolve("private-token");
    await settle();
    expect(options.create).not.toHaveBeenCalled();
    expect(options.ready).toHaveBeenLastCalledWith(false);
  });
  it("si cambia de asesora durante la carga del SDK se descarta el cliente que llegó tarde", async () => {
    let resolve!: (client: FakeClient) => void;
    const client = new FakeClient();
    const options = {
      token: vi.fn(async () => "token"),
      create: vi.fn(
        () =>
          new Promise<FakeClient>((r) => {
            resolve = r;
          }),
      ),
      client: vi.fn(),
      ready: vi.fn(),
      error: vi.fn(),
      notification: vi.fn(),
    };
    const c = startPhoneConnection(options);
    await settle();
    c.stop();
    resolve(client);
    await settle();
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(options.client).not.toHaveBeenCalledWith(client);
  });
  it("el botón Reconectar reinicia el límite y exige token fresco", async () => {
    const { connection, options, clients } = setup();
    await settle();
    connection.reconnect();
    await settle();
    clients[1].emit("telnyx.ready");
    await vi.advanceTimersByTimeAsync(120000);
    expect(clients).toHaveLength(2);
    expect(options.token).toHaveBeenLastCalledWith(true);
    connection.stop();
  });
  it("el error de micrófono no rompe una sesión de señalización conectada", async () => {
    const { connection, options, clients } = setup();
    await settle();
    clients[0].emit("telnyx.ready");
    clients[0].emit("telnyx.error", { error: { code: 42001 } });
    await vi.advanceTimersByTimeAsync(120000);
    expect(clients).toHaveLength(1);
    expect(options.ready).toHaveBeenLastCalledWith(true);
    expect(options.error).toHaveBeenLastCalledWith(
      expect.stringContaining("micrófono"),
    );
    connection.stop();
  });
  it("normaliza el evento SDK sin divulgar el payload del proveedor", () => {
    expect(
      phoneError({ error: { code: 46001, message: "secret" } }),
    ).toMatchObject({ code: 46001, auth: true, media: false });
    expect(JSON.stringify(phoneError(new Error("secret")))).not.toContain(
      "secret",
    );
  });
});
