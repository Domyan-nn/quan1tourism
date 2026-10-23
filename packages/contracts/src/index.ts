export type Locale = string;
export interface Language {
  code: Locale;
  name: string;
  native_name: string;
  speech_locale: string;
  enabled: boolean;
  required: boolean;
  sort_order: number;
  direction: "ltr" | "rtl";
}
export type Status =
  "draft" | "in_review" | "approved" | "published" | "archived";
export type Role = "visitor" | "editor" | "reviewer" | "admin";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Category {
  id: string;
  name: string;
  color: string;
  count: number;
}
export interface Translation {
  title: string;
  text: string;
  tts_ready: boolean;
}
export interface Poi {
  id: string;
  name: string;
  address: string;
  category_id: string;
  latitude: number;
  longitude: number;
  status: Status;
  revision: number;
  updated_at: string;
  image_id: string | null;
  cover: number;
  translations: Record<Locale, Translation>;
  has_published: boolean;
  note: string;
  is_demo: boolean;
}
export interface Audit {
  id: number;
  action: string;
  actor: string;
  created_at: string;
  detail: string;
}
export interface Release {
  id: string;
  revision: number;
  created_at: string;
  snapshot: Poi;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
export interface Summary {
  total: number;
  published: number;
  in_review: number;
  draft: number;
  tts_ready: number;
  translations_ready: number;
}
