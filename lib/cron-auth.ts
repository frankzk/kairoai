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
// La regla ahora: pasa quien tiene sesion iniciada (los botones de la app) o
// quien trae el secreto (Vercel lo manda solo en cada cron programado).

export function cronAccessAllowed(opts: {
  authenticated: boolean;
  authorization: string | null;
  secret: string | undefined;
}): boolean {
  if (opts.authenticated) return true;
  // Sin secreto configurado no hay con que comparar. Se deja pasar para no
  // cortar los crons el dia del deploy; la tira de salud lo avisa.
  if (!opts.secret) return true;
  return opts.authorization === `Bearer ${opts.secret}`;
}
