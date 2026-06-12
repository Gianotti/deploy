const COLORS = [
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f97316", // orange
  "#14b8a6", // teal
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ef4444", // red
];

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

interface Props {
  name: string;
  size?: "sm" | "lg";
}

export default function ClientAvatar({ name, size = "sm" }: Props) {
  const initial = name.trim().charAt(0).toUpperCase();
  const bg = colorFromName(name);
  const cls = size === "lg"
    ? "w-16 h-16 rounded-xl text-2xl font-black flex-shrink-0"
    : "w-10 h-10 rounded-lg text-lg font-bold flex-shrink-0";

  return (
    <div
      className={`${cls} flex items-center justify-center select-none`}
      style={{ background: bg }}
      aria-label={name}
    >
      <span className="text-white leading-none">{initial}</span>
    </div>
  );
}
