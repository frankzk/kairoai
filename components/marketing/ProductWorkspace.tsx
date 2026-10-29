"use client";
import { Fragment, useMemo, useState } from "react";
import type { MarketingProductMetric } from "@/lib/marketing-intelligence";
import { count, money } from "./format";
import s from "./dashboard.module.css";
import { useUsdMoney } from "./UsdContext";
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
const planBody = (product: MarketingProductMetric) => ({
  kind: "plan",
  product_key: product.key,
  priority: product.priority,
  supplier: product.plan?.supplier ?? "",
  lead_days: product.plan?.lead_days ?? null,
  cover_days: product.plan?.cover_days ?? null,
  incoming_units: product.plan?.incoming_units ?? 0,
});

function ReplenishmentEditor({
  product,
  save,
  saving,
  close,
}: {
  product: MarketingProductMetric;
  save: Save;
  saving: string;
  close: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [supplier, setSupplier] = useState(product.plan?.supplier ?? "");
  const [lead, setLead] = useState(String(product.plan?.lead_days ?? ""));
  const [cover, setCover] = useState(String(product.plan?.cover_days ?? ""));
  const [incoming, setIncoming] = useState(
    String(product.plan?.incoming_units ?? 0),
  );
  return (
    <form
      className={s.editing}
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await save(product.key, {
          ...planBody(product),
          supplier,
          lead_days: lead === "" ? null : Number(lead),
          cover_days: cover === "" ? null : Number(cover),
          incoming_units: Number(incoming),
        });
        setFailed(!ok);
        if (ok) close();
      }}
    >
      <div className={s.formGrid}>
        <label className={s.field}>
          Proveedor
          <input
            className={s.control}
            value={supplier}
            maxLength={120}
            placeholder="Nombre del proveedor"
            onChange={(event) => setSupplier(event.target.value)}
          />
        </label>
        <label className={s.field}>
          Plazo de entrega (días)
          <input
            className={s.control}
            type="number"
            min="0"
            max="365"
            step="1"
            value={lead}
            placeholder="Sin definir"
            onChange={(event) => setLead(event.target.value)}
          />
        </label>
        <label className={s.field}>
          Cobertura tras llegada (días)
          <input
            className={s.control}
            type="number"
            min="1"
            max="365"
            step="1"
            value={cover}
            placeholder="Sin definir"
            onChange={(event) => setCover(event.target.value)}
          />
        </label>
        <label className={s.field}>
          Unidades en camino (manual)
          <input
            className={s.control}
            type="number"
            min="0"
            max="10000000"
            step="1"
            required
            value={incoming}
            onChange={(event) => setIncoming(event.target.value)}
          />
        </label>
        <div className="flex gap-2">
          <button
            className={`${s.button} ${s.primary}`}
            disabled={Boolean(saving)}
            type="submit"
          >
            {saving === product.key ? "Guardando…" : "Guardar plan"}
          </button>
          <button
            className={s.button}
            type="button"
            disabled={Boolean(saving)}
            onClick={close}
          >
            Cancelar
          </button>
        </div>
      </div>
      {failed && (
        <p role="alert" className={`${s.warn} mt-3 text-xs`}>
          No se pudo guardar el plan. Revisa los valores e inténtalo de nuevo.
        </p>
      )}
      <p className={`${s.muted} mt-3`}>
        Plan manual. La sugerencia usa la demanda de los últimos 7 días
        completos, el stock disponible y las unidades en camino. No crea una
        compra ni envía un pedido al proveedor.
      </p>
    </form>
  );
}

