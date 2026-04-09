"use client";

import { Phone, CheckCircle, TrendingUp, PhoneMissed } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StatsData {
  total: number;
  confirmed: number;
  upsells: number;
  no_answer: number;
  cancelled: number;
  confirmation_rate: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: string;
}

function StatCard({ title, value, subtitle, icon, color, trend }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`p-2 rounded-lg ${color}`}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-foreground">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
        {trend && (
          <p className="text-xs text-emerald-400 mt-1 font-medium">{trend}</p>
        )}
      </CardContent>
      {/* Decorative gradient */}
      <div
        className={`absolute bottom-0 left-0 right-0 h-0.5 opacity-60 ${color.replace("bg-", "bg-gradient-to-r from-transparent via-").replace("/20", "")}`}
      />
    </Card>
  );
}

export function StatsCards({ stats }: { stats: StatsData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <StatCard
        title="Llamadas Hoy"
        value={stats.total}
        subtitle="Total iniciadas"
        icon={<Phone className="h-4 w-4 text-blue-400" />}
        color="bg-blue-500/20"
      />
      <StatCard
        title="Confirmados"
        value={stats.confirmed}
        subtitle={`de ${stats.total} llamadas`}
        icon={<CheckCircle className="h-4 w-4 text-emerald-400" />}
        color="bg-emerald-500/20"
      />
      <StatCard
        title="Upsells"
        value={stats.upsells}
        subtitle="Ventas adicionales"
        icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
        color="bg-purple-500/20"
      />
      <StatCard
        title="No Contesta"
        value={stats.no_answer}
        subtitle="Sin respuesta"
        icon={<PhoneMissed className="h-4 w-4 text-orange-400" />}
        color="bg-orange-500/20"
      />
      <StatCard
        title="Tasa Confirmación"
        value={`${stats.confirmation_rate}%`}
        subtitle="Del total de llamadas"
        icon={
          <span className="text-yellow-400 font-bold text-sm">%</span>
        }
        color="bg-yellow-500/20"
        trend={
          stats.confirmation_rate >= 70
            ? "Excelente rendimiento"
            : stats.confirmation_rate >= 50
            ? "Buen rendimiento"
            : undefined
        }
      />
    </div>
  );
}
