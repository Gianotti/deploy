import type { DeployStatus } from "@/types";

const CONFIG: Record<DeployStatus, { bg: string; text: string; border: string; emoji: string; label: string }> = {
  LIBRE:      { bg: "bg-green-900/40",  text: "text-green-400",  border: "border-green-800",  emoji: "✅", label: "Deploy libre" },
  RESTRINGIDO:{ bg: "bg-yellow-900/40", text: "text-yellow-400", border: "border-yellow-800", emoji: "🟡", label: "Restringido" },
  BLOQUEADO:  { bg: "bg-red-900/40",    text: "text-red-400",    border: "border-red-800",    emoji: "🔴", label: "Bloqueado" },
};

interface Props {
  status: DeployStatus;
  large?: boolean;
}

export default function StatusBadge({ status, large }: Props) {
  const c = CONFIG[status];
  if (large) {
    return (
      <div className={`flex items-center gap-4 ${c.bg} border ${c.border} rounded-2xl px-8 py-6 w-fit mx-auto`}>
        <span className="text-5xl">{c.emoji}</span>
        <span className={`text-3xl font-bold ${c.text}`}>{c.label}</span>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${c.bg} border ${c.border} ${c.text} text-xs font-semibold px-2.5 py-1 rounded-full`}>
      {c.emoji} {c.label}
    </span>
  );
}
