import type { ItaliaStatus } from "@/lib/italia-orders";

export const control = "inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40";
export const statusTone: Record<ItaliaStatus,string> = {
  pending:"bg-slate-500/15 text-slate-300", confirmed:"bg-amber-500/15 text-amber-300",
  dispatched:"bg-cyan-500/15 text-cyan-300", partial:"bg-blue-500/15 text-blue-300",
  delivered:"bg-emerald-500/15 text-emerald-300", cancelled:"bg-red-500/15 text-red-300",
  returned:"bg-orange-500/15 text-orange-300", refunded:"bg-slate-500/15 text-slate-300",
};
export const countLabel: Record<ItaliaStatus,string> = {
  pending:"Pendientes", confirmed:"Confirmados", dispatched:"Enviados", partial:"Envío parcial",
  delivered:"Entregados", cancelled:"Anulados", returned:"Devueltos", refunded:"Reembolsados",
};
export const date = (value:string,timeZone="Europe/Rome") => new Date(value).toLocaleString("es-ES",{timeZone});
export const shortDate = (value:string,timeZone="Europe/Rome") => new Date(value).toLocaleDateString("es-ES",{timeZone});
export function money(value:number|null,currency:string,locale="it-IT") {
  if(value===null)return "Sin importe";
  try{return new Intl.NumberFormat(locale,{style:"currency",currency}).format(value);}
  catch{return `${value.toLocaleString(locale)} ${currency}`;}
}
