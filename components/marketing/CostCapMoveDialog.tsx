"use client";
// Confirmación de "Pasar a COST CAP" (Acciones): lo único de Kairo que crea
// algo en Meta, así que nada se crea sin pasar por aquí. Lee la vista previa
// en vivo (el anuncio, las COST CAP del mismo producto y sus conjuntos), deja
// elegir destino y conjunto cuando hay varios, dice en una línea qué va a
// pasar y solo entonces crea el anuncio. Estados: cargando, no se puede (con
// el motivo), creando, creado (con el id nuevo) y error (se vuelve a comprobar
// antes de reintentar, nunca se reenvía a ciegas).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Target, X } from "lucide-react";
import type { QueueItem } from "@/lib/marketing-action-queue";
import type {
  MoveAdsetOption,
  MoveDestination,
  MovePreview,
} from "@/lib/marketing-cost-cap-move";
import { periodLabelText } from "@/lib/marketing-copy";
import { marketingDate, shiftDate } from "@/lib/marketing-dates";
import { DECISION_RULES } from "@/lib/marketing-decisions";
import { count, money } from "./format";
import a from "./acciones.module.css";
import { useMarketingStore } from "./MarketingStoreContext";

export interface CostCapMoveResult {
  adId: string;
  at: string;
}

type Load =
  | { status: "loading" }
  | { status: "error"; text: string }
  | { status: "ready"; preview: MovePreview };
type Phase =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "created"; adId: string; warning: string }
  | { status: "failed"; text: string };

const destinationKey = (d: Pick<MoveDestination, "accountId" | "campaignId">) =>
  `${d.accountId}:${d.campaignId}`;

