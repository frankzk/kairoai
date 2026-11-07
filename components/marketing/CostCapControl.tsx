"use client";
import type { CostCapCandidate, CostCapRow } from "@/lib/marketing-cost-cap";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money } from "./format";
import { ordersText } from "@/lib/marketing-actions";
import r from "./team-report.module.css";

const usd = (value: number | null | undefined) => money(value, "USD");
const t = MARKETING_TARGETS;

/** "Control de las COST CAP" (módulo 3). The CPA is the pixel's on purpose. */
export function CostCapControl({
  control,
  loading,
  error,
  filterLabel = null,
}: {
  control: { rows: CostCapRow[]; candidates: CostCapCandidate[] } | null;
  loading: boolean;
  error: string;
  /** Name of the top filter when it is not today ("Ayer"): these columns are always today. */
  filterLabel?: string | null;
}) {
  return (
    <section className={r.section} aria-labelledby="cost-cap-title">
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>04 / COST CAP</p>
          <h2 id="cost-cap-title">Control de las COST CAP</h2>
          <p>
            Alerta roja: más de {usd(t.costCapDailyAlertUsd)} en un día o CPA
            del píxel mayor al doble de la puja. No entrega: menos de{" "}
            {usd(t.costCapNoDeliveryUsd)} al día. (Gomitas CR4 gastó {usd(1166)}{" "}
            el 27 oct.)
            {filterLabel &&
              ` No depende del filtro de período (${filterLabel}): «hoy» es siempre el día de hoy.`}
          </p>
        </div>
      </div>
      {loading && !control ? (
        <p role="status">Consultando campañas COST CAP…</p>
      ) : !control ? (
        <p role="alert" className={r.risk}>
          {error || "No se pudieron consultar las campañas."}
        </p>
      ) : (
        <>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Campañas COST CAP"
          >
            <table className={r.actionsTable}>
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Puja</th>
                  <th>Gasto hoy</th>
                  <th>Gasto ayer</th>
                  <th>CPA píxel hoy / ayer</th>
                  <th>Pedidos reales ayer</th>
                  <th>Alertas</th>
                </tr>
              </thead>
              <tbody>
                {control.rows.map((row) => (
                  <tr
                    key={row.key}
                    className={row.risk ? r.riskRow : undefined}
                  >
                    <th scope="row">
                      {row.name}
                      <small>
                        {row.accountLabel}
                        {row.product ? ` · ${row.product}` : " · Sin producto"}
                        {row.status === "pausada" ? " · Pausada" : ""}
                      </small>
                    </th>
                    <td>
                      {usd(row.bid)}
                      {row.bidNote && <small>{row.bidNote}</small>}
                    </td>
                    <td>{usd(row.today.spendUsd)}</td>
                    <td>{usd(row.yesterday.spendUsd)}</td>
                    <td>
                      {usd(row.today.cpaPixel)} / {usd(row.yesterday.cpaPixel)}
                      <small>
                        Píxel:{" "}
                        {row.today.pixel == null
                          ? "Sin datos"
                          : count(row.today.pixel)}{" "}
                        hoy ·{" "}
                        {row.yesterday.pixel == null
                          ? "Sin datos"
                          : count(row.yesterday.pixel)}{" "}
                        ayer
                      </small>
                    </td>
                    <td>
                      {row.yesterday.real == null
                        ? "Sin datos"
                        : `≈ ${ordersText(row.yesterday.real)}`}
                    </td>
                    <td className={r.actionCell}>
                      {row.alerts.length ? (
                        <div className={r.chips}>
                          {row.alerts.map((alert) => (
                            <span
                              key={`${alert.code}:${alert.day}`}
                              className={`${r.chip} ${alert.tone === "risk" ? r.chipRed : r.chipYellow}`}
                            >
                              {alert.day === "hoy" ? "Hoy" : "Ayer"}:{" "}
                              {alert.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={`${r.chip} ${r.chipOk}`}>
                          Sin alertas
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!control.rows.length && (
                  <tr>
                    <td colSpan={7}>
                      Sin campañas COST CAP con gasto en los últimos 14 días.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <h3 className="mt-6">Candidatos para COST CAP nueva</h3>
          <p className={r.caption}>
            Productos con CBO activas cuyo CPA del píxel en 7 días ya está por
            debajo de {usd(t.cpaUsd)} con al menos{" "}
            {count(t.costCapCandidateMinPurchases)} compras, y sin COST CAP
            activa.
          </p>
          {control.candidates.length ? (
            control.candidates.slice(0, 8).map((c) => (
              <p key={c.productKey} className={r.alert}>
                <strong>{c.name}</strong>
                {c.detail}
              </p>
            ))
          ) : (
            <p className={r.alert}>
              Sin productos con CPA del píxel en CBO por debajo de{" "}
              {usd(t.cpaUsd)}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
