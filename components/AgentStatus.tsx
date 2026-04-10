"use client";

import { useState } from "react";
import { Phone, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface AgentStatusProps {
  agentName: string;
  isActive: boolean;
}

type TriggerState = "idle" | "loading" | "success" | "error";

export function AgentStatus({ agentName, isActive }: AgentStatusProps) {
  const [phone, setPhone] = useState("");
  const [orderId, setOrderId] = useState("");
  const [triggerState, setTriggerState] = useState<TriggerState>("idle");
  const [resultMessage, setResultMessage] = useState("");
  const [resultType, setResultType] = useState<"success" | "error">("success");

  async function handleTriggerCall(e: React.FormEvent) {
    e.preventDefault();
    if (!phone || !orderId) return;

    setTriggerState("loading");
    setResultMessage("");

    try {
      const res = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, order_id: orderId }),
      });

      const data = await res.json();

      if (res.ok) {
        setTriggerState("success");
        setResultType("success");
        setResultMessage(`Llamada iniciada — ID: ${data.call_id}`);
        setPhone("");
        setOrderId("");
      } else {
        setTriggerState("error");
        setResultType("error");
        setResultMessage(data.error ?? "Error al disparar la llamada");
      }
    } catch {
      setTriggerState("error");
      setResultType("error");
      setResultMessage("Error de red. Intenta de nuevo.");
    }

    setTimeout(() => setTriggerState("idle"), 5000);
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row gap-6">
          {/* Agent Status Indicator */}
          <div className="flex items-center gap-4 min-w-fit">
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                <Phone className="h-6 w-6 text-primary" />
              </div>
              {isActive && (
                <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background animate-pulse" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{agentName}</span>
                <Badge variant={isActive ? "success" : "muted"}>
                  {isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mireva Costa Rica · Español CR
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden sm:block w-px bg-border" />

          {/* Manual Trigger Form */}
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
              Disparar llamada manual
            </p>
            <form onSubmit={handleTriggerCall} className="flex flex-wrap gap-2">
              <Input
                type="tel"
                placeholder="+50688887777"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-44 text-sm"
                disabled={triggerState === "loading"}
              />
              <Input
                type="text"
                placeholder="Order ID (Shopify)"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="w-48 text-sm"
                disabled={triggerState === "loading"}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!phone || !orderId || triggerState === "loading"}
                className="shrink-0"
              >
                {triggerState === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4" />
                )}
                <span className="ml-2">
                  {triggerState === "loading" ? "Iniciando..." : "Llamar"}
                </span>
              </Button>
            </form>

            {/* Result message */}
            {resultMessage && (
              <div
                className={`flex items-center gap-2 mt-2 text-xs ${
                  resultType === "success"
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                {resultType === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" />
                )}
                {resultMessage}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
