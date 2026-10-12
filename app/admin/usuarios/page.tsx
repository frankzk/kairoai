"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Plus, RefreshCw, ShieldCheck, UserRoundX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { permisosDeRoles, type Permiso, type Rol } from "@/lib/permisos";

// Usuarios y accesos. Solo la ve quien tiene el permiso "usuarios".
//
// Los ROLES son plantillas: marcar uno o varios precarga las pantallas (se
// suman). Despues se puede ajustar pantalla por pantalla. Lo que se guarda y se
// aplica son las pantallas y las tiendas.

interface Usuario {
  id: number;
  username: string;
  email: string | null;
  nombre: string;
  roles: string[];
  permisos: string[];
  tiendas: string[];
  staff_id: number | null;
  activo: boolean;
  sin_clave: boolean;
  debe_cambiar_clave: boolean;
  bloqueado_hasta: string | null;
  ultimo_ingreso: string | null;
}
interface Staff {
  id: number;
  name: string;
  role: string;
  active: boolean;
}
interface Catalogo {
  permisos: Array<{ id: Permiso; label: string; detalle: string }>;
  roles: Array<{ id: Rol; label: string; permisos: Permiso[] }>;
  tiendas: Array<{ code: string; label: string }>;
}

interface Borrador {
  id: number | null;
  nombre: string;
  username: string;
  email: string;
  clave: string;
  roles: Rol[];
  permisos: Permiso[];
  tiendas: string[];
  staff_id: number | null;
}

const VACIO: Borrador = { id: null, nombre: "", username: "", email: "", clave: "", roles: [], permisos: [], tiendas: [], staff_id: null };

const FOCO = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Contraseña inicial legible: 3 grupos sin letras confusas (0/O, 1/l). */
function generarClave(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  const ch = Array.from(buf, (n) => abc[n % abc.length]);
  return `${ch.slice(0, 4).join("")}-${ch.slice(4, 8).join("")}-${ch.slice(8, 12).join("")}`;
}

