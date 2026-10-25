export const DEFAULT_API_ORIGIN = "https://quan1-tourism-api.onrender.com";

export function apiOrigin(value: string | undefined): string {
  const url = new URL(value?.trim() || DEFAULT_API_ORIGIN);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      host === "localhost" || host.endsWith(".localhost") ||
      host === "[::1]" || host === "[::]" || /^127\./.test(host) || host === "0.0.0.0") {
    throw new Error("EXPO_PUBLIC_API_ORIGIN must be a public HTTPS origin.");
  }
  return url.origin;
}
