import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import { getChatAuthHeaders, isAllowedMediaHost } from "@/lib/icomfly-chat";

export const runtime = "nodejs";
export const maxDuration = 30;

// Proxy de media del chat (imagenes/audios/videos del transcript de Icomfly).
// El navegador no puede pedir la media directo: las URLs pueden requerir el JWT
// de Icomfly y exponerlas seria filtrar el token. Este proxy valida el host
// contra una allowlist (anti-SSRF), adjunta la auth solo para hosts de Icomfly
// y streamea el binario. Queda protegido por la cookie de sesion como el resto
// de /api/* (middleware).
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  const rawUrl = req.nextUrl.searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "url invalida" }, { status: 400 });
  }
  if (target.protocol !== "https:") {
    return NextResponse.json({ error: "solo se permite https" }, { status: 400 });
  }
  if (!isAllowedMediaHost(target.hostname)) {
    // Host desconocido: no descargamos. Si Icomfly cambia de CDN, agregarlo a
    // LEADS_MEDIA_ALLOWED_HOSTS.
    return NextResponse.json(
      { error: `host de media no permitido: ${target.hostname}` },
      { status: 403 }
    );
  }

  const externalStoreId = getIcomflyExternalStoreId(store.code);
  const isIcomfly =
    target.hostname === "icomfly.com" || target.hostname.endsWith(".icomfly.com");

  try {
    const fetchMedia = async (forceFresh: boolean) => {
      const headers: Record<string, string> =
        isIcomfly && externalStoreId != null
          ? await getChatAuthHeaders(externalStoreId, forceFresh)
          : {};
      return fetch(target.toString(), { headers, cache: "no-store" });
    };
    let res = await fetchMedia(false);
    if (res.status === 401 && isIcomfly && externalStoreId != null) {
      res = await fetchMedia(true);
    }
    if (!res.ok || !res.body) {
      return NextResponse.json(
        { error: `media ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") ?? "application/octet-stream");
    const length = res.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    // La media de un chat es privada; cache solo en el navegador del usuario.
    headers.set("Cache-Control", "private, max-age=3600");
    return new NextResponse(res.body, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al descargar media";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
