"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Check, ArrowLeft, ToggleLeft, ToggleRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpsellRuleDB } from "@/lib/db";

const TIER_COLORS: Record<string, "default" | "success" | "warning"> = {
  S: "success",
  A: "default",
  B: "warning",
};

const EMPTY_FORM = {
  trigger_sku: "",
  upsell_sku: "",
  upsell_name: "",
  upsell_price: "",
  pitch: "",
  tier: "B" as "S" | "A" | "B",
};

export default function UpsellAdminPage() {
  const [rules, setRules] = useState<UpsellRuleDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchRules() {
    const res = await fetch("/api/upsell-rules");
    const data = await res.json();
    setRules(data.rules ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchRules(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const method = editId ? "PATCH" : "POST";
      const body = editId
        ? { id: editId, ...form, upsell_price: Number(form.upsell_price) }
        : { ...form, upsell_price: Number(form.upsell_price) };

      const res = await fetch("/api/upsell-rules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Error al guardar");
        return;
      }
      setForm(EMPTY_FORM);
      setEditId(null);
      setShowForm(false);
      await fetchRules();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: UpsellRuleDB) {
    await fetch("/api/upsell-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, active: !rule.active }),
    });
    await fetchRules();
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar esta regla?")) return;
    await fetch(`/api/upsell-rules?id=${id}`, { method: "DELETE" });
    await fetchRules();
  }

  function startEdit(rule: UpsellRuleDB) {
    setForm({
      trigger_sku: rule.trigger_sku,
      upsell_sku: rule.upsell_sku,
      upsell_name: rule.upsell_name,
      upsell_price: String(rule.upsell_price),
      pitch: rule.pitch,
      tier: rule.tier,
    });
    setEditId(rule.id);
    setShowForm(true);
  }

  const active = rules.filter((r) => r.active);
  const inactive = rules.filter((r) => !r.active);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" /> Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">Reglas de Upsell</h1>
            <p className="text-xs text-muted-foreground">
              {active.length} activas · {inactive.length} inactivas
            </p>
          </div>
          <Button
            className="ml-auto"
            size="sm"
            onClick={() => { setShowForm(true); setEditId(null); setForm(EMPTY_FORM); }}
          >
            <Plus className="h-4 w-4 mr-2" /> Nueva regla
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Form */}
        {showForm && (
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="text-base">
                {editId ? "Editar regla" : "Nueva regla de upsell"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">SKU del producto comprado (trigger)</label>
                    <Input
                      placeholder="ej: shampoo-romero"
                      value={form.trigger_sku}
                      onChange={(e) => setForm({ ...form, trigger_sku: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">SKU del producto a ofrecer (upsell)</label>
                    <Input
                      placeholder="ej: crema-peinar-romero"
                      value={form.upsell_sku}
                      onChange={(e) => setForm({ ...form, upsell_sku: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Nombre del producto upsell</label>
                    <Input
                      placeholder="ej: Crema para Peinar de Romero"
                      value={form.upsell_name}
                      onChange={(e) => setForm({ ...form, upsell_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Precio en ₡ Colones</label>
                    <Input
                      type="number"
                      placeholder="ej: 7900"
                      value={form.upsell_price}
                      onChange={(e) => setForm({ ...form, upsell_price: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Pitch de venta (lo que dice Valeria)</label>
                  <Input
                    placeholder="ej: Completá tu rutina capilar — la crema de romero sella la hidratación todo el día."
                    value={form.pitch}
                    onChange={(e) => setForm({ ...form, pitch: e.target.value })}
                    required
                  />
                </div>
                <div className="flex items-center gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Tier (tasa de conversión esperada)</label>
                    <div className="flex gap-2">
                      {(["S", "A", "B"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setForm({ ...form, tier: t })}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                            form.tier === t
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          Tier {t} {t === "S" ? "(>20%)" : t === "A" ? "(10-20%)" : "(5-10%)"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={saving}>
                    <Check className="h-4 w-4 mr-1" />
                    {saving ? "Guardando..." : editId ? "Guardar cambios" : "Crear regla"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }}
                  >
                    <X className="h-4 w-4 mr-1" /> Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Rules table */}
        {loading ? (
          <div className="h-48 rounded-lg border border-border bg-card animate-pulse" />
        ) : rules.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
              <p className="text-sm">No hay reglas de upsell todavía.</p>
              <p className="text-xs mt-1">
                Hacé click en "Nueva regla" para agregar la primera.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Tier</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Trigger SKU</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Ofrece</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Precio</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Pitch</th>
                      <th className="text-left py-3 px-4 text-muted-foreground font-medium">Estado</th>
                      <th className="py-3 px-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr
                        key={rule.id}
                        className={`border-b border-border/50 transition-colors ${
                          rule.active ? "hover:bg-muted/30" : "opacity-40 hover:bg-muted/20"
                        }`}
                      >
                        <td className="py-3 px-4">
                          <Badge variant={TIER_COLORS[rule.tier]}>
                            Tier {rule.tier}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {rule.trigger_sku}
                          </code>
                        </td>
                        <td className="py-3 px-4">
                          <div>
                            <p className="font-medium text-foreground text-xs">{rule.upsell_name}</p>
                            <code className="text-xs text-muted-foreground">{rule.upsell_sku}</code>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">
                          ₡{rule.upsell_price.toLocaleString("es-CR")}
                        </td>
                        <td className="py-3 px-4 hidden lg:table-cell">
                          <p className="text-xs text-muted-foreground max-w-xs truncate" title={rule.pitch}>
                            {rule.pitch}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={() => handleToggle(rule)} title="Activar/desactivar">
                            {rule.active
                              ? <ToggleRight className="h-5 w-5 text-emerald-400" />
                              : <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                            }
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1">
                            <button
                              onClick={() => startEdit(rule)}
                              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(rule.id)}
                              className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
