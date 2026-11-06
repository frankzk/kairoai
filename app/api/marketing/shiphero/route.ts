// Conexión de Marketing con ShipHero.
// GET: estado (sin tokens; nunca llama a ShipHero ni descifra nada).
// POST: conectar con usuario y contraseña de ShipHero, o con un refresh token
//   de desarrollador. La contraseña solo viaja a /auth/token de ShipHero: no
//   se guarda, no se registra y no se devuelve.
// PATCH: elegir cliente/almacén, o desconectar (borra el acceso guardado; la
//   fila y las fotos se conservan). No hay DELETE.
import { NextRequest } from "next/server";
import {
  canEditMarketing,
  marketingAccess,
  marketingAuthor,
  marketingReply,
  readJsonBody,
} from "@/lib/marketing-access";
import { marketingCatalogLoader } from "@/lib/marketing-catalog-loader";
import { getDB } from "@/lib/db";
import { isMissingRelation } from "@/lib/marketing-inventory-db";
import { SHIPHERO_KEY_VAR, SecretKeyError, secretKeyStatus } from "@/lib/secret-box";
import { SHIPHERO_MESSAGES, ShipHeroError } from "@/lib/shiphero-client";
import {
  SHIPHERO_PENDING_MIGRATION,
  SHIPHERO_SYNC_BUDGET_MS,
  ShipHeroChoiceError,
  ShipHeroStorageError,
  chooseShipHeroScope,
  connectShipHero,
  disconnectShipHero,
  readShipHeroStatus,
  statusFromRow,
  syncShipHeroInventory,
  type ShipHeroSyncResult,
} from "@/lib/shiphero-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_ACCESS = "No tienes acceso a Marketing de Costa Rica.";
const NO_EDIT = "No tienes permiso para modificar Marketing.";

/** ShipHero rejections are never 401: the app reads 401 as "session expired". */
const STATUS_BY_CODE: Partial<Record<ShipHeroError["code"], number>> = {
  bad_credentials: 422,
  api_disabled: 422,
  locked: 422,
  auth_gone: 422,
  reconnect: 422,
  throttled: 429,
};

function keyMessage(): string | null {
  const key = secretKeyStatus(process.env, SHIPHERO_KEY_VAR);
  return key === "ok" ? null : new SecretKeyError(key, SHIPHERO_KEY_VAR).message;
}

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed) return marketingReply({ error: NO_ACCESS }, 403);
  try {
    const canEdit = canEditMarketing(allowed);
    return marketingReply({
      status: "ok",
      // The choices (other warehouses, other 3PL customers) only go to editors.
      connection: await readShipHeroStatus(allowed.store.id, process.env, {
        canEdit,
      }),
      canEdit,
    });
  } catch (error) {
    if (error instanceof ShipHeroStorageError && error.pendingMigration) {
      const empty = statusFromRow(null);
      return marketingReply({
        status: "pending_migration",
        message: SHIPHERO_PENDING_MIGRATION,
        connection: { key: empty.key, staticEnv: empty.staticEnv },
        canEdit: canEditMarketing(allowed),
      });
    }
    return marketingReply(
      { error: "No se pudo leer la conexión con ShipHero." },
      503,
    );
  }
}

type ConnectInput =
  | { mode: "password"; username: string; password: string }
  | { mode: "token"; refreshToken: string };

