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
export type PublicCategory = Omit<Category, "count">;
export interface Translation {
  title: string;
  text: string;
  tts_ready: boolean;
  published?: boolean;
}
export interface WikipediaSource {
  url: string;
  title: string;
  revision_id: number | null;
  retrieved_at: string;
  license: string;
  model: string;
  warnings: string[];
  wikidata_id: string | null;
  coordinate_source: string | null;
  image_url: string | null;
  image_page_url: string | null;
  image_author: string | null;
  image_license: string | null;
}
export interface WikipediaDraft {
  draft: Pick<
    Poi,
    "name" | "address" | "category_id" | "latitude" | "longitude"
  > & {
    translations: Record<string, Pick<Translation, "title" | "text">>;
    source: WikipediaSource;
  };
  missing_fields: string[];
  elapsed_seconds: number;
  existing_poi: { id: string; name: string } | null;
}
export interface AiJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  result: WikipediaDraft | null;
  error: string;
}
export interface Poi {
  id: string;
  name: string;
  address: string;
  short_description?: string;
  view_count?: number;
  listen_count?: number;
  category_id: string;
  latitude: number | null;
  longitude: number | null;
  trigger_radius_m?: number;
  auto_narration_enabled?: boolean;
  narration_meta?: Record<
    string,
    { origin: string; stale: boolean; source_revision?: number; model?: string }
  >;
  source?: WikipediaSource | null;
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
