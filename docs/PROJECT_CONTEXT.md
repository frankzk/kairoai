# Kairo AI Webapp Context

Last updated: 2026-06-11

## Purpose

Kairo AI is an internal operations webapp for COD e-commerce in LATAM, currently focused on Costa Rica orders. It combines Shopify order data, voice-agent call outcomes, logistics settlement files, and business expenses so the team can understand:

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

Navigation:

- Dashboard now links to `/admin/finance` with the label `Gestion`.

Tabs:

- `Pedidos`: shows Shopify orders as the baseline tracking list, filters by operational tracking state and liquidation state, includes a search box for order codes, guide numbers, and customers, opens Boxful logistics Excel upload from the table header action button/modal, inspects matched rows, and tracks operational follow-up state.
- `Liquidaciones`: upload settlement/liquidation Excel files by cutoff date, select previously imported files, sort them by recent/oldest, delete imports when needed, inspect financial settlement rows, filter Shopify match state, source Excel traceability, claim alerts, and anomalies.
- `Costos SKU`: loads Shopify products/variants and manages product costs by SKU with explicit edit/save rows, saved/missing cost tabs, and versioned effective dates.
- `Gastos`: manual CRUD for ads, payroll, and miscellaneous expenses, organized into three internal tabs with contextual modal buttons.
- `Rentabilidad`: shows the approved net-profit formula, cash/control KPIs, a financial anomaly center, order-level margin, and missing SKU costs.
- `Cierre mensual`: aggregates orders, operational statuses, settlement statuses, cash, product costs, ads, payroll, miscellaneous expenses, estimated net profit by month, and lists the underlying orders for each month.
- `Archivos Boxful`: tracks imported/expected/missing/ignored Boxful logistics and liquidation files by exact file name.

APIs:

- `GET/POST/DELETE /api/finance/logistics`
- `GET/POST/DELETE /api/finance/product-costs`
- `GET/POST/PATCH/DELETE /api/finance/expenses`
- `GET/POST/DELETE /api/finance/settlements`
- `GET/POST /api/finance/shopify-sync`
- `GET/POST /api/finance/claims`
- `GET/POST /api/finance/boxful-files`
- `GET /api/finance/summary`

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
- Settlement rows can be filtered by Shopify match status: `Todos`, `Con match`, and `Sin match`. `Sin match` means the Boxful liquidation row did not match a Shopify order by order name, `#MCRC`/numeric variants, guide/order identifiers, or iConflate/chatbot note code.
- If the user does not enter `period_start`, the importer infers the earliest `Creado en` date from the Excel and uses that to limit Shopify order fetching. This prevents long Vercel imports and avoids opaque non-JSON server errors.
- Shopify matching accepts exact order names, `#MCRC` order names, and numeric order numbers when reconciling imported files.
- Shopify matching also accepts iConflate/chatbot order codes stored in Shopify order notes, for example `Pedido #3685 - Venta por bot - WhatsApp ...`. Importers fetch `note` and `note_attributes`, extract `Pedido #NNN`, and use it as an alternate match key before falling back to Shopify numeric `order_number`.
- `/admin/finance` requests one bounded live Shopify page with `status=any` from `2025-09-16T00:00:00-06:00` so the Pedidos tab can show recent store orders even before a Boxful logistics file is imported. It also reads up to 20,000 persisted Shopify orders from Supabase. It must not use `all=1` during normal page load because Shopify pagination can exceed Vercel serverless timeouts. Boxful rows replace/enrich matching Shopify rows instead of creating duplicates.
- The `Pedidos` tab keeps the Shopify/Boxful table as the main surface. The Boxful logistics importer is an action button on the right side of the table header and opens a modal; it should not return to a persistent side-panel form.
- The `Pedidos` tab search filters the visible table client-side by order code (`#MCRC...`, `MCRC...`, iConflate note code, or numeric partials), guide number, customer name, SKU, and item title. The search should remain above the table because it is the primary lookup workflow during reconciliation.
- The `Pedidos` tab main controls are tracking-state filters: `Todos`, `Pendientes`, `Anulados`, `Entregados`, and `No entregados`. Technical import counts such as Boxful rows, Shopify matches, and unmatched rows are diagnostic context only, not primary KPIs.
- The `Pedidos` tab also has liquidation filters: `Todos`, `Liquidados`, `Sin liquidacion`, `Por reclamar`, and `Duplicados`. These filters are used for corrective work, especially `Entregados` + `Por reclamar`.
- In the `Pedidos` table, `Estado liquidacion` must stay as a simple financial state: `Liquidada`, `Sin liquidacion`, or `Doble liquidacion`. The source Excel belongs in a separate `Archivo liquidacion` column so the team can audit which Boxful file paid or charged that order. The settlement amount belongs in a separate `A liquidar` column.
- Existing imported Excel rows are not automatically rematched after a matching-rule code change. To apply the new iConflate-note match rule to an already imported liquidation/logistics file, delete that import and upload the Excel again, unless a future rematch tool is added.

Database schema:

