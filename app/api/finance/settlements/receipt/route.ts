// Cobro de una liquidacion: el comprobante bancario y el doble check del monto.
//
//   POST   sube el comprobante y/o guarda los montos del cobro
//   GET    devuelve una URL firmada para ver el comprobante
//   DELETE borra los montos (deja el archivo)
//
// Va en su propia ruta y no en /api/finance/settlements porque ahi el PATCH ya
// esta ocupado por el match manual de filas.

import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreConfig, getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  clearReceiptAmounts,
  RECEIPT_MAX_BYTES,
  RECEIPT_MIME_TYPES,
  saveReceipt,
  signedReceiptUrl,
  uploadReceipt,
} from "@/lib/settlement-receipt-db";
import { checkReceipt } from "@/lib/settlement-receipt";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const maxDuration = 60;

function missingStore() {
  return NextResponse.json(
    { error: "store requerido: usa mireva-cr o mireva-hn" },
    { status: 400 }
  );
}

/** Numero de un campo de formulario. Vacio -> null, basura -> undefined. */
function numeroOpcional(raw: FormDataEntryValue | null): number | null | undefined {
  const texto = String(raw ?? "").trim();
  if (!texto) return null;
  // Se aceptan las dos formas de escribir decimales: 13.600,50 y 13600.50.
  const n = Number(texto.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStore();
  const importId = Number(req.nextUrl.searchParams.get("import_id"));
  if (!importId) return NextResponse.json({ error: "import_id requerido" }, { status: 400 });

  try {
    const signed = await signedReceiptUrl(store.id, importId);
    if (!signed) {
      return NextResponse.json({ error: "Esta liquidacion no tiene comprobante" }, { status: 404 });
    }
    return NextResponse.json(signed);
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al abrir el comprobante");
    console.error(`[settlements/receipt GET] ${store.code} import=${importId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let store: ReturnType<typeof getRequiredStoreConfig> = null;
  let importId = 0;
  try {
    const form = await req.formData();
    store = getRequiredStoreConfig(form.get("store"));
    if (!store) return missingStore();
    importId = Number(form.get("import_id"));
    if (!importId) return NextResponse.json({ error: "import_id requerido" }, { status: 400 });

    const receivedUsd = numeroOpcional(form.get("received_usd"));
    const referenceRate = numeroOpcional(form.get("reference_rate"));
    if (receivedUsd === undefined) {
      return NextResponse.json(
        { error: "El monto recibido tiene que ser un numero mayor que cero" },
        { status: 400 }
      );
    }
    if (referenceRate === undefined) {
      return NextResponse.json(
        { error: "La tasa de referencia tiene que ser un numero mayor que cero" },
        { status: 400 }
      );
    }

    const receivedAt = String(form.get("received_at") ?? "").trim() || null;
    // Se valida la forma, no solo que venga algo: una fecha mal tecleada
    // arruina la comparacion contra la tasa del dia sin que se note.
    if (receivedAt && !/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
      return NextResponse.json({ error: "Fecha de recepcion invalida" }, { status: 400 });
    }

    // El archivo es OPCIONAL: se puede corregir un monto mal tecleado sin tener
    // que volver a subir la captura.
    let nuevaRuta: string | undefined;
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > RECEIPT_MAX_BYTES) {
        return NextResponse.json(
          { error: `El comprobante no puede pasar de ${RECEIPT_MAX_BYTES / 1024 / 1024} MB` },
          { status: 400 }
        );
      }
      if (!RECEIPT_MIME_TYPES.includes(file.type as (typeof RECEIPT_MIME_TYPES)[number])) {
        return NextResponse.json(
          { error: `Tipo de archivo no admitido: ${file.type || "desconocido"}. Sube PNG, JPG, WEBP o PDF.` },
          { status: 400 }
        );
      }
      nuevaRuta = await uploadReceipt({
        storeId: store.id,
        importId,
        bytes: await file.arrayBuffer(),
        mime: file.type,
      });
    }

    const updated = await saveReceipt(
      store.id,
      importId,
      {
        received_usd: receivedUsd,
        received_at: receivedAt,
        reference_rate: referenceRate,
        received_note: String(form.get("received_note") ?? "").trim() || null,
        received_by: String(form.get("received_by") ?? "").trim() || null,
      },
      nuevaRuta
    );
    if (!updated) {
      return NextResponse.json({ error: "Liquidacion no encontrada" }, { status: 404 });
    }

    // El veredicto se devuelve calculado para que la pantalla no tenga que
    // repetir la matematica del dinero.
    const check = checkReceipt({
      declaredLocal: Number(updated.total_to_liquidate),
      receivedUsd: Number(updated.received_usd),
      referenceRate: updated.reference_rate,
    });

    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[settlements/receipt cache]", cacheErr)
    );
    return NextResponse.json({ ok: true, import: updated, check });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al guardar el cobro");
    console.error(`[settlements/receipt POST] ${store?.code ?? "?"} import=${importId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return missingStore();
  const importId = Number(req.nextUrl.searchParams.get("import_id"));
  if (!importId) return NextResponse.json({ error: "import_id requerido" }, { status: 400 });

  try {
    const updated = await clearReceiptAmounts(store.id, importId);
    if (!updated) {
      return NextResponse.json({ error: "Liquidacion no encontrada" }, { status: 404 });
    }
    await refreshFinanceDatasetCache(store).catch((cacheErr) =>
      console.warn("[settlements/receipt DELETE cache]", cacheErr)
    );
    return NextResponse.json({ ok: true, import: updated });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al borrar el cobro");
    console.error(`[settlements/receipt DELETE] ${store.code} import=${importId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
