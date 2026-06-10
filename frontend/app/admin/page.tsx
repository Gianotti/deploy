"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/lib/auth";
import {
  getCountries, createCountry, deleteCountry,
  getClients, createClient, deleteClient, updateClientGA4,
  getDeployRules, createDeployRule, deleteDeployRule,
  getNotificationConfig, saveNotificationConfig, sendNotificationNow,
  getGA4CredentialsStatus, saveGA4Credentials, deleteGA4Credentials, getGA4Realtime,
  extractError,
  type NotificationConfig, type GA4RealtimeData, type GA4CredentialsStatus,
} from "@/lib/api";
import type { Country, Client, DeployRule, PromoType, DeployStatus } from "@/types";

type Tab = "countries" | "clients" | "rules" | "notifications" | "ga4";

const PROMO_TYPES: PromoType[] = ["PROMO_ESPECIAL", "PROMO_NORMAL"];
const DEPLOY_STATUSES: DeployStatus[] = ["LIBRE", "RESTRINGIDO", "BLOQUEADO"];

const PROMO_LABEL: Record<PromoType, string> = {
  PROMO_ESPECIAL: "Promo Especial 🔴 (bloquea el día)",
  PROMO_NORMAL:   "Promo Normal 🟡 (deploy con aviso)",
};

const STATUS_STYLE: Record<DeployStatus, string> = {
  LIBRE:       "text-green-500",
  RESTRINGIDO: "text-yellow-500",
  BLOQUEADO:   "text-red-500",
};

const TIMEZONES: { group: string; zones: { value: string; label: string }[] }[] = [
  { group: "América del Sur", zones: [
    { value: "America/Argentina/Buenos_Aires", label: "Argentina — Buenos Aires" },
    { value: "America/Argentina/Cordoba",      label: "Argentina — Córdoba" },
    { value: "America/Argentina/Mendoza",      label: "Argentina — Mendoza" },
    { value: "America/Sao_Paulo",              label: "Brasil — São Paulo" },
    { value: "America/Santiago",               label: "Chile — Santiago" },
    { value: "America/Bogota",                 label: "Colombia — Bogotá" },
    { value: "America/Lima",                   label: "Perú — Lima" },
    { value: "America/Caracas",                label: "Venezuela — Caracas" },
    { value: "America/La_Paz",                 label: "Bolivia — La Paz" },
    { value: "America/Asuncion",               label: "Paraguay — Asunción" },
    { value: "America/Montevideo",             label: "Uruguay — Montevideo" },
    { value: "America/Guayaquil",              label: "Ecuador — Guayaquil" },
  ]},
  { group: "América Central y México", zones: [
    { value: "America/Mexico_City",  label: "México — Ciudad de México" },
    { value: "America/Monterrey",    label: "México — Monterrey" },
    { value: "America/Tijuana",      label: "México — Tijuana" },
    { value: "America/Guatemala",    label: "Guatemala" },
    { value: "America/Costa_Rica",   label: "Costa Rica" },
    { value: "America/Panama",       label: "Panamá" },
    { value: "America/El_Salvador",  label: "El Salvador" },
    { value: "America/Tegucigalpa",  label: "Honduras" },
    { value: "America/Managua",      label: "Nicaragua" },
  ]},
  { group: "América del Norte", zones: [
    { value: "America/New_York",    label: "EE.UU. — Nueva York (ET)" },
    { value: "America/Chicago",     label: "EE.UU. — Chicago (CT)" },
    { value: "America/Denver",      label: "EE.UU. — Denver (MT)" },
    { value: "America/Los_Angeles", label: "EE.UU. — Los Ángeles (PT)" },
    { value: "America/Toronto",     label: "Canadá — Toronto" },
  ]},
  { group: "Caribe", zones: [
    { value: "America/Santo_Domingo", label: "Rep. Dominicana" },
    { value: "America/Havana",        label: "Cuba — La Habana" },
    { value: "America/Puerto_Rico",   label: "Puerto Rico" },
  ]},
  { group: "Europa", zones: [
    { value: "Europe/Madrid",    label: "España — Madrid" },
    { value: "Europe/London",    label: "Reino Unido — Londres" },
    { value: "Europe/Paris",     label: "Francia — París" },
    { value: "Europe/Lisbon",    label: "Portugal — Lisboa" },
  ]},
  { group: "Otros", zones: [
    { value: "UTC", label: "UTC" },
    { value: "Australia/Sydney", label: "Australia — Sídney" },
  ]},
];