- New migration file: `supabase/finance_schema.sql`
- This SQL must be executed in Supabase SQL Editor before production finance APIs can persist data.
- If tables are missing, `/admin/finance` shows a message instructing the user to run `supabase/finance_schema.sql`.
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
- The `Rentabilidad` tab now builds an operational finance control center in the client from Shopify orders, Boxful logistics rows, settlement rows, product costs, and import filenames. It does not require an extra DB table yet.
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
- Stripe / non-COD settlement rule: if a matched liquidation row has `Monto COD = 0`, a negative `A Liquidar` is expected because Boxful is only charging logistics/fulfillment services. That negative logistics balance affects profitability, but it is not a `Margen negativo` anomaly by itself.
- Financial anomalies can be moved through a claim workflow: `pendiente`, `reclamado`, `resuelto`, `descartado`, with notes. The key is `finance_claims.anomaly_key`.
- Exportables are client-side CSV downloads for anomalies, order profitability, monthly close, and Boxful file control.
- The monthly close tab must not be only a summary. It should let the user select `Todos` or a month, see counts for `Pendientes`, `Entregados`, `No entregados`, `Anulados`, liquidated/unliquidated orders, claim candidates, duplicate settlement rows, and inspect/export the order list behind that month.
- Shopify historical sync must be done via `/api/finance/shopify-sync` in bounded batches. The normal `/admin/finance` page load must not paginate all Shopify orders because Vercel can time out. The UI sync button loops through bounded batches from `2025-09-16T00:00:00-06:00` and persists into `shopify_orders`.
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
- Some settlement rows use numeric-only order values such as `3937` or `3685`. These often come from iConflate/chatbot and should match against Shopify order notes like `Pedido #3685`, not only against Shopify `#MCRC...`.
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

- Identify whether numeric-only rows come from another Shopify store, a previous order naming format, or an external order source.
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
4. Rentabilidad

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
- The operational table uses internal views: `Sin costo` for Shopify variants still missing unit cost, and `Con costo` for validated SKUs. The historical audit remains below as `Historial de cambios de costos`.

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

### 4. Rentabilidad

Purpose:

- answer urgently: how much money did the business actually make?
- identify per-order profitability, cash pending from COD settlements, and operational anomalies that require action.

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

Implemented order-control KPIs:

- `Caja liquidada`: sum of settled `A Liquidar` rows currently visible in control.
- `Caja por reclamar`: expected COD for delivered orders without settlement.
- `Margen pedido`: sum of order-level contribution margin before ads/payroll/misc.
- `Alertas criticas`: high-severity finance anomalies.

Important limitation:

- Ads, payroll, and miscellaneous expenses are still allocated only at aggregate/month level. Per-order profitability is contribution margin before those shared expenses.
- Shopify historical order sync is bounded and persisted through `/api/finance/shopify-sync`. Page load reads persisted orders from Supabase and only fetches one live Shopify page for freshness, avoiding browser-triggered full pagination.

## MVP Recommendation

Build in this order:

1. Settlement importer and reconciliation table.
2. Orders view with delivered/not delivered/annulled/pending/unmatched statuses.
3. Product costs CRUD.
4. Expenses CRUD with Ads, Planilla, and Varios tabs.
5. Profitability summary using imported settlements plus manual costs/expenses.

## Operational Notes

- Do not commit `.env.local` or secrets.
- `.vercel` is local metadata and should remain ignored.
- Vercel production deploys from `main`.
- Finance persistence requires running `supabase/finance_schema.sql` in Supabase before use.
- After changing protected routes, verify:
  - `/login` returns 200
  - `/` redirects to `/login` when unauthenticated
  - Shopify and Retell webhooks remain accessible

## Validation Log

2026-06-11:

- `npm run lint`: passed
- `npm run build`: passed
- `Liquidaciones` now has an imported-file selector below the upload form, recent/oldest sorting, delete-with-confirmation, and Shopify match filters (`Todos`, `Con match`, `Sin match`) for the active settlement file.
- `Pedidos` now separates liquidation state, source file, and amount: `Estado liquidacion` shows only the state, `Archivo liquidacion` shows the exact Excel source, `A liquidar` shows the settlement amount, and liquidation filters support corrective views like `Por reclamar` and `Duplicados`.
- `Cierre mensual` now lists the order-level data behind each month, with month selection, operational/settlement filters, status counts, and CSV export for the visible order list.
- Shopify historical sync now uses a 2025-09-16 lower bound, reads up to 20,000 persisted orders, and syncs in larger bounded batches for complete monthly close coverage.

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
- `Costos SKU` now fetches `/api/shopify/products` and displays Shopify variants with SKU, Shopify price, explicit row editing, `Sin costo` / `Con costo` internal views, `Empaque propio`, effective dates, and saved/missing cost state.
- Profitability summary now exposes settlement charged-cost breakdown:
  - COD collected
  - COD commission
  - delivery cost
  - Pick&Pack
  - settlement packaging
  - card commission as informational, outside the Boxful charged-cost total
  - net `A Liquidar`

## Open Questions

- Should product cost be counted only when an order is delivered?
- How should inventory loss be handled for not-delivered orders?
- Are numeric-only settlement orders from another store/source?
- Should weekly settlements map to a calendar week, a custom date range, or both?
