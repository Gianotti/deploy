"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const ALL_LINKS = [
  { href: "/dashboard",  label: "🚦 Inicio",       roles: ["admin", "reader", "comercial"] },
  { href: "/calendar",   label: "📅 Calendario",   roles: ["admin", "reader", "comercial"] },
  { href: "/promotions", label: "🏷️ Promociones",  roles: ["admin", "reader", "comercial"] },
  { href: "/admin",      label: "⚙️ Admin",         roles: ["admin", "reader"] },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const links = ALL_LINKS.filter((l) => !user || (l.roles as readonly string[]).includes(user.role));

  return (
    <nav className="bg-white dark:bg-navy-800 border-b border-gray-200 dark:border-navy-700 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-16">
        <div className="flex items-center gap-6">
          <span className="font-bold text-gray-900 dark:text-white text-lg">🚀 Deploy</span>
          <div className="hidden sm:flex gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  pathname.startsWith(l.href)
                    ? "bg-accent text-white"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-navy-700"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-lg transition
                       text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {user && (
            <>
              <span className="text-gray-500 dark:text-gray-400 text-sm hidden sm:block">
                {user.full_name}
                <span className="ml-2 text-xs bg-gray-100 dark:bg-navy-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {user.role}
                </span>
              </span>
              <button
                onClick={logout}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-accent transition px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-700"
              >
                Salir
              </button>
            </>
          )}
        </div>
      </div>

      {/* Mobile bottom nav */}
      <div className="sm:hidden flex border-t border-gray-200 dark:border-navy-700">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`flex-1 py-3 text-center text-xs font-medium transition ${
              pathname.startsWith(l.href)
                ? "text-accent"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
