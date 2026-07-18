export type DatasetCacheReadStatus = "hit" | "miss" | "error";

export type DatasetLoadDecision =
  | "use-l2"
  | "use-stale-l1"
  | "build"
  | "unavailable";

// Un error de Supabase no equivale a un cache miss. Reconstruir el historico
// ante una falla de lectura multiplica el trabajo y termina en timeouts 504.
export function decideDatasetLoad(
  cacheStatus: DatasetCacheReadStatus,
  hasStaleL1: boolean
): DatasetLoadDecision {
  if (cacheStatus === "hit") return "use-l2";
  if (cacheStatus === "miss") return "build";
  return hasStaleL1 ? "use-stale-l1" : "unavailable";
}
