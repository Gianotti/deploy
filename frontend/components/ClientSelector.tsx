"use client";

import { useEffect, useState } from "react";
import { getClients } from "@/lib/api";
import type { Client } from "@/types";

interface Props {
  value: Client | null;
  onChange: (client: Client) => void;
}

export default function ClientSelector({ value, onChange }: Props) {
  const [clients, setClients] = useState<Client[]>([]);

  useEffect(() => {
    getClients().then(setClients).catch(console.error);
  }, []);

  return (
    <div>
      <label className="field-label">Cliente</label>
      <select
        value={value?.id ?? ""}
        onChange={(e) => {
          const c = clients.find((c) => c.id === Number(e.target.value));
          if (c) onChange(c);
        }}
        className="field w-full sm:w-72"
      >
        <option value="">Seleccioná un cliente...</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {c.country.name}
          </option>
        ))}
      </select>
    </div>
  );
}
