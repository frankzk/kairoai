// Browser-only lifecycle, independent of React so connection races can be tested.
export interface PhoneClient {
  on(event: string, callback: (event: unknown) => void): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  clearReconnectToken(): void;
}
export function phoneError(event: unknown) {
  const envelope =
    event && typeof event === "object"
      ? (event as Record<string, unknown>)
      : {};
  const error =
    envelope.error && typeof envelope.error === "object"
      ? (envelope.error as Record<string, unknown>)
      : envelope;
  const browserCode =
    error.name === "NotAllowedError"
      ? 42001
      : error.name === "NotFoundError"
        ? 42002
        : error.name === "NotReadableError"
          ? 42003
          : null;
  const code =
    typeof error.code === "number" && Number.isInteger(error.code)
      ? error.code
      : browserCode;
  const auth = code !== null && code >= 46001 && code <= 46003;
  const media = code !== null && code >= 40001 && code <= 44099;
  // Never echo provider payloads, JWTs or URLs into user-visible diagnostics.
  const message = auth
    ? "Telnyx rechazó la sesión del teléfono. Renovando conexión…"
    : code === 42001
      ? "Permite el acceso al micrófono en el navegador."
      : code === 42002
        ? "No se encontró un micrófono disponible."
        : code === 42003
          ? "No se pudo abrir el micrófono. Revisa si otra aplicación lo está usando."
          : media
            ? "No se pudo iniciar el audio de la llamada. Revisa el micrófono."
            : "No se pudo conectar con Telnyx. Revisa la conexión a internet.";
  return { code, auth, media, message };
}

/** One retry owner and one live client. Retired clients may never alter the new session. */
export function startPhoneConnection<T extends PhoneClient>(options: {
  token: (force: boolean) => Promise<string>;
  create: (token: string) => Promise<T>;
  client: (client: T | null) => void;
  ready: (ready: boolean) => void;
  error: (message: string | null) => void;
  notification: (event: unknown) => void;
}) {
  let stopped = false,
    generation = 0,
    failures = 0;
  let active: T | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let disposing: Promise<void> = Promise.resolve();
  const clearTimers = () => {
    clearTimeout(retry);
    clearTimeout(watchdog);
    retry = undefined;
    watchdog = undefined;
  };
  const retire = () => {
    const old = active;
    active = null; // Invalidate event callbacks BEFORE disconnect emits socket.close.
    options.client(null);
    if (old) {
      old.clearReconnectToken();
      disposing = disposing.then(() => old.disconnect()).catch(() => {});
    }
    return disposing;
  };
  const current = (id: number, client: T) =>
    !stopped && id === generation && active === client;

  function schedule(id: number, force: boolean, message: string) {
    if (stopped || id !== generation || retry !== undefined) return;
    clearTimeout(watchdog);
    options.ready(false);
    void retire();
    failures++;
    if (failures > 8) {
      options.error(
        "El teléfono no logró conectarse. Pulsa Reconectar teléfono para volver a intentar.",
      );
      return;
    }
    options.error(message);
    retry = setTimeout(
      () => {
        retry = undefined;
        void connect(force);
      },
      Math.min(3000 * 2 ** (failures - 1), 60000),
    );
  }
  async function connect(force = false) {
    if (stopped) return;
    const id = ++generation;
    clearTimers();
    options.ready(false);
    await retire();
    if (stopped || id !== generation) return;
    let token: string;
    try {
      token = await options.token(force);
    } catch {
      schedule(id, force, "Conectando el teléfono… reintentando.");
      return;
    }
    if (stopped || id !== generation) return;
    let c: T;
    try {
      c = await options.create(token);
    } catch {
      schedule(
        id,
        false,
        "No se pudo cargar el teléfono. Reintentando conexión…",
      );
      return;
    }
    if (stopped || id !== generation) {
      c.clearReconnectToken();
      await c.disconnect().catch(() => {});
      return;
    }
    active = c;
    options.client(c);
    c.on("telnyx.ready", () => {
      if (!current(id, c)) return;
      clearTimeout(watchdog);
      failures = 0;
      options.ready(true);
      options.error(null);
    });
    c.on("telnyx.error", (event) => {
      if (!current(id, c)) return;
      const error = phoneError(event);
      if (error.media) {
        options.error(error.message);
        return;
      }
      schedule(id, error.auth, error.message);
    });
    c.on("telnyx.socket.close", () => {
      if (current(id, c))
        schedule(
          id,
          false,
          "Se perdió la conexión del teléfono. Reconectando…",
        );
    });
    c.on("telnyx.socket.error", () => {
      if (current(id, c))
        schedule(id, false, "No se pudo conectar con Telnyx. Reintentando…");
    });
    c.on("telnyx.notification", (event) => {
      if (current(id, c)) options.notification(event);
    });
    // connect() may resolve before ready, or the socket can stall without a close event.
    watchdog = setTimeout(() => {
      if (current(id, c))
        schedule(
          id,
          true,
          "El teléfono tardó demasiado en conectar. Renovando sesión…",
        );
    }, 20000);
    try {
      await c.connect();
    } catch (event) {
      if (current(id, c))
        schedule(
          id,
          phoneError(event).auth,
          "No se pudo conectar el teléfono. Reintentando…",
        );
    }
  }
  void connect();
  return {
    reconnect() {
      if (!stopped) {
        failures = 0;
        void connect(true);
      }
    },
    stop() {
      stopped = true;
      generation++;
      clearTimers();
      options.ready(false);
      void retire();
    },
  };
}
