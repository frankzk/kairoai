# Kairo AI Webapp Context

Last updated: 2026-06-15

> See "Session 2026-06-13 additions" near the end for the latest architecture
> and finance/logistics features, plus the list of pending Supabase migrations.

## Purpose

Kairo AI is an internal operations webapp for COD e-commerce in LATAM, currently supporting Mireva Costa Rica and being extended for Mireva Honduras. It combines Shopify order data, voice-agent call outcomes, logistics settlement files, and business expenses so the team can understand:

- which COD orders were delivered
- which orders were not delivered or returned
- which orders were annulled before dispatch because the customer was not confirmed
- how much cash is expected from logistics settlements
- urgent profitability after product costs, advertising spend, payroll, and miscellaneous expenses

This document is the onboarding source for future devs and dev agents. Keep it updated whenever architecture, data model, workflows, integrations, or business logic changes.

## Current Stack

- Framework: Next.js 14 App Router
- UI: React, Tailwind CSS, local shadcn-style components
- Hosting: Vercel
- Repository: `frankzk/kairoai`
- Production URL: `https://kairoai-pearl.vercel.app`
- Main production branch: `main`
- Data/integrations:
  - Shopify Admin API
  - Retell AI
  - ElevenLabs
  - Google Gemini
  - Supabase
  - Zadarma (centralita virtual: las asesoras llaman desde el navegador)

## Multi-store Platform Architecture

The app is being evolved without rewriting the working Costa Rica operation.
Finance, dispatch, incidents, and courier data remain `store_id` scoped. The
new platform registry in `supabase/migrations/0019_platform_registry.sql` adds
the onboarding primitives needed for 8+ stores:

- `stores` remains the tenant dimension and now carries timezone, locale,
  historical Shopify lower bound, default courier, and metadata.
- `store_integrations` stores provider configuration per store using env-var
  references only; secret values stay in Vercel/environment variables.
- `courier_accounts` defines which couriers are active per store and whether
  they support API tracking, file import, or both.
- `courier_file_profiles` stores XLSX/CSV mapping profiles so unknown couriers
  can be onboarded by file format before a custom API adapter exists.
- `user_profiles` and `user_store_roles` are the RBAC foundation for Supabase
  Auth. Until the auth migration is complete, the existing admin password is a
  compatibility bridge.
- `courier_shipments` and `courier_tracking_events` are the generic future
  cache for courier status. Existing Moovin/Forza tables stay in place while the
  adapter migration is staged.

Important rule: new store-aware APIs should require an explicit `store`. Legacy
routes may keep compatibility defaults only while they are being migrated.

## Auth

A simple admin login is active in production.

Files:

- `app/login/page.tsx`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `lib/auth.ts`
- `middleware.ts`

Environment variables:

- `ADMIN_PASSWORD`: password used to access the admin panel.
- `AUTH_SECRET`: random secret used to sign the HTTP-only session cookie.

Session details:

- Cookie name: `kairo_session`
- Cookie is HTTP-only.
- Middleware protects the dashboard, admin pages, and internal APIs.
- External webhooks remain public:
  - `/api/shopify/webhook`
  - `/api/retell/webhook`
  - `/api/retell/llm`
  - `/api/cron/retries`

## Existing Product Areas

### Dashboard

Main file: `app/page.tsx`

Current dashboard includes:

- stats cards
- recent calls
- Shopify orders tab
- carts/draft orders tab
- agent status
- links to upsell and settings admin pages
- logout action

### Upsell Admin

Main file: `app/admin/upsell/page.tsx`

Purpose:

- define product-to-product upsell rules
- select products from Shopify
- set upsell SKU, name, price, pitch, and tier

### Agent Settings

Main file: `app/admin/settings/page.tsx`

Purpose:

- configure retry behavior
- configure abandoned cart agent settings

### Gestion financiera MVP

Main file: `app/admin/finance/page.tsx`

Status: implemented locally.

Multi-store rule:

- The finance module is multi-store through `stores` / `store_id`.
- Current configured stores:
  - `mireva-cr` (`store_id = 1`, currency `CRC`, logistics provider `Moovin`)
  - `mireva-hn` (`store_id = 2`, currency `HNL`, logistics provider `Forza`)
- The `/admin/finance` header includes a store selector. Every finance API request must carry the selected `store` value.
- Store isolation is enforced at the API boundary: finance and Shopify data endpoints require an explicit valid `store` (`mireva-cr` or `mireva-hn`) and return `400` instead of defaulting to Costa Rica.
- Finance writes, uploads, deletes, syncs, and reads must always pass `store_id` to Supabase. Boxful logistics/liquidation imports must set `store_id` on both the import record and every row.
- Costa Rica keeps the legacy env fallback `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ACCESS_TOKEN`.
- Costa Rica OAuth can also use `SHOPIFY_CR_CLIENT_ID` / `SHOPIFY_CR_CLIENT_SECRET`, with legacy fallback to `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`.
- Honduras must use `SHOPIFY_HN_SHOP_DOMAIN`, `SHOPIFY_HN_CLIENT_ID`, `SHOPIFY_HN_CLIENT_SECRET`, and `SHOPIFY_HN_ACCESS_TOKEN`.
- Do not use the Costa Rica Shopify app credentials for Honduras. Shopify blocks app installation across organizations, and the authorization screen will show the wrong app name/store owner.
- Shopify OAuth token generation is store-aware:
  - Costa Rica: `/api/shopify/auth?store=mireva-cr`
  - Honduras: `/api/shopify/auth?store=mireva-hn`
  - The callback uses the OAuth `state` value to show the correct Vercel token variable (`SHOPIFY_CR_ACCESS_TOKEN` or `SHOPIFY_HN_ACCESS_TOKEN`) after Shopify returns the token.
  - OAuth now rejects missing/invalid `store` state; never generate tokens from a store-ambiguous URL.
- Shopify is the authoritative order universe inside each store. A Boxful logistics/liquidation row from Honduras must never create or count as a Costa Rica order, and vice versa.
- Boxful data is reconciliation data only. If a Boxful row does not match a Shopify order in the same `store_id`, it stays unmatched and may become an anomaly/reclaim, but it must not create a new order in another store.
- Carrier tracking is store-aware:
  - Costa Rica uses Moovin (`moovin_tracking`, `/api/finance/moovin-sync`, `/api/finance/moovin-tracking`).
  - Honduras uses Forza (`forza_tracking`, `/api/finance/forza-sync`, `/api/finance/forza-tracking`).
  - The UI chooses the carrier from `FINANCE_STORES[].logisticsProvider`. Do not infer Honduras guides as Moovin and do not query Forza for Costa Rica.
  - Forza guide numbers are normalized with the `FD` prefix, so `26827471` and `FD26827471` refer to the same guide.
  - Forza public tracking uses `POST https://rastreo.forzadelivery.com/fd2/Home.aspx/API` with `Tracking/GetTrackingPublic`. The browser page may show reCAPTCHA, but the JSON endpoint currently returns package status for public guide lookups. Cache results in `forza_tracking` and avoid polling all guides on page load.
- Supabase uniqueness is store-scoped for the key tables: Shopify orders (`store_id, shopify_order_id`), SKU costs (`store_id, sku`), finance claims (`store_id, anomaly_key`), and Boxful file controls (`store_id, file_name, file_type`).
- Until `0010_multi_store_finance.sql` is applied, Costa Rica read APIs fall back to legacy unscoped tables if Supabase does not have `store_id` yet. This preserves visibility of existing CR costs, settlements, logistics, expenses, claims, and file controls. Honduras does not use that fallback, to avoid mixing countries.
- Webhook/call-confirmation legacy routes still use the original Shopify/Retell configuration and should be treated as Costa Rica-only until they receive explicit `store_id`, per-store webhook secret validation, and per-store call metadata. Do not connect Honduras webhooks to those legacy routes yet.

Navigation:

- Dashboard now links to `/admin/finance` with the label `Gestion`.

Tabs:

- `Pedidos`: shows Shopify orders as the baseline tracking list, filters by operational tracking state and liquidation state, includes a search box for order codes, guide numbers, and customers, opens Boxful logistics Excel upload from the table header action button/modal, inspects matched rows, and tracks operational follow-up state.
- `Liquidaciones`: upload settlement/liquidation Excel files by cutoff date, select previously imported files, sort them by recent/oldest, delete imports when needed, inspect financial settlement rows, filter Shopify match state, source Excel traceability, claim alerts, and anomalies. Liquidation Boxful files belong here, not in the logistics file-control tab.
- `Productos`: single surface for product performance and product costs. The former standalone `Costos SKU` workflow is folded into the product table as a compact `Costo SKU` column with edit/history actions.
- `Gastos`: manual CRUD for ads, payroll, and miscellaneous expenses, organized into three internal tabs with contextual modal buttons.
- `Cierre mensual`: single profitability and monthly-close surface. It must stay simple: month selector, executive result, first-priority issues, registered-cost composition, then collapsible details for orders, anomalies, missing SKU costs, and month comparison.
- `Logistica Boxful`: read-only logistics file history. It consolidates files imported from the `Pedidos` Boxful logistics modal. It must not upload/register files manually and must not show liquidation-file controls.

APIs:

- `GET/POST/DELETE /api/finance/logistics`
- `GET/POST/DELETE /api/finance/product-costs`
- `GET/POST/PATCH/DELETE /api/finance/expenses`
- `GET/POST/DELETE /api/finance/settlements`
- `GET/POST /api/finance/shopify-sync`
- `GET/POST /api/finance/claims`
- `GET /api/finance/boxful-files`
- `GET /api/finance/summary`
- `GET/POST /api/finance/moovin-sync`
- `GET /api/finance/moovin-tracking`
- `GET/POST /api/finance/forza-sync`
- `GET /api/finance/forza-tracking`

Core logic:

- `lib/finance.ts`

Excel parsing:

