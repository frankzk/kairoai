"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Info, RefreshCw, Search, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sanitizeExternalError } from "@/lib/api-errors";
import { costaRicaDate, type MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import { buildMarketingAdsSummary } from "@/lib/marketing-ads-summary";
import CampaignsTable from "@/components/marketing/CampaignsTable";

const currency = new Intl.NumberFormat("es-CR", { style: "currency", currency: "CRC", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("es-CR");
const percent = new Intl.NumberFormat("es-CR", { style: "percent", maximumFractionDigits: 1 });
const amount = (value: number | null) => value == null ? "Sin datos" : currency.format(value);
const adAmount = (value: number | null, code: string | null) => value == null || !code ? "Sin datos" : new Intl.NumberFormat("es-CR", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const rate = (value: number | null) => value == null ? "—" : percent.format(value);
type View = "summary" | "campaigns" | "products" | "sources";

const pendingSources = [
  { key: "meta", name: "Meta Ads", detail: "Inversión, impresiones y clics por cuenta y campaña.", needs: "Cuentas publicitarias de Costa Rica y acceso de lectura a todos sus reportes." },
  { key: "tiktok", name: "TikTok Ads", detail: "Inversión, impresiones y clics por campaña.", needs: "Identificador del anunciante y acceso de lectura a sus reportes." },
  { key: "shiphero", name: "ShipHero", detail: "Stock actual disponible y comprometido por SKU y almacén.", needs: "Acceso a inventario, cuenta y almacén de Costa Rica, y correspondencia de SKU con Icomfly." },
] as const;

export default function MarketingPage() {
  const [month, setMonth] = useState("");
  const [view, setView] = useState<View>("summary");
  const [data, setData] = useState<MarketingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"orders" | "units" | "delivered">("orders");
  const [page, setPage] = useState(0);
  const [sources, setSources] = useState<MarketingSources | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState("");

  useEffect(() => setMonth(costaRicaDate(new Date()).slice(0, 7)), []);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError("");
    fetch(`/api/marketing/summary?store=mireva-cr&month=${encodeURIComponent(month)}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cargar Marketing.");
      return body as MarketingSummary;
    }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(sanitizeExternalError(cause instanceof Error ? cause.message : "No se pudo cargar Marketing."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [month, revision]);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setSourcesLoading(true);
    setSources(null);
    setSourcesError("");
    fetch(`/api/marketing/sources?store=mireva-cr&month=${encodeURIComponent(month)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("No se pudo consultar el estado de las conexiones.");
        return await response.json() as MarketingSources;
      })
      .then(result => { if (!controller.signal.aborted) setSources(result); })
      .catch(() => { if (!controller.signal.aborted) setSourcesError("No se pudo consultar el estado de las conexiones. Vuelve a actualizar."); })
      .finally(() => { if (!controller.signal.aborted) setSourcesLoading(false); });
    return () => controller.abort();
  }, [month, revision]);
  useEffect(() => setPage(0), [query, sort, month]);

  const products = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("es");
    return (data?.products ?? []).filter(product =>
      !search || `${product.name} ${product.sku}`.toLocaleLowerCase("es").includes(search)
    ).sort((a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name));
  }, [data, query, sort]);
  const maxWeekly = Math.max(1, ...(data?.weeks.map(week => week.generated) ?? []));
  const totals = data?.totals;
  const ads = useMemo(() => buildMarketingAdsSummary(sources, month, data?.totals.generated ?? 0, data?.totals.delivered ?? 0), [sources, month, data]);
  const adCoverage = sourcesLoading ? "Consultando plataformas…" : ads.accountCount ? `${ads.providers.join(" + ")} · ${ads.accountCount} cuentas${ads.partial ? " · Inversión parcial" : ""}` : "Sin inversión consultable";
  const adSpend = sourcesLoading ? "Consultando…" : ads.breakdown.length > 1 ? "Varias monedas" : adAmount(ads.spend, ads.currency);
  const adCpa = sourcesLoading ? "Consultando…" : adAmount(ads.costPerGenerated, ads.currency);
  const stockBySku = useMemo(() => {
    const result = new Map<string, { available: number; allocated: number } | null>();
    for (const item of sources?.shiphero.data?.stock ?? []) {
      const key = item.sku.trim().toLowerCase();
      result.set(key, result.has(key) ? null : { available: item.available, allocated: item.allocated });
    }
    return result;
  }, [sources]);
  const incompleteSources = pendingSources.filter(source => sources?.[source.key].status !== "ready").map(source => source.name);

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/finance?store=mireva-cr" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-3 w-3" aria-hidden="true" /> Gestión
          </Link>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Mireva Costa Rica <span aria-hidden="true">·</span> Pedidos, resultados y disponibilidad de datos</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">Mes de creación del pedido</span>
            <Input aria-label="Mes de creación del pedido" type="month" min="2020-01" max={costaRicaDate(new Date()).slice(0, 7)} value={month}
              onChange={event => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} className="w-44 [color-scheme:dark]" />
          </label>
          <Button variant="outline" disabled={!month || loading || sourcesLoading} onClick={() => setRevision(value => value + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Actualizar
          </Button>
        </div>
      </header>

      <nav aria-label="Vistas de marketing" className="flex flex-wrap gap-x-4 border-b border-border text-sm">
        {([ ["summary", "Resumen"], ["campaigns", "Campañas"], ["products", "Productos"], ["sources", "Fuentes y conexiones"] ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}
            className={`border-b-2 px-1 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === value ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <p className="flex items-center gap-2"><Unplug className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />{sourcesLoading ? "Consultando conexiones…" : sourcesError || (incompleteSources.length ? `${incompleteSources.join(", ")}: acceso pendiente o consulta no disponible.` : "Consultas de Meta, TikTok y ShipHero completadas.")}</p>
        {view !== "sources" && <button type="button" onClick={() => setView("sources")} className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Ver qué falta</button>}
      </div>

      {view === "sources" ? (
        <section aria-labelledby="sources-heading" className="space-y-6">
          <div>
            <h2 id="sources-heading" className="text-base font-semibold">Fuentes del panel</h2>
            <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">La base operativa usa la conciliación de Gestión. Las conexiones publicitarias y de inventario requieren sus propios accesos.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[650px] text-left text-xs">
              <caption className="sr-only">Disponibilidad y requisitos de las fuentes de marketing</caption>
              <thead className="bg-muted/40 text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Fuente</th><th scope="col" className="p-3 font-medium">Estado</th><th scope="col" className="p-3 font-medium">Datos y requisitos</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><th scope="row" className="p-3 font-medium">Pedidos y logística</th><td className="p-3">Base de Gestión</td><td className="p-3 text-muted-foreground">Icomfly, histórico de Shopify y transportadoras, según la última sincronización operativa.</td></tr>
                <tr><th scope="row" className="p-3 font-medium">Costos y liquidaciones</th><td className="p-3">Registros de Gestión</td><td className="p-3 text-muted-foreground">Costos por SKU e importaciones de liquidación disponibles en Kairo.</td></tr>
                <tr><th scope="row" className="p-3 font-medium">Publicidad manual en CRC</th><td className="p-3">Registro de Gestión</td><td className="p-3 text-muted-foreground">Solo para el saldo financiero en colones. La inversión del resumen se consulta en Meta y TikTok; el gasto manual se mantiene separado para evitar duplicados.</td></tr>
                {pendingSources.map(source => <tr key={source.name}><th scope="row" className="p-3 font-medium">{source.name}</th><td className="whitespace-nowrap p-3">{sourcesLoading ? "Consultando…" : sources?.[source.key].status === "ready" ? "Consulta completada" : sources?.[source.key].status === "error" ? "Error de consulta" : "Pendiente de conectar"}</td><td className="space-y-1 p-3 text-muted-foreground"><p className="text-foreground">{source.detail}</p><p>{sources?.[source.key].message || source.needs}</p>{sources?.[source.key].status !== "ready" && <p>{source.needs}</p>}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="max-w-[75ch] space-y-2 text-sm">
            <h3 className="font-medium">Para relacionar anuncios con ventas</h3>
            <p className="text-muted-foreground">Guardar el origen, las UTMs y los identificadores de campaña y anuncio junto al pedido de Icomfly. Hasta validar ese vínculo, los pedidos del panel incluyen todos los canales y no se atribuyen a una campaña.</p>
            <p className="text-muted-foreground">Las cuentas publicitarias de esta primera integración son exclusivas de Mireva Costa Rica. Las conversiones reportadas por Meta y TikTok se mantendrán separadas de los pedidos únicos.</p>
          </div>
          <Link href="/admin/finance" className="inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Revisar registros en Gestión <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </section>
      ) : view === "campaigns" ? <CampaignsTable sources={sources} loading={sourcesLoading} error={sourcesError} /> : loading ? (
        <div role="status" aria-live="polite" className="space-y-5"><span className="sr-only">Cargando datos de marketing de Costa Rica</span><div className="grid grid-cols-2 divide-x divide-border border border-border sm:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="space-y-3 p-4"><div className="h-3 w-16 bg-muted" /><div className="h-7 w-20 bg-muted" /></div>)}</div><div className="h-64 rounded-lg border border-border bg-muted/20" /></div>
      ) : error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-border p-5"><h2 className="font-medium">No se pudo cargar el panel</h2><p className="text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}>Reintentar</Button></div>
      ) : data && totals ? (
        <>
          {totals.generated === 0 && <div role="status" className="rounded-md border border-border p-4 text-sm">No hay pedidos con fecha de creación en este mes. Selecciona otro mes o revisa la sincronización en Gestión.</div>}
          {view === "summary" ? <>
            <dl className="grid grid-cols-2 border border-border sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Pedidos creados", number.format(totals.generated), "Todas las fuentes"],
                ["Inversión publicitaria", adSpend, adCoverage],
                ["Costo / pedido creado", adCpa, "Inversión consultada / todos los pedidos"],
                ["Entregados", number.format(totals.delivered), `${rate(totals.deliveryRate)} de los creados`],
                ["Sin cierre", number.format(totals.open), "Resultado todavía provisional"],
                ["Neto en liquidaciones", amount(totals.settlementNet), "Depósito bancario no verificado"],
              ].map(([label, value, note]) => <div key={label} className="border-b border-r border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</dd><dd className="mt-1 text-[11px] text-muted-foreground">{note}</dd></div>)}
            </dl>

            <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
              <section aria-labelledby="cohorts-heading" className="min-w-0 space-y-4">
                <div><h2 id="cohorts-heading" className="text-base font-semibold">Cómo terminan los pedidos del mes</h2><p className="mt-1 text-xs text-muted-foreground">Estado actual, agrupado por semana de creación. Cada barra incluye todos los pedidos de esa semana.</p></div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  {[["bg-emerald-400", "Entregados"], ["bg-rose-400", "No entregados"], ["bg-slate-500", "Anulados"], ["bg-amber-400", "Sin cierre"]].map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 ${color}`} />{label}</span>)}
                </div>
                <div className="space-y-4 rounded-lg border border-border p-4">
                  {data.weeks.map(week => <div key={week.from}>
                    <div className="mb-1.5 flex justify-between gap-2 text-xs"><span>{week.from.slice(8)}–{week.to.slice(8)}</span><span className="tabular-nums text-muted-foreground">{number.format(week.delivered)} entregados / {number.format(week.generated)} creados</span></div>
                    <div role="img" aria-label={`${week.from} al ${week.to}: ${week.generated} pedidos, ${week.delivered} entregados, ${week.failed} no entregados, ${week.annulled} anulados y ${week.open} sin cierre`} className="flex h-4 w-full overflow-hidden bg-muted/40">
                      {([["delivered", "bg-emerald-400", "Entregados"], ["failed", "bg-rose-400", "No entregados"], ["annulled", "bg-slate-500", "Anulados"], ["open", "bg-amber-400", "Sin cierre"]] as const).map(([key, color, label]) => <span key={key} title={`${label}: ${week[key]}`} className={color} style={{ width: `${week[key] / maxWeekly * 100}%` }} />)}
                    </div>
                  </div>)}
                  <p className="text-[11px] text-muted-foreground">Escala común: {number.format(maxWeekly === 1 && !totals.generated ? 0 : maxWeekly)} pedidos. Días en hora de Costa Rica.</p>
                </div>
                {totals.open > 0 && <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{number.format(totals.open)} pedidos siguen abiertos; {number.format(data.quality.recentOpen)} tienen menos de 14 días. La entrega final puede cambiar.</p>}
              </section>

              <section aria-labelledby="spend-heading" className="space-y-4">
                <div><h2 id="spend-heading" className="text-base font-semibold">Inversión publicitaria y costo por pedido</h2><p className="mt-1 text-xs text-muted-foreground">{adCoverage}. Gasto del mes seleccionado en la moneda de las cuentas.</p></div>
                <dl aria-live="polite" className="divide-y divide-border border-y border-border text-xs">
                  {[
                    ["Inversión consultada", adSpend],
                    ["Costo combinado / pedido creado", adCpa],
                    ["Costo combinado / pedido entregado", sourcesLoading ? "Consultando…" : adAmount(ads.costPerDelivered, ads.currency)],
                  ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-medium tabular-nums">{value}</dd></div>)}
                  {ads.breakdown.length > 1 && ads.breakdown.map(group => <div key={group.currency} className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">Inversión en {group.currency}</dt><dd className="font-medium tabular-nums">{adAmount(group.spend, group.currency)}</dd></div>)}
                </dl>
                <p className="text-[11px] leading-relaxed text-muted-foreground">El costo divide la inversión consultada entre todos los pedidos creados o entregados del mes, incluidos los orgánicos y sin atribuir. No es CPA atribuido a campañas ni CAC. {ads.partial && "La inversión y los costos son parciales hasta consultar Meta y TikTok."}</p>
                {sourcesError && <p role="alert" className="text-xs text-amber-400">{sourcesError}</p>}
                {!sourcesLoading && ads.accountCount > 0 && (!ads.aligned || ads.breakdown.length > 1) && <p className="text-xs text-amber-400">Los costos por pedido se ocultan porque las cuentas tienen distintas monedas o sus meses no coinciden con el calendario de Costa Rica.</p>}
                <h3 className="pt-2 text-sm font-medium">Registros financieros en colones</h3>
                <dl className="divide-y divide-border border-y border-border text-xs">
                  {[
                    ["Publicidad manual (CRC)", amount(totals.registeredAdSpend)],
                    ["Neto en liquidaciones", amount(totals.settlementNet)],
                    ["Costo de producto en pedidos liquidados", amount(totals.productCost)],
                    ["Margen registrado antes de publicidad", amount(totals.recordedMargin)],
                    ["Saldo parcial después de publicidad", amount(totals.partialBalance)],
                  ].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-medium tabular-nums">{value}</dd></div>)}
                </dl>
                <p className="text-[11px] leading-relaxed text-muted-foreground">Estos registros usan gastos manuales en CRC, separados de la inversión de las plataformas para evitar duplicados y conversiones de moneda. El saldo parcial excluye pedidos aún sin liquidar, nómina y otros gastos; no representa utilidad final ni ROAS atribuido. El gasto manual puede estar incompleto.</p>
                {data.channels.length > 0 && <div><h3 className="mb-2 text-xs font-medium">Publicidad por canal registrado</h3><ul className="divide-y divide-border text-xs">{data.channels.map(channel => <li key={channel.name} className="flex justify-between gap-3 py-2"><span>{channel.name} <span className="text-muted-foreground">({channel.records} registros)</span></span><span className="tabular-nums">{amount(channel.spend)}</span></li>)}</ul></div>}
              </section>
            </div>

            <section aria-labelledby="quality-heading" className="border-t border-border pt-4">
              <h2 id="quality-heading" className="text-base font-semibold">Qué falta para tomar mejores decisiones</h2>
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                <li>{sources?.meta.status === "ready" && sources.tiktok.status === "ready" ? "Campañas disponibles. Falta vincular el origen de cada pedido para atribuir resultados." : "Completar los accesos de Meta y TikTok para comparar campañas y validar la inversión completa."}</li>
                <li>{sources?.shiphero.status === "ready" ? "Stock actual disponible por coincidencia de SKU. La cobertura requiere validar demanda y reposición." : "Completar el acceso de ShipHero y relacionar los SKU para consultar stock."}</li>
                <li>{number.format(data.quality.deliveredWithoutSettlement)} entregados sin liquidación. {number.format(data.quality.duplicateSettlements)} pedidos con liquidaciones múltiples, excluidos de los importes.</li>
                <li>{number.format(data.quality.missingCosts)} pedidos liquidados y entregados sin costo completo. {number.format(data.quality.withoutProducts)} pedidos del mes sin productos identificados.</li>
                {data.quality.foreignExpenses > 0 && <li className="text-amber-400">{number.format(data.quality.foreignExpenses)} gastos publicitarios en otra moneda o sin moneda, excluidos. Los costos combinados y el saldo se ocultan hasta conciliarlos.</li>}
                {data.quality.withoutDate > 0 && <li>{number.format(data.quality.withoutDate)} pedidos del histórico no tienen fecha válida y no se asignan a ningún mes.</li>}
                {data.quality.adRecords === 0 && <li>No hay gastos publicitarios manuales en CRC este mes. El saldo financiero después de publicidad queda sin datos; la inversión consultada en las plataformas se muestra arriba.</li>}
              </ul>
            </section>
          </> : <section aria-labelledby="products-heading" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 id="products-heading" className="text-base font-semibold">Resultados por producto</h2><p className="mt-1 text-xs text-muted-foreground">Un pedido puede incluir varios productos. Sus conteos no deben sumarse como pedidos únicos. El stock es actual, no histórico.</p></div>
              <div className="flex flex-wrap gap-2"><label className="relative"><span className="sr-only">Buscar producto o SKU</span><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Producto o SKU" className="w-56 pl-9" /></label><label className="sr-only" htmlFor="product-sort">Ordenar productos</label><select id="product-sort" value={sort} onChange={event => setSort(event.target.value as typeof sort)} className="h-10 rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="orders">Más pedidos</option><option value="units">Más unidades</option><option value="delivered">Más entregados</option></select></div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-left text-xs">
                <caption className="sr-only">Productos de los pedidos creados en {month}, con su estado actual</caption>
                <thead className="bg-muted/40 text-muted-foreground"><tr>{["Producto / SKU", "Pedidos", "Unidades pedidas", "Entregados", "No entregados", "Sin cierre", "Entrega / pedidos", "Stock disponible"].map(label => <th key={label} scope="col" className="whitespace-nowrap p-3 font-medium">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">{products.slice(page * 20, (page + 1) * 20).map(product => {
                  const stock = stockBySku.get(product.sku.trim().toLowerCase());
                  return <tr key={product.key} className="hover:bg-muted/20"><th scope="row" className="max-w-64 p-3 font-medium"><span className="block">{product.name || "Producto sin nombre"}</span><span className="mt-1 block font-normal text-muted-foreground">{product.sku || "Sin SKU"}</span></th>{[product.orders, product.units, product.delivered, product.failed, product.open].map((value, index) => <td key={index} className="p-3 tabular-nums">{number.format(value)}</td>)}<td className="p-3 tabular-nums">{rate(product.deliveryRate)}</td><td className="whitespace-nowrap p-3 text-muted-foreground">{stock ? <><span className="block text-foreground">{number.format(stock.available)} disponibles</span><span className="text-[11px]">{number.format(stock.allocated)} comprometidas</span></> : sources?.shiphero.status === "ready" ? "Sin coincidencia única de SKU" : sourcesLoading ? "Consultando…" : "Sin datos de stock"}</td></tr>;
                })}</tbody>
              </table>
              {products.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{query ? "No hay productos que coincidan con la búsqueda." : "No hay productos identificados para los pedidos de este mes."}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>{number.format(products.length)} productos{products.length > 20 ? ` · Página ${page + 1} de ${Math.ceil(products.length / 20)}` : ""}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={(page + 1) * 20 >= products.length} onClick={() => setPage(value => value + 1)}>Siguiente</Button></div></div>
          </section>}
          <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">Calculado: {new Intl.DateTimeFormat("es-CR", { timeZone: data.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(data.calculatedAt))}, Costa Rica. Usa la última sincronización disponible en Gestión.</p>
        </>
      ) : null}
    </main>
  );
}