/** "María José Pérez" -> "maria.perez" */
function sugerirUsuario(nombre: string): string {
  const partes = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return "";
  return (partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : partes[0]).slice(0, 32);
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-CR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState("");
  // Contraseña recien creada o reseteada: se muestra UNA vez para copiarla.
  const [claveMostrada, setClaveMostrada] = useState<{ nombre: string; usuario: string; clave: string; pedirCambio?: boolean } | null>(null);
  const [copiada, setCopiada] = useState(false);
  // Cambio de contraseña de un trabajador: la escribe el dueño o la genera.
  const [cambioClave, setCambioClave] = useState<{ u: Usuario; clave: string; pedirCambio: boolean } | null>(null);
  const [errorClave, setErrorClave] = useState("");
  const [guardandoClave, setGuardandoClave] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "No se pudieron cargar los usuarios.");
      setUsuarios(j.usuarios);
      setStaff(j.staff);
      setCatalogo(j.catalogo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los usuarios.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const staffPorId = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const permisoLabel = useMemo(() => new Map((catalogo?.permisos ?? []).map((p) => [p.id, p.label])), [catalogo]);
  const rolLabel = useMemo(() => new Map((catalogo?.roles ?? []).map((r) => [r.id, r.label])), [catalogo]);
  const tiendaLabel = useMemo(() => new Map((catalogo?.tiendas ?? []).map((t) => [t.code, t.label.replace("Mireva ", "")])), [catalogo]);

  // Asesoras de la planilla que todavia no tienen usuario (mas la propia).
  const staffLibre = useMemo(() => {
    const usadas = new Set(usuarios.filter((u) => u.id !== borrador?.id).map((u) => u.staff_id).filter(Boolean));
    return staff.filter((s) => s.active && !usadas.has(s.id));
  }, [staff, usuarios, borrador?.id]);

  function nuevo() {
    setErrorForm("");
    setBorrador({ ...VACIO, clave: generarClave(), tiendas: catalogo?.tiendas.length === 1 ? [catalogo.tiendas[0].code] : [] });
  }

  function editar(u: Usuario) {
    setErrorForm("");
    setBorrador({
      id: u.id,
      nombre: u.nombre,
      username: u.username,
      email: u.email ?? "",
      clave: "",
      roles: u.roles as Rol[],
      permisos: u.permisos as Permiso[],
      tiendas: u.tiendas,
      staff_id: u.staff_id,
    });
  }

  function toggle<T>(lista: T[], v: T): T[] {
    return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
  }

  // Marcar o desmarcar un rol recalcula las pantallas: la suma de los roles.
  function toggleRol(r: Rol) {
    if (!borrador) return;
    const roles = toggle(borrador.roles, r);
    setBorrador({ ...borrador, roles, permisos: permisosDeRoles(roles) });
  }

  function elegirStaff(idStr: string) {
    if (!borrador) return;
    const id = idStr ? Number(idStr) : null;
    const s = id ? staffPorId.get(id) : null;
    setBorrador({
      ...borrador,
      staff_id: id,
      // Al crear, el nombre y el usuario salen de la planilla si estaban vacios.
      nombre: borrador.id === null && s && !borrador.nombre ? s.name : borrador.nombre,
      username: borrador.id === null && s && !borrador.username ? sugerirUsuario(s.name) : borrador.username,
    });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!borrador) return;
    setGuardando(true);
    setErrorForm("");
    try {
      const datos = {
        nombre: borrador.nombre,
        email: borrador.email,
        roles: borrador.roles,
        permisos: borrador.permisos,
        tiendas: borrador.tiendas,
        staff_id: borrador.staff_id,
      };
      const res =
        borrador.id === null
          ? await fetch("/api/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...datos, username: borrador.username, clave: borrador.clave }),
            })
          : await fetch(`/api/users/${borrador.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(datos),
            });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorForm(j.error ?? "No se pudo guardar.");
        return;
      }
      if (borrador.id === null) {
        setClaveMostrada({ nombre: borrador.nombre, usuario: borrador.username, clave: borrador.clave });
        setCopiada(false);
      }
      setBorrador(null);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  function abrirCambioClave(u: Usuario) {
    setErrorClave("");
    setCambioClave({ u, clave: generarClave(), pedirCambio: true });
  }

  async function guardarClave(e: FormEvent) {
    e.preventDefault();
    if (!cambioClave) return;
    setGuardandoClave(true);
    setErrorClave("");
    try {
      const { u, clave, pedirCambio } = cambioClave;
      const res = await fetch(`/api/users/${u.id}/clave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave, pedir_cambio: pedirCambio }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorClave(j.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      setClaveMostrada({ nombre: u.nombre, usuario: u.username, clave, pedirCambio });
      setCopiada(false);
      setCambioClave(null);
      await cargar();
    } finally {
      setGuardandoClave(false);
    }
  }

  async function cambiarActivo(u: Usuario) {
    const accion = u.activo ? "desactivar" : "reactivar";
    if (u.activo && !window.confirm(`¿Desactivar a ${u.nombre}? Se le cierra la sesión y no puede volver a entrar.`)) return;
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !u.activo }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) window.alert(j.error ?? `No se pudo ${accion}.`);
    await cargar();
  }

  async function copiar() {
    if (!claveMostrada) return;
    try {
      await navigator.clipboard.writeText(`Usuario: ${claveMostrada.usuario}\nContraseña: ${claveMostrada.clave}`);
      setCopiada(true);
    } catch {
      /* el texto queda a la vista para copiarlo a mano */
    }
  }

  const necesitaAsesora =
    borrador !== null && borrador.permisos.includes("leads") && !borrador.permisos.includes("leads_equipo");

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Usuarios y accesos</h1>
          <p className="text-sm text-muted-foreground">
            Cada persona entra con su usuario y ve solo sus pantallas y tiendas.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} aria-hidden="true" /> Actualizar
          </Button>
          <Button size="sm" onClick={nuevo} disabled={!catalogo} className="gap-2">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Nuevo usuario
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}

      {claveMostrada && (
        <Card className="mb-4 border-emerald-500/40">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
            <div className="min-w-0 text-sm">
              <p>
                Pásale estos datos a <span className="font-semibold">{claveMostrada.nombre}</span>.
                {claveMostrada.pedirCambio === false
                  ? " Entra directo con esta contraseña."
                  : " Al entrar, el sistema le pide cambiar la contraseña."}{" "}
                <span className="text-muted-foreground">Se muestra solo esta vez.</span>
              </p>
              <p className="mt-1 font-mono">
                Usuario: <span className="font-semibold">{claveMostrada.usuario}</span> · Contraseña:{" "}
                <span className="font-semibold">{claveMostrada.clave}</span>
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={copiar} className="gap-2">
                {copiada ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copiada ? "Copiado" : "Copiar"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setClaveMostrada(null)} aria-label="Cerrar">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Persona</th>
                <th className="px-4 py-2 font-medium">Pantallas</th>
                <th className="px-4 py-2 font-medium">Tiendas</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Último ingreso</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {!cargando && usuarios.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    Todavía no hay usuarios. Crea el primero con “Nuevo usuario”.
                  </td>
                </tr>
              )}
              {usuarios.map((u) => {
                const bloqueado = u.bloqueado_hasta && Date.parse(u.bloqueado_hasta) > Date.now();
                return (
                  <tr key={u.id} className={`border-b border-border/50 align-top ${u.activo ? "" : "opacity-60"}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.nombre}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {u.username}
                        {u.email ? ` · ${u.email}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {u.roles.map((r) => rolLabel.get(r as Rol) ?? r).join(" + ") || "Sin rol"}
                        {u.staff_id ? ` · Asesora: ${staffPorId.get(u.staff_id)?.name ?? u.staff_id}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {u.permisos.map((p) => (
                          <Badge key={p} variant="secondary" className="font-normal">
                            {permisoLabel.get(p as Permiso) ?? p}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{u.tiendas.map((t) => tiendaLabel.get(t) ?? t).join(", ")}</td>
                    <td className="px-4 py-3 text-xs">
                      {!u.activo ? (
                        <Badge variant="muted">Desactivado</Badge>
                      ) : u.sin_clave ? (
                        <Badge variant="warning">Sin contraseña: pónsela con “Contraseña”</Badge>
                      ) : bloqueado ? (
                        <Badge variant="destructive">Bloqueado hasta {fmt(u.bloqueado_hasta)}</Badge>
                      ) : u.debe_cambiar_clave ? (
                        <Badge variant="warning">Pendiente de primer ingreso</Badge>
                      ) : (
                        <Badge variant="success">Activo</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(u.ultimo_ingreso)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => editar(u)}>
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => abrirCambioClave(u)} className="gap-1.5" title="Cambiarle la contraseña">
                          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Contraseña
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void cambiarActivo(u)} className="gap-1.5">
                          <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" /> {u.activo ? "Desactivar" : "Reactivar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {cambioClave && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-clave"
          onKeyDown={(e) => e.key === "Escape" && setCambioClave(null)}
        >
          <form onSubmit={guardarClave} className="my-16 w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-1 flex items-center justify-between">
              <h2 id="titulo-clave" className="text-base font-semibold">
                Cambiar contraseña de {cambioClave.u.nombre}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCambioClave(null)} aria-label="Cerrar">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Usuario <span className="font-mono text-foreground">{cambioClave.u.username}</span>. Se le cierra la sesión
              abierta y, si estaba bloqueada por intentos fallidos, queda desbloqueada.
            </p>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">Contraseña nueva (mínimo 8 caracteres)</span>
              <div className="flex gap-2">
                <Input
                  className="font-mono"
                  value={cambioClave.clave}
                  onChange={(e) => setCambioClave({ ...cambioClave, clave: e.target.value })}
                  autoFocus
                  required
                  minLength={8}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setCambioClave({ ...cambioClave, clave: generarClave() })}>
                  Generar
                </Button>
              </div>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className={`mt-0.5 ${FOCO}`}
                checked={cambioClave.pedirCambio}
                onChange={(e) => setCambioClave({ ...cambioClave, pedirCambio: e.target.checked })}
              />
              <span>
                Que la cambie al entrar
                <span className="block text-xs text-muted-foreground">
                  Recomendado: así solo ella la conoce. Desmárcalo si quieres que entre directo con esta.
                </span>
              </span>
            </label>
            {errorClave && <p className="mt-3 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{errorClave}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCambioClave(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardandoClave}>
                {guardandoClave ? "Guardando..." : "Cambiar contraseña"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {borrador && catalogo && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-usuario"
          onKeyDown={(e) => e.key === "Escape" && setBorrador(null)}
        >
          <form onSubmit={guardar} className="my-8 w-full max-w-2xl rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="titulo-usuario" className="text-base font-semibold">
                {borrador.id === null ? "Nuevo usuario" : `Editar a ${borrador.nombre}`}
              </h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBorrador(null)} aria-label="Cerrar">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Asesora de la planilla (si gestiona leads)</span>
                <select
                  className={`h-10 w-full rounded-md border border-input bg-background px-3 text-sm ${FOCO}`}
                  value={borrador.staff_id ?? ""}
                  onChange={(e) => elegirStaff(e.target.value)}
                >
                  <option value="">— No es asesora —</option>
                  {staffLibre.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.role}
                    </option>
                  ))}
                </select>
                {necesitaAsesora && !borrador.staff_id && (
                  <span className="block text-xs text-amber-300">
                    Para Leads hay que vincularla: así sus gestiones quedan a su nombre y no puede registrar a nombre de otra.
                  </span>
                )}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Nombre</span>
                <Input value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })} required />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Usuario (para entrar)</span>
                <Input
                  value={borrador.username}
                  onChange={(e) => setBorrador({ ...borrador, username: e.target.value.toLowerCase().replace(/\s/g, "") })}
                  disabled={borrador.id !== null}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="text-muted-foreground">Correo (opcional: también puede entrar con su correo)</span>
                <Input
                  type="email"
                  value={borrador.email}
                  onChange={(e) => setBorrador({ ...borrador, email: e.target.value.toLowerCase().replace(/\s/g, "") })}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="nombre@gmail.com"
                />
              </label>
              {borrador.id === null && (
                <label className="space-y-1 text-sm sm:col-span-2">
                  <span className="text-muted-foreground">Contraseña inicial (la cambia al entrar)</span>
                  <div className="flex gap-2">
                    <Input
                      className="font-mono"
                      value={borrador.clave}
                      onChange={(e) => setBorrador({ ...borrador, clave: e.target.value })}
                      required
                      minLength={8}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={() => setBorrador({ ...borrador, clave: generarClave() })}>
                      Generar otra
                    </Button>
                  </div>
                </label>
              )}
            </div>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">Roles <span className="font-normal text-muted-foreground">(se suman; precargan las pantallas)</span></legend>
              <div className="flex flex-wrap gap-2">
                {catalogo.roles.map((r) => (
                  <label key={r.id} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                    <input type="checkbox" checked={borrador.roles.includes(r.id)} onChange={() => toggleRol(r.id)} className={FOCO} />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">Pantallas <span className="font-normal text-muted-foreground">(ajuste fino por persona)</span></legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {catalogo.permisos.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      className={`mt-0.5 ${FOCO}`}
                      checked={borrador.permisos.includes(p.id)}
                      onChange={() => setBorrador({ ...borrador, permisos: toggle(borrador.permisos, p.id) })}
                    />
                    <span>
                      <span className="font-medium">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.detalle}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-medium">Tiendas</legend>
              <div className="flex flex-wrap gap-2">
                {catalogo.tiendas.map((t) => (
                  <label key={t.code} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                    <input
                      type="checkbox"
                      className={FOCO}
                      checked={borrador.tiendas.includes(t.code)}
                      onChange={() => setBorrador({ ...borrador, tiendas: toggle(borrador.tiendas, t.code) })}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {errorForm && <p className="mt-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{errorForm}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setBorrador(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : borrador.id === null ? "Crear usuario" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
