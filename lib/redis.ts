import { Redis } from "@upstash/redis";

// Lazy singleton — avoids instantiation errors at build time
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

// Convenience proxy — keeps call sites clean
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// Key builders
export const keys = {
  dedup: (phone: string, orderId: string) =>
    `called:${phone}:${orderId}`,
  callRecord: (callId: string) => `call:${callId}`,
  callsIndex: () => `calls:index`,
  statsToday: () => {
    const d = new Date().toISOString().slice(0, 10);
    return `stats:${d}`;
  },
  retryQueue: () => `retry:queue`,
};

export interface CallRecord {
  call_id: string;
  order_id: string;
  phone: string;
  customer_name: string;
  products: string;
  total: string;
  country: string;
  status: "calling" | "confirmed" | "cancelled" | "no_answer" | "upsell_accepted" | "error";
  upsell_accepted: boolean;
  duration_seconds: number;
  started_at: string;
  ended_at?: string;
  notes?: string;
}

export async function saveCallRecord(record: CallRecord): Promise<void> {
  const pipe = redis.pipeline();
  pipe.set(keys.callRecord(record.call_id), JSON.stringify(record));
  pipe.zadd(keys.callsIndex(), {
    score: Date.now(),
    member: record.call_id,
  });
  // Keep only 500 most recent calls
  pipe.zremrangebyrank(keys.callsIndex(), 0, -501);
  await pipe.exec();
}

export async function updateCallRecord(
  callId: string,
  updates: Partial<CallRecord>
): Promise<void> {
  const existing = await redis.get<string>(keys.callRecord(callId));
  if (!existing) return;
  const record: CallRecord = JSON.parse(existing as string);
  const updated = { ...record, ...updates };
  await redis.set(keys.callRecord(callId), JSON.stringify(updated));
}

export async function getRecentCalls(limit = 50): Promise<CallRecord[]> {
  const callIds = await redis.zrange(keys.callsIndex(), 0, limit - 1, {
    rev: true,
  });
  if (!callIds.length) return [];

  const records = await Promise.all(
    callIds.map((id) => redis.get<string>(keys.callRecord(id as string)))
  );

  return records
    .filter(Boolean)
    .map((r) => JSON.parse(r as string) as CallRecord);
}

export async function incrementStat(
  field: "total" | "confirmed" | "cancelled" | "no_answer" | "upsells"
): Promise<void> {
  await redis.hincrby(keys.statsToday(), field, 1);
}

export interface DailyStats {
  total: number;
  confirmed: number;
  cancelled: number;
  no_answer: number;
  upsells: number;
}

export async function getTodayStats(): Promise<DailyStats> {
  const raw = await redis.hgetall(keys.statsToday());
  const toNum = (v: unknown) => (v ? parseInt(v as string, 10) : 0);
  return {
    total: toNum(raw?.total),
    confirmed: toNum(raw?.confirmed),
    cancelled: toNum(raw?.cancelled),
    no_answer: toNum(raw?.no_answer),
    upsells: toNum(raw?.upsells),
  };
}
