# Kairo AI

Internal operations webapp for COD e-commerce, voice-agent follow-up, Shopify reconciliation, logistics settlement tracking, and profitability.

## Developer Onboarding

Start here:

- [Project context and product notes](docs/PROJECT_CONTEXT.md)

Keep `docs/PROJECT_CONTEXT.md` updated whenever the app behavior, data model, integrations, or business rules change.

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```

## Production

Production deploys on Vercel from the `main` branch.

Do not commit local secrets. Environment files are ignored by Git.

## Database

Run the base schema first, then run the finance schema when enabling the order management/profitability area. The finance schema includes product costs, expenses, settlement imports, and Boxful logistics imports.

- `supabase/schema.sql`
- `supabase/finance_schema.sql`
