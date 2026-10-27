// Quien puede disparar un cron. Puro, sin imports: lo usa el middleware, que
// corre en el runtime edge.
//
// UNA sola puerta, en el middleware. Antes habia dos mitades:
//   - El middleware dejaba pasar /api/cron/* a cualquiera (estaban todas en
//     PUBLIC_PATHS), y CRON_SECRET nunca se configuro en Vercel: cualquiera
//     en internet podia disparar el sync de leads, de Shopify o de Moovin.
//   - Moovin, Forza y shopify-refresh tenian su propio chequeo que SOLO
//     aceptaba el secreto. El dia que se configurara, el boton "Detectar" de
//     Novedades —que llama a /api/cron/moovin desde el navegador, con la
//     sesion y sin el secreto— recibiria 401, y SessionGuard ante cualquier
//     401 manda al login: la usuaria quedaba expulsada por apretar un boton.
//
// La regla ahora (27/10/2026):
//   - Pasa quien trae el secreto: Vercel lo manda solo en cada cron programado.
//   - Con sesion, solo quien tiene el permiso de ESE cron
//     (permisosParaCronManual en lib/permisos.ts): el boton "Detectar" de
//     Novedades, o quien administra. Antes pasaba cualquier sesion.
//   - Sin secreto configurado NO pasa nadie sin sesion. Antes se dejaba pasar
//     "para no cortar los crons el dia del deploy", y CRON_SECRET no estaba en
//     Vercel: cualquiera en internet podia dispararlos.

export function cronAccessAllowed(opts: {
  /** Permisos de la sesion, o null si no hay sesion. */
  permisos: readonly string[] | null;
  /** Alguno de estos permisos deja dispararlo a mano. */
  requeridos: readonly string[];
  authorization: string | null;
  secret: string | undefined;
}): boolean {
  if (opts.permisos && opts.requeridos.some((p) => opts.permisos!.includes(p))) return true;
  if (!opts.secret) return false;
  return opts.authorization === `Bearer ${opts.secret}`;
}

/** Worker externo de Italia: falla cerrado y limita el acceso manual a su tienda. */
export function wooCronAccessAllowed(opts: {
  identity: { u: number; s: string[]; p: string[]; mc?: boolean } | null;
  authorization: string | null;
  secret: string | undefined;
}): boolean {
  const who = opts.identity;
  if (who && !who.mc && (who.u === 0 || who.s.includes("kenku-it")) &&
      who.p.some(p => p === "pedidos" || p === "finanzas")) return true;
  return Boolean(opts.secret && opts.authorization === `Bearer ${opts.secret}`);
}