- Uses the `xlsx` npm package.
- Boxful logistics imports use the first sheet.
- Boxful column M (`Estado`) is the source of truth for delivered/returned logistics status.
- Settlement imports expect a sheet named `Envios`; if missing, the first sheet is used.
- Optional `Consolidado` sheet is read for total collected and total to liquidate.
- Settlement/liquidation imports do not use date ranges in the UI. The user provides one `fecha de corte`, stored in `settlement_imports.period_end`; `period_label` is automatically derived as `Corte YYYY-MM-DD` when not provided.
- `settlement_imports.file_name` is a business identifier because Boxful references liquidations by Excel file name. The UI must keep this visible in latest import cards and history so the team can know which Boxful liquidation files are still missing in Kairo AI.
- In the `Liquidaciones` tab, imported files appear below the upload form as selectable file rows. Selecting a file changes the active state and drives the right-side settlement table. Imports can be sorted by `Recientes` or `Antiguas`; deleting an import removes the import record and its settlement rows.
- Liquidation files are controlled in `Liquidaciones`. The former mixed file-control tab is now `Logistica Boxful` and only displays `file_type = logistica`.
- Settlement rows can be filtered by Shopify match status: `Todos`, `Con match`, and `Sin match`. `Sin match` means the Boxful liquidation row did not match a Shopify order by order name, `#MCRC`/numeric variants, guide/order identifiers, or iConflate/chatbot note code.
- If the user does not enter `period_start`, the importer infers the earliest `Creado en` date from the Excel and uses that to limit Shopify order fetching. This prevents long Vercel imports and avoids opaque non-JSON server errors.
- Shopify matching accepts exact order names, `#MCRC` order names, and numeric order numbers when reconciling imported files.
- Shopify matching also accepts iConflate/chatbot order codes stored in Shopify order notes, for example `Pedido #3685 - Venta por bot - WhatsApp ...`. Importers fetch `note` and `note_attributes`, extract `Pedido #NNN`, and use it as an alternate match key before falling back to Shopify numeric `order_number`.
- `/admin/finance` requests one bounded live Shopify page with `status=any` from the selected store's historical start date so the Pedidos tab can show recent store orders even before a Boxful logistics file is imported. It also reads persisted Shopify orders from Supabase in paginated chunks. It must not use `all=1` during normal page load because Shopify pagination can exceed Vercel serverless timeouts. Boxful rows replace/enrich matching Shopify rows instead of creating duplicates.
- Shopify is the only authoritative order universe for `Pedidos`, `Productos`, `Cierre mensual`, KPIs, and profitability. A Boxful logistics row or liquidation row without a verified Shopify match must never be promoted into a new visible order. It remains reconciliation backlog: `Sin match` in the import view and/or a finance anomaly until the real Shopify order is found.
- The `Pedidos` tab keeps the Shopify/Boxful table as the main surface. The Boxful logistics importer is an action button on the right side of the table header and opens a modal; it should not return to a persistent side-panel form.
- The `Pedidos` tab search filters the visible table client-side by order code (`#MCRC...`, `MCRC...`, iConflate note code, or numeric partials), guide number, customer name, SKU, and item title. The search should remain above the table because it is the primary lookup workflow during reconciliation.
- The `Pedidos` tab main controls are tracking-state filters: `Todos`, `Pendientes`, `Anulados`, `Entregados`, and `No entregados`. Technical import counts such as Boxful rows, Shopify matches, and unmatched rows are diagnostic context only, not primary KPIs.
- The `Pedidos` tab also has liquidation filters: `Todos`, `Liquidados`, `Sin liquidacion`, `Por reclamar`, and `Duplicados`. These filters are used for corrective work, especially `Entregados` + `Por reclamar`.
- In the `Pedidos` table, `Estado liquidacion` must stay as a simple financial state: `Liquidada`, `Sin liquidacion`, or `Doble liquidacion`. The Shopify order badge is followed by `Fecha Shopify`, sourced from `shopify_created_at`, so support can compare operational movement against the original Shopify creation date. The source Excel belongs in a separate `Archivo liquidacion` column so the team can audit which Boxful file paid or charged that order. The settlement amount belongs in a separate `A liquidar` column.
- Existing imported Excel rows are not automatically rematched after a matching-rule code change. To apply the new iConflate-note match rule to an already imported liquidation/logistics file, delete that import and upload the Excel again, unless a future rematch tool is added.

Database schema:

- New migration file: `supabase/migrations/0002_finance_schema.sql`
- This SQL must be executed in Supabase SQL Editor before production finance APIs can persist data.
- Multi-store migration file: `supabase/migrations/0010_multi_store_finance.sql`
- This SQL adds `stores`, backfills current finance rows to Costa Rica, and adds `store_id` to Shopify orders, logistics, liquidations, costs, cost versions, expenses, claims, and Boxful file controls.
- Forza tracking migration file: `supabase/migrations/0011_forza_tracking.sql`
- This SQL adds the Honduras Forza status cache keyed by `(store_id, guide_number)`. It must run after `0010_multi_store_finance.sql` before the Forza sync buttons can persist statuses.
- The `shopify_order_syncs` table is optional in older Supabase installs. The multi-store migration checks for it before adding `store_id`, so the migration can run safely even when that sync-audit table was never created.
- If tables/columns are missing, `/admin/finance` shows a message instructing the user to run `supabase/migrations/0002_finance_schema.sql` and `supabase/migrations/0010_multi_store_finance.sql`.
- Additional finance-control tables:
  - `shopify_orders`: persisted Shopify order master, synced in batches.
  - `shopify_order_syncs`: reserved sync audit table.
  - `product_cost_versions`: SKU cost history by effective date.
  - `finance_claims`: workflow state for financial anomalies/reclaims.
  - `boxful_file_controls`: exact Boxful file-name registry and missing-file tracker.

Important implementation detail:

- `Estado seguimiento` and `Estado liquidacion` are different business concepts and must not be merged:
  - `Estado seguimiento` comes from Boxful logistics column M and Shopify cancellation state.
  - `Estado liquidacion` comes from settlement/liquidation Excel rows and represents whether/where the order appeared financially.
- Order rows are Shopify-backed only. Matched Boxful logistics rows can provide guide/status/customer corrections, and matched liquidation rows can provide settlement state/cash, but unmatched Boxful/liquidation rows cannot increase the Shopify order count.
- Operational order status uses this priority:
  - `Entregado`: Boxful logistics column M says `Entregado`.
  - `No entregado`: Boxful logistics column M says `No entregado` or equivalent returned status.
  - Liquidation fallback: if logistics is still pending/in-progress but a Boxful liquidation row says `Entregado` or `No entregado`, tracking can use that liquidation status to update the follow-up state.
  - `Anulado`: Shopify says the order is cancelled or `financial_status = voided`, and there is no Boxful/logistics/liquidation movement for that order.
  - `Pendiente`: the order is in progress and has none of the final states above.
- If Shopify is cancelled/voided but Boxful or a liquidation file shows movement, the order is not treated as a pure `Anulado`. Follow Boxful/liquidation for the operational outcome: delivered becomes revenue/profit, not delivered keeps logistics costs, and in-progress stays pending until the final result arrives.
- Product costs are applied only to rows whose internal status is `delivered`.
- Product cost lookup is versioned. For a delivered order, the UI chooses the SKU cost version whose `effective_from` date is closest to but not after the Shopify order date. Current `product_costs` remains the active/latest table; `product_cost_versions` is the audit/history table.
- `No entregado` rows still affect profitability through their negative `A Liquidar` value.
- Claim alert rule: if a Boxful logistics row is `Entregado` but no settlement/liquidation row exists for the same order or guide number, `/admin/finance` flags it as `Entregados sin liquidacion` / `Por reclamar`. This is a revenue-control alert so the team can claim payment from the logistics provider.
- Settlement traceability rule: whenever an order appears in a settlement/liquidation import, the order history/table must show the source Excel file name. The UI matches logistics rows to settlement rows by normalized order number or guide number and displays `settlement_imports.file_name`.
- Anomaly reporting rule: every financial/logistics inconsistency should be surfaced in the UI, not hidden in secondary badges. Double settlement/liquidation is an anomaly and must be reported with the matching key, source Excel files, statuses, count, and total amount.
- In normal operation each order should have zero or one liquidation trace. More than one liquidation trace for the same normalized order or guide must show as `Doble liquidacion` in `Pedidos` and as a high-severity anomaly for review.
- The `Cierre mensual` tab builds the operational finance control center in the client from Shopify orders, Boxful logistics rows, settlement rows, product costs, expenses, and import filenames. It does not require an extra DB table yet.
- There is intentionally no separate `Rentabilidad` tab. Profitability, anomaly review, missing SKU cost review, and cost composition live inside `Cierre mensual` to avoid two similar financial views.
- The first screen of `Cierre mensual` should not expose all tables at once. Orders, anomalies, missing SKUs, and historical comparison are secondary detail sections and should remain collapsed by default.
- Order-level profitability uses:
  - `amount_to_liquidate`: sum of matched settlement rows for the order/guide.
  - `product_cost`: SKU unit cost plus packaging cost, multiplied by quantity, only for delivered orders.
  - `contribution_margin`: `amount_to_liquidate - product_cost`, before ads/payroll/misc allocation.
  - `cash_status`: `cobrado` when there is a settlement row, `por_cobrar` when delivered but not settled, and `sin_caja` otherwise.
- Financial anomaly rules currently implemented:
  - delivered without settlement
  - duplicate settlement/liquidation
  - settlement says delivered but tracking is not delivered
  - cancelled/voided Shopify order with Boxful/liquidation movement
  - missing SKU cost
  - negative order margin only when the matched settlement has COD collected (`Monto COD > 0`)
  - Shopify order without Boxful guide after 2 days
  - liquidation row without a visible Shopify-backed order
- Stripe / non-COD settlement rule: if a matched liquidation row has `Monto COD = 0`, a negative `A Liquidar` is expected because Boxful is only charging logistics/fulfillment services. That negative logistics balance affects profitability, but it is not a `Margen negativo` anomaly by itself.
- Financial anomalies can be moved through a claim workflow: `pendiente`, `reclamado`, `resuelto`, `descartado`, with notes. The key is `finance_claims.anomaly_key`.
- Exportables are client-side CSV downloads for anomalies, order profitability, monthly close, and Boxful file control.
- The monthly close tab must not be only a summary. It should let the user select `Todos` or a month, see counts for `Pendientes`, `Entregados`, `No entregados`, `Anulados`, liquidated/unliquidated orders, claim candidates, duplicate settlement rows, and inspect/export the order list behind that month.
- Shopify historical sync must be done via `/api/finance/shopify-sync` in bounded batches. The finance UI treats Shopify as the complete order base from each store-specific start date; Boxful logistics and liquidations only enrich tracking/cash state. Page load reads persisted Shopify orders in small paginated API calls (`limit` + `offset`) so the full store history can be shown without one oversized Vercel response.
- Store-specific Shopify sync start dates:
  - Mireva Costa Rica: `2026-01-01T00:00:00-06:00`
  - Mireva Honduras: `2025-12-09T00:00:00-06:00` because the first Honduras order is from December 9, 2025.
- If Honduras endpoints return Shopify `Unauthorized`, the historical date is not the blocker; `SHOPIFY_HN_ACCESS_TOKEN` must be regenerated from `/api/shopify/auth?store=mireva-hn` and redeployed.
- Settlement/liquidation files also include per-order Boxful charged service costs:
  - `Monto de comision COD`
  - `Costo de entrega`
  - `Pick&Pack`
  - `Empaque`
- Business rule: `A Liquidar = Monto COD - Monto de comision COD - Costo de entrega - Pick&Pack - Empaque`.
- `Com. Tarjeta` is imported and can be shown as an informational settlement field, but it is not included in the Boxful service-cost total unless the business later confirms otherwise.
- These Boxful service costs are imported and shown in profitability as a settlement breakdown. They must not be subtracted again from net profit because `A Liquidar` already represents the net logistics result after those charges.
- Shopify matching uses exact settlement `Orden` to Shopify `order.name`, `#MCRC`/numeric variants, and iConflate/chatbot note codes such as `Pedido #3685`.
- Numeric-only settlement order values can be iConflate/chatbot order codes. Shopify notes containing `Pedido #NNN` are now the primary source for matching those values.

