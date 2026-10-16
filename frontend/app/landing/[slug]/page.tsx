"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getPublicStatus, type ClientStatus } from "@/lib/api";
import { ClientDetail, FOCUS, LandingHeader, REFRESH_SECS, clientSlug } from "@/components/landing/parts";

export default function ClientStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [countdown, setCountdown] = useState(REFRESH_SECS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getPublicStatus();
      setClients(data.clients);
      setGeneratedAt(data.generated_at);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setCountdown(REFRESH_SECS);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, REFRESH_SECS * 1000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const key = decodeURIComponent(slug ?? "");
  const client = clients.find((c) => clientSlug(c) === key || String(c.client_id) === key);

  useEffect(() => {
    if (client) document.title = `${client.client_name} · Deploy Status`;
  }, [client?.client_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatedAt = generatedAt.split(" ").slice(1).join(" ");

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <LandingHeader updatedAt={updatedAt} countdown={countdown} onRefresh={fetchStatus} />

      <main className="mx-auto max-w-screen-xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <Link
          href={client ? `/landing#cliente-${client.client_id}` : "/landing"}
          className={`-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[15px] font-medium text-ink-2 hover:text-ink ${FOCUS}`}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="15 18 9 12 15 6" /></svg>
          Todos los clientes
        </Link>

        {loading && (
          <div role="status" className="space-y-5">
            <span className="sr-only">Cargando cliente…</span>
            <div className="h-10 w-1/2 max-w-md rounded-lg bg-line motion-safe:animate-pulse" />
            <div className="h-40 rounded-2xl bg-line motion-safe:animate-pulse" />
          </div>
        )}

        {!loading && error && !client && (
          <div className="rounded-2xl border border-line bg-card p-8 text-center space-y-4">
            <div>
              <p className="text-[17px] font-semibold text-ink">No se pudo cargar el estado de deploy</p>
              <p className="text-[15px] text-ink-2 mt-1">Revisá la conexión y volvé a intentar.</p>
            </div>
            <button onClick={fetchStatus} className={`inline-flex h-10 items-center rounded-lg bg-ink px-5 text-[15px] font-semibold text-card hover:opacity-90 ${FOCUS}`}>
              Reintentar
            </button>
          </div>
        )}

        {!loading && !error && !client && (
          <div className="rounded-2xl border border-line bg-card p-8 text-center space-y-2">
            <p className="text-[17px] font-semibold text-ink">No encontramos ese cliente</p>
            <p className="text-[15px] text-ink-2">Puede que lo hayan renombrado. Buscalo en la lista de clientes.</p>
          </div>
        )}

        {error && client && (
          <p role="status" className="rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-ink-2">
            No se pudo actualizar. Se muestran los datos de las {updatedAt || "última carga"}.
          </p>
        )}

        {client && <ClientDetail client={client} now={now} />}
      </main>
    </div>
  );
}
