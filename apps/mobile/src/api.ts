import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { User } from "@quan1/contracts";
import { apiOrigin } from "./config";

// Expo replaces this literal public environment reference at bundle time.
export const API_ORIGIN = apiOrigin(process.env.EXPO_PUBLIC_API_ORIGIN);
const TOKEN_KEY = "quan1.native.session";
const VISIT_KEY = "quan1.native.visit";
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let token: string | null = null;
let visit: string | null = null;
let initializing: Promise<void> | undefined;
let sessionWrites: Promise<unknown> = Promise.resolve();

function writeSession<T>(operation: () => Promise<T>): Promise<T> {
  const pending = sessionWrites.then(operation, operation);
  sessionWrites = pending.catch(() => {});
  return pending;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function initializeSession() {
  return initializing ??= (async () => {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
    visit = await SecureStore.getItemAsync(VISIT_KEY);
    if (!visit || !/^[a-f0-9]{64}$/.test(visit)) {
      visit = Array.from(await Crypto.getRandomBytesAsync(32), b => b.toString(16).padStart(2, "0")).join("");
      await SecureStore.setItemAsync(VISIT_KEY, visit, options);
    }
  })().catch(error => { initializing = undefined; throw error; });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  await initializeSession();
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "Quan1Admin");
  if (visit) headers.set("X-Quan1-Visit", visit);
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const sentToken = headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
  if (init.body) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const result = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      ...init, headers, signal: controller.signal, credentials: "omit",
    });
    if (!result.ok) {
      // A delayed response must not erase a session issued by a later login.
      if (result.status === 401 && sentToken && !/^\/native\/auth\/(login|register)$/.test(path)) {
        await forgetSession(sentToken);
      }
      const data = await result.json().catch(() => ({}));
      throw new ApiError(result.status, typeof data.detail === "string" ? data.detail : "Request failed");
    }
    return result.status === 204 ? undefined as T : await result.json() as T;
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}

export async function authenticate(mode: "login" | "register", data: {email: string; password: string; name?: string}) {
  const result = await request<{ user: User; access_token: string }>(`/native/auth/${mode}`, {
    method: "POST", body: JSON.stringify(data),
  });
  try {
    await writeSession(async () => {
      await SecureStore.setItemAsync(TOKEN_KEY, result.access_token, options);
      token = result.access_token;
    });
  }
  catch (error) {
    // Revoke a newly issued token if the device cannot store it securely.
    await request("/native/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${result.access_token}` } }).catch(() => {});
    throw error;
  }
  return result.user;
}
export function forgetSession(expectedToken?: string | null) {
  return writeSession(async () => {
    if (expectedToken !== undefined && token !== expectedToken) return;
    token = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  });
}
export async function restoreUser() {
  await initializeSession();
  if (!token) return null;
  try { return await request<User>("/native/auth/me"); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
}
export async function logout() {
  await initializeSession();
  const previous = token;
  // Only remove locally after server revocation succeeds; a failed logout is retryable.
  try {
    await request("/native/auth/logout", {
      method: "POST", headers: { Authorization: previous ? `Bearer ${previous}` : "" },
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
  await forgetSession(previous);
}
export function engagement(id: string, kind: "view" | "listen") {
  return request<void>(`/pois/${encodeURIComponent(id)}/events/${kind}`, { method: "POST" }).catch(() => {});
}
export function imageUrl(id: string) { return `${API_ORIGIN}/api/v1/media/${encodeURIComponent(id)}`; }
