"use client";
import { useState } from "react";
import type { InventoryAlert } from "@/lib/marketing-inventory-decide";
import { count } from "./format";
import r from "./team-report.module.css";

const MAX = 6;
const CHIP: Record<InventoryAlert["tone"], [string, string]> = {
  risk: ["Urgente", r.chipRed],
  wait: ["Revisar", r.chipYellow],
  good: ["Reposición", r.chipOk],
};

/** Inventory alerts of módulo 5: active ad without stock, orders waiting, restock. */
export function InventoryAlerts({
  alerts,
  title = "Alertas de inventario",
  empty,
}: {
  alerts: InventoryAlert[];
  title?: string;
  /** Text when there is nothing to say (omit to render nothing). */
  empty?: string;
}) {
  const [all, setAll] = useState(false);
  if (!alerts.length && !empty) return null;
  const visible = all ? alerts : alerts.slice(0, MAX);
  return (
    <div className={r.inventoryAlerts}>
      <h3>{title}</h3>
      {!alerts.length && <p className={r.alert}>{empty}</p>}
      <ul className={r.alertList}>
        {visible.map((alert) => {
          const [label, chip] = CHIP[alert.tone];
          return (
            <li
              key={alert.key}
              className={`${r.alert} ${alert.tone === "risk" ? r.alertRisk : ""}`}
            >
              <span className={`${r.chip} ${chip}`}>{label}</span>
              <strong>{alert.title}</strong>
              {alert.detail}
            </li>
          );
        })}
      </ul>
      {alerts.length > MAX && (
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Ver menos" : `y ${count(alerts.length - MAX)} más`}
        </button>
      )}
    </div>
  );
}
