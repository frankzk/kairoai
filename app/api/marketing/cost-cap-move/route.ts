// Marketing › Acciones › "Pasar a COST CAP" (25/11/2026): crea en Meta un
// anuncio nuevo, ACTIVO, con la misma publicación, dentro de un conjunto que
// ya existe de la campaña COST CAP del mismo producto. Es la ÚNICA ruta de
// Kairo que escribe en Meta: nunca toca presupuestos, pujas ni estados, nunca
// crea campañas ni conjuntos, no borra nada y nada es automático (sin cron:
// solo con el botón y su confirmación).
//
//   GET  ?store=mireva-cr|mireva-hn&account=<cuenta del anuncio>&ad=<anuncio>
//        → vista previa leída en vivo de Meta: el anuncio, las COST CAP destino
//          (de cualquier cuenta ACTIVA) con sus conjuntos, si la publicación ya
//          está ahí y `blocked` con el motivo cuando no se puede.
//   POST ?store=mireva-cr|mireva-hn  { account, ad, targetAccount, adset }
//        → vuelve a validar todo en el servidor, reserva en el registro de
//          cambios, crea el anuncio y deja el "Hecho". Devuelve el id nuevo.
//
// Leer pide el permiso de Marketing; escribir, además, poder editar Marketing
// (igual que «Registrar cambio» y los ajustes). La respuesta nunca lleva el
// token ni el mensaje de error de Meta. La lógica está en
// lib/marketing-cost-cap-move.ts (pura) y lib/marketing-cost-cap-move-server.ts.
import { NextRequest } from "next/server";
import {
  canEditMarketing,
  marketingAccess,
  marketingAuthor,
  marketingReply,
  readJsonBody,
} from "@/lib/marketing-access";
import {
  createCostCapAd,
  dbMoveLedger,
  loadMoveAssignments,
  MoveReadError,
  previewCostCapMove,
} from "@/lib/marketing-cost-cap-move-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Los ids van dentro de la consulta a Meta: solo dígitos. */
const id = (value: unknown): string | null => {
  const text =
    typeof value === "string" ? value.trim().replace(/^act_/, "") : "";
  return /^\d{1,30}$/.test(text) ? text : null;
};

const failure = (error: unknown) =>
  error instanceof MoveReadError
    ? marketingReply({ error: error.reason }, error.status)
    : marketingReply(
        { error: "No se pudo consultar Meta. Vuelve a intentarlo." },
        502,
      );

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed)
    return marketingReply(
      { error: "Se requiere Marketing y acceso a la tienda elegida." },
      403,
    );
  const params = req.nextUrl.searchParams;
  const account = id(params.get("account")),
    ad = id(params.get("ad"));
  if (!account || !ad)
    return marketingReply(
      { error: "account y ad deben ser ids numéricos." },
      400,
    );
  try {
    return marketingReply(
      await previewCostCapMove(
        { account, ad },
        {
          store: allowed.store.code,
          assignments: () => loadMoveAssignments(allowed.store),
        },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!canEditMarketing(allowed))
    return marketingReply(
      { error: "No tienes permiso para modificar Marketing." },
      403,
    );
  const read = await readJsonBody(req, 2048);
  if ("error" in read) return read.error;
  const body = read.body;
  if (body.store !== undefined && body.store !== allowed.store.code)
    return marketingReply({ error: "Tienda no autorizada." }, 400);
  const account = id(body.account),
    ad = id(body.ad),
    targetAccount = id(body.targetAccount),
    adset = id(body.adset);
  if (!account || !ad || !targetAccount || !adset)
    return marketingReply(
      {
        error: "account, ad, targetAccount y adset deben ser ids numéricos.",
      },
      400,
    );
  try {
    const outcome = await createCostCapAd(
      { account, ad, targetAccount, adset },
      {
        store: allowed.store.code,
        assignments: () => loadMoveAssignments(allowed.store),
        ledger: dbMoveLedger(allowed.store.id, marketingAuthor(allowed.actor)),
      },
    );
    if (!outcome.ok)
      return marketingReply(
        {
          error: outcome.reason,
          ...(outcome.kind ? { kind: outcome.kind } : {}),
        },
        outcome.status,
      );
    return marketingReply({
      created: true,
      adId: outcome.adId,
      adName: outcome.adName,
      method: outcome.method,
      destination: outcome.destination,
      change: outcome.change,
      ...(outcome.change
        ? {}
        : {
            warning:
              "El anuncio se creó, pero no se pudo anotar el «Hecho» en el registro de cambios.",
          }),
    });
  } catch (error) {
    return failure(error);
  }
}