## Shopify Integration

Shopify is active in production.

Validated endpoints:

- `/api/shopify/products`: returns products and variants.
- `/api/shopify/orders`: returns recent open orders by default; accepts `status`, `all=1`, `limit`, `created_at_min`, and `max_pages`. Even with `all=1`, pagination is capped to avoid Vercel `FUNCTION_INVOCATION_TIMEOUT`.

Important behavior:

- Shopify order name values look like `#MCRC11518`.
- The logistics settlement file uses an `Orden` column that often matches Shopify `order.name`.
- Some settlement rows use numeric-only order values such as `3937` or `3685`. These often come from iConflate/chatbot and should match only against explicit external aliases in Shopify notes/attributes, for example `Pedido #3685`.
- A plain numeric Boxful order like `4206` must not be auto-converted to Shopify `#MCRC4206`; `#MCRC` matching requires an explicit `#MCRC...`/`MCRC...` value.
- `/admin/finance` includes a `Notas Shopify` tab that lists Shopify order code to note alias pairs, for example `#MCRC10269 -> 3685`. The admin fetches a lightweight 90-day Shopify notes backfill so recent liquidation/logistics matches by bot order code do not depend only on the full historical sync.
- In `/admin/finance`, Shopify orders appear in the `Pedidos` tab. Rows with a matching Boxful logistics import show `Origen = Boxful`; Shopify-only rows show `Origen = Shopify` and remain `Pendiente` unless Shopify is cancelled/voided or a liquidation row provides a final status. If a cancelled/voided Shopify order has Boxful or liquidation movement, Boxful/liquidation state overrides pure annulment.

## Logistics Settlement Analysis

Latest settlement analyzed:

- Local file: `C:\Users\Pc\Downloads\Liquidación 6EDBEA.xlsx`
- Workbook sheets:
  - `Envios`: 711 shipment rows
  - `Consolidado`: settlement totals

Important columns from `Envios`:

- `No. Guia`
- `Orden`
- `No. Orden tienda`
- `Nombre`
- `Apellido`
- `Telefono`
- `Creado en`
- `Courier`
- `Tipo de Servicio`
- `Monto COD`
- `Monto de comision COD`
- `Com. Tarjeta`
- `Costo de entrega`
- `Pick&Pack`
- `Empaque`
- `A Liquidar`
- `Estado`

Observed settlement states:

- `Entregado`
- `No entregado`

Business meaning:

- `Entregado`: customer received and paid COD order.
- `No entregado`: logistics did not deliver or order returned; the settlement row often has negative logistics costs.
- `Anulado`: not present in this settlement file by default. This should be inferred from Shopify/voice-agent flow when a COD order was not confirmed and therefore was not dispatched.

First reconciliation result against Shopify:

- Settlement rows: 711
- Shopify orders fetched: 5,997
- Matched rows: 558
- Unmatched rows: 153
- Match rate: 78.48%
- Match key used successfully: settlement `Orden` to Shopify `order.name`

Matched settlement summary:

- `Entregado`: 343 rows, `₡6,866,683.29` to liquidate
- `No entregado`: 215 rows, `-₡801,459.60` to liquidate

Full settlement summary:

- `Entregado`: 420 rows, `₡8,218,982.68` to liquidate
- `No entregado`: 291 rows, `-₡1,023,802.40` to liquidate
- `Total a recibir`: `₡7,195,180.28`

Unmatched rows:

- 153 total
- 150 are numeric-only order values
- 2 have `#MCRC` prefix
- 1 has another pattern

Next reconciliation work:

- Numeric-only rows can come from the iConfly/iConflate bot code stored in Shopify notes.
  Example: Shopify order `#MCRC11603` can include note `Pedido #4206 - Venta por bot - WhatsApp ...`.
  In that case Boxful/liquidation rows with order `4206` must match Shopify `#MCRC11603`.
- Plain numeric Boxful order values should not fall back to `#MCRC{number}`. They match Shopify only when that numeric code exists as an explicit external bot-code alias in Shopify notes/attributes.
- Existing imported rows are also enriched in the admin UI from synced Shopify data, so old `sin match` rows can resolve after Shopify sync/refresh without re-uploading the Excel.
- Build an importer that stores uploaded weekly/period settlement files instead of manually analyzing local Excel files.
- Preserve source file name and import timestamp.
- Keep raw row data for auditability.

## Planned New Area: Gestion de Pedidos

The next product area should be a business operations and profitability section, not only a shipment tracker.

Confirmed MVP decisions:

- Product costs will be managed by SKU.
- Advertising spend will be entered manually at first.
- Payroll will be entered as a complete monthly amount.
- Miscellaneous expenses will be entered manually.
- Logistics settlement files are generated weekly or by period and will be uploaded manually by the user.
- Initial net profit formula is approved:

```txt
utilidad_neta = sum(A Liquidar) - product_costs - ads - payroll - miscellaneous_expenses
```

Recommended top-level navigation:

1. Pedidos
2. Costos de producto
3. Gastos
4. Cierre mensual

### 1. Pedidos

Purpose:

- track order outcome and reconciliation status
- show whether each order is pending, annulled, delivered, or not delivered from the follow-up/logistics perspective
- show settlement presence as a separate `Estado liquidacion` column, without treating it as the follow-up status

Suggested columns:

- Shopify order
- guide number
- customer name
- partially masked phone
- Shopify total
- Shopify financial status
- Shopify fulfillment status
- logistics settlement status
- internal operational status
- courier
- order date
- settlement Excel source file, when present
- settlement amount/status, when present
- match status

Internal statuses:

- `Entregado`: appears as delivered in settlement.
- `No entregado`: appears as not delivered in Boxful logistics or settlement.
- `Anulado`: COD order was not confirmed and was not dispatched.
- `Pendiente`: order is still in progress and does not have `Anulado`, `Entregado`, or `No entregado`.
- `Sin match`: appears in settlement but was not found in Shopify.
- `Por reclamar`: appears as delivered in Boxful logistics, but is missing from imported settlement/liquidation rows by both order number and guide number.

Anomalies:

- `Doble liquidacion`: the same normalized order number or guide number appears in two or more distinct settlement/liquidation rows. The UI must report the source Excel files and amounts so the team can review possible duplicate payment/cost.

### 1.5 Liquidaciones

Purpose:

- manage financial settlement files independently from shipment follow-up
- upload liquidation Excel files using the Boxful file name plus one cutoff date
- select any imported liquidation from the list under the import form
- sort imported liquidation files by newest or oldest cutoff/import date
- delete an imported liquidation with confirmation when it needs to be reprocessed
- filter settlement rows by Shopify match: all rows, matched rows, or unmatched rows only
- report delivered orders missing from liquidation as claim alerts
- report double liquidation or any financial/logistics inconsistency as anomalies
- show each settlement row with its source Excel file, status, Shopify match, and amount to liquidate
- list imported liquidation file names and cutoff dates to compare against Boxful and identify missing imports

Important rule:

- Shopify `fulfilled` does not necessarily mean financially successful. For profitability, settlement status and `A Liquidar` are the source of truth.

### 2. Costos de Producto

Purpose:

- define cost of goods sold by product/SKU.
- use SKU as the primary key for cost matching.
- show Shopify products/variants so the user can edit costs directly in the product table instead of typing product data manually.

Suggested fields:

- SKU
- product name
- unit cost
- optional packaging cost
- currency
- effective start date
- active/inactive

Used to calculate:

```txt
pedido_product_cost = sum((unit_cost + packaging_cost) * quantity)
```

Important:

- Shopify variants without SKU are shown as `Sin SKU` and cannot be used for automatic cost matching until a SKU is added in Shopify.
- Cost rows are not free-editing. The user clicks `Editar`, enters the draft values, then the same action changes to `Guardar`.
- `Costo unitario` must be greater than zero before a SKU can be validated as `Con costo`.
- `Empaque propio` is the merchant-side packaging/product handling cost per unit. It is separate from the `Empaque` charged by Boxful in settlement files.
- Every save writes the active product cost and a `product_cost_versions` history row through `/api/finance/product-costs`.
- `effective_from` controls when the new cost starts applying. The UI defaults it to today, and historical rows should use the version effective on the order date when the profitability logic is extended for date-sensitive COGS.
- The operational table uses internal views: `Sin costo` for Shopify variants still missing unit cost, and `Con costo` for validated SKUs. Historical audit is per SKU: each row shows a `Historial` button, enabled only when the SKU has more than one saved version, and opens a modal with that SKU's versions.

### 3. Gastos

Use three internal tabs inside one page:

- Ads
- Planilla
- Varios

UI rule:

- Each tab owns its own list/view.
- The registration form is not a persistent side-panel.
- The action button lives in the top-right of the active tab view and opens a modal:
  - Ads: `Registrar Gasto Ads`
  - Planilla: `Registrar Planilla`
  - Varios: `Registrar Gastos Varios`
- The active tab determines the stored `business_expenses.type`, so the modal does not need a type dropdown.

#### Ads

Suggested fields:

- date
- platform
- optional campaign
- amount
- currency
- notes

Start with manual entry. Later, this can connect to Meta/TikTok/Google automatically.

#### Planilla

Suggested fields:

- month
- total monthly payroll amount
- optional person or role
- amount
- type: fixed, commission, bonus
- notes

MVP rule:

- Payroll is entered by full month.

#### Gastos Varios

Suggested fields:

- date
- category
- provider
- amount
- recurring yes/no
- notes

Examples:

- software
- warehouse/storage
- design
- bank fees
- tools
- phone lines
- domains
- VAs
- accounting

### 4. Cierre mensual

Purpose:

- answer urgently: how much money did the business actually make?
- identify per-order profitability, cash pending from COD settlements, and operational anomalies that require action.
- show which cost concepts consume 100% of the monthly cost base through a stacked horizontal bar.

Initial formula:

```txt
resultado_logistico = sum(A Liquidar from all settlement rows)
utilidad_neta = resultado_logistico - product_costs - ads - payroll - miscellaneous_expenses
```

Important:

- In the settlement file, `No entregado` rows already contribute negative values through `A Liquidar`.
- In Stripe/non-COD settlement rows, `Monto COD = 0` and `A Liquidar` can be negative because Boxful deducts service costs without collecting cash from the customer. This is normal and should not create a negative-margin anomaly by itself.
- In the settlement file, delivery, Pick&Pack, empaque, and COD commission explain the difference between COD collected and `A Liquidar`, but they are not additional deductions after `A Liquidar`.
- `Com. Tarjeta` is tracked separately as informational unless confirmed as part of the Boxful service-cost formula.
- Product costs should usually be applied only to delivered orders unless inventory is lost or non-returnable. This needs a business rule before final profit calculations.

