"use client";
import { useState, type FormEvent } from "react";
import type { MarketingFamily } from "@/lib/marketing-product-families";
import {
  normalKeyword,
  type CampaignKeywordRule,
} from "@/lib/marketing-settings-types";
import { keywordProblem } from "@/lib/marketing-campaign-keywords";
import r from "./team-report.module.css";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;

/** Team rules: a campaign whose name contains the keyword gets the product. */
export function KeywordRules({
  rules,
  families,
  error,
  canEdit,
  saving,
  save,
}: {
  rules: CampaignKeywordRule[];
  families: MarketingFamily[];
  error: string;
  canEdit: boolean;
  saving: string;
  save: Save;
}) {
  const [keyword, setKeyword] = useState("");
  const [family, setFamily] = useState("");
  const [failed, setFailed] = useState(false);
  const normal = normalKeyword(keyword);
  const problem = normal ? keywordProblem(normal) : null;
  const sorted = [...rules].sort((a, b) => a.keyword.localeCompare(b.keyword));
  const options = families
    // Families under review are not used for automatic assignment.
    .filter((f) => f.members.length > 0 && !f.review)
    .sort((a, b) => a.name.localeCompare(b.name));
  async function add(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const ok = await save(`keyword:${normal}`, {
      kind: "keyword",
      keyword: normal,
      family_key: family,
    });
    if (ok) {
      setKeyword("");
      setFamily("");
    } else setFailed(true);
  }
  return (
    <div className={r.keywords}>
      <h3>Palabras clave de campaña</h3>
      <p className={r.caption}>
        Si el nombre de la campaña contiene estas palabras, se asigna el
        producto. Ejemplo: NEOCELL → Colágeno. La asignación guardada a mano
        siempre manda.
      </p>
      {error && <p className={r.caption}>{error}</p>}
      <ul>
        {sorted.map((rule) => (
          <li key={rule.keyword}>
            <span className={r.chip}>
              {rule.keyword.toLocaleUpperCase("es")}
            </span>
            → {rule.product_name}
            {canEdit && (
              <button
                disabled={Boolean(saving)}
                aria-label={`Quitar la palabra ${rule.keyword}`}
                onClick={() =>
                  save(`keyword:${rule.keyword}`, {
                    kind: "keyword",
                    keyword: rule.keyword,
                    family_key: null,
                  })
                }
              >
                {saving === `keyword:${rule.keyword}` ? "Quitando…" : "Quitar"}
              </button>
            )}
          </li>
        ))}
        {!sorted.length && (
          <li>
            Sin palabras del equipo. Se usan el SKU y el nombre del producto.
          </li>
        )}
      </ul>
      {canEdit && !error && (
        <form onSubmit={add}>
          <label className={r.field}>
            Palabra en el nombre de la campaña
            <input
              value={keyword}
              maxLength={60}
              placeholder="Ej.: shilajit capsulas"
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
          <label className={r.field}>
            Producto
            <select value={family} onChange={(e) => setFamily(e.target.value)}>
              <option value="">Elige un producto</option>
              {options.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={
              Boolean(saving) ||
              normal.length < 3 ||
              normal.length > 60 ||
              Boolean(problem) ||
              !family
            }
          >
            {saving === `keyword:${normal}` ? "Guardando…" : "Agregar"}
          </button>
          {problem && (
            <small role="alert" className={r.risk}>
              {problem}
            </small>
          )}
          {failed && (
            <small role="alert" className={r.risk}>
              No se pudo guardar la palabra. Revisa el texto y el producto.
            </small>
          )}
        </form>
      )}
    </div>
  );
}