function connectInput(
  body: Record<string, unknown>,
): ConnectInput | { error: string } {
  if (body.mode === "token") {
    const token =
      typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
    return token.length >= 10 && token.length <= 2000 && !/\s/.test(token)
      ? { mode: "token", refreshToken: token }
      : { error: "Pega el token de desarrollador." };
  }
  if (body.mode === "password") {
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    // The password is not trimmed: spaces may be part of it.
    const password = typeof body.password === "string" ? body.password : "";
    return username.length >= 3 &&
      username.length <= 200 &&
      password.length >= 1 &&
      password.length <= 200
      ? { mode: "password", username, password }
      : { error: "Escribe el correo y la contraseña de ShipHero." };
  }
  return { error: "Escribe el correo y la contraseña de ShipHero." };
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply({ error: allowed ? NO_EDIT : NO_ACCESS }, 403);
  const pendingKey = keyMessage();
  if (pendingKey) return marketingReply({ error: pendingKey }, 503);
  const read = await readJsonBody(req, 4096);
  if ("error" in read) return read.error;
  const input = connectInput(read.body);
  if ("error" in input) return marketingReply({ error: input.error }, 400);

  const storeId = allowed.store.id;
  const { data: allowedAttempt, error: attemptError } = await getDB().rpc(
    "marketing_shiphero_connect_attempt",
    { p_store: storeId },
  );
  if (attemptError)
    return marketingReply(
      {
        error: isMissingRelation(attemptError)
          ? SHIPHERO_PENDING_MIGRATION
          : "No se pudo leer la conexión con ShipHero.",
      },
      503,
    );
  if (allowedAttempt === false)
    return marketingReply(
      { error: "Demasiados intentos. Prueba de nuevo en 15 minutos." },
      429,
    );

  const by = marketingAuthor(allowed.actor);
  try {
    const connection = await connectShipHero(storeId, input, by, {
      deadline: start + 25_000,
    });
    let sync: ShipHeroSyncResult | null = null;
    if (connection.state === "connected")
      // Reported, never fatal: the connection is already saved.
      sync = await syncShipHeroInventory(storeId, {
        by,
        deadline: start + SHIPHERO_SYNC_BUDGET_MS,
        catalog: marketingCatalogLoader(allowed.store),
      }).catch(() => ({ ok: false, error: SHIPHERO_MESSAGES.unexpected }));
    return marketingReply({
      status: "ok",
      connection: sync
        ? await readShipHeroStatus(storeId, process.env, { canEdit: true })
        : connection,
      sync,
    });
  } catch (error) {
    if (error instanceof ShipHeroError) {
      // Only the code: never the body, the input or the error object.
      console.warn("shiphero connect failed", error.code);
      return marketingReply(
        {
          error:
            input.mode === "token" && error.code === "reconnect"
              ? "ShipHero no aceptó ese token. Revisa que sea el refresh token del usuario desarrollador."
              : SHIPHERO_MESSAGES[error.code],
        },
        STATUS_BY_CODE[error.code] ?? 502,
      );
    }
    if (error instanceof SecretKeyError)
      return marketingReply({ error: error.message }, 503);
    if (error instanceof ShipHeroStorageError)
      return marketingReply(
        {
          error: error.pendingMigration
            ? error.message
            : "No se pudo guardar la conexión. Prueba de nuevo.",
        },
        503,
      );
    console.warn("shiphero connect failed", "unexpected");
    return marketingReply({ error: SHIPHERO_MESSAGES.unexpected }, 502);
  }
}

const optionalId = (value: unknown): string | null | undefined | false =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : typeof value === "string" && value.trim() && value.length <= 100
        ? value.trim()
        : false;

export async function PATCH(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply({ error: allowed ? NO_EDIT : NO_ACCESS }, 403);
  const read = await readJsonBody(req, 2048);
  if ("error" in read) return read.error;
  const by = marketingAuthor(allowed.actor);
  const storeId = allowed.store.id;
  try {
    if (read.body.action === "disconnect")
      return marketingReply({
        status: "ok",
        connection: await disconnectShipHero(storeId, by),
      });
    if (read.body.action === "scope") {
      const customerAccountId = optionalId(read.body.customerAccountId);
      const warehouseId = optionalId(read.body.warehouseId);
      if (customerAccountId === false || warehouseId === false)
        return marketingReply(
          { error: "Esa opción ya no está disponible. Vuelve a conectar." },
          400,
        );
      return marketingReply({
        status: "ok",
        connection: await chooseShipHeroScope(
          storeId,
          { customerAccountId, warehouseId },
          by,
        ),
      });
    }
    return marketingReply({ error: "Acción inválida." }, 400);
  } catch (error) {
    if (error instanceof ShipHeroChoiceError)
      return marketingReply({ error: error.message }, 400);
    if (error instanceof ShipHeroStorageError)
      return marketingReply(
        {
          error: error.pendingMigration
            ? error.message
            : "No se pudo guardar. Prueba de nuevo.",
        },
        503,
      );
    return marketingReply({ error: "No se pudo guardar. Prueba de nuevo." }, 503);
  }
}