Suggested KPIs:

- delivered revenue
- total to liquidate
- product costs
- advertising spend
- payroll
- miscellaneous expenses
- net profit
- net margin
- real CPA
- real ROAS
- loss from not-delivered orders
- cost composition percentage by Boxful, product cost, ads, payroll, and miscellaneous expenses

Implemented order-control KPIs:

- `Caja liquidada`: sum of settled `A Liquidar` rows currently visible in control.
- `Caja por reclamar`: expected COD for delivered orders without settlement.
- `Margen pedido`: sum of order-level contribution margin before ads/payroll/misc.
- `Alertas criticas`: high-severity finance anomalies.

Implemented close view:

- Month selector focused on one month at a time. `sin-fecha` is labeled as `Sin fecha Shopify` because it represents rows without a Shopify creation date.
- Executive result card: net profit, liquidated cash, cash to claim, contribution margin, delivered/pending/not-delivered/annulled counts, and cash-to-claim share.
- `Que revisar primero` card: pending operations, claim candidates, duplicate liquidations, missing SKU costs, and high-severity anomalies.
- `Costos registrados` card: stacked horizontal bar for Boxful service costs, product cost, ads, payroll, and miscellaneous expenses. Profit should not be part of the cost bar.
- Collapsible details: order list, anomalies/reclaims, SKUs without cost, and month comparison. These details must stay closed by default to keep the close readable.

Important limitation:

- Ads, payroll, and miscellaneous expenses are still allocated only at aggregate/month level. Per-order profitability is contribution margin before those shared expenses.
- Shopify historical order sync is bounded and persisted through `/api/finance/shopify-sync`. Page load reads the persisted Supabase history in small pages and fetches one live Shopify page for freshness, avoiding browser-triggered full Shopify pagination and avoiding a single huge JSON payload.

## MVP Recommendation

Build in this order:

1. Settlement importer and reconciliation table.
2. Orders view with delivered/not delivered/annulled/pending/unmatched statuses.
3. Product costs CRUD.
4. Expenses CRUD with Ads, Planilla, and Varios tabs.
5. Cierre mensual with profitability summary, cost composition, anomalies, and manual costs/expenses.

## Operational Notes

- Do not commit `.env.local` or secrets.
- `.vercel` is local metadata and should remain ignored.
- Vercel production deploys from `main`.
- Finance persistence requires running `supabase/migrations/0002_finance_schema.sql` and `supabase/migrations/0010_multi_store_finance.sql` in Supabase before use.
- After changing protected routes, verify:
  - `/login` returns 200
  - `/` redirects to `/login` when unauthenticated
  - Shopify and Retell webhooks remain accessible

## Validation Log

2026-06-13:

- `npm run lint`: passed
- `npm run build`: passed
- Hardened multi-store isolation for finance and Shopify data routes:
  - `lib/stores.ts` now exposes strict store parsing helpers that reject missing/unknown store codes instead of normalizing to Costa Rica.
  - Finance APIs for summary, product costs, expenses, claims, Boxful file controls, logistics uploads/deletes, settlement uploads/deletes, and Shopify sync require an explicit `store`.
  - Shopify data APIs for products, orders, note orders, checkouts, and draft orders require an explicit `store` and resolve credentials from that store only.
  - Shopify OAuth token generation requires `store`; OAuth callback rejects invalid store state and validates that the returned `shop` domain matches the selected store.
  - Remaining Shopify webhook/call-confirmation legacy paths still use the original global Shopify/Retell configuration and are documented as Costa Rica-only until per-store webhook/call metadata is implemented.

2026-06-12:

- `npm run lint`: passed
- `npm run build`: passed
- Added multi-store finance architecture for Mireva Honduras without duplicating the app:
  - New shared store config: `lib/store-config.ts`
  - Server credential resolver: `lib/stores.ts`
  - New DB migration: `supabase/migrations/0010_multi_store_finance.sql`
  - `/admin/finance` now has a store selector and sends `store=mireva-cr` or `store=mireva-hn` to finance and Shopify endpoints.
  - Finance reads/writes are scoped by `store_id` for Shopify orders, Boxful logistics, Boxful liquidations, product costs, cost versions, expenses, claims, and file controls.
  - Existing Costa Rica data is backfilled to `store_id = 1`; Honduras starts isolated on `store_id = 2`.
  - Required Honduras envs in Vercel: `SHOPIFY_HN_SHOP_DOMAIN` and `SHOPIFY_HN_ACCESS_TOKEN`.
- Supabase `shopify_orders` currently contains `10,756` persisted Shopify orders, matching the direct Shopify API count from `2026-01-01T00:00:00-06:00` at validation time. First persisted order observed: `#MCRC1001` on `2026-01-19`.
- Persisted Shopify order distribution at validation time: January `64`, February `1,994`, March `1,652`, April `2,379`, May `3,410`, June `1,257`.
- `logistics_rows` currently contains `7,736` Boxful rows and `7,696` consolidated logistics keys. `7,368` of those consolidated logistics keys are Shopify-backed; `329` raw logistics rows remain unmatched and must not count as pedidos. Imported logistics distribution: `Entregado 4,802`, `No entregado 2,355`, `En ruta a destino 140`, `Problemas en gestion 96`, `Recolectado 275`, `Registrado 23`, `Guia cancelada 45`.
- `/api/finance/shopify-sync` GET now supports `limit` and `offset`, so `/admin/finance` can load the full persisted Shopify base in pages instead of relying on one large JSON response.
- `/admin/finance` now renders the base finance UI before the full Shopify history is loaded. Persisted Shopify orders are appended in background batches of `2,000`, with a visible progress banner, so the page no longer stays blank while January-to-date data is downloaded and recalculated.
- Corrected the authoritative order architecture: `Pedidos`, `Productos`, `Cierre mensual`, KPIs, and profitability now use only Shopify-backed orders. Unmatched Boxful logistics rows and unmatched liquidation rows stay as reconciliation/anomaly records and no longer increase the visible order total.
- Architecture audit after the fix: the old visible-order formula produced `11,084` rows because unmatched Boxful/logistics keys were promoted into the order list; the new Shopify-backed formula produces `10,756`, matching Shopify and Supabase.
- Hardened Boxful Excel parsing. `lib/xlsx.ts` now exposes `sheetToJson`, sanitizes every worksheet before conversion, and converts unsupported formula cell types such as `t="f"` into safe string/number/date cells. `/api/finance/logistics` and `/api/finance/settlements` now use this helper for every parsed sheet, including `Consolidado`, to prevent the upload error `unrecognized type f`.
- Local audit of `C:\Users\Pc\Downloads\01-12-2025 hasta 11-06-2026.xlsx` after formula sanitization:
  - `total_rows = 7736`
  - `guide_rows = 7736`
  - status counts from Boxful column M: `Entregado = 4808`, `No entregado = 2349`, `Recolectado = 275`, `Registrado = 23`, `En ruta a destino = 140`, `Problemas en gestion = 96`, `Guia cancelada = 45`
  - order code shapes: `#MCRC... = 6871`, numeric bot/iConflate aliases = `863`, other = `2`
  This means a dashboard showing only ~800 delivered and ~350 not delivered after importing this file should be investigated as a data-loading/consolidation issue, not as an Excel-source issue.
- `Productos` and the former `Costos SKU` workflow remain unified in one compact product table. Added a `Despachados` product filter and kept `Sin costo` / `Sin producto` filters for cost completion and unknown-product audits.
- Product rows are now consolidated conservatively after Shopify catalog enrichment: rows with the same SKU merge; rows with one missing SKU can merge only when product titles are compatible; rows with conflicting SKUs remain separate. This reduces duplicate rows where one source has the SKU and another source only has the product title.
- Product rates remain order-based, not unit-based: `Tasa despacho = product-orders con guia / product-orders Shopify`; `Efectividad entrega = product-orders entregados / product-orders con guia`. The UI shows numerator/denominator beside each rate so a 100% rate is auditable as, for example, `1/1` rather than an unexplained percentage.

2026-06-11:

- `npm run lint`: passed
- `npm run build`: passed
- `Liquidaciones` now has an imported-file selector below the upload form, recent/oldest sorting, delete-with-confirmation, and Shopify match filters (`Todos`, `Con match`, `Sin match`) for the active settlement file.
- `Pedidos` now separates liquidation state, source file, and amount: `Estado liquidacion` shows only the state, `Archivo liquidacion` shows the exact Excel source, `A liquidar` shows the settlement amount, and liquidation filters support corrective views like `Por reclamar` and `Duplicados`.
- `Cierre mensual` now lists the order-level data behind each month, with month selection, operational/settlement filters, status counts, and CSV export for the visible order list.
- Removed the standalone `Rentabilidad` tab. `Cierre mensual` now owns profitability KPIs, financial anomalies, missing SKU costs, and the stacked cost-composition bar for Boxful, product, ads, payroll, and miscellaneous costs.
- Simplified `Cierre mensual` UI into an executive close view: one month selector, result card, priority-review card, cost card, and collapsed detail sections.
- The first screen of `Cierre mensual` now avoids month tables and giant detail grids by default. It shows only the selected month result, `Que revisar primero`, `Costos registrados`, and expandable sections for orders, anomalies, missing SKUs, and month comparison.
- Shopify historical sync now uses store-specific lower bounds and reads persisted orders in paginated chunks for complete monthly close coverage from each store's first relevant order onward.
- `Archivos Boxful` was renamed to `Logistica Boxful` and now only registers/displays logistics files. Liquidation files stay in `Liquidaciones`.
- Added `Productos` analysis tab for product-level operational performance and cost completion. It uses the same normalized finance order rows as `Pedidos`/`Cierre mensual`, preserves line items on `OrderProfitabilityRow`, and aggregates by SKU when available or by product title otherwise.
- Product-level dispatch rule: `Tasa despacho = product-orders con guia Boxful / product-orders que ingresaron a Shopify`. Product analysis excludes orphan settlement/logistics rows that cannot be tied back to Shopify. A guide means the order left the warehouse with transport, even if it is still in progress and has not reached `Entregado` or `No entregado`. Delivery effectiveness is `Entregados / product-orders con guia Boxful`, so guided orders still in progress count in the denominator until their final outcome arrives.
- Product-level status counts classify Shopify cancelled/voided first as `Anulado`; otherwise they follow tracking as `Entregado`, `No entregado`, or `Pendiente`. The `Productos` tab includes search by product/SKU/order example, status filters, `Sin costo`, `Sin producto`, compact funnel counts, rate bars with numerator/denominator, cost edit/history actions, and CSV export.
- Product-level grouping is catalog-aware: SKU is authoritative when present, and rows without SKU can be merged into a catalog/SKU row only when the product title is compatible and there is no conflicting SKU.
- In `Productos`, `Producto sin registrar` is only a fallback when an order reaches the product analysis without readable line items, package items, or item summary. The table shows an alert with the grouped order count and includes `Pedidos ejemplo` so the user can search those order codes in `Pedidos` and audit whether the source lacked Shopify `line_items` or only arrived through Boxful/liquidacion. The grouping also parses `items_summary` before falling back to `Producto sin registrar`.
- Products without Shopify SKU can still be costed from the `Productos` tab. The UI stores those costs with an internal key derived from the product title (`producto:<slug>`). Cost lookup uses SKU first, then this title key for SKU-less items. `Producto sin registrar` remains uncostable because the real product is unknown.
- `Notas Shopify` now defaults to the actionable alias view: only rows with an extracted bot/order code are shown first. The user can switch to `Todas` to audit notes without extracted codes.
- Large Boxful logistics files can exceed the Vercel function timeout when uploaded from the UI because the serverless route must parse Excel formulas, fetch/index Shopify orders, match rows, and insert thousands of records. On 2026-06-11, `01-12-2025 hasta 11-06-2026.xlsx` was imported directly from the local Codex environment into Supabase in chunks:
  - `logistics_imports.id = 1`
  - `total_rows = 7736`
  - `matched_rows = 7407`
  - `unmatched_rows = 329`
  - `boxful_file_controls.status = importado`
  Future product work should replace this emergency path with an async/background import flow or chunked client upload.
