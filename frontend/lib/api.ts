import axios from "axios";

export function extractError(err: any): string {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message ?? "Error desconocido";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(" · ");
  return JSON.stringify(detail);
}
import Cookies from "js-cookie";
import type {
  Client,
  Country,
  DeployRule,
  DeployStatus,
  DeployWindowResponse,
  Promotion,
  Repository,
  Team,
  TodayStatusResponse,
  User,
} from "@/types";

// In the browser → hits Next.js rewrites → backend
// In SSR → direct (not needed here since all fetches are client-side)
const api = axios.create({ baseURL: "/api" });

api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      Cookies.remove("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// Auth
export async function login(email: string, password: string): Promise<void> {
  const res = await api.post<{ access_token: string }>("/auth/login", { email, password });
  Cookies.set("access_token", res.data.access_token, { expires: 1 });
}

export function logout() {
  Cookies.remove("access_token");
  window.location.href = "/login";
}

export async function getMe(): Promise<User> {
  return (await api.get<User>("/auth/me")).data;
}

// Countries
export async function getCountries(): Promise<Country[]> {
  return (await api.get<Country[]>("/countries/")).data;
}

export async function createCountry(data: { name: string; iso_code: string; timezone: string }): Promise<Country> {
  return (await api.post<Country>("/countries/", data)).data;
}

export async function updateCountry(id: number, data: Partial<{ name: string; timezone: string }>): Promise<Country> {
  return (await api.patch<Country>(`/countries/${id}`, data)).data;
}

export async function deleteCountry(id: number): Promise<void> {
  await api.delete(`/countries/${id}`);
}

// Clients
export async function getClients(countryId?: number): Promise<Client[]> {
  return (await api.get<Client[]>("/clients/", { params: countryId ? { country_id: countryId } : {} })).data;
}

export async function createClient(data: { name: string; country_id: number }): Promise<Client> {
  return (await api.post<Client>("/clients/", data)).data;
}

export async function updateClient(id: number, data: Partial<{ name: string; country_id: number }>): Promise<Client> {
  return (await api.patch<Client>(`/clients/${id}`, data)).data;
}

export async function deleteClient(id: number): Promise<void> {
  await api.delete(`/clients/${id}`);
}

export async function uploadClientLogo(clientId: number, file: File): Promise<Client> {
  const form = new FormData();
  form.append("file", file);
  return (await api.post<Client>(`/clients/${clientId}/logo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  })).data;
}

export async function deleteClientLogo(clientId: number): Promise<Client> {
  return (await api.delete<Client>(`/clients/${clientId}/logo`)).data;
}

// Deploy Rules
export async function getDeployRules(): Promise<DeployRule[]> {
  return (await api.get<DeployRule[]>("/deploy-rules/")).data;
}

export async function createDeployRule(data: {
  promo_type: string;
  min_criticality: number;
  deploy_status: string;
  window_start?: string;
  window_end?: string;
  description?: string;
}): Promise<DeployRule> {
  return (await api.post<DeployRule>("/deploy-rules/", data)).data;
}

export async function deleteDeployRule(id: number): Promise<void> {
  await api.delete(`/deploy-rules/${id}`);
}

// Promotions
export async function getPromotions(clientId: number, fromDate?: string, toDate?: string): Promise<Promotion[]> {
  return (await api.get<Promotion[]>("/promotions/", {
    params: { client_id: clientId, from_date: fromDate, to_date: toDate },
  })).data;
}

export async function createPromotion(data: {
  client_id: number;
  start_date: string;
  end_date: string;
  promo_type: string;
  criticality: number;
  description?: string;
}): Promise<Promotion> {
  return (await api.post<Promotion>("/promotions/", data)).data;
}

export async function deletePromotion(id: number): Promise<void> {
  await api.delete(`/promotions/${id}`);
}

// Deploy windows
export async function getDeployWindows(
  clientId: number,
  fromDate: string,
  toDate: string
): Promise<DeployWindowResponse> {
  return (await api.get<DeployWindowResponse>("/deploy-windows", {
    params: { client_id: clientId, from_date: fromDate, to_date: toDate },
  })).data;
}

export interface ClientStatus {
  client_id: number;
  client_name: string;
  country_name: string;
  country_iso: string;
  timezone: string;
  deploy_status: DeployStatus;
  can_deploy_now: boolean;
  window_start: string | null;
  window_end: string | null;
  active_promo_count: number;
  has_logo?: boolean;
  ga4_active_users: number | null;
  ga4_top_pages: { path: string; users: number }[];
}

export interface PublicStatus {
  generated_at: string;
  clients: ClientStatus[];
  ecosystem_total: number;
  ecosystem_peak_today: number;
}

export async function getPublicStatus(): Promise<PublicStatus> {
  return (await api.get<PublicStatus>("/public/status")).data;
}

export async function getTodayStatus(clientId: number): Promise<TodayStatusResponse> {
  return (await api.get<TodayStatusResponse>("/deploy-status/today", {
    params: { client_id: clientId },
  })).data;
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface NotificationConfig {
  id: number;
  webhook_url: string;
  time_1: string | null;
  time_2: string | null;
  time_3: string | null;
  is_active: boolean;
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  return (await api.get<NotificationConfig>("/notifications/config")).data;
}

export async function saveNotificationConfig(data: Omit<NotificationConfig, "id">): Promise<NotificationConfig> {
  return (await api.post<NotificationConfig>("/notifications/config", data)).data;
}

export async function sendNotificationNow(): Promise<{ sent: boolean; message: string }> {
  return (await api.post("/notifications/send-now")).data;
}

// ── GA4 ──────────────────────────────────────────────────────────────────────

export interface GA4RealtimeData {
  client_id: number;
  client_name: string;
  property_id: string;
  active_users: number;   // -1 = error
  page_views: number;
  error: string | null;
}

export interface GA4CredentialsStatus {
  configured: boolean;
  client_email?: string;
}

export async function getGA4CredentialsStatus(): Promise<GA4CredentialsStatus> {
  return (await api.get<GA4CredentialsStatus>("/ga4/credentials/status")).data;
}

export async function saveGA4Credentials(credentials_json: string): Promise<void> {
  await api.post("/ga4/credentials", { credentials_json });
}

export async function deleteGA4Credentials(): Promise<void> {
  await api.delete("/ga4/credentials");
}

export async function getGA4Realtime(): Promise<GA4RealtimeData[]> {
  return (await api.get<GA4RealtimeData[]>("/ga4/realtime")).data;
}

export async function updateClientGA4(id: number, ga4_property_id: string | null): Promise<Client> {
  return (await api.patch<Client>(`/clients/${id}`, { ga4_property_id })).data;
}

// ── Repositories ─────────────────────────────────────────────────────────────

export async function getRepositories(): Promise<Repository[]> {
  return (await api.get<Repository[]>("/repositories/")).data;
}

export async function createRepository(name: string): Promise<Repository> {
  return (await api.post<Repository>("/repositories/", { name })).data;
}

export async function deleteRepository(id: number): Promise<void> {
  await api.delete(`/repositories/${id}`);
}

export async function addClientToRepository(repoId: number, clientId: number): Promise<Repository> {
  return (await api.post<Repository>(`/repositories/${repoId}/clients`, { client_id: clientId })).data;
}

export async function removeClientFromRepository(repoId: number, clientId: number): Promise<Repository> {
  return (await api.delete<Repository>(`/repositories/${repoId}/clients/${clientId}`)).data;
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function getTeams(): Promise<Team[]> {
  return (await api.get<Team[]>("/teams/")).data;
}

export async function createTeam(data: { name: string; deploy_days: number[] }): Promise<Team> {
  return (await api.post<Team>("/teams/", data)).data;
}

export async function updateTeam(id: number, data: { name?: string; deploy_days?: number[] }): Promise<Team> {
  return (await api.patch<Team>(`/teams/${id}`, data)).data;
}

export async function deleteTeam(id: number): Promise<void> {
  await api.delete(`/teams/${id}`);
}

export async function addTeamChannel(teamId: number, data: { webhook_url: string; label?: string }): Promise<Team> {
  return (await api.post<Team>(`/teams/${teamId}/channels`, data)).data;
}

export async function removeTeamChannel(teamId: number, channelId: number): Promise<Team> {
  return (await api.delete<Team>(`/teams/${teamId}/channels/${channelId}`)).data;
}

export async function addTeamSlot(
  teamId: number,
  data: { time?: string | null; message_ok?: string | null; message_blocked?: string | null }
): Promise<Team> {
  return (await api.post<Team>(`/teams/${teamId}/slots`, data)).data;
}

export async function updateTeamSlot(
  teamId: number,
  slotId: number,
  data: { time: string | null; message_ok: string | null; message_blocked: string | null }
): Promise<Team> {
  return (await api.patch<Team>(`/teams/${teamId}/slots/${slotId}`, data)).data;
}

export async function deleteTeamSlot(teamId: number, slotId: number): Promise<Team> {
  return (await api.delete<Team>(`/teams/${teamId}/slots/${slotId}`)).data;
}

export async function testTeamNotify(teamId: number, slotId: number): Promise<{ sent: boolean; channels: number }> {
  return (await api.post(`/teams/${teamId}/slots/${slotId}/test-notify`)).data;
}
