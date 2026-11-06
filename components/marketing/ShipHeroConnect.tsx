"use client";
// Tarjeta "Conectar ShipHero" (Marketing › Fuentes). La contraseña vive solo
// en el estado de este componente: va una vez por POST al servidor (que la
// manda solo a ShipHero) y se borra al terminar, salga bien o mal. Nunca va
// en la URL, en localStorage ni en el estado de otro componente.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { ShipHeroStatus } from "@/lib/shiphero-connection";
import { count, dateTimeCr } from "./format";
import { sendMarketing, useResource } from "./useMarketing";
import s from "./dashboard.module.css";
import r from "./team-report.module.css";

const SHIPHERO_URL = "/api/marketing/shiphero?store=mireva-cr";
const SYNC_URL = "/api/marketing/shiphero/sync?store=mireva-cr";

type Payload =
  | { status: "ok"; connection: ShipHeroStatus; canEdit: boolean }
  | {
      status: "pending_migration";
      message: string;
      connection: Pick<ShipHeroStatus, "key" | "staticEnv">;
      canEdit: boolean;
    };

type SyncResult = {
  ok: boolean;
  skipped?: string;
  rows?: number;
  error?: string;
};

function syncText(result: SyncResult | null | undefined): string | null {
  if (!result) return null;
  if (result.rows != null)
    return `Inventario guardado: ${count(result.rows)} SKU.`;
  if (result.skipped === "falta_elegir")
    return result.error || "Elige qué inventario leer.";
  if (result.skipped === "ocupado")
    return "Ya hay una sincronización en curso. Prueba en un minuto.";
  if (result.skipped === "cambio")
    return "La conexión cambió durante la lectura. No se guardó nada. Prueba de nuevo.";
  return result.error || null;
}

