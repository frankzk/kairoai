"use client";
import { useMemo } from "react";
import { ordersText, type CampaignActionRow } from "@/lib/marketing-actions";
import {
  buildLaunches,
  launchSpendText,
  type LaunchRow,
  type LaunchStage,
} from "@/lib/marketing-launches";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { ManualCampaignChange } from "@/lib/marketing-source-types";
import { marketingDate } from "@/lib/marketing-dates";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money, shortDate } from "./format";
import r from "./team-report.module.css";

const t = MARKETING_TARGETS;

const toneChip = (tone: LaunchStage["tone"]) =>
  tone === "risk"
    ? r.chipRed
    : tone === "good"
      ? r.chipOk
      : tone === "wait"
        ? r.chipYellow
        : r.chipMuted;

/** Thin progress bar with its text (the color is never the only signal). */
function Progress({
  label,
  value,
  text,
}: {
  label: string;
  value: number;
  text: string;
}) {
  return (
    <div
      className={`${r.meter} ${r.launchMeter}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={text}
    >
      <div className={r.meterFill} style={{ width: `${value * 100}%` }} />
    </div>
  );
}

function LaunchLine({ launch }: { launch: LaunchRow }) {
  const spend = launchSpendText(launch);
  const orders =
    launch.real == null
      ? "Sin datos"
      : `${Number.isInteger(launch.real) ? "" : "≈ "}${ordersText(launch.real)} de ${count(launch.passOrders)}`;
  return (
    <tr>
      <td>{launch.accountLabel}</td>
      <th scope="row">
        {launch.campaignName}
        <small>
          {launch.launchDate
            ? `Lanzada el ${shortDate(launch.launchDate)}`
            : "Sin fecha"}
          {launch.source === "manual" ? " · registrada a mano" : ""}
        </small>
      </th>
      <td>
        {spend}
        {launch.currency !== "USD" && launch.spendUsd != null && (
          <small>≈ {money(launch.spendUsd, "USD")}</small>
        )}
        <Progress
          label={`Gasto de la prueba de ${launch.campaignName}`}
          value={launch.stage.spendProgress}
          text={spend}
        />
      </td>
      <td>
        {orders}
        <Progress
          label={`Pedidos reales de ${launch.campaignName}`}
          value={launch.stage.ordersProgress}
          text={orders}
        />
      </td>
      <td>{launch.pixel == null ? "Sin datos" : count(launch.pixel)}</td>
      <td className={r.actionCell}>
        <span className={`${r.chip} ${toneChip(launch.stage.tone)}`}>
          {launch.stage.label}
        </span>
        <p>{launch.stage.detail}</p>
      </td>
    </tr>
  );
}

/** "Seguimiento de lanzamientos" (módulo 9), section 03 of the report. */
export function LaunchTracker({
  rows,
  manual,
  manualPending,
  loading,
  error,
  fx,
  productName,
}: {
  /** Campaign rows of the actions table (null while loading or when it failed). */
  rows: CampaignActionRow[] | null;
  manual: ManualCampaignChange[];
  /** The change log table is not created yet (manual launches unavailable). */
  manualPending: boolean;
  loading: boolean;
  error: string;
  fx: UsdRate | null;
  productName: (key: string) => string | null;
}) {
  const result = useMemo(
    () =>
      rows
        ? buildLaunches({
            rows,
            manual,
            today: marketingDate(),
            fx,
            productName,
          })
        : null,
    [rows, manual, fx, productName],
  );
  const meta = (v: number) => money(v, "USD");
  const pen = (v: number) => money(v, "PEN");
  return (
    <section
      id="lanzamientos"
      className={r.section}
      aria-labelledby="launches-title"
    >
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>03 / Lanzamientos</p>
          <h2 id="launches-title">Seguimiento de lanzamientos</h2>
          <p>
            Campañas lanzadas en los últimos {t.testMaxAgeDays} días, por
            producto: cuánto llevan de la prueba y si pasan o hay que apagarlas.
          </p>
        </div>
      </div>
      {loading && !result ? (
        <p role="status">Consultando lanzamientos…</p>
      ) : !result ? (
        <p role="alert" className={r.risk}>
          {error || "No se pudieron consultar las campañas."}
        </p>
      ) : (
        <>
          {result.notes.map((note) => (
            <p key={note} className={r.caption}>
              {note}
            </p>
          ))}
          {manualPending && (
            <p className={r.caption}>
              Lanzamientos registrados a mano no disponibles (pendiente aplicar
              migración).
            </p>
          )}
          {!result.groups.length ? (
            <p className={r.alert}>
              Sin lanzamientos en los últimos {t.testMaxAgeDays} días.
            </p>
          ) : (
            <div className={r.launchGroups}>
              {result.groups.map((group) => (
                <article
                  key={group.productKey ?? "sin-producto"}
                  className={r.launchCard}
                >
                  <h3>
                    {group.productName}
                    {group.firstDate &&
                      ` · lanzado el ${shortDate(group.firstDate)}`}
                    {group.lastDate &&
                      group.lastDate !== group.firstDate &&
                      ` · último el ${shortDate(group.lastDate)}`}
                  </h3>
                  <div
                    className={r.tableWrap}
                    tabIndex={0}
                    role="region"
                    aria-label={`Lanzamientos de ${group.productName}`}
                  >
                    <table className={r.launchTable}>
                      <thead>
                        <tr>
                          <th>Cuenta</th>
                          <th>Campaña</th>
                          <th>Gasto</th>
                          <th>Pedidos reales</th>
                          <th>Píxel</th>
                          <th>Etapa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.launches.map((launch) => (
                          <LaunchLine
                            key={launch.campaignKey}
                            launch={launch}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className={r.caption}>
            Prueba Meta: apagar con {meta(t.metaTestKillUsd)} sin venta; pasa
            con {meta(t.metaTestPassUsd)} y {count(t.metaTestPassOrders)}{" "}
            pedidos. TikTok: {pen(t.tiktokTestKillPen)} /{" "}
            {pen(t.tiktokTestPassPen)} y {count(t.tiktokTestPassOrders)}{" "}
            pedidos. En prueba hasta {t.testMaxAgeDays} días. Pedidos reales ≈
            UTM + reparto por producto; el píxel solo se muestra, no decide.
          </p>
        </>
      )}
    </section>
  );
}
