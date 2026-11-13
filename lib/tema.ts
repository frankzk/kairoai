// Tono de Kairo: claro por defecto, oscuro si la persona lo elige.
//
// Se guarda por persona en este navegador (localStorage, con el id de la
// cookie kairo_yo), así dos personas que comparten computadora tienen cada
// una el suyo. Un script en <head> lo aplica antes de pintar: sin parpadeo.

export type Tema = "claro" | "oscuro";

export const CLAVE_TEMA = "kairo_tema";

export const claveTema = (id: number | null | undefined) =>
  id == null ? CLAVE_TEMA : `${CLAVE_TEMA}:${id}`;

/** Script que corre en <head> antes del primer pintado. */
export const SCRIPT_TEMA = `(function(){try{var id=null;var m=document.cookie.match(/(?:^|; )kairo_yo=([^;]*)/);if(m){try{id=JSON.parse(decodeURIComponent(m[1])).id}catch(e){}}var t=(id!=null&&localStorage.getItem("${CLAVE_TEMA}:"+id))||localStorage.getItem("${CLAVE_TEMA}");if(t==="oscuro")document.documentElement.classList.add("dark")}catch(e){}})();`;

export function leerTema(id: number | null | undefined): Tema {
  try {
    const t =
      localStorage.getItem(claveTema(id)) ?? localStorage.getItem(CLAVE_TEMA);
    return t === "oscuro" ? "oscuro" : "claro";
  } catch {
    return document.documentElement.classList.contains("dark")
      ? "oscuro"
      : "claro";
  }
}

export function aplicarTema(tema: Tema, id: number | null | undefined) {
  document.documentElement.classList.toggle("dark", tema === "oscuro");
  try {
    localStorage.setItem(claveTema(id), tema);
    // El último elegido en este navegador vale también para el login.
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin almacenamiento (modo privado): vale para esta visita.
  }
}