export function ShipHeroConnect({
  canEdit,
  onChanged,
}: {
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const resource = useResource<Payload>(SHIPHERO_URL, revision);
  const [busy, setBusy] = useState<
    "" | "connect" | "scope" | "sync" | "disconnect"
  >("");
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(
    null,
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [useToken, setUseToken] = useState(false);
  const [customer, setCustomer] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [changingScope, setChangingScope] = useState(false);

  const refresh = () => {
    setRevision((value) => value + 1);
    onChanged();
  };
  const payload = resource.data;
  const editable = canEdit && (payload?.canEdit ?? true);
  // The server says how long the wait is (no browser clock): when it ends, the
  // button comes back without a reload.
  const [cooled, setCooled] = useState<Payload | null>(null);
  useEffect(() => {
    if (payload?.status !== "ok" || !(payload.connection.syncInMs > 0)) return;
    const timer = setTimeout(
      () => setCooled(payload),
      payload.connection.syncInMs + 1_000,
    );
    return () => clearTimeout(timer);
  }, [payload]);

  async function sync() {
    setBusy("sync");
    const result = await sendMarketing<{ result: SyncResult }>(SYNC_URL, "POST");
    setBusy("");
    setNotice(
      result.ok
        ? {
            text: syncText(result.data.result) || "Sincronización terminada.",
            warn: !result.data.result.rows,
          }
        : { text: result.error, warn: true },
    );
    refresh();
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy("connect");
    setNotice(null);
    try {
      const result = await sendMarketing<{
        connection: ShipHeroStatus;
        sync: SyncResult | null;
      }>(
        SHIPHERO_URL,
        "POST",
        useToken
          ? { mode: "token", refreshToken: token }
          : { mode: "password", username, password },
      );
      if (!result.ok) setNotice({ text: result.error, warn: true });
      else
        setNotice({
          text:
            result.data.connection.state === "needs_scope"
              ? "Conectado. Elige qué inventario leer."
              : syncText(result.data.sync) || "ShipHero conectado.",
          warn: Boolean(result.data.sync && !result.data.sync.ok),
        });
      if (result.ok) refresh();
    } finally {
      // The secret never outlives the request, whatever the outcome.
      setPassword("");
      setToken("");
      setBusy("");
    }
  }

  async function saveScope(connection: ShipHeroStatus) {
    setBusy("scope");
    const body: Record<string, string | null> = {};
    // A chosen customer is locked: changing it needs a new connection.
    if (connection.accountKind === "3pl" && !connection.customer && customer)
      body.customerAccountId = customer;
    if (warehouse) body.warehouseId = warehouse;
    const result = await sendMarketing<{ connection: ShipHeroStatus }>(
      SHIPHERO_URL,
      "PATCH",
      { action: "scope", ...body },
    );
    setBusy("");
    if (!result.ok) {
      setNotice({ text: result.error, warn: true });
      return;
    }
    setChangingScope(false);
    if (result.data.connection.state === "connected") await sync();
    else refresh();
  }

  async function disconnect() {
    if (
      !window.confirm(
        "¿Desconectar ShipHero? Kairo deja de leer el inventario. Las fotos guardadas se conservan.",
      )
    )
      return;
    setBusy("disconnect");
    const result = await sendMarketing(SHIPHERO_URL, "PATCH", { action: "disconnect" });
    setBusy("");
    setNotice(
      result.ok
        ? {
            text: "ShipHero desconectado. Si quieres cortar el acceso del todo, cambia la contraseña en ShipHero.",
            warn: false,
          }
        : { text: result.error, warn: true },
    );
    refresh();
  }

  let body: ReactNode;
  if (resource.loading && !payload) body = <p role="status">Consultando ShipHero…</p>;
  else if (!payload)
    body = (
      <p role="alert" className={r.warnText}>
        {resource.error || "No se pudo consultar la conexión con ShipHero."}
      </p>
    );
  else if (payload.status === "pending_migration")
    body = <p className={r.warnText}>{payload.message}</p>;
  else {
    const c = payload.connection;
    const live = ["connected", "needs_scope"].includes(c.state);
    const coolingDown = c.syncInMs > 0 && cooled !== payload;
    const activeWarehouses = c.choices.warehouses.filter((w) => w.active);
    const showScope = c.state === "needs_scope" || changingScope;
    body = (
      <>
        {!c.key.configured && (
          <p role="alert" className={r.warnText}>
            {c.key.message ||
              "Pendiente: configurar SHIPHERO_TOKEN_KEY."}{" "}
            Sin esa clave Kairo no puede guardar el acceso.
          </p>
        )}
        {c.staticEnv &&
          (c.state === "not_connected" || c.state === "disconnected") && (
          <p className={r.caption}>
            Conectado con la configuración del servidor (SHIPHERO_CR_*).
          </p>
        )}
        {live && (
          <ul className="mt-2 space-y-1">
            <li>
              Conectado como <b>{c.userEmail || "usuario de ShipHero"}</b>
              {c.connectedBy ? ` · por ${c.connectedBy}` : ""}
            </li>
            {c.accountKind === "3pl" && (
              <li>Cliente: {c.customer ? c.customer.name : "sin elegir"}</li>
            )}
            <li>
              Almacén:{" "}
              {c.warehouse
                ? c.warehouse.name
                : activeWarehouses.length > 1
                  ? "sin elegir"
                  : "el único que ve tu usuario"}
            </li>
            <li>
              Última foto:{" "}
              {c.lastSyncOkAt
                ? `${dateTimeCr(c.lastSyncOkAt)}${c.lastSyncRows != null ? ` · ${count(c.lastSyncRows)} SKU` : ""}`
                : "todavía ninguna"}
            </li>
            <li>
              En camino:{" "}
              {c.incoming
                ? "aproximado (órdenes de compra abiertas de los últimos 180 días)"
                : "sin dato"}
            </li>
          </ul>
        )}
        {c.state === "reconnect" && (
          <p role="alert" className={r.warnText}>
            ShipHero pide volver a conectar.
          </p>
        )}
        {c.lastError && (
          <p role="alert" className={r.warnText}>
            {c.lastError}
          </p>
        )}
        {!editable ? (
          <p className={r.caption}>
            Solo quien edita Marketing puede conectar ShipHero.
          </p>
        ) : showScope && live ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <p className="w-full">Elige qué inventario leer.</p>
            {c.accountKind === "3pl" && !c.customer && (
              <p className={`${r.warnText} w-full`}>
                Ese usuario es de Boxful y ve a todos sus clientes. Elige solo
                el de Mireva: para cambiarlo después hay que volver a conectar.
              </p>
            )}
            {c.accountKind === "3pl" && !c.customer && (
              <label className={r.field}>
                Cliente
                <select
                  value={customer}
                  onChange={(event) => setCustomer(event.target.value)}
                  disabled={busy !== ""}
                >
                  <option value="">Elige…</option>
                  {c.choices.customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {c.choices.warehouses.length > 1 && (
              <label className={r.field}>
                Almacén
                <select
                  value={warehouse || c.warehouse?.id || ""}
                  onChange={(event) => setWarehouse(event.target.value)}
                  disabled={busy !== ""}
                >
                  <option value="">Elige…</option>
                  {c.choices.warehouses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                      {item.active ? "" : " (inactivo)"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() => saveScope(c)}
            >
              {busy === "scope" ? "Guardando…" : "Guardar"}
            </button>
            {c.state === "connected" && changingScope && (
              <button
                type="button"
                className={r.inlineLink}
                disabled={busy !== ""}
                onClick={() => {
                  setChangingScope(false);
                  setWarehouse("");
                }}
              >
                Cancelar
              </button>
            )}
            {c.choices.customersTruncated && (
              <p className={`${r.caption} w-full`}>
                Hay más clientes de los que Kairo puede listar.
              </p>
            )}
          </div>
        ) : live ? (
          <div className={`${r.statusActions} mt-3`}>
            <button
              type="button"
              disabled={busy !== "" || coolingDown || !c.key.configured}
              onClick={sync}
              title={coolingDown ? "Espera unos minutos" : undefined}
            >
              {busy === "sync"
                ? "Sincronizando…"
                : coolingDown
                  ? "Espera unos minutos"
                  : "Sincronizar ahora"}
            </button>
            {c.choices.warehouses.length >= 2 && (
              <button
                type="button"
                disabled={busy !== ""}
                onClick={() => setChangingScope(true)}
              >
                Cambiar almacén
              </button>
            )}
            <button
              type="button"
              disabled={busy !== ""}
              onClick={disconnect}
            >
              {busy === "disconnect" ? "Desconectando…" : "Desconectar"}
            </button>
          </div>
        ) : (
          <form className="mt-3 grid gap-3" onSubmit={connect}>
            <p className="font-medium">Conectar ShipHero</p>
            {useToken ? (
              <label className={r.field}>
                Refresh token de ShipHero
                <textarea
                  name="shiphero-token"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  rows={3}
                  className="rounded-md border border-[var(--mk-border)] bg-[var(--mk-surface)] p-2 text-xs"
                  disabled={busy !== "" || !c.key.configured}
                  required
                />
                <span>
                  Lo crea un administrador en ShipHero: My Account › Developer
                  Users.
                </span>
              </label>
            ) : (
              <>
                <label className={r.field}>
                  Correo de ShipHero
                  <input
                    name="shiphero-user"
                    type="text"
                    inputMode="email"
                    autoComplete="off"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={busy !== "" || !c.key.configured}
                    required
                  />
                </label>
                <label className={r.field}>
                  Contraseña
                  <input
                    name="shiphero-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy !== "" || !c.key.configured}
                    required
                  />
                </label>
              </>
            )}
            <div className={r.statusActions}>
              <button
                type="submit"
                disabled={busy !== "" || !c.key.configured}
              >
                {busy === "connect" ? "Conectando…" : "Conectar"}
              </button>
              <button
                type="button"
                className={r.inlineLink}
                disabled={busy !== ""}
                onClick={() => {
                  setUseToken((value) => !value);
                  setPassword("");
                  setToken("");
                }}
              >
                {useToken
                  ? "Usar correo y contraseña"
                  : "Tengo un token de desarrollador"}
              </button>
            </div>
            <p className={r.caption}>
              La contraseña se envía una sola vez a ShipHero y Kairo no la
              guarda. Kairo guarda solo el acceso que entrega ShipHero,
              cifrado, y lo usa para leer el inventario.
            </p>
          </form>
        )}
      </>
    );
  }

  return (
    <section className={`${s.section} mt-6`} aria-labelledby="shiphero-title">
      <h2 id="shiphero-title" className={s.heading}>
        ShipHero
      </h2>
      <div className={r.report}>
        <p className={`${s.muted} mt-2`}>
          Inventario de Mireva en Boxful: stock por SKU, pedidos esperando y
          unidades en camino. Kairo lo lee 4 veces al día.
        </p>
        {body}
        {notice && (
          <p
            role={notice.warn ? "alert" : "status"}
            className={notice.warn ? r.warnText : r.caption}
          >
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
}