- `Pedidos` consolidates multiple Boxful logistics rows for the same Shopify order into one visible order row. When duplicate logistics rows exist, a final column-M status (`Entregado` or `No entregado`) wins over intermediate states like `Registrado`, `Recolectado`, `En ruta a destino`, or `Problemas en gestión`; if there are multiple final rows, the newest logistics date wins. This prevents the UI from showing a Shopify order as `Pendiente` when the uploaded Boxful history already contains its final delivery outcome.
- `Gastos > Planilla` captures payroll in Peruvian soles (`PEN`) with a required exchange rate to Costa Rican colones (`CRC`). The app stores the converted CRC amount in `business_expenses.amount` so monthly profitability remains comparable; the original PEN amount and exchange rate are persisted in `business_expenses.notes` for audit display.
- `Gastos > Varios` supports expenses paid in `CRC`, `USD`, or `PEN`. If the original currency is not CRC, the modal requires an exchange rate and stores the converted CRC amount in `business_expenses.amount`; the original amount/currency and exchange rate are persisted in `business_expenses.notes`.

2026-06-10:

- `npm run lint`: passed
- `npm run build`: passed
- Added `dynamic = "force-dynamic"` to `/api/shopify/products` because that API should not fetch Shopify during static prerender.
- Added Boxful logistics import model:
  - `logistics_imports`
  - `logistics_rows`
  - `/api/finance/logistics`
  - `/admin/finance` now treats Boxful as the source for operational delivery state.
- Boxful logistics source is not the same as settlement/liquidation source.
- Current Boxful state rule:
  - Boxful column M `Entregado` -> `Entregado`
  - Boxful column M `No entregado` -> `No entregado`
  - Liquidation row `Estado = Entregado` or `No entregado` can update tracking when logistics is still pending
  - Shopify cancelled or `financial_status = voided` -> `Anulado` only if there is no Boxful/liquidation movement
  - Other Boxful states -> `Pendiente`
- Added claim alert in `Pedidos`: delivered Boxful rows missing from liquidations are counted in the top metric `Por reclamar` and listed in an `Entregados sin liquidacion` table with order, guide, customer, courier, and expected COD.
- Added settlement source trace in `Pedidos`: when a logistics row matches a settlement row by order or guide, the table shows the liquidation Excel file name, status, and amount to liquidate. If multiple settlement rows match, the UI shows the first file plus a `+N` badge.
- Added anomaly reporting in `Pedidos`: double settlements are counted in the top metric `Anomalias` and shown in a `Doble liquidacion detectada` table.
- Added cancelled-with-movement handling: if Shopify is cancelled/voided but Boxful or liquidation shows movement, tracking follows Boxful/liquidation and the financial anomaly center reports `Anulado Shopify con movimiento`.
- `Pedidos` now uses status filter buttons (`Todos`, `Pendientes`, `Anulados`, `Entregados`, `No entregados`) instead of treating Boxful/import match counts as the primary controls. Boxful row/match/unmatched counts remain as import diagnostics.
- Improved import reliability: finance upload handlers now surface non-JSON server responses with a readable message, and importers infer date ranges from Excel rows when period dates are omitted.
- `Productos` now fetches `/api/shopify/products` to enrich the product table with catalog variants. Cost lookup reads by SKU first and then by the internal `producto:<slug>` title key, so products that were costed before receiving a SKU do not appear as missing cost.
- Profitability summary now exposes settlement charged-cost breakdown:
  - COD collected
  - COD commission
  - delivery cost
  - Pick&Pack
  - settlement packaging
  - card commission as informational, outside the Boxful charged-cost total
  - net `A Liquidar`

## Session 2026-06-13 additions

### Session 2026-06-14 hotfixes

- The Boxful logistics upload route was hardened for large Honduras files. `/api/finance/logistics` now parses and inserts the Excel using persisted Shopify orders only; it no longer calls Shopify during the upload request. Shopify remains the only order source of truth, and `Sync Shopify` is responsible for refreshing the order base before imports.
- Boxful logistics rows still never become standalone pedidos. They can update status/guide/courier only when they match a Shopify order for the same `store_id`; unmatched rows stay as reconciliation records.
- Honduras courier display/sync is store-aware. `mireva-hn` uses Forza even if a Shopify fulfillment has a stale or generic carrier label such as `Moovin`, `Transportadora`, or `Other`; Costa Rica continues to use Moovin.
- Forza tracking uses the public browser endpoint `https://rastreo.forzadelivery.com/fd2/Home.aspx/API` first with `Tracking/GetNewDeliveryTracking`, then falls back to the older `Tracking/GetTrackingPublic` method and the Honduras portal endpoint. If Forza returns CAPTCHA/HTML, Kairo must report it as blocked by CAPTCHA and should not try to bypass it. Stable automation needs an official Forza API, webhook, or periodic status file.
- The orders table derives the displayed courier from the selected store before rendering actions. Honduras rows with a stale `Moovin` fulfillment label are displayed and acted on as Forza; Costa Rica remains Moovin.
- Local validation of `C:\Users\Pc\Downloads\01-12-2025 hasta 31-12-2025 (1).xlsx`: direct `xlsx.sheet_to_json` fails with `unrecognized type f`, but the app sanitization path parses it successfully. Parsed logistics rows: `847` (`Entregado = 426`, `No entregado = 413`, `Guia cancelada = 8`). This file size should not require async import after removing the Shopify network fetch from the upload path.

### Session 2026-06-15 hotfixes

- Finance API routes now sanitize external HTML errors before returning them to the UI. A Supabase/Cloudflare `522 Connection timed out` page must be shown as a short actionable message, not as raw `<!DOCTYPE html>`.
- `/admin/finance` also sanitizes malformed or HTML API responses client-side via `sanitizeExternalError`, so a future provider timeout cannot fill the error banner with a full HTML page.
- Supabase reads now retry transient read-only failures (`522`, `503`, `504`, etc.) at the shared DB client level. The finance page also staggers heavy base loads instead of firing settlements, logistics, costs, expenses, and summary all at once; settlement/logistics API reads fetch imports and rows sequentially to reduce Supabase pressure.
- `/admin/finance` now paints in phases: product costs, expenses, summary, claims/files, and recent Shopify orders load first; settlements, logistics, and the full Shopify snapshot continue in the background. This prevents the whole dashboard from being blocked by heavy historical reads.
- Performance debug for the slow `/admin/finance` load found three pressure points: the first render waited for multiple independent Supabase reads, the persisted Shopify snapshot requested oversized pages, and every paginated Shopify history request recalculated coverage. The hotfix makes each base source load independently with an 8s fast timeout, moves settlements/logistics/full Shopify history to delayed background work with a 25s timeout, and prevents background failures from freezing the UI.
- Persisted Shopify history now loads as a non-blocking enrichment: the first operational paint asks for only 250 persisted Shopify orders with `coverage=0`; background history continues in 500-row pages, one request at a time, also with `coverage=0`. Exact Supabase coverage/count queries are too expensive to gate the order-tracking UI and should move to a server-side summary/materialized endpoint before being reintroduced.
- Operational-first rule for `/admin/finance`: the `Pedidos` tab must not build the full financial control center, product analysis, or monthly close on initial load. Operational KPIs now calculate directly from normalized Shopify/logistics rows; product profitability and monthly close build only when their tabs are opened. Background Shopify history uses lower concurrency and starts after the first operational paint to reduce Supabase pressure.
- Target UX for finance performance: order tracking/logistics should become usable within ~20 seconds even if Supabase, settlements, or Shopify history are slow. Product costs, expenses, claims, settlements, notes, and monthly close are enrichment layers and should load after the operational view.
- Logistics rows are now paginated. `/api/finance/logistics` accepts `limit`, `offset`, `include_rows=0`, and `include_imports=0`; `/admin/finance` loads the first 500 rows quickly and completes the logistics history in the background. A slow historical logistics read should not show a red blocking error in the operational view.
- Carrier incident rule: if a Moovin/Forza shipment has any delivery-incidence event and no final delivered/not-delivered status, Kairo must show it as `Incidencia`. Later branch/sede/in-progress events do not reset it to `En ruta`; this prevents cases like guide `2533332` from hiding an unresolved delivery issue.
- Next architecture step: replace client-side full-history aggregation with server-side summary/pagination endpoints or materialized views for KPIs, order lists, product analysis, and monthly close. Large Excel imports and historical syncs should use an async job table/queue instead of long-running Vercel requests.

### Architecture / robustness
- **Shared order matching** in `lib/order-matching.ts` (pure, tested) consumed by
  the finance page and both import routes; no more divergent copies. Numeric
  Boxful codes only match via an explicit note alias ("Pedido <code>"), never by
  bare order number. Reshipped guides (`#MCRC10099-V2`) match their base order.
- **Shared finance types** in `lib/finance-types.ts` (no imports), used by server
  and client.
- **Vitest + GitHub Actions CI** (`.github/workflows/ci.yml`): typecheck + lint +
  tests + build on every PR and push to `main`. Tests live in `tests/`.
- **Numbered migrations** in `supabase/migrations/` with a README tracking what is
  applied. Reads paginate past PostgREST's 1000-row cap.
- Shopify history sync is **resumable** (backfill mode walks from the oldest
  synced order back to January) and rate-limit aware; reads avoid detoasting
  `raw_order` by using real `note`/`note_attributes`/`line_items` columns.

