"use client";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { AccountsPayload } from "@/lib/marketing-insights-types";
import { useAccountStatus } from "./AccountStatus";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };

/**
 * Report banner (módulo 11): only when an account is restricted, unpaid,
 * without access, near its spend cap or TikTok stopped arriving. Loads after
 * the report, so it never delays the hero.
 */
export function AccountStatusBanner({
  accounts,
  settings,
  onOpen,
}: {
  accounts: Resource<AccountsPayload>;
  settings: MarketingSettings | null;
  onOpen: () => void;
}) {
  const status = useAccountStatus(accounts, settings);
  if (!status?.problems.length) return null;
  const risk = status.problems.some((p) => p.tone === "risk");
  return (
    <div
      role="alert"
      className={`${r.banner} ${risk ? r.bannerRisk : ""} ${r.statusBanner}`}
    >
      <ul>
        {status.problems.map((problem) => (
          <li key={`${problem.platform}:${problem.accountId}`}>
            <strong>{problem.label}:</strong> {problem.title}
          </li>
        ))}
      </ul>
      <button type="button" className={r.inlineLink} onClick={onOpen}>
        Ver estado de las cuentas
      </button>
    </div>
  );
}