export function ProductWorkspace({
  products,
  ready,
  saving,
  save,
  replenishment = false,
}: {
  products: MarketingProductMetric[];
  ready: boolean;
  saving: string;
  save: Save;
  replenishment?: boolean;
}) {
  const money = useUsdMoney();
  const [query, setQuery] = useState("");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [sort, setSort] = useState("orders");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState("");
  const filtered = useMemo(
    () =>
      products
        .filter(
          (product) =>
            (!priorityOnly || product.priority) &&
            (query.trim()
              ? `${product.name} ${product.sku}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase())
              : product.orders > 0 ||
                product.priority ||
                product.campaignCount > 0 ||
                product.recentUnits > 0),
        )
        .sort((a, b) =>
          sort === "stock"
            ? (a.available ?? Infinity) - (b.available ?? Infinity)
            : sort === "cpa"
              ? (b.cpa ?? -1) - (a.cpa ?? -1)
              : sort === "name"
                ? a.name.localeCompare(b.name)
                : b.orders - a.orders,
        ),
    [products, query, priorityOnly, sort],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 15)),
    currentPage = Math.min(page, pages - 1);
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>
            {replenishment ? "Plan de reposición" : "Productos y prioridades"}
          </h2>
          <p className={s.muted}>
            {replenishment
              ? "Stock actual y demanda de los últimos 7 días completos, independientes del filtro del reporte."
              : "Costo combinado por producto, sin atribuir sus pedidos a una campaña específica."}
          </p>
        </div>
        <span className={s.badge}>CPA máx. USD 8.50 · Stock mín. 100</span>
      </div>
      <div className={`${s.toolbar} mb-4`}>
        <label className={s.field}>
          Producto o SKU
          <input
            className={s.control}
            value={query}
            placeholder="Buscar en todo el catálogo"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className={s.field}>
          Ordenar
          <select
            className={s.control}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="orders">Más pedidos</option>
            <option value="cpa">Mayor costo por pedido</option>
            <option value="stock">Menor stock disponible</option>
            <option value="name">Nombre del producto</option>
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={priorityOnly}
            onChange={(event) => {
              setPriorityOnly(event.target.checked);
              setPage(0);
            }}
          />
          Solo prioritarios
        </label>
      </div>
      <div className={s.tableWrap}>
        <table
          className={`${s.table} ${replenishment ? "min-w-[1000px]" : "min-w-[1060px]"}`}
        >
          <caption className="sr-only">
            {replenishment
              ? "Inventario actual y planificación de compras"
              : "Pedidos, gasto asignado y costo por producto"}
          </caption>
          <thead>
            <tr>
              <th>Producto</th>
              {replenishment ? (
                <>
                  <th>Proveedor</th>
                  <th className={s.numeric}>Stock actual</th>
                  <th className={s.numeric}>Unid. / día</th>
                  <th className={s.numeric}>Días de stock</th>
                  <th className={s.numeric}>En camino</th>
                  <th className={s.numeric}>Sugerencia de compra</th>
                  <th>Ajustes</th>
                </>
              ) : (
                <>
                  <th className={s.numeric}>Hoy</th>
                  <th className={s.numeric}>Ayer</th>
                  <th className={s.numeric}>7 días completos</th>
                  <th className={s.numeric}>Pedidos período</th>
                  <th className={s.numeric}>Inversión asignada</th>
                  <th className={s.numeric}>Costo / pedido</th>
                  <th className={s.numeric}>Stock actual</th>
                  <th>Prioridad</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(currentPage * 15, (currentPage + 1) * 15)
              .map((product) => (
                <Fragment key={product.key}>
                  <tr>
                    <td className="max-w-[250px]">
                      <span className="block font-medium">{product.name}</span>
                      <span className={s.muted}>
                        {product.sku || "Sin SKU"}
                        {product.campaignCount > 0
                          ? ` · ${product.campaignCount} campañas`
                          : ""}
                      </span>
                      {product.priority && (
                        <span className={`${s.badge} ${s.good} mt-1`}>
                          Prioritario
                        </span>
                      )}
                    </td>
                    {replenishment ? (
                      <>
                        <td>
                          {product.plan?.supplier || "Sin definir"}
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {product.plan?.lead_days != null
                              ? `${product.plan.lead_days} días de entrega`
                              : "Plazo sin definir"}
                          </span>
                        </td>
                        <td
                          className={`${s.numeric} ${product.available != null && product.available < 100 ? s.warn : ""}`}
                        >
                          {product.available == null
                            ? "Sin datos"
                            : count(product.available)}
                        </td>
                        <td className={s.numeric}>
                          {new Intl.NumberFormat("es-CR", {
                            maximumFractionDigits: 1,
                          }).format(product.dailyDemand)}
                        </td>
                        <td className={s.numeric}>
                          {product.coverageDays == null
                            ? "Sin datos"
                            : product.coverageDays.toFixed(1)}
                        </td>
                        <td className={s.numeric}>
                          {count(product.plan?.incoming_units ?? 0)}
                          <span className="block text-[10px] text-muted-foreground">
                            Registro manual
                          </span>
                        </td>
                        <td
                          className={`${s.numeric} ${(product.suggestedUnits ?? 0) > 0 ? s.warn : ""}`}
                        >
                          {product.suggestedUnits == null
                            ? "Faltan datos"
                            : `${count(product.suggestedUnits)} unidades`}
                        </td>
                        <td>
                          <button
                            className={s.button}
                            disabled={!ready || Boolean(saving)}
                            onClick={() =>
                              setEditing(
                                editing === product.key ? "" : product.key,
                              )
                            }
                            aria-expanded={editing === product.key}
                          >
                            Configurar
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        {[
                          product.todayOrders,
                          product.yesterdayOrders,
                          product.sevenDayOrders,
                          product.orders,
                        ].map((value, index) => (
                          <td key={index} className={s.numeric}>
                            {count(value)}
                          </td>
                        ))}
                        <td className={s.numeric}>
                          {money(product.spend, product.currency)}
                        </td>
                        <td
                          className={`${s.numeric} ${product.currency === "USD" && (product.cpa ?? 0) > 8.5 ? s.warn : ""}`}
                        >
                          {money(product.cpa, product.currency)}
                        </td>
                        <td
                          className={`${s.numeric} ${product.available != null && product.available < 100 ? s.warn : ""}`}
                        >
                          {product.available == null
                            ? "Sin datos"
                            : count(product.available)}
                        </td>
                        <td>
                          <button
                            aria-pressed={product.priority}
                            className={`${s.button} ${product.priority ? s.good : ""}`}
                            disabled={!ready || Boolean(saving)}
                            onClick={() =>
                              save(product.key, {
                                ...planBody(product),
                                priority: !product.priority,
                              })
                            }
                          >
                            {saving === product.key
                              ? "Guardando…"
                              : product.priority
                                ? "Prioritario"
                                : "Priorizar"}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                  {editing === product.key && (
                    <tr>
                      <td colSpan={8}>
                        <ReplenishmentEditor
                          key={`${product.key}:${product.plan?.updated_at || "new"}`}
                          product={product}
                          save={save}
                          saving={saving}
                          close={() => setEditing("")}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <div className={s.empty}>
          No hay productos con estos filtros. Busca por nombre o SKU para
          consultar el catálogo completo.
        </div>
      )}
      <div className={`${s.toolbar} mt-4 justify-between`}>
        <span className={s.muted}>
          {count(filtered.length)} productos · Página {currentPage + 1} de{" "}
          {pages}
        </span>
        <div className="flex gap-2">
          <button
            className={s.button}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Anterior
          </button>
          <button
            className={s.button}
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
      <p className={`${s.muted} mt-4`}>
        {replenishment
          ? "Demanda = unidades pedidas en los últimos 7 días completos / 7, excluye anulados. Se repone al caer bajo el mayor de 100 unidades o la demanda del plazo del proveedor. La sugerencia cubre plazo y cobertura configurados, resta stock y unidades en camino. Es una estimación, sin costos, mínimos de compra ni devoluciones futuras."
          : "Hoy y ayer usan la hora de Costa Rica; los 7 días completos terminan ayer. La inversión incluye las campañas asignadas y consultables. Un pedido con varios productos cuenta una vez para cada producto; no sumes estas filas como pedidos únicos. El stock es actual."}
      </p>
    </section>
  );
}
