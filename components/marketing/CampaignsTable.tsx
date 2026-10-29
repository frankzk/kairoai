import type { MarketingSources } from "@/lib/marketing-source-types";

const number = new Intl.NumberFormat("es-CR");
const amount = (value: number, currency: string) => new Intl.NumberFormat("es-CR", {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(value);

export default function CampaignsTable({ sources, loading, error }: {
  sources: MarketingSources | null;
  loading: boolean;
  error: string;
}) {
  if (loading) return <p role="status" className="py-8 text-sm text-muted-foreground">Consultando las fuentes publicitarias…</p>;
  if (error) return <p role="alert" className="py-4 text-sm text-amber-400">{error}</p>;
  return <section aria-labelledby="campaigns-heading" className="space-y-5">
    <div>
      <h2 id="campaigns-heading" className="text-base font-semibold">Campañas de Costa Rica</h2>
      <p className="mt-1 max-w-[75ch] text-xs text-muted-foreground">Inversión en la moneda original y calendario de cada cuenta. No se suma al gasto manual de Gestión ni se atribuyen entregas sin un vínculo con el pedido.</p>
    </div>
    {([ ["meta", "Meta Ads"], ["tiktok", "TikTok Ads"] ] as const).map(([key, label]) => {
      const source = sources?.[key];
      const data = source?.data;
      return <div key={key} className="space-y-3">
        <h3 className="text-sm font-medium">{label}</h3>
        {source?.status !== "ready" || !data ? <p className="rounded-md border border-border p-4 text-xs text-muted-foreground">{source?.message || "Pendiente de consultar."}</p> : data.accounts.map(account => <div key={account.accountId} className="space-y-2">
          <p className="text-xs font-medium">{account.accountName || account.accountId}</p>
          <p className="text-xs text-muted-foreground">Cuenta {account.accountId} · {account.currency} · {account.timezone}. Consulta completada: {new Intl.DateTimeFormat("es-CR", { timeZone: "America/Costa_Rica", dateStyle: "short", timeStyle: "short" }).format(new Date(source.checkedAt))}, Costa Rica.</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-left text-xs">
              <caption className="sr-only">Campañas de {label}, cuenta {account.accountId}, ordenadas por inversión</caption>
              <thead className="bg-muted/40 text-muted-foreground"><tr>{["Campaña", `Inversión (${account.currency})`, "Impresiones", "Clics reportados", "CTR reportado"].map(text => <th key={text} scope="col" className="p-3 font-medium">{text}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{account.campaigns.map(campaign => <tr key={campaign.id}>
                <th scope="row" className="max-w-72 p-3 font-medium">{campaign.name}<span className="mt-1 block text-[11px] font-normal text-muted-foreground">{campaign.id}</span></th>
                <td className="p-3 tabular-nums">{amount(campaign.spend, account.currency)}</td>
                <td className="p-3 tabular-nums">{number.format(campaign.impressions)}</td>
                <td className="p-3 tabular-nums">{number.format(campaign.clicks)}</td>
                <td className="p-3 tabular-nums">{campaign.impressions ? `${(campaign.clicks / campaign.impressions * 100).toFixed(2)} %` : "—"}</td>
              </tr>)}</tbody>
            </table>
            {!account.campaigns.length && <p className="p-5 text-sm text-muted-foreground">La consulta no devolvió campañas para este mes.</p>}
          </div>
        </div>)}
      </div>;
    })}
    <p className="max-w-[75ch] text-[11px] text-muted-foreground">Los clics son los reportados por cada plataforma y pueden tener definiciones distintas. Esta vista no calcula conversiones ni ROAS atribuido.</p>
  </section>;
}
