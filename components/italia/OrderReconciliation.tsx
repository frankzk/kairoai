import { ITALIA_STATUS, type ItaliaOrder } from "@/lib/italia-orders";
import { useOrderDisplay } from "./OrderDisplayContext";

export default function OrderReconciliation({order}:{order:ItaliaOrder}) {
  const {date,money}=useOrderDisplay(),r=order.reconciliation;
  if(!r)return null;
  const review=["review","ambiguous","unknown"].includes(r.state);
  const explanation=r.applied
    ? "La lista refleja el seguimiento de Elogy. El pedido original de Shopify y la gestión guardada en Kairo se conservan."
    : r.state==="review"
      ? r.reason==="amount"?"El importe o la moneda no coinciden. Revisa ambos pedidos antes de conciliar el estado.":"El seguimiento difiere de un estado protegido. Se conserva Kairo/Shopify hasta revisar la evidencia."
      : r.state==="ambiguous"?"Hay más de una coincidencia. No se aplica ningún estado automáticamente."
      : "No hay seguimiento verificado para aplicar. Se conserva el estado de Kairo/Shopify.";
  return <section className={`rounded border p-3 ${review?"border-amber-500/40 bg-amber-500/5":"border-border"}`} aria-label="Conciliación con Elogy">
    <h3 className="font-semibold">Conciliación con Elogy</h3>
    <dl className="mt-2 grid gap-3 sm:grid-cols-3">
      <div><dt className="text-muted-foreground">Estado guardado en Kairo</dt><dd className="mt-1">{ITALIA_STATUS[r.baseStatus]}</dd></div>
      <div><dt className="text-muted-foreground">Seguimiento Elogy</dt><dd className="mt-1">{r.label||"Sin coincidencia verificada"}</dd></div>
      {r.totalCents!==null&&r.currency&&<div><dt className="text-muted-foreground">Importe Elogy / Shopify</dt><dd className="mt-1">{money(r.totalCents/100,r.currency)} / {money(order.total,order.currency)}</dd></div>}
    </dl>
    {r.guide&&<p className="mt-2 break-words">Guía Elogy: {r.guide} · {r.carrier||"Courier sin informar"}</p>}
    {r.stateAt&&<p className="mt-1 text-muted-foreground">Seguimiento: {date(r.stateAt)}{r.observedAt?` · Leído: ${date(r.observedAt)}`:""}</p>}
    <p className={`mt-2 ${review?"text-amber-300":"text-muted-foreground"}`}>{explanation}</p>
  </section>;
}
