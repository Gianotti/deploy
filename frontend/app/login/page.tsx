"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export default function LoginPage() {
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch {
      setError("Credenciales incorrectas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-navy-900">
      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="fixed top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg text-lg
                   text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-navy-700 transition"
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">🚀</div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Deploy Manager</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
            Ventanas de deploy por calendario de promociones
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-8 space-y-4">
          <div>
            <label className="field-label">Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required className="field" placeholder="tu@email.com"
            />
          </div>
          <div>
            <label className="field-label">Contraseña</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required className="field" placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

      </div>
    </div>
  );
}