// ─── Countries ────────────────────────────────────────────────────────────────

function CountriesTab() {
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", iso_code: "", timezone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try { setCountries(await getCountries()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (countries.some(c => c.iso_code === form.iso_code)) {
      setError(`El código ISO "${form.iso_code}" ya existe`); return;
    }
    setSaving(true);
    try { await createCountry(form); setForm({ name: "", iso_code: "", timezone: "" }); load(); }
    catch (err: any) { setError(extractError(err)); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`¿Eliminar "${name}"?`)) return;
    try { await deleteCountry(id); load(); }
    catch (err: any) { alert(extractError(err)); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white">Nuevo país</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Nombre</label>
            <input className="field" required value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Brasil" />
          </div>
          <div>
            <label className="field-label">Código ISO</label>
            <input className="field" required maxLength={3} value={form.iso_code}
              onChange={e => setForm({ ...form, iso_code: e.target.value.toUpperCase() })} placeholder="BRA" />
          </div>
          <div>
            <label className="field-label">Timezone</label>
            <select className="field" required value={form.timezone}
              onChange={e => setForm({ ...form, timezone: e.target.value })}>
              <option value="">Seleccioná un timezone...</option>
              {TIMEZONES.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.zones.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Guardando..." : "+ Agregar país"}</button>
      </form>

      <div className="space-y-2">
        {loading && <p className="text-gray-400 text-sm">Cargando...</p>}
        {countries.map(c => (
          <div key={c.id} className="card px-5 py-3 flex items-center justify-between">
            <div>
              <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
              <span className="ml-3 text-xs bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{c.iso_code}</span>
              <span className="ml-2 text-gray-400 text-sm">{c.timezone}</span>
            </div>
            <button onClick={() => handleDelete(c.id, c.name)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition text-xl px-2">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Clients ──────────────────────────────────────────────────────────────────

function ClientsTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", country_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [cls, cts] = await Promise.all([getClients(), getCountries()]);
      setClients(cls); setCountries(cts);
      if (cts.length && !form.country_id) setForm(f => ({ ...f, country_id: String(cts[0].id) }));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSaving(true);
    try { await createClient({ name: form.name, country_id: Number(form.country_id) }); setForm(f => ({ ...f, name: "" })); load(); }
    catch (err: any) { setError(extractError(err)); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`¿Eliminar "${name}"?`)) return;
    try { await deleteClient(id); load(); }
    catch (err: any) { alert(extractError(err)); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleCreate} className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white">Nuevo cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Nombre</label>
            <input className="field" required value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Banco Nación" />
          </div>
          <div>
            <label className="field-label">País</label>
            <select className="field" value={form.country_id}
              onChange={e => setForm({ ...form, country_id: e.target.value })}>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name} ({c.iso_code})</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" disabled={saving || !countries.length} className="btn-primary">
          {saving ? "Guardando..." : "+ Agregar cliente"}
        </button>
      </form>

      <div className="space-y-2">
        {loading && <p className="text-gray-400 text-sm">Cargando...</p>}
        {clients.map(c => (
          <div key={c.id} className="card px-5 py-3 flex items-center justify-between">
            <div>
              <span className="font-medium text-gray-900 dark:text-white">{c.name}</span>
              <span className="ml-3 text-gray-400 text-sm">{c.country.name}</span>
              <span className="ml-2 text-xs bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{c.country.iso_code}</span>
            </div>
            <button onClick={() => handleDelete(c.id, c.name)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition text-xl px-2">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Deploy Rules ─────────────────────────────────────────────────────────────

const EMPTY_RULE = {
  promo_type: "PROMO_ESPECIAL" as PromoType,
  min_criticality: 1,
  deploy_status: "BLOQUEADO" as DeployStatus,
  window_start: "", window_end: "", description: "",
};

function RulesTab() {
  const [rules, setRules] = useState<DeployRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_RULE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try { setRules(await getDeployRules()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      const payload = form.promo_type === "PROMO_ESPECIAL"
        ? { ...form, deploy_status: "BLOQUEADO" as DeployStatus, min_criticality: 1, window_start: undefined, window_end: undefined }
        : { ...form, window_start: form.window_start || undefined, window_end: form.window_end || undefined };
      await createDeployRule({ ...payload, description: form.description || undefined });
      setForm(EMPTY_RULE); load();
    } catch (err: any) { setError(extractError(err)); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar esta regla?")) return;
    await deleteDeployRule(id); load();
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-navy-700/50 border border-blue-200 dark:border-navy-700 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-gray-400">
        Defaults sin regla: <span className="text-red-500 font-semibold">PROMO_ESPECIAL → BLOQUEADO</span> ·
        <span className="text-yellow-500 font-semibold"> PROMO_NORMAL → RESTRINGIDO</span>
      </div>

      <form onSubmit={handleCreate} className="card p-6 space-y-5">
        <h2 className="font-semibold text-gray-900 dark:text-white">Nueva regla</h2>

        <div>
          <label className="field-label">Tipo de promo</label>
          <select className="field sm:w-72" value={form.promo_type}
            onChange={e => {
              const t = e.target.value as PromoType;
              setForm({ ...form, promo_type: t, deploy_status: t === "PROMO_ESPECIAL" ? "BLOQUEADO" : form.deploy_status, min_criticality: 1 });
            }}>
            {PROMO_TYPES.map(t => <option key={t} value={t}>{PROMO_LABEL[t]}</option>)}
          </select>
        </div>

        {form.promo_type === "PROMO_ESPECIAL" && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
            🔴 Promo Especial siempre bloquea el deploy. No requiere configurar criticidad ni ventana horaria.
          </div>
        )}

        {form.promo_type === "PROMO_NORMAL" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Criticidad mínima</label>
              <select className="field" value={form.min_criticality}
                onChange={e => setForm({ ...form, min_criticality: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Estado resultante</label>
              <select className="field" value={form.deploy_status}
                onChange={e => setForm({ ...form, deploy_status: e.target.value as DeployStatus })}>
                {DEPLOY_STATUSES.filter(s => s !== "BLOQUEADO").map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}

        {form.promo_type === "PROMO_NORMAL" && form.deploy_status === "RESTRINGIDO" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Ventana inicio</label>
              <input className="field" type="time" value={form.window_start}
                onChange={e => setForm({ ...form, window_start: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Ventana fin</label>
              <input className="field" type="time" value={form.window_end}
                onChange={e => setForm({ ...form, window_end: e.target.value })} />
            </div>
          </div>
        )}

        <div>
          <label className="field-label">Descripción (opcional)</label>
          <input className="field" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Ej: Promo normal alta criticidad → ventana nocturna" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary">{saving ? "Guardando..." : "+ Agregar regla"}</button>
      </form>

      <div className="space-y-2">
        {loading && <p className="text-gray-400 text-sm">Cargando...</p>}
        {rules.map(r => (
          <div key={r.id} className="card px-5 py-3 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-accent">{PROMO_LABEL[r.promo_type] ?? r.promo_type}</span>
                {r.promo_type === "PROMO_NORMAL" && (
                  <span className="text-gray-400 text-xs">crit ≥ {r.min_criticality}</span>
                )}
                <span className="text-gray-400 text-xs">→</span>
                <span className={`text-sm font-bold ${STATUS_STYLE[r.deploy_status]}`}>{r.deploy_status}</span>
                {r.window_start && <span className="text-yellow-500 font-mono text-xs">{r.window_start}–{r.window_end}</span>}
              </div>
              {r.description && <p className="text-gray-500 dark:text-gray-400 text-sm">{r.description}</p>}
            </div>
            <button onClick={() => handleDelete(r.id)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition text-xl flex-shrink-0">×</button>
          </div>
        ))}
        {!loading && rules.length === 0 && <p className="text-gray-400 text-sm">No hay reglas — se usan los defaults del motor.</p>}
      </div>
    </div>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

function NotificationsTab() {
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getNotificationConfig().then(setConfig).catch(() => setConfig({ id: 1, webhook_url: "", time_1: null, time_2: null, time_3: null, is_active: false }));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setError(""); setSaving(true);
    try {
      const saved = await saveNotificationConfig({ webhook_url: config.webhook_url, time_1: config.time_1 || null, time_2: config.time_2 || null, time_3: config.time_3 || null, is_active: config.is_active });
      setConfig(saved); setMsg("Configuración guardada ✅");
    } catch (err: any) { setError(extractError(err)); }
    finally { setSaving(false); setTimeout(() => setMsg(""), 3000); }
  }

  async function handleSendNow() {
    setSending(true); setError("");
    try {
      const res = await sendNotificationNow();
      setMsg("Mensaje enviado ✅");
    } catch (err: any) { setError(extractError(err)); }
    finally { setSending(false); setTimeout(() => setMsg(""), 4000); }
  }

  if (!config) return <div className="text-gray-400 text-sm">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-navy-700/50 border border-blue-200 dark:border-navy-700 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-gray-400">
        Configurá un webhook de Google Chat para recibir el estado de deploy de todos los clientes en hasta 3 horarios por día (hora UTC).
      </div>

      <form onSubmit={handleSave} className="card p-6 space-y-5">
        <h2 className="font-semibold text-gray-900 dark:text-white">Configuración de notificaciones</h2>

        <div>
          <label className="field-label">URL del Webhook de Google Chat</label>
          <input className="field" type="url" placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=..." value={config.webhook_url}
            onChange={e => setConfig({ ...config, webhook_url: e.target.value })} />
          <p className="text-xs text-gray-400 mt-1">En Google Chat: Manage Webhooks → Add Webhook → copiar URL</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {([1, 2, 3] as const).map(n => (
            <div key={n}>
              <label className="field-label">Horario {n} (UTC)</label>
              <input className="field" type="time"
                value={(config as any)[`time_${n}`] ?? ""}
                onChange={e => setConfig({ ...config, [`time_${n}`]: e.target.value || null } as any)} />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setConfig({ ...config, is_active: !config.is_active })}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.is_active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.is_active ? "translate-x-5" : ""}`} />
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-300">{config.is_active ? "Notificaciones activas" : "Notificaciones desactivadas"}</span>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
        {msg && <p className="text-green-500 text-sm">{msg}</p>}

        <div className="flex gap-3 flex-wrap">
          <button type="submit" disabled={saving} className="btn-primary">{saving ? "Guardando..." : "Guardar configuración"}</button>
          <button type="button" disabled={sending || !config.webhook_url} onClick={handleSendNow}
            className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-navy-700 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-navy-700 transition disabled:opacity-50">
            {sending ? "Enviando..." : "📨 Enviar ahora"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── GA4 ─────────────────────────────────────────────────────────────────────

type CredMode = "sa" | "oauth";

function GA4Tab() {
  const [credStatus, setCredStatus] = useState<GA4CredentialsStatus | null>(null);
  const [credJson, setCredJson] = useState("");
  const [credMode, setCredMode] = useState<CredMode>("sa");
  const [oauthForm, setOauthForm] = useState({ client_id: "", client_secret: "", refresh_token: "" });
  const [clients, setClients] = useState<Client[]>([]);
  const [realtime, setRealtime] = useState<GA4RealtimeData[]>([]);
  const [savingCreds, setSavingCreds] = useState(false);
  const [loadingRealtime, setLoadingRealtime] = useState(false);
  const [editingGA4, setEditingGA4] = useState<Record<number, string>>({});
  const [savingGA4, setSavingGA4] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getGA4CredentialsStatus().then(setCredStatus).catch(() => setCredStatus({ configured: false }));
    getClients().then(cs => { setClients(cs); const map: Record<number,string> = {}; cs.forEach(c => { map[c.id] = c.ga4_property_id ?? ""; }); setEditingGA4(map); });
  }, []);

  async function handleSaveCreds(e: React.FormEvent, jsonOverride?: string) {
    e.preventDefault(); setError(""); setSavingCreds(true);
    const json = jsonOverride ?? credJson;
    try {
      await saveGA4Credentials(json);
      const status = await getGA4CredentialsStatus();
      setCredStatus(status); setCredJson(""); setMsg("Credenciales guardadas ✅");
    } catch (err: any) { setError(extractError(err)); }
    finally { setSavingCreds(false); setTimeout(() => setMsg(""), 3000); }
  }

  async function handleDeleteCreds() {
    if (!confirm("¿Eliminar las credenciales de GA4?")) return;
    await deleteGA4Credentials();
    setCredStatus({ configured: false });
  }

  async function handleSavePropertyId(clientId: number) {
    setSavingGA4(clientId);
    try {
      const val = editingGA4[clientId]?.trim() || null;
      await updateClientGA4(clientId, val);
      setMsg(`Property ID actualizado ✅`);
    } catch (err: any) { setError(extractError(err)); }
    finally { setSavingGA4(null); setTimeout(() => setMsg(""), 3000); }
  }

  async function handleLoadRealtime() {
    setLoadingRealtime(true); setError("");
    try {
      const data = await getGA4Realtime();
      setRealtime(data);
    } catch (err: any) { setError(extractError(err)); }
    finally { setLoadingRealtime(false); }
  }

  function buildOauthJson() {
    return JSON.stringify({ type: "oauth", ...oauthForm }, null, 2);
  }

  return (
    <div className="space-y-6">
      {/* Credenciales */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-gray-900 dark:text-white">Credenciales GA4</h2>
          {credStatus?.configured && (
            <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-800 px-2.5 py-1 rounded-full">
              ✅ Configurado — {credStatus.client_email}
            </span>
          )}
        </div>

        {!credStatus?.configured ? (
          <div className="space-y-4">
            {/* Selector de método */}
            <div className="flex gap-2">
              <button type="button" onClick={() => setCredMode("sa")}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition ${credMode === "sa" ? "bg-accent text-white border-accent" : "border-gray-200 dark:border-navy-700 text-gray-500 dark:text-gray-400"}`}>
                🔑 Service Account JSON
              </button>
              <button type="button" onClick={() => setCredMode("oauth")}
                className={`px-4 py-2 rounded-xl border text-sm font-medium transition ${credMode === "oauth" ? "bg-accent text-white border-accent" : "border-gray-200 dark:border-navy-700 text-gray-500 dark:text-gray-400"}`}>
                🔐 OAuth Token
              </button>
            </div>

            {credMode === "sa" && (
              <form onSubmit={handleSaveCreds} className="space-y-3">
                <div className="bg-blue-50 dark:bg-navy-700/50 border border-blue-200 dark:border-navy-700 rounded-xl p-3 text-xs text-blue-700 dark:text-gray-400 space-y-1">
                  <p className="font-semibold">Pasos:</p>
                  <p>1. Google Cloud → IAM → Service Accounts → descargá el JSON key</p>
                  <p>2. En GA4: Admin → <strong>Property Access Management</strong> → + → ingresá el email del SA → Viewer</p>
                  <p className="text-yellow-600 dark:text-yellow-400">⚠️ Si GA4 rechaza el email, usá la opción OAuth Token.</p>
                </div>
                <textarea className="field h-36 font-mono text-xs"
                  placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
                  value={credJson} onChange={e => setCredJson(e.target.value)} required />
                {error && <p className="text-red-500 text-sm">{error}</p>}
                {msg && <p className="text-green-500 text-sm">{msg}</p>}
                <button type="submit" disabled={savingCreds} className="btn-primary">{savingCreds ? "Guardando..." : "Guardar credenciales"}</button>
              </form>
            )}

            {credMode === "oauth" && (
              <form onSubmit={async (e) => { await handleSaveCreds(e, buildOauthJson()); }} className="space-y-3">
                <div className="bg-blue-50 dark:bg-navy-700/50 border border-blue-200 dark:border-navy-700 rounded-xl p-3 text-xs text-blue-700 dark:text-gray-400 space-y-1">
                  <p className="font-semibold">Cómo obtener el Refresh Token (una sola vez):</p>
                  <p>1. Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Desktop app)</p>
                  <p>2. Entrá a <strong>OAuth 2.0 Playground</strong> → Settings → usá tus credenciales</p>
                  <p>3. Scope: <span className="font-mono">https://www.googleapis.com/auth/analytics.readonly</span></p>
                  <p>4. Authorize → Exchange code → copiás el <strong>Refresh Token</strong></p>
                  <p className="text-green-600 dark:text-green-400">✅ Esta opción funciona con cualquier cuenta que tenga acceso a GA4.</p>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="field-label">Client ID</label>
                    <input className="field font-mono text-xs" placeholder="xxxxx.apps.googleusercontent.com"
                      value={oauthForm.client_id} onChange={e => setOauthForm({ ...oauthForm, client_id: e.target.value })} required />
                  </div>
                  <div>
                    <label className="field-label">Client Secret</label>
                    <input className="field font-mono text-xs" type="password" placeholder="GOCSPX-..."
                      value={oauthForm.client_secret} onChange={e => setOauthForm({ ...oauthForm, client_secret: e.target.value })} required />
                  </div>
                  <div>
                    <label className="field-label">Refresh Token</label>
                    <input className="field font-mono text-xs" placeholder="1//0g..."
                      value={oauthForm.refresh_token} onChange={e => setOauthForm({ ...oauthForm, refresh_token: e.target.value })} required />
                  </div>
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                {msg && <p className="text-green-500 text-sm">{msg}</p>}
                <button type="submit" disabled={savingCreds} className="btn-primary">{savingCreds ? "Guardando..." : "Guardar credenciales"}</button>
              </form>
            )}
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={handleLoadRealtime} disabled={loadingRealtime} className="btn-primary">
              {loadingRealtime ? "Cargando..." : "🔄 Actualizar datos en tiempo real"}
            </button>
            <button onClick={handleDeleteCreds}
              className="px-5 py-2.5 rounded-xl border border-red-200 dark:border-red-800 text-sm font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
              Eliminar credenciales
            </button>
          </div>
        )}
      </div>

      {/* Property IDs por cliente */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-white">GA4 Property ID por cliente</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Formato: <span className="font-mono bg-gray-100 dark:bg-navy-700 px-1 rounded">properties/123456789</span> — lo encontrás en GA4 → Admin → Property Settings.</p>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        {msg && <p className="text-green-500 text-sm">{msg}</p>}
        <div className="space-y-3">
          {clients.map(c => {
            const rt = realtime.find(r => r.client_id === c.id);
            return (
              <div key={c.id} className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="w-40 flex-shrink-0">
                    <p className="text-gray-900 dark:text-white font-medium text-sm truncate">{c.name}</p>
                    <p className="text-gray-400 text-xs">{c.country.name}</p>
                  </div>
                  <input className="field flex-1 min-w-0 font-mono text-sm" placeholder="properties/123456789 o solo 123456789"
                    value={editingGA4[c.id] ?? ""} onChange={e => setEditingGA4({ ...editingGA4, [c.id]: e.target.value })} />
                  <button onClick={() => handleSavePropertyId(c.id)} disabled={savingGA4 === c.id}
                    className="btn-primary flex-shrink-0 text-xs py-2 px-3">
                    {savingGA4 === c.id ? "..." : "Guardar"}
                  </button>
                </div>
                {/* Resultado de GA4 */}
                {rt && rt.active_users >= 0 && (
                  <div className="ml-44 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-blue-600 dark:text-blue-400 font-bold">👥 {rt.active_users} usuarios activos ahora</span>
                      <span className="text-gray-400 text-xs">📄 {rt.page_views} page views</span>
                    </div>
                    {Object.keys(rt.by_country).length > 0 && (
                      <div className="flex gap-3 flex-wrap mt-2">
                        {Object.entries(rt.by_country)
                          .sort(([, a], [, b]) => b - a)
                          .map(([country, users]) => (
                            <span key={country} className="text-xs text-gray-500 dark:text-gray-400">
                              {country}: <strong className="text-gray-900 dark:text-white">{users}</strong>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                )}
                {rt && rt.active_users < 0 && (
                  <div className="ml-44 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">❌ Error GA4</p>
                    <p className="text-red-500 text-xs mt-1">{rt.error ?? "Error desconocido"}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "countries",     label: "🌎 Países" },
  { id: "clients",       label: "🏦 Clientes" },
  { id: "rules",         label: "⚙️ Reglas" },
  { id: "notifications", label: "💬 Notificaciones" },
  { id: "ga4",           label: "📊 GA4" },
];

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("countries");

  return (
    <AuthGuard allowedRoles={["admin", "reader"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Administración</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Gestión de países, clientes y reglas de deploy</p>
        </div>

        {user?.role !== "admin" && (
          <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-xl px-5 py-4 text-yellow-700 dark:text-yellow-400 text-sm">
            Solo los administradores pueden crear o eliminar registros.
          </div>
        )}

        <div className="flex gap-1 bg-gray-100 dark:bg-navy-800 border border-gray-200 dark:border-navy-700 rounded-xl p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                tab === t.id ? "bg-accent text-white" : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "countries"     && <CountriesTab />}
        {tab === "clients"       && <ClientsTab />}
        {tab === "rules"         && <RulesTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "ga4"           && <GA4Tab />}
      </div>
    </AuthGuard>
  );
}
