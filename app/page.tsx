"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatsCards, type StatsData } from "@/components/StatsCards";
import { CallsTable } from "@/components/CallsTable";
import { AgentStatus } from "@/components/AgentStatus";
import type { CallRecord } from "@/lib/redis";

interface DashboardData {
  stats: StatsData;
  calls: CallRecord[];
  fetched_at: string;
}

const EMPTY_STATS: StatsData = {
  total: 0,
  confirmed: 0,
  upsells: 0,
  no_answer: 0,
  cancelled: 0,
  confirmation_rate: 0,
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (res.ok) {
        const json: DashboardData = await res.json();
        setData(json);
        setLastUpdated(
          new Date().toLocaleTimeString("es-CR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        );
      }
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stats = data?.stats ?? EMPTY_STATS;
  const calls = data?.calls ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Kairo AI
              </h1>
              <p className="text-xs text-muted-foreground">
                Voice Agents · E-commerce COD · LATAM
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Actualizado: {lastUpdated}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">Actualizar</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Agent Status + Manual Trigger */}
        <AgentStatus agentName="Valeria" isActive={!loading} />

        {/* KPI Cards */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-lg border border-border bg-card animate-pulse"
              />
            ))}
          </div>
        ) : (
          <StatsCards stats={stats} />
        )}

        {/* Calls Table */}
        {loading ? (
          <div className="h-96 rounded-lg border border-border bg-card animate-pulse" />
        ) : (
          <CallsTable calls={calls} />
        )}

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground py-4">
          <p>
            Kairo AI · Agentes de voz IA para e-commerce COD en LATAM ·{" "}
            <span className="text-primary">Powered by Retell AI + Gemini</span>
          </p>
        </footer>
      </main>
    </div>
  );
}