### Finance/logistics features
- **Comparativo por periodo y paqueteria**: la tarjeta `Entrega por paqueteria` y su detalle usan exactamente la misma cohorte temporal seleccionada en los KPIs (`Hoy`, `Ayer`, `7 dias`, `30 dias`, `Mes`, `Todo` o `Rango`). El filtro se aplica sobre `shopify_created_at` con limite superior exclusivo; Shopify sigue siendo la fuente unica y las filas logisticas solo enriquecen guia, transportadora y estado.
- **En ruta** tracking status: an order with a Boxful guide/courier is "En ruta"
  (dispatched, in transit), distinct from "Pendiente" (confirmed, not shipped).
  Aggregations treat en_route as pending-like via `isPendingLike`.
- **Customer first/last name** as real columns (migration 0005); the orders table
  shows the surname.
- **Payroll staff catalog** (migration 0004): register people once with their
  role; payroll entries pick from a dropdown. Payment type is a fixed select.
  Expense tabs have dynamic month/person/category filters and sortable headers.
- **Daily exchange rate** for expenses: `/api/finance/exchange-rate` (open.er-api.com,
  6h cache) auto-fills the CRC rate for USD/PEN, still editable.
- **Cierre mensual** is a full COD P&L cascade (ingresos → margen bruto → operativo
  → contribución → utilidad), with %-of-revenue, MoM deltas, unit economics, COD
  funnel, claim aging, month-maturity badges, KPI strip and automatic alerts.
- **SKU cost editing** moved into the Productos table (pencil + history); tables are
  sortable by header.

### Moovin courier tracking (lib/moovin.ts, migration 0006)
- Moovin's public tracking is a Next.js Server Action (the page bails out to CSR, so
  the data only comes from the action POST, body `[idPackage,"",""]` — the lastName
  rides in the URL only). Replicated server-side with the `next-action` header.
- The action id rotates on every Moovin redeploy, which silently broke every lookup
  ("No se pudo interpretar"). It now **self-heals**: if the known id fails to parse,
  `discoverActionIds` scrapes the current id from Moovin's JS bundle, caches the one
  that works, and retries. `MOOVIN_NEXT_ACTION` is just the seed default (optional
  `MOOVIN_COOKIE`).
- `GET /api/finance/moovin-tracking?idPackage=&lastName=` — on-demand lookup, caches
  result. `POST/GET /api/finance/moovin-sync` — batch update of en-route Moovin
  orders (rate-limited, skips guides checked within 6h) and cache read.
- Orders table "Transportadora" column shows the cached Moovin status (colored,
  incident-flagged) with a button to open the full timeline; "Actualizar Moovin"
  batch-updates all en-route Moovin orders.
- **Estado de seguimiento buckets** for in-transit orders are driven by the latest
  Moovin state via `moovinTransitPhase` (`lib/moovin-status.ts`, pure/tested):
  `despacho_solicitado` (Registrado · Por preparar · Recolección solicitada/programada),
  `recolectado` (Recolectado · Precoordinación · Sede de Moovin · En sede local),
  `en_route` (Coordinado · En ruta a lo largo del día). Applied in
  `resolveDispatchState`/`mergeDispatchIntoTracking` (`lib/dispatch.ts`); an
  uncatalogued in-transit state defaults to `en_route` and logs a warn. This
  replaced the old time-based "Standby" tracking bucket (the iComfly `is_standby`
  marker and its Despacho tab are unaffected). Terminal states (delivered/incident/
  cancelled/returned) and Pendientes are unchanged.
- **Reconciliation** (`lib/moovin-reconcile.ts`, tested): flags Moovin-vs-system
  mismatches (Moovin delivered but unrecorded, returned not reflected, unresolved
  incident, system-delivered while Moovin not confirmed) as a clickable alert +
  modal in Pedidos.

### WYN courier tracking (`lib/wyn.ts`)
- Mireva Costa Rica puede usar Moovin y WYN simultaneamente. La transportadora se
  resuelve por la guia: cualquier guia `MLCR...` pertenece a WYN, incluso si Shopify
  conserva una etiqueta antigua de Moovin. Shopify sigue siendo la unica fuente de
  pedidos; WYN solo enriquece guia, estado e historial.
- `GET /api/finance/wyn-tracking?store=mireva-cr&guide=MLCR...` consulta el endpoint
  publico `POST https://wynexpress.com/api/tracking`, normaliza el historial y guarda
  cache por `(store_id, courier_code, guide_number)` en `courier_shipments`, con
  `courier_code=wyn`. La ruta rechaza Honduras y guias que no sean WYN para impedir
  cruces entre tiendas o couriers.
- Estados: `Devuelto`/`returned` se clasifica como `No entregado`; `Entregado` como
  `Entregado`; llegada, transito, ultima milla o retiro como `En ruta`; fallos e
  incidencias permanecen visibles. La palabra "entregado" dentro de "entregado en
  direccion de retorno" nunca debe sobreescribir la devolucion.
- Las guias WYN se excluyen explicitamente del lote masivo de Moovin. En Pedidos, el
  boton de estado y el modal cambian a WYN, muestran el ultimo estado, el historial y
  un enlace al rastreo oficial.
- El historial de eventos queda dentro de `raw_payload` y la vista operativa lee el
  mismo registro comun de transportadoras. No requiere una tabla WYN separada.

### Comparativo por periodo y paqueteria

- En Mireva Costa Rica, la tarjeta superior que antes mostraba un lead time sin
  muestras ahora resume la efectividad de entrega de **WYN / MailAmericas** y
  **Moovin**. Al abrirla muestra la comparacion completa por estados Kairo.
- El reporte usa la misma cohorte Shopify elegida en los KPIs superiores: `Hoy`,
  `Ayer`, `7 dias`, `30 dias`, `Mes`, `Todo` o las fechas de `Rango`. Shopify es
  la unica fuente de pedidos: las filas logisticas solo agregan guia, paqueteria y
  estado. Una fila WYN/Boxful sin pedido Shopify asociado no aumenta ningun conteo.
- Cada pedido se deduplica por codigo Shopify. `Despachados` significa pedidos de
  la cohorte con guia identificada para esa paqueteria. `Efectividad` se calcula
  como `Entregados / Despachados`, no como entregados entre casos finalizados.
- Los estados se muestran normalizados al flujo Kairo: Pendiente, Despacho
  solicitado, Recolectado, En ruta, Reintento, incidencias solucionables/no
  solucionables, Anulado, Entregado y No entregado.
- Una guia con transportadora desconocida queda en el contador de auditoria
  `Guias sin paqueteria identificada`; nunca se asigna por aproximacion.
- El calculo se incorpora a `GET /api/finance/kpis` y reutiliza el dataset operativo
  ya cargado. No crea una lectura historica adicional de Supabase.

### iComfly Estado de Despacho (lib/icomfly.ts, lib/dispatch.ts, migration 0010)
Supervisa el despacho de pedidos COD en dos momentos atribuibles a personas:
1. la **asesora** confirma el pedido y luego **solicita el despacho / genera la
   guía de transporte** en iComfly; 2. el **almacén** (ShipHero/Boxful) genera la
   **guía final** en su horario (corte 15:00 CR). Entre ambos hay un limbo que se
   vigila como **standby**.

- **Fuente:** `lib/icomfly.ts` consume la API de iComfly (read-only). Auth por
  `ICOMFLY_TOKEN` o login `ICOMFLY_EMAIL`/`ICOMFLY_PASSWORD` (POST /auth/login).
  `GET /orders?withAttribution=1` (atribución `confirmo`/`genero_guia`/`envio` con
  nombre+correo) y `GET /metrics/agents`. Normalización tolerante de campos.
- **Lógica pura** en `lib/dispatch.ts` (testeada, `tests/dispatch.test.ts`):
  sub-estado `pendiente → despacho_solicitado → despachado`; guía final detectada
  por iComfly (status/tracking/shipped) **y** Boxful (`logistics_rows.guide_number`);
  standby a las **15:00 CR**; match con la planilla (`payroll_staff`) por
  `icomfly_user_id` → correo → nombre normalizado.
  - **Pendiente de confirmar con iComfly:** si `genero_guia` o `envio` es la
    "solicitud de despacho" → constante `DISPATCH_REQUEST_FIELD` (configurable).
- **Almacén no atribuible por persona** (ShipHero no se extrae): la guía final se
  mide "hecha + cuándo", sin nombre. Productividad por persona = solo asesoras.
- **Migración 0010:** tablas `icomfly_orders` e `icomfly_agents`; enriquece
  `payroll_staff` con `email` + `icomfly_user_id` (el sync los auto-completa por
  match de nombre). Diseño multi-tienda/courier/usuario (cada fila lleva
  `store_id`, `carrier_name`, `*_user_id`).
- **Sync** (`lib/icomfly-sync.ts`): `POST /api/icomfly/sync` (manual, dashboard) y
  `GET/POST /api/cron/icomfly` (cron cada 30 min, público como los demás crons).
  `GET /api/icomfly/sync` lee lo persistido + resumen.
- **UI:** tab **“Despacho”** en `/admin/finance` (`components/DispatchTab.tsx`):
  resumen por estado, **alertas de standby**, **tablero diario** (hora CR),
  **productividad por persona de la planilla** y lista de pedidos con estado +
  atribución (Confirmó/Solicitó). Marca personas con actividad **no registradas
  en la planilla**.

### Leads de WhatsApp: gráfico diario de pendientes

- `/admin/leads` muestra los leads sin gestión manual agrupados por
  `first_seen_at` en UTC-6 (con `created_at` como respaldo): una barra **+14
  días** acumula los históricos y las 14 barras siguientes detallan cada día.
- El gráfico se recalcula sobre la búsqueda global, etapa o Agenda activa. Una
  barra filtra la lista a los leads sin llamar de esa fecha o del acumulado
  histórico; el filtro convive con las etapas y puede retirarse desde la barra
  o desde **Quitar filtro**. El total suma todos esos buckets y, si hay leads ya
  gestionados dentro de la etapa, muestra el denominador por separado.
- El buscador incorpora a su derecha un rango inclusivo **Desde / Hasta** sobre
  `last_interaction_at` en UTC-6, exactamente la fecha mostrada encima de
  **Ver chat**. El rango actualiza lista, etapas, Agenda y gráfico.
- “Sin llamar” se deriva de `status_source = 'auto'`; no se hace una consulta
  extra a `lead_calls`, Supabase o Icomfly para pintar el gráfico.

## Telefonía Zadarma (llamadas desde la laptop de la asesora)

### Decisión: Zadarma directo, no Teamsale

Teamsale es el CRM propio de Zadarma. Su API (`/v1/zcrm/...`: clientes, leads,
acuerdos, tareas) sirve para leer/escribir datos **dentro de Teamsale**, no para
marcar un teléfono. Adoptarlo significaría un segundo CRM en paralelo a Kairo,
con los leads y pedidos duplicados y las asesoras trabajando en dos pantallas.

