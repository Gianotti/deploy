"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import ClientSelector from "@/components/ClientSelector";
import { getPromotions, createPromotion, deletePromotion, extractError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Client, Promotion, PromoType } from "@/types";

const PROMO_TYPES: PromoType[] = ["PROMO_ESPECIAL", "PROMO_NORMAL"];

const TYPE_STYLE: Record<PromoType, string> = {
  PROMO_ESPECIAL: "bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
  PROMO_NORMAL:   "bg-yellow-50 dark:bg-yellow-900/40 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
};

const TYPE_LABEL: Record<PromoType, string> = {
  PROMO_ESPECIAL: "Promo Especial 🔴",
  PROMO_NORMAL:   "Promo Normal 🟡",
};

const EMPTY_FORM = { start_date: "", end_date: "", promo_type: "PROMO_NORMAL" as PromoType, criticality: 1, description: "" };

export default function PromotionsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canCreate = user?.role === "admin" || user?.role === "comercial";

  const [client, setClient] = useState<Client | null>(null);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function fetchPromos(c: Client) {
    setLoading(true);
    try { setPromos(await getPromotions(c.id)); } finally { setLoading(false); }
  }

  function handleClientChange(c: Client) {
    setClient(c); setPromos([]); setShowForm(false); fetchPromos(c);
  }

  async function handleDelete(id: number) {
    if (!confirm("¿Eliminar esta promoción?")) return;
    await deletePromotion(id);
    if (client) fetchPromos(client);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setFormError(""); setSaving(true);
    try {
      const criticality = form.promo_type === "PROMO_ESPECIAL" ? 5 : form.criticality;
      await createPromotion({ ...form, criticality, client_id: client.id, description: form.description || undefined });
      setForm(EMPTY_FORM); setShowForm(false); fetchPromos(client);
    } catch (err: any) { setFormError(extractError(err)); }
    finally { setSaving(false); }
  }

  return (
    <AuthGuard>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Promociones</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Gestioná las promos por cliente</p>
          </div>
          {canCreate && client && (
            <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
              {showForm ? "Cancelar" : "+ Nueva promo"}
            </button>
          )}
        </div>

        <ClientSelector value={client} onChange={handleClientChange} />

        {/* Create form */}
        {showForm && canCreate && client && (
          <form onSubmit={handleSubmit} className="card p-6 space-y-5">
            <h2 className="font-semibold text-gray-900 dark:text-white">Nueva promoción — {client.name}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">Fecha inicio</label>
                <input type="date" required value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="field" />
              </div>
              <div>
                <label className="field-label">Fecha fin</label>
                <input type="date" required value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })} className="field" />
              </div>
            </div>

            <div>
              <label className="field-label">Tipo</label>
              <div className="flex gap-2 flex-wrap">
                {PROMO_TYPES.map((t) => (
                  <button type="button" key={t}
                    onClick={() => setForm({ ...form, promo_type: t })}
                    className={`px-4 py-2 rounded-xl border text-xs font-semibold transition ${
                      form.promo_type === t ? TYPE_STYLE[t] : "border-gray-200 dark:border-navy-700 text-gray-400 hover:border-gray-400"
                    }`}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {form.promo_type === "PROMO_NORMAL" && (
              <div>
                <label className="field-label">
                  Criticidad — {form.criticality}/5
                  <span className="ml-2 font-normal normal-case text-gray-400">
                    (determina la ventana horaria permitida)
                  </span>
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button type="button" key={n}
                      onClick={() => setForm({ ...form, criticality: n })}
                      className={`w-10 h-10 rounded-xl border text-sm font-bold transition ${
                        form.criticality === n
                          ? "bg-accent border-accent text-white"
                          : "border-gray-200 dark:border-navy-700 text-gray-400 hover:border-gray-400"
                      }`}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}

            {form.promo_type === "PROMO_ESPECIAL" && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">
                🔴 Promo Especial bloquea el deploy durante todo el día, sin excepciones.
              </div>
            )}

            <div>
              <label className="field-label">Descripción (opcional)</label>
              <input type="text" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ej: Hot Sale — envío masivo" className="field" />
            </div>

            {formError && (
              <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
                {formError}
              </p>
            )}
            <button type="submit" disabled={saving} className="btn-primary w-full py-3">
              {saving ? "Guardando..." : "Guardar promoción"}
            </button>
          </form>
        )}

        {loading && <div className="text-center py-12 text-3xl animate-pulse">🏷️</div>}

        {!loading && client && promos.length === 0 && !showForm && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-3">🏷️</div>
            <p>No hay promociones para este cliente</p>
          </div>
        )}

        {!loading && promos.length > 0 && (
          <div className="space-y-3">
            {[...promos].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((p) => (
              <div key={p.id} className="card p-4 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${TYPE_STYLE[p.promo_type]}`}>
                      {TYPE_LABEL[p.promo_type]}
                    </span>
                    <span className="text-xs text-yellow-500">★ {p.criticality}/5</span>
                    <span className="text-xs text-gray-400">{p.start_date} → {p.end_date}</span>
                  </div>
                  <p className="text-gray-900 dark:text-white text-sm">{p.description ?? <span className="text-gray-400">Sin descripción</span>}</p>
                </div>
                {canCreate && (
                  <button onClick={() => handleDelete(p.id)}
                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 transition text-xl flex-shrink-0">×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {!client && !loading && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🏷️</div>
            <p>Seleccioná un cliente para ver sus promociones</p>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}
