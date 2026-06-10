export type UserRole = "admin" | "reader" | "comercial";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export interface Country {
  id: number;
  name: string;
  iso_code: string;
  timezone: string;
}

export interface Client {
  id: number;
  name: string;
  country_id: number;
  country: Country;
  ga4_property_id: string | null;
}

export type PromoType = "PROMO_ESPECIAL" | "PROMO_NORMAL";

export interface Promotion {
  id: number;
  client_id: number;
  start_date: string;
  end_date: string;
  promo_type: PromoType;
  criticality: number;
  description: string | null;
}

export type DeployStatus = "LIBRE" | "RESTRINGIDO" | "BLOQUEADO";

export interface DeployRule {
  id: number;
  promo_type: PromoType;
  min_criticality: number;
  deploy_status: DeployStatus;
  window_start: string | null;
  window_end: string | null;
  description: string | null;
}

export interface DeployWindowDay {
  date: string;
  deploy_status: DeployStatus;
  window_start: string | null;
  window_end: string | null;
  active_promotions: Promotion[];
}

export interface DeployWindowResponse {
  client_id: number;
  country_id: number;
  windows: DeployWindowDay[];
}

export interface TodayStatusResponse {
  client_id: number;
  date: string;
  deploy_status: DeployStatus;
  window_start: string | null;
  window_end: string | null;
  can_deploy_now: boolean;
  active_promotions: Promotion[];
  message: string;
}
