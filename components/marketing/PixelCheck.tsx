"use client";
import { Fragment, useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import { buildRealEstimate } from "@/lib/marketing-real-cpa";
import {
  buildPixelReport,
  factorText,
  PIXEL_TONE_LABEL,
  realOrdersText,
  type PixelGroup,
  type PixelTone,
} from "@/lib/marketing-pixel";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { marketingDate } from "@/lib/marketing-dates";
import { count, percentage, shortDate } from "./format";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const WINDOWS = [3, 7, 13] as const;
const MAX_HEALTH = 6;
const MAX_PRODUCTS = 15;

const toneChip: Record<PixelTone, string> = {
  de_mas: r.chipRed,
  de_menos: r.chipYellow,
  alineado: r.chipOk,
  poco_dato: r.chipMuted,
  sin_reales: r.chipRed,
};
const campaignsText = (n: number) =>
  n === 1 ? "1 campaña" : `${count(n)} campañas`;
const unit = (platform: "meta" | "tiktok") =>
  platform === "meta" ? "compras del píxel" : "conversiones";

function ToneChip({ group }: { group: PixelGroup }) {
  return (
    <span className={`${r.chip} ${toneChip[group.tone]}`}>
      {PIXEL_TONE_LABEL[group.tone]}
    </span>
  );
}

function GroupCells({ group }: { group: PixelGroup }) {
  return (
    <>
      <td>{count(group.pixel)}</td>
      <td>
        ≈ {realOrdersText(group.real)}
        <small>{count(group.utm)} con UTM</small>
      </td>
      <td>
        {factorText(group.factor)}
        {group.tone === "poco_dato" && group.factor != null && (
          <small>pocos pedidos</small>
        )}
      </td>
      <td>
        <ToneChip group={group} />
      </td>
    </>
  );
}

/**
 * "Píxel contra pedidos reales" (módulo 4). Uses the action sources (pixel
 * per campaign and day) and the control (real orders per day) already loaded
 * by the report: no extra request.
 */
export function PixelCheck({
  summary,
  actions,
  control,
  settings,
  fx,
}: {
  summary: Pick<MarketingSummary, "productFamilies" | "familyDataError">;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
}) {
  const [windowDays, setWindowDays] = useState<number>(t.pixelWindowDays);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allProducts, setAllProducts] = useState(false);
  const [allHealth, setAllHealth] = useState(false);
  const estimate = useMemo(
    () =>
      actions.data && control.data
        ? buildRealEstimate({
            summary,
            sources: actions.data,
            settings,
            control: control.data,
            fx,
          })
        : null,
    [actions.data, control.data, summary, settings, fx],
  );
  const pixel = useMemo(
    () =>
      estimate && control.data
        ? buildPixelReport({
            campaigns: estimate.campaigns,
            estimates: estimate.estimates,
            days: control.data.days,
            labels: settings?.accountLabels ?? [],
            fx,
            windowDays,
            today: control.data.today || marketingDate(),
          })
        : null,
    [estimate, control.data, settings?.accountLabels, fx, windowDays],
  );
  const loading = actions.loading || control.loading;
  const failed = (["meta", "tiktok"] as const).filter(
    (p) => actions.data && actions.data[p].status === "error",
  );
  const health = pixel?.health ?? [];
  const products = pixel?.products ?? [];
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <section className={r.section} aria-labelledby="pixel-title">
      <div className={r.sectionHead}>
        <div>
          <h2 id="pixel-title">Píxel contra pedidos reales</h2>
          <p>
            Factor = compras del píxel ÷ pedidos reales de iComfly (sin
            anulados). Más de {factorText(t.pixelFactorHigh)}: el píxel cuenta
            de más; menos de {factorText(t.pixelFactorLow)}: cuenta de menos.
          </p>
        </div>
        <div
          className={r.windowChips}
          role="group"
          aria-label="Días comparados"
        >
          {WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
            >
              {days} días
            </button>
          ))}
        </div>
      </div>
      {loading && !pixel ? (
        <p role="status">Consultando píxel y pedidos reales…</p>
      ) : !control.data ? (
        <p role="alert" className={r.risk}>
          {control.error || "Pedidos reales no disponibles."}
        </p>
      ) : !actions.data || !pixel ? (
        <p role="alert" className={r.risk}>
          {actions.error || "No se pudo consultar Meta."}
        </p>
      ) : (
        <>
          {health.length > 0 && (
            <div className={`${r.banner} ${r.bannerRisk}`} role="alert">
              <strong>Salud del píxel</strong>
              <ul className={r.pixelHealth}>
                {(allHealth ? health : health.slice(0, MAX_HEALTH)).map((a) => (
                  <li key={`${a.accountLabel}:${a.date}:${a.code}`}>
                    <span className={`${r.chip} ${r.chipRed}`}>
                      {a.code === "caida" ? "Caída" : "Sin compras"}
                    </span>{" "}
                    <strong>{a.title}.</strong> {a.detail}
                  </li>
                ))}
              </ul>
              {health.length > MAX_HEALTH && (
                <button type="button" onClick={() => setAllHealth(!allHealth)}>
                  {allHealth
                    ? "Ver menos"
                    : `y ${count(health.length - MAX_HEALTH)} más`}
                </button>
              )}
            </div>
          )}
          {failed.map((p) => (
            <p key={p} role="alert" className={r.risk}>
              No se pudo consultar {p === "meta" ? "Meta" : "TikTok"}.
            </p>
          ))}
          {pixel.platforms.length > 0 ? (
            <div className={r.pixelPlatforms}>
              {pixel.platforms.map((g) => (
                <p key={g.key}>
                  <strong>{g.label}:</strong> {count(g.pixel)}{" "}
                  {unit(g.platform)} · ≈ {realOrdersText(g.real)} pedidos reales
                  · factor {factorText(g.factor)} <ToneChip group={g} />
                </p>
              ))}
            </div>
          ) : (
            <p className={r.alert}>
              Sin campañas con producto asignado en estos días.
            </p>
          )}
          {pixel.accounts.length > 0 && (
            <>
              <h3 className="mt-6">Por cuenta</h3>
              <div
                className={r.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Píxel por cuenta"
              >
                <table className={r.pixelTable}>
                  <thead>
                    <tr>
                      <th>Cuenta</th>
                      <th>Píxel</th>
                      <th>Pedidos reales ≈</th>
                      <th>Factor</th>
                      <th>Lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pixel.accounts.map((g) => {
                      const children = pixel.accountProducts.filter(
                        (p) =>
                          p.platform === g.platform &&
                          p.key.startsWith(`${g.key}|`),
                      );
                      const expanded = open.has(g.key);
                      return (
                        <Fragment key={g.key}>
                          <tr>
                            <th scope="row">
                              {g.label}
                              <small>
                                {g.platform === "meta" ? "Meta" : "TikTok"} ·{" "}
                                {campaignsText(g.campaigns)}
                              </small>
                              {children.length > 0 && (
                                <button
                                  type="button"
                                  className={r.inlineLink}
                                  aria-expanded={expanded}
                                  onClick={() => toggle(g.key)}
                                >
                                  {expanded
                                    ? "Ocultar productos"
                                    : `Ver ${children.length === 1 ? "1 producto" : `${count(children.length)} productos`}`}
                                </button>
                              )}
                            </th>
                            <GroupCells group={g} />
                          </tr>
                          {expanded &&
                            children.map((p) => (
                              <tr key={p.key} className={r.pixelChild}>
                                <th scope="row">
                                  {p.productName}
                                  <small>{p.detail}</small>
                                </th>
                                <GroupCells group={p} />
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {products.length > 0 && (
            <>
              <h3 className="mt-6">Por producto</h3>
              <div
                className={r.tableWrap}
                tabIndex={0}
                role="region"
                aria-label="Píxel por producto"
              >
                <table className={r.pixelTable}>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Píxel</th>
                      <th>Pedidos reales ≈</th>
                      <th>Factor</th>
                      <th>Lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allProducts
                      ? products
                      : products.slice(0, MAX_PRODUCTS)
                    ).map((g) => (
                      <tr key={g.key}>
                        <th scope="row">
                          {g.label}
                          <small>
                            {g.platform === "meta" ? "Meta" : "TikTok"} ·{" "}
                            {campaignsText(g.campaigns)}
                          </small>
                        </th>
                        <GroupCells group={g} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {products.length > MAX_PRODUCTS && (
                <button
                  type="button"
                  className="mt-2"
                  aria-pressed={allProducts}
                  onClick={() => setAllProducts(!allProducts)}
                >
                  {allProducts
                    ? `Ver los ${MAX_PRODUCTS} con más pedidos`
                    : `Ver todos (${count(products.length)})`}
                </button>
              )}
            </>
          )}
          <p className={r.caption}>
            {shortDate(pixel.window.from)} al {shortDate(pixel.window.to)} (
            {count(pixel.window.days)} días completos; hoy no cuenta). Pedidos
            reales por campaña ≈ UTM + reparto por producto (
            {percentage(pixel.utmShare)} con UTM). El píxel pone la compra en el
            día del clic o la vista: compara varios días, no uno. Menos de{" "}
            {count(t.pixelMinRealOrders)} pedidos reales: pocos para leer el
            factor.
          </p>
          {pixel.notes.map((note) => (
            <p key={note} className={r.caption}>
              {note}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
