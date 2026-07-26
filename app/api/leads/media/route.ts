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

  try {
    const fetchMedia = async (forceFresh: boolean) => {
      const headers: Record<string, string> = withAuth
        ? await getChatAuthHeaders(externalStoreId as number, forceFresh)
        : {};
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
