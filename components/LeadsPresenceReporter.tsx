"use client";

import { useEffect, useState } from "react";
import { startLeadsPresence } from "@/lib/leads-presence-client";

/** Keep reporting while Leads is open, including when Productivity is closed. */
export default function LeadsPresenceReporter({ store }: { store: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => startLeadsPresence(store, setFailed), [store]);
  return failed ? <p role="status" className="mx-auto max-w-6xl px-4 pt-2 text-xs text-amber-300">No se pudo registrar tu presencia en Leads. Reintentando…</p> : null;
}