Kairo ya es el CRM: tiene el lead, la conversación, el historial y el pedido.
Lo único que falta es el teléfono, y eso lo da la **centralita de Zadarma**
directamente (API `/v1/...` + widget WebRTC). Teamsale solo tendría sentido si
en algún momento se decide que el equipo viva dentro de Teamsale, y entonces la
integración sería la inversa: Teamsale como fuente y Kairo consumiendo
`/v1/zcrm/customers`.

### Cómo llama la asesora

1. Cada asesora tiene una extensión de la centralita (`499499-100`, `-101`, …)
   guardada en `payroll_staff.zadarma_sip`.
2. Al abrir `/admin/leads`, `ZadarmaWebphone` pide a
   `/api/zadarma/webphone` la llave temporal del widget WebRTC
   (`/v1/webrtc/get_key/`, vive 72 h, se cachea 12 h en memoria del proceso) y
   monta el widget: **el navegador queda registrado como su teléfono**.
3. `CallButton` (encabezado del drawer del lead) llama a `/api/zadarma/call`,
   que ejecuta `/v1/request/callback/` con `from` = su extensión y `to` = el
   teléfono del lead. Zadarma timbra la extensión (suena el navegador, la
   asesora contesta con su diadema) y enseguida marca al cliente.
4. La centralita reporta el ciclo de vida a `/api/zadarma/webhook`, que escribe
   el CDR en `zadarma_calls`.

El teléfono del cliente **no se toma del cuerpo del request** cuando hay
`lead_id`: se lee del lead en Supabase, para que el navegador no pueda pedir
llamadas a números arbitrarios contra el saldo de la cuenta.

### Dos formatos de extensión (no son intercambiables)

Zadarma no usa el mismo formato en todos sus métodos y el castigo por
equivocarse no siempre es un error:

| Dónde | Formato | Si te equivocas |
| --- | --- | --- |
| Widget WebRTC y `/v1/webrtc/get_key/` | login completo (`499499-100`) | el widget no carga |
| `sip` de `/v1/request/callback/` | extensión corta (`100`) | `Field "sip" could be only SIP or PBX number` |
| `from` de `/v1/request/callback/` | extensión corta (`100`) | **responde `success` y no timbra nada** |

El caso de `from` es el peligroso: la petición se acepta, la asesora ve el
mensaje de confirmación y no suena ningún teléfono. Se guarda el login
completo (es lo que muestra el área personal) y `toShortExtension` convierte
en el único lugar que lo necesita.

### El widget va por encima de los drawers

El script de Zadarma inyecta el widget en `<body>` con su propio `z-index` y
no expone forma de configurarlo, así que los drawers de Kairo (`z-50`) lo
tapaban: para contestar había que cerrar el pedido y se perdía lo que se
estaba leyendo. `ZadarmaWebphone` observa lo que el script agrega al montar y
le fija un `z-index` por encima de todo lo nuestro. Se observa por markup
añadido y no por clases/ids de Zadarma a propósito: esas cambian con cada
versión del widget y el fallo volvería sin que nadie lo note.

La esquina donde aparece sale del área personal (`GET /v1/webrtc/`), así que
si tapa algo importante se mueve desde Zadarma, sin deploy.

### "No me timbra": cómo se diagnostica

El catálogo de personal muestra un punto de estado por asesora: verde = hay un
teléfono **registrado** en su extensión. Es la distinción que más cuesta ver,
porque el widget puede estar abierto y verse perfecto sin haber registrado la
extensión — y en ese caso la centralita responde `failed` sin explicar nada.

Sale de `/v1/pbx/internal/<SIP>/status/`. Si el punto está rojo con el widget
abierto, la extensión no se registró: revisar permiso de micrófono del
navegador y la contraseña / restricción por IP de esa extensión en Zadarma.

En `zadarma_calls` las dos patas de la llamada se distinguen así: si `phone`
son tres dígitos, es la centralita **timbrando a la extensión**; si es un
número largo, es la extensión **marcando al cliente**. Que la segunda funcione
y la primera no significa exactamente esto: el teléfono puede llamar, pero
nadie puede llamarlo.

### Dónde se puede llamar

El botón vive en dos pantallas, y cada una **necesita también el widget
montado** (`ZadarmaWebphone`): sin él la centralita timbra una extensión que
ningún navegador tiene registrada.

- `/admin/leads` → drawer del lead: llama con `lead_id`.
- `/admin/finance` → drawer de Gestión de pedidos: llama con `order_name`.

En ambos casos el teléfono se lee de la base (del lead o de `shopify_orders`),
nunca de lo que manda el navegador. El resultado de la llamada lo sigue
registrando la asesora a mano con los botones que ya existían
(Contestó / No contesta / Buzón…): la centralita reporta `answered` también
cuando contesta un buzón, así que no se pre-selecciona nada.

### Asignar extensiones

`/api/zadarma/extensions` lee las extensiones reales de la centralita con
`/v1/pbx/internal/` (devuelve `pbx_id` + números cortos; el login del widget es
la unión: `499499` + `100` → `499499-100`) y marca cuál ya tiene dueño. El
catálogo de personal en `/admin/finance` muestra un selector por persona, así
que asignar una extensión no requiere SQL. Un índice único parcial impide que
dos personas compartan extensión: dos navegadores registrados en la misma línea
se roban las llamadas entre sí.

Si la telefonía no está configurada, la lista llega vacía y el selector no
aparece: el catálogo sigue sirviendo para la planilla igual que antes.

### Seguridad del widget

Zadarma advierte explícitamente que el widget **no debe quedar en una página
pública**: quien la abra puede llamar a cuenta tuya. En Kairo vive solo en
`/admin/leads`, detrás del login del middleware. Mientras el acceso sea una
contraseña de admin compartida, quien la tenga tiene teléfono — otra razón para
mover esto a Supabase Auth.

### Identidad de la asesora

Kairo todavía entra con una sola contraseña de admin, así que "quién soy" sigue
siendo el selector de asesora (`payroll_staff`) que ya usaban el composer, la
barra de gestión y crear pedido. Esa clave vivía duplicada en tres componentes
y ahora está en `lib/vendedora.ts`, que además emite un evento: el teléfono web
necesita enterarse en el acto de que cambió la asesora para registrarse con SU
extensión. Cuando llegue Supabase Auth, esto se reemplaza por el usuario real.

Cambiar de asesora con el widget ya montado exige recargar la página (el widget
de Zadarma no se reinicializa dos veces sin dejar dos teléfonos peleando por la
línea); el aviso lo dice explícitamente.

### Archivos

- `lib/zadarma.ts`: cliente firmado (`Authorization: key:base64(hex(hmac_sha1(
  metodo + params + md5(params))))`), extensiones, widget key, callback, enlace
  de grabación, verificación de firma de webhooks.
- `lib/zadarma-calls.ts`: extensión por asesora, CDR y cruce teléfono → lead.
- `lib/vendedora.ts`: asesora activa en el navegador.
- `components/ZadarmaWebphone.tsx`, `components/CallButton.tsx`.
- `app/api/zadarma/{webphone,call,extensions,webhook}/route.ts`.
- `PATCH /api/finance/payroll-staff`: asigna/libera la extensión.
- `supabase/migrations/0029_zadarma_calls.sql`.

Los scripts del widget (`webphoneWebRTCWidget/v9/...?sub_v=1`) y la firma de
`zadarmaWidgetFn` salen del código que Zadarma publica en el área personal
(`my.zadarma.com/marketplace/#tab-webRtc` → "Código del widget"); si suben la
versión, se cambia en `ZadarmaWebphone.tsx`. Ojo con el sexto argumento: ahí se
pasa un **objeto** `{right:'10px',bottom:'5px'}`, no una cadena.

La forma y la esquina no se fijan en el código: se leen de `GET /v1/webrtc/`,
que devuelve los ajustes del área personal. Cambiar la apariencia es un click
en Zadarma, no un deploy.

### Diagnóstico

`/admin/settings` muestra una tarjeta de telefonía que responde "por qué no
timbra" sin entrar a Zadarma: saldo (sin saldo la centralita responde
`disposition: "no money"` y la asesora solo ve que no entra la llamada),
dominio autorizado para el widget, URL y eventos de notificación, huso horario
frente a `ZADARMA_TIMEZONE_OFFSET`, y cuántas extensiones están asignadas.

El botón **Configurar notificaciones** apunta la centralita a
`/api/zadarma/webhook` y enciende los seis eventos del ciclo de vida vía
`POST /v1/pbx/callinfo/url/` y `/v1/pbx/callinfo/notifications/`, en vez de
hacerlo a mano en el panel. Zadarma valida la URL con `zd_echo`, así que solo
funciona contra un deploy ya publicado.

### Límites de la API

100 solicitudes por minuto en general y 3 por minuto en los métodos de
estadística. Por eso la llave del widget se cachea 12 h en memoria del proceso
y el CDR se arma con los webhooks en vez de sondear `/v1/statistics/pbx/`.

### Reglas

- `zadarma_calls` es el CDR técnico (quién marcó, a quién, duración,
  grabación). **No reemplaza a `lead_calls`**, que sigue siendo la gestión
  comercial que registra la asesora ("no contestó", "casi cierra"). El timeline
  del drawer (`getLeadHistory`) mezcla ambos: las llamadas aparecen con
  `kind: "phone"` y las gestiones con su `kind` de siempre. Si la migración
  0028 no está aplicada, el timeline sigue mostrando solo las gestiones.
- El webhook se autentica con la firma HMAC del propio evento, no con la cookie
  de sesión, por eso está en `PUBLIC_PATHS` del middleware. La IP de origen
  (185.45.152.40/30) se registra como señal, pero no es la única defensa porque
  depende de la cadena de proxies.
- El webhook responde 200 aunque falle la escritura: reintentar no arregla un
  error de base y Zadarma deja de mandar el resto del ciclo si recibe un error.
- Los eventos llegan en varias partes y pueden desordenarse; el upsert solo
  escribe los campos presentes para que un evento tardío no borre lo ya sabido.
- Sin `ZADARMA_API_KEY`/`ZADARMA_API_SECRET`, o sin extensión asignada, el
  tablero funciona igual: solo desaparece el teléfono.

### Pendiente

- Reproducir la grabación desde el timeline (`zadarma_calls.record_url` ya se
  guarda; falta el reproductor y decidir quién puede oírla).
- Marcar llamadas perdidas entrantes como leads que requieren atención.
- Productividad por asesora con datos de la centralita (hoy solo cuenta
  gestiones manuales).

### Pending Supabase migrations (run in SQL Editor, idempotent)
At the time of writing these were not yet confirmed applied in production — check
`supabase/migrations/README.md` for current state:
- `0003_shopify_orders_note_columns.sql` — fixes the statement-timeout on page load.
- `0005_customer_name_parts.sql` — first/last name columns (Moovin tracking needs
  `last_name`).
- `0006_moovin_tracking.sql` — Moovin status cache. Until applied, Moovin works
  on-demand but nothing is cached and reconciliation stays empty.
