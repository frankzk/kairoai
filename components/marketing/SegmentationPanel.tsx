"use client";
import { useMemo } from "react";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type {
  AccountsPayload,
  OrderFactsPayload,
  SegmentationPayload,
} from "@/lib/marketing-insights-types";
import {
  ageGenderReport,
  provinceReport,
  segmentationRange,
  type SegmentRow,
} from "@/lib/marketing-segments";
import { accountLabel } from "@/lib/marketing-actions";
import { marketingDate } from "@/lib/marketing-dates";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money, percentage, shortDate } from "./format";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
function SegmentTable({
  rows,
  caption,
  first,
}: {
  rows: SegmentRow[];
  caption: string;
  first: string;
}) {
  return (
    <div
      className={r.tableWrap}
      role="region"
      tabIndex={0}
      aria-label={caption}
    >
      <table className={r.segmentTable}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col">Gasto</th>
            <th scope="col">% del gasto</th>
            <th scope="col">Compras del píxel</th>
            <th scope="col">CPA píxel</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{money(row.spendUsd)}</td>
              <td>{percentage(row.shareSpend)}</td>
              <td>{count(Math.round(row.purchases))}</td>
              <td>
                {row.cpaPixel == null ? "Sin compras" : money(row.cpaPixel)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Segmentación" (módulo 12), section 07 of Análisis. */
export function SegmentationPanel({
  period,
  orders,
  segmentation,
  loadSegmentation,
  accounts,
  settings,
  fx,
}: {
  period: { from: string; to: string };
  orders: Resource<OrderFactsPayload>;
  segmentation: Resource<SegmentationPayload>;
  loadSegmentation: (from: string, to: string) => Promise<void>;
  accounts: Resource<AccountsPayload>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
}) {
  const facts = orders.data;
  const provinces = useMemo(
    () => (facts ? provinceReport(facts, facts.from, facts.to) : null),
    [facts],
  );
  const range = segmentationRange(period, marketingDate());
  const segment = segmentation.data;
  const report = useMemo(
    () => (segment ? ageGenderReport(segment.rows, fx) : null),
    [segment, fx],
  );
  const stale =
    segment && (segment.from !== range.from || segment.to !== range.to);
  const nameOf = (id: string) => {
    const name =
      accounts.data?.meta?.find((a) => a.accountId === id)?.name ?? "";
    return accountLabel("meta", id, name, settings?.accountLabels ?? []);
  };
  const maxShare = Math.max(0.0001, ...(provinces?.rows ?? []).map((p) => p.share));
  return (
    <section
      id="analisis-segmentacion"
      className={r.section}
      aria-labelledby="segmentation-title"
    >
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>07 / Segmentación</p>
          <h2 id="segmentation-title">Segmentación</h2>
          <p>
            Dónde están los clientes (pedidos reales de iComfly) y a qué edad y
            género le compra el píxel de Meta.
          </p>
        </div>
      </div>

      <h3>Pedidos por provincia</h3>
      {orders.loading && !facts ? (
        <p role="status">Consultando los pedidos de iComfly…</p>
      ) : !provinces || !facts ? (
        orders.error ? (
          <p role="alert" className={r.risk}>
            No se pudieron leer los pedidos de iComfly. {orders.error}
          </p>
        ) : (
          <p className={r.alert}>
            Elige un período que termine hoy o antes para ver las provincias.
          </p>
        )
      ) : provinces.total === 0 ? (
        <p className={r.alert}>Sin pedidos reales en el período.</p>
      ) : (
        <>
          <p className={r.caption}>
            {count(provinces.total)} pedidos reales del {shortDate(facts.from)}{" "}
            al {shortDate(facts.to)}.
          </p>
          <ul className={r.segBars}>
            {provinces.rows.map((row) => (
              <li key={row.province}>
                <span className={r.segLabel}>{row.province}</span>
                <span className={r.segTrack} aria-hidden="true">
                  <span style={{ width: `${(row.share / maxShare) * 100}%` }} />
                </span>
                <span className={r.segValue}>
                  <strong>{percentage(row.share)}</strong> ·{" "}
                  {count(row.real)}
                  <small
                    className={
                      row.cancelRate != null && row.cancelRate > t.cancelRateAlert
                        ? r.risk
                        : undefined
                    }
                  >
                    {" "}
                    · anulación {percentage(row.cancelRate)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          {provinces.unknown > 0 && (
            <p className={r.caption}>
              Sin provincia: {count(provinces.unknown)} pedidos (dirección
              incompleta o ilegible).
            </p>
          )}
          <p className={r.caption}>
            Provincia según la dirección de envío en iComfly (se corrigen
            errores de escritura y cantones). Anulación = anulados ÷ (reales +
            anulados), sin reemplazos por upsell ni pruebas.
            {facts.truncated && " Lectura incompleta: elige un período más corto."}
          </p>
        </>
      )}

      <h3 className="mt-6">Edad y género (Meta)</h3>
      <p className={r.caption}>
        Compras del píxel, no pedidos reales: iComfly no guarda edad ni género.
        Sin desglose de TikTok: Make no lo envía.
      </p>
      <div className={r.filters}>
        <button
          type="button"
          onClick={() => void loadSegmentation(range.from, range.to)}
          disabled={segmentation.loading}
        >
          {segmentation.loading
            ? "Consultando Meta…"
            : segment && !stale
              ? "Volver a cargar"
              : "Cargar edad y género de Meta"}
        </button>
        <span className={r.period}>
          {shortDate(range.from)} – {shortDate(range.to)}
        </span>
      </div>
      {segmentation.error ? (
        <p role="alert" className={r.risk}>
          {segmentation.error}
        </p>
      ) : !segment || !report ? (
        !segmentation.loading && (
          <p className={r.alert}>
            Se consulta solo al pedirlo: una llamada a Meta por cuenta, guardada
            una hora.
          </p>
        )
      ) : !segment.configured ? (
        <p className={r.alert}>Meta no está configurado para esta tienda.</p>
      ) : (
        <>
          {stale && (
            <p className={r.warnText}>
              Datos del {shortDate(segment.from)} al {shortDate(segment.to)}:
              cambiaste el período, vuelve a cargar.
            </p>
          )}
          {segment.failed.length > 0 && (
            <p role="alert" className={r.warnText}>
              Sin datos de {segment.failed.map(nameOf).join(", ")}.
            </p>
          )}
          {report.unconverted.length > 0 && (
            <p role="alert" className={r.warnText}>
              Sin tasa de cambio para {report.unconverted.map(nameOf).join(", ")}
              : no entra en la tabla.
            </p>
          )}
          {report.rows.length === 0 ? (
            <p className={r.alert}>Sin gasto en Meta en estos días.</p>
          ) : (
            <>
              <p className={r.caption}>
                {money(report.total.spendUsd)} de gasto ·{" "}
                {count(Math.round(report.total.purchases))} compras del píxel ·
                CPA píxel {money(report.total.cpaPixel)}.
              </p>
              <div className={r.twoColumns}>
                <div>
                  <SegmentTable
                    rows={report.byGender}
                    caption="Por género"
                    first="Género"
                  />
                </div>
                <div>
                  <SegmentTable
                    rows={report.byAge}
                    caption="Por edad"
                    first="Edad"
                  />
                </div>
              </div>
              <h3 className="mt-6">Edad × género</h3>
              <SegmentTable
                rows={report.rows}
                caption="Gasto y compras del píxel por edad y género"
                first="Segmento"
              />
              {report.grouped > 0 && (
                <p className={r.caption}>
                  Otros = {count(report.grouped)} segmentos con menos de{" "}
                  {money(t.segmentMinSpendUsd)} de gasto.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