function adsetFacts(set: MoveAdsetOption, currency: string): string {
  const parts = [
    set.bidAmount != null ? `puja ${money(set.bidAmount, currency)}` : null,
    set.dailyBudget != null
      ? `${money(set.dailyBudget, currency)} por día`
      : null,
    set.spend != null && set.spend > 0
      ? `gastó ${money(set.spend, currency)} en 3 días`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "sin puja ni presupuesto propios";
}

export function CostCapMoveDialog({
  item,
  onClose,
  onCreated,
}: {
  item: QueueItem;
  onClose: () => void;
  onCreated: (result: CostCapMoveResult) => void;
}) {
  const store = useMarketingStore();
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [destination, setDestination] = useState("");
  const [adset, setAdset] = useState("");
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const busy = phase.status === "creating";

  // Vista previa en vivo (y otra vez al "volver a comprobar").
  useEffect(() => {
    if (!item.adId) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch(
      `/api/marketing/cost-cap-move?store=${store}&account=${item.accountId}&ad=${item.adId}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "No se pudo consultar Meta. Vuelve a intentarlo.",
          );
        return body as MovePreview;
      })
      .then((preview) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "ready", preview });
        const pick =
          preview.destinations.find(
            (d) =>
              d.accountId === preview.suggested?.accountId &&
              d.campaignId === preview.suggested?.campaignId,
          ) ?? preview.destinations.find((d) => !d.blocked);
        setDestination(pick ? destinationKey(pick) : "");
        setAdset(pick?.suggestedAdsetId ?? "");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoad({
            status: "error",
            text:
              error instanceof Error && error.message
                ? error.message
                : "No se pudo consultar Meta. Vuelve a intentarlo.",
          });
      });
    return () => controller.abort();
  }, [item.accountId, item.adId, attempt, store]);

  // Foco: entra al diálogo, no sale con Tab y vuelve a donde estaba al cerrar.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);
  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [href]",
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === ref.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!ref.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const preview = load.status === "ready" ? load.preview : null;
  const chosen =
    preview?.destinations.find((d) => destinationKey(d) === destination) ??
    null;
  const chosenSet = chosen?.adsets.find((set) => set.id === adset) ?? null;
  const ready = Boolean(preview && !preview.blocked && chosen && chosenSet);

  async function create() {
    if (!preview || !chosen || !chosenSet || !item.adId || busy) return;
    setPhase({ status: "creating" });
    try {
      const response = await fetch(
        `/api/marketing/cost-cap-move?store=${store}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store,
            account: item.accountId,
            ad: item.adId,
            targetAccount: chosen.accountId,
            adset: chosenSet.id,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.adId !== "string")
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "No se pudo crear el anuncio. Vuelve a comprobar antes de reintentar.",
        );
      setPhase({
        status: "created",
        adId: body.adId,
        warning: typeof body.warning === "string" ? body.warning : "",
      });
      onCreated({ adId: body.adId, at: new Date().toISOString() });
    } catch (error) {
      setPhase({
        status: "failed",
        text:
          error instanceof Error && error.message !== "Failed to fetch"
            ? error.message
            : "No se pudo confirmar con el servidor. Vuelve a comprobar antes de reintentar: puede que el anuncio se haya creado.",
      });
    }
  }
  function recheck() {
    setPhase({ status: "idle" });
    setAttempt((n) => n + 1);
  }

  const today = marketingDate();
  const windowText = periodLabelText(
    preview?.window ?? {
      from: shiftDate(today, -DECISION_RULES.windowDays),
      to: shiftDate(today, -1),
    },
    today,
  );
  const several = (preview?.destinations.length ?? 0) > 1;

  return (
    <div
      className={a.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={a.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={a.dialogHead}>
          <h3 id={titleId}>
            <Target aria-hidden="true" />
            Pasar a COST CAP
          </h3>
          <button
            type="button"
            className={a.dialogClose}
            onClick={close}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={a.dialogBody}>
          <section className={a.block} aria-label="Anuncio">
            <p className={a.blockLabel}>Anuncio</p>
            <p className={a.blockTitle}>{item.name}</p>
            <p className={a.blockSub}>
              Meta · {item.accountLabel}
              {item.campaignName ? ` · en ${item.campaignName}` : ""}
            </p>
            <dl className={a.facts}>
              <div>
                <dt>Compras</dt>
                <dd>{item.real == null ? "—" : count(item.real)}</dd>
              </div>
              <div>
                <dt>Costo por compra</dt>
                <dd>{money(item.cpaReal, "USD")}</dd>
              </div>
              <div>
                <dt>Gasto</dt>
                <dd>{money(item.spendUsd, "USD")}</dd>
              </div>
            </dl>
            <p className={a.blockSub}>
              Según Meta, del {windowText}. Post ID{" "}
              <code>
                {preview?.source?.postId ?? item.postId ?? "sin dato"}
              </code>
            </p>
          </section>

          {load.status === "loading" && (
            <p className={a.dialogState} role="status">
              Consultando en Meta el anuncio y las campañas COST CAP…
            </p>
          )}
          {load.status === "error" && (
            <p className={`${a.dialogState} ${a.stateBad}`} role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{load.text}</span>
            </p>
          )}

          {preview && phase.status !== "created" && (
            <>
              {preview.blocked ? (
                <p className={`${a.dialogState} ${a.stateWarn}`} role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <strong>No se puede pasar desde aquí.</strong>{" "}
                    {preview.blocked}
                    {preview.destinations
                      .filter((d) => d.duplicate)
                      .map((d) => (
                        <span key={destinationKey(d)} className={a.stateLine}>
                          En {d.campaignName}: «{d.duplicate!.name}» (ID{" "}
                          {d.duplicate!.adId}).
                        </span>
                      ))}
                  </span>
                </p>
              ) : (
                <>
                  <fieldset className={a.block} disabled={busy}>
                    <legend className={a.blockLabel}>
                      {several
                        ? "Campaña COST CAP destino: elige una"
                        : "Campaña COST CAP destino"}
                    </legend>
                    {several ? (
                      <div className={a.options}>
                        {preview.destinations.map((d) => {
                          const key = destinationKey(d);
                          return (
                            <label
                              key={key}
                              className={a.option}
                              data-disabled={d.blocked ? "true" : undefined}
                            >
                              <input
                                type="radio"
                                name="destino"
                                checked={destination === key}
                                disabled={Boolean(d.blocked)}
                                onChange={() => {
                                  setDestination(key);
                                  setAdset(d.suggestedAdsetId ?? "");
                                }}
                              />
                              <span>
                                <strong>{d.campaignName}</strong>
                                <small>
                                  Cuenta {d.accountName}
                                  {d.sameAccount
                                    ? " (la del anuncio)"
                                    : " (otra cuenta)"}
                                  {d.spend != null && d.spend > 0
                                    ? ` · gastó ${money(d.spend, d.currency)} en 3 días`
                                    : ""}
                                </small>
                                {d.blocked && (
                                  <small className={a.optionBlocked}>
                                    {d.blocked}
                                  </small>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      chosen && (
                        <>
                          <p className={a.blockTitle}>{chosen.campaignName}</p>
                          <p className={a.blockSub}>
                            Cuenta {chosen.accountName}
                            {chosen.sameAccount
                              ? " (la del anuncio)"
                              : " (otra cuenta)"}
                          </p>
                        </>
                      )
                    )}
                  </fieldset>

                  {chosen && (
                    <fieldset className={a.block} disabled={busy}>
                      <legend className={a.blockLabel}>
                        {chosen.adsets.length > 1
                          ? "Conjunto de anuncios: elige uno"
                          : "Conjunto de anuncios"}
                      </legend>
                      {chosen.adsets.length > 1 ? (
                        <div className={a.options}>
                          {chosen.adsets.map((set) => (
                            <label key={set.id} className={a.option}>
                              <input
                                type="radio"
                                name="conjunto"
                                checked={adset === set.id}
                                onChange={() => setAdset(set.id)}
                              />
                              <span>
                                <strong>{set.name}</strong>
                                <small>
                                  {adsetFacts(set, chosen.currency)}
                                </small>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        chosenSet && (
                          <>
                            <p className={a.blockTitle}>{chosenSet.name}</p>
                            <p className={a.blockSub}>
                              {adsetFacts(chosenSet, chosen.currency)}
                            </p>
                          </>
                        )
                      )}
                    </fieldset>
                  )}

                  {chosen && chosenSet && (
                    <p className={a.happen}>
                      Se crea un anuncio nuevo, activo, en «{chosenSet.name}» de
                      «{chosen.campaignName}» con la misma publicación. El
                      anuncio original sigue encendido.
                      {!chosen.sameAccount &&
                        " Como la COST CAP está en otra cuenta, allá se crea también un creativo con esa publicación."}{" "}
                      Empieza a gastar del presupuesto de ese conjunto; no se
                      cambia ningún presupuesto ni puja.
                    </p>
                  )}
                </>
              )}
              {phase.status === "failed" && (
                <p className={`${a.dialogState} ${a.stateBad}`} role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>
                    <strong>No se creó el anuncio.</strong> {phase.text}
                  </span>
                </p>
              )}
            </>
          )}

          {phase.status === "created" && (
            <p className={`${a.dialogState} ${a.stateGood}`} role="status">
              <CircleCheck aria-hidden="true" />
              <span>
                <strong>Anuncio creado y activo.</strong> ID nuevo{" "}
                <code>{phase.adId}</code>
                {chosen && chosenSet
                  ? ` en «${chosenSet.name}» de «${chosen.campaignName}».`
                  : "."}{" "}
                Quedó marcado como «Hecho» en Acciones.
                {phase.warning && (
                  <span className={a.stateLine}>{phase.warning}</span>
                )}
              </span>
            </p>
          )}
        </div>

        <footer className={a.dialogFoot}>
          {phase.status === "created" ? (
            <button type="button" className={a.primary} onClick={onClose}>
              Listo
            </button>
          ) : load.status === "error" || phase.status === "failed" ? (
            <>
              <button type="button" className={a.secondary} onClick={close}>
                Cerrar
              </button>
              <button type="button" className={a.primary} onClick={recheck}>
                {load.status === "error" ? "Reintentar" : "Volver a comprobar"}
              </button>
            </>
          ) : preview?.blocked ? (
            <button type="button" className={a.secondary} onClick={close}>
              Cerrar
            </button>
          ) : (
            <>
              <button
                type="button"
                className={a.secondary}
                onClick={close}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={a.primary}
                onClick={create}
                disabled={!ready || busy}
                aria-busy={busy}
              >
                {busy ? "Creando en Meta…" : "Crear anuncio en la COST CAP"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