- `0010_icomfly_dispatch.sql` — Estado de Despacho (icomfly_orders / icomfly_agents
  + columnas en payroll_staff). Hasta aplicarla, el tab “Despacho” queda vacío.
- `0029_zadarma_calls.sql` — Telefonía Zadarma (`payroll_staff.zadarma_sip` +
  `zadarma_calls`). Hasta aplicarla, el botón “Llamar” y el teléfono web quedan
  deshabilitados; el resto del tablero de leads no se ve afectado.

## Open Questions

- Should product cost be counted only when an order is delivered?
- How should inventory loss be handled for not-delivered orders?
- Are numeric-only settlement orders from another store/source?
- Should weekly settlements map to a calendar week, a custom date range, or both?

## Incident 2026-07-18: 504 on finance orders

### Symptom

- Vercel reported a high-severity increase in 504 responses for
  `/api/finance/orders` while Supabase was timing out.
- The Orders screen could remain loading, show a partial history, or temporarily
  drop to zero rows.

### Root cause

- The first Orders render made three concurrent requests for the same assembled
  historical dataset: table rows, operational counts, and courier guides.
- A failed read of `finance_dataset_cache` was indistinguishable from a confirmed
  cache miss. Every request therefore attempted to rebuild the complete history.
- Single-flight protected one warm Vercel process only; parallel cold instances
  could still rebuild the same store at the same time.

### Fix and invariants

- The first Orders request now returns the first table page, operational counts,
  settlement counts, and courier guides together with `metadata=1`.
- KPI loading waits for the operational dataset instead of starting another
  reconstruction at the same time.
- Only a confirmed L2 cache miss may trigger a cold build.
- A Supabase/L2 read failure serves the last L1 value when available. Without a
  stale value it returns HTTP 503 with `Retry-After`, never a full rebuild.
- L2 reads, writes, and cold builds have explicit time limits and a short failure
  backoff. The browser preserves the last valid table after transient failures.

### Runbook

1. Check Vercel errors for `/api/finance/orders` and Supabase project health.
2. Confirm `finance_dataset_cache` is readable for the affected `store_id`.
3. Do not purge the cache while Supabase is degraded; stale operational data is
   safer than forcing concurrent historical rebuilds.
4. After recovery, use Refresh once and verify that the initial Orders request
   includes `metadata=1` and returns HTTP 200.

## Incident 2026-07-21: finance orders 503 / "0 pedidos" (table bloat)

### Symptom

- `/admin/finance` showed **0 pedidos**, all operational KPIs at `0/0`, and the
  banner **"Datos operativos temporalmente no disponibles. Reintenta en unos
  segundos."** — even though Supabase reported Healthy and the metadata line still
  recognised ~15,558 Shopify orders. The data existed; reading it failed.

### Root cause

- **Severe table bloat / stale planner stats** on the finance tables. They are
  rewritten wholesale very often, and autovacuum was not keeping up (Postgres logs
  showed `autovacuum worker took too long to start; canceled`):
  - `finance_dataset_cache`: 62 MB for 18 live rows (hourly cron × 8 sections × 2
    stores, each a multi-MB payload → dead versions piled up).
  - `moovin_tracking`: 19 MB for ~10k rows; `logistics_rows`: 63 MB;
    `settlement_rows`: 19 MB. Several reported `n_live_tup = 0` (never analysed),
    so the planner seq-scanned inflated heaps.
- Effect: the L2 cache read (`SELECT payload …`) and the source-table scans took
  **10–46 s**, exceeding the 20 s L2 read timeout and the 45 s cold-build timeout.
- A **database restart** (`the database system is starting up` /
  `terminating connection due to administrator command` in the logs) left caches
  cold; the first reads hit disk over the bloated heaps and every finance read
  fell to HTTP 503.
- Secondary bug: the L2 write fallback `writeL2LegacyFull` upserted with
  `onConflict: "store_id"`, but the post-0021 PK is `(store_id, section)`. Postgres
  rejected it (`there is no unique or exclusion constraint matching the ON CONFLICT
  specification`), so when the per-section write timed out under load, the fallback
  also failed and nothing was persisted.

### Fix and invariants

- **Reclaimed the bloat (production, one-off):** `VACUUM (FULL, ANALYZE)` on
  `finance_dataset_cache`, `moovin_tracking`, `logistics_rows`, `settlement_rows`,
  plus `ANALYZE` on `shopify_orders` / `icomfly_orders` / `forza_tracking`. Reads
  dropped from 10–18 s to ~80 ms; the `logistics_rows` store scan from 14–46 s to
  ~33 ms.
- **Prevented recurrence:** migration `0023_finance_autovacuum_tuning.sql` lowers
  the autovacuum/analyze thresholds on those churny tables so vacuum runs long
  before 20% of the table is dead (the default is far too late for tables rewritten
  in full).
- **Write path repaired:** `writeL2LegacyFull` now conflicts on
  `(store_id, section)`, so the degraded-mode write actually persists.
- **UI never shows a false zero:** the Orders table keeps the last valid result on
  a transient failure and shows an inline **Reintentar** button. If a store has
  never loaded successfully it renders an explicit error state instead of an empty
  "0 pedidos" table, and switching stores clears the previous store's rows so a
  failure never leaks another store's data.

### Runbook

1. If finance reads are slow or 503, check table bloat first:
   `SELECT relname, n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid))
    FROM pg_stat_user_tables WHERE relname IN
    ('finance_dataset_cache','moovin_tracking','logistics_rows','settlement_rows','shopify_orders');`
2. If a table is far larger than its live-row count implies (or `last_analyze` is
   null), run `VACUUM (FULL, ANALYZE) <table>;` (small tables, seconds; brief lock).
3. Confirm migration `0023` is applied (`SELECT reloptions FROM pg_class WHERE
   relname='finance_dataset_cache';` should list the autovacuum overrides).
4. Reload `/admin/finance`; the initial Orders request should return HTTP 200 in
   well under 20 s.

## Escalabilidad de /api/finance/orders (rediseño por fases)

### Problema

El endpoint hoy baja TODO el dataset de la tienda (blob JSONB en
`finance_dataset_cache`), lo descomprime en memoria y **filtra, cuenta y pagina
en JavaScript** sobre las ~15k filas. El estado de seguimiento y el de
liquidación son campos DERIVADOS (`getEffectiveTrackingStatus` +
`mergeDispatchIntoTracking` + trazas), por eso hoy se calculan en memoria sobre
el dataset completo. Es O(todo) por request: a 100k pedidos el parse pasa de
>10MB, la RAM y los cold builds se disparan y el módulo vuelve a caer.

### Solución: índice materializado + SQL (O(página))

Materializar por pedido los campos derivados como FILAS reales indexables y mover
filtro/paginación/conteos a SQL:

- **`finance_order_index`** (migración 0024): una fila por pedido con
  `tracking_filter`, `effective_status`, `settlement_count`, `is_delivered`,
  `order_date`, `shopify_created_at`, `cod_amount`, `guide_number`, `courier`,
  `search_lower` / `search_compact` (búsqueda GIN trigram) y `detail` JSONB (el
  `RowWithTraces` que pinta la tabla). PK e índices liderados por `store_id`
  (aislamiento por tienda). Autovacuum agresivo (misma rotación que 0023).
- **Derivación con paridad exacta**: `lib/finance-order-index.ts`
  (`buildOrderIndexRecords`) replica byte a byte `resolveRows` del endpoint y
  `matchesOrderSearch`. Cubierto por `tests/finance-order-index.test.ts`.
- **Búsqueda en servidor sin cambiar semántica**: `search_lower` (campos en
  minúscula unidos por `\n`) reproduce `text.includes(rawQuery)` y
  `search_compact` (campos `normalizeSearchText` unidos por `\n`) reproduce
  `compactText.includes(compactQuery)`; como ni `rawQuery` ni `compactQuery`
  contienen `\n`, un `LIKE '%q%'` no cruza el separador → equivale al match por
  campo.

### Fases

- **Fase 1 (hecha, aditiva):** tabla + el cron `finance-index` la puebla
  `refreshFinanceDatasetCache(store, { writeOrderIndex: true })`, 1/hora/tienda.
  Las mutaciones NO la escriben (no cargan 15k filas por cambio) y **nada la lee
  todavía** — riesgo cero. Sirve para validar paridad contra la implementación en
  memoria.
- **Fase 2 (pendiente):** reescribir `/api/finance/orders` para leer de la tabla
  (WHERE store_id + filtros, `LIMIT/OFFSET` o keyset, conteos con
  `COUNT(*) FILTER (...)`), detrás de un flag, verificando que los números salen
  idénticos a la UI actual.
- **Fase 3 (pendiente):** activar el flag, borrar el camino en memoria y la
  sección `rows` del blob. Operativo (índice) y financiero (`/summary`,
  `product-costs`, `expenses`) quedan totalmente desacoplados.

## WYN tracking sync (Costa Rica)

- WYN is isolated to store `mireva-cr` (`store_id=1`) and guides beginning with
  `MLCR`. Honduras and future stores are never included in this job.
- `GET/POST /api/cron/wyn` reviews at most 12 uncached or stale guides per run,
  sequentially and with a three-second pause between requests. Vercel schedules
  it every 30 minutes; `CRON_SECRET` protects the endpoint when configured. This
  pacing is intentional because WYN starts responding with HTTP 429 after bursts
  of roughly 15 tracking requests.
- Results are persisted in the shared `courier_shipments` registry by
  `(store_id, courier_code, guide_number)`, always with `courier_code=wyn`. This
  keeps WYN isolated from Moovin and from every other store without an extra table.
- Terminal results are not requested again: `delivered`, `returned`,
  `not_delivered`, and `cancelled`. Non-terminal results are eligible again after
  three hours.
- The provider result is authoritative. Only `delivered` becomes Kairo
  `Entregado`. `Devuelto` and phrases such as `Entregado en direccion de retorno`
  become `No entregado` and must never inflate delivery effectiveness.
- If WYN returns an access-control or rate-limit response, the job stops
  immediately and reports `blocked=true`; every successful result from that run
  is still persisted, and no order status is guessed or changed.
- The courier KPI/report uses the active UI period selector (`Hoy`, `Ayer`,
  `7 dias`, `30 dias`, `Mes`, `Todo`, or `Rango`). The recurring sync only keeps
  the underlying operational state current and does not impose a monthly period.
- Audit 2026-07-18: 165 unique WYN guides were found in Costa Rica Shopify orders.
  The first production sweep confirmed one effective delivery, two shipments in
  route, eleven pending and one unclassified result before WYN rate-limited the
  original burst configuration.
- Paced production validation 2026-07-18: a second run checked 12 guides without
  failures or provider blocking. The persistent WYN cache then contained 27 guides:
  seven `delivered`, one `returned`, five `en_route`, eleven `pending`, and three
  `unknown`. Guide `MLCR000131292SD` is the returned shipment and therefore remains
  `No entregado`; it is not included in the seven effective deliveries.
