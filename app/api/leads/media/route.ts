import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import { getChatAuthHeaders, isIcomflyHost } from "@/lib/icomfly-chat";

export const runtime = "nodejs";
export const maxDuration = 30;

// La media puede vivir en el CDN que Icomfly decida (S3, WhatsApp, etc.) y ese
// host cambia sin avisar, asi que NO se usa allowlist de dominios: se acepta
// cualquier host https PUBLICO y el filtro es anti-SSRF (nada de IPs literales
// ni hosts internos). El JWT de Icomfly solo viaja hacia hosts de Icomfly.
function isSafePublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost")) return false;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return false;
  // Hostnames sin punto (p.ej. nombres de servicio internos de la red).
  if (!h.includes(".")) return false;
  // IPv4 literal (cubre 10.x, 127.x, 169.254.x, etc. de un solo golpe).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  // IPv6 literal (en URLs viene entre corchetes; hostname los conserva).
  if (h.includes(":") || h.startsWith("[")) return false;
  return true;
}

// Tipos por extension. Las notas de voz de WhatsApp son OGG/Opus y varios CDN
// las sirven como application/octet-stream; con ese tipo el navegador no las
// decodifica bien, asi que se corrige por la extension de la URL.
const EXT_CONTENT_TYPE: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  amr: "audio/amr",
  mp4: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function resolveContentType(upstream: string | null, pathname: string): string {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXT_CONTENT_TYPE[ext];
  const type = (upstream ?? "").split(";")[0].trim().toLowerCase();
  // Se confia en el origen salvo que sea generico y la extension diga mas.
  if (!type || type === "application/octet-stream" || type === "binary/octet-stream") {
    return byExt ?? "application/octet-stream";
  }
  return upstream as string;
}

// Proxy de media del chat (imagenes/audios/videos del transcript de Icomfly).
// El navegador no puede pedir la media directo: la URL puede requerir el JWT
// de Icomfly y exponerla seria filtrar el token. Streamea el binario y queda
// protegido por la cookie de sesion como el resto de /api/* (middleware).
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
  if (!isSafePublicHost(target.hostname)) {
    return NextResponse.json(
      { error: `host de media no permitido: ${target.hostname}` },
      { status: 403 }
    );
  }

  const externalStoreId = getIcomflyExternalStoreId(store.code);
  const withAuth = isIcomflyHost(target.hostname) && externalStoreId != null;

  // El <audio> pide rangos de bytes para poder reproducir y buscar; hay que
  // reenviar el Range al origen y devolver el 206 tal cual.
  const range = req.headers.get("range");

  try {
    const fetchMedia = async (forceFresh: boolean) => {
      const headers: Record<string, string> = withAuth
        ? await getChatAuthHeaders(externalStoreId as number, forceFresh)
        : {};
      if (range) headers.Range = range;
      return fetch(target.toString(), { headers, cache: "no-store" });
    };
    let res = await fetchMedia(false);
    if (res.status === 401 && withAuth) {
      res = await fetchMedia(true);
    }
    if (!res.ok || !res.body) {
      // Queda en los logs de Vercel para diagnosticar hosts/URLs vencidas.
      console.error(`leads/media ${res.status} para ${target.hostname}`);
      return NextResponse.json(
        { error: `media ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", resolveContentType(res.headers.get("content-type"), target.pathname));
    // Content-Length SOLO si el origen no comprimio: fetch descomprime solo, y
    // reenviar el largo comprimido le entrega al navegador un stream con el
    // tamano equivocado (se corta => audio mudo, imagen a medias).
    const encoding = res.headers.get("content-encoding");
    const length = res.headers.get("content-length");
    if (length && !encoding) headers.set("Content-Length", length);

    headers.set("Accept-Ranges", res.headers.get("accept-ranges") ?? "bytes");
    const contentRange = res.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);
    // La media de un chat es privada; cache solo en el navegador del usuario.
    headers.set("Cache-Control", "private, max-age=3600");

    return new NextResponse(res.body, { status: res.status === 206 ? 206 : 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al descargar media";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
