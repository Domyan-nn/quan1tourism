/** Accept only the project-root link printed by Expo CLI for an Expo Go session. */
export function expoGoUrl(
  enabled: string | undefined,
  value: string | undefined,
): string | null {
  if (
    enabled !== "true" ||
    !value ||
    value !== value.trim() ||
    value.length > 1024
  )
    return null;
  if (!/^exps?:\/\//.test(value) || /[\s\\?#\u0000-\u001f\u007f]/.test(value))
    return null;
  try {
    const url = new URL(value);
    if (
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname)
    )
      return null;
    const host = url.hostname.toLowerCase();
    if (
      ["localhost", "0.0.0.0", "[::]", "[::1]"].includes(host) ||
      host.endsWith(".localhost") ||
      /^127\./.test(host)
    )
      return null;
    if (
      url.port &&
      (!/^\d+$/.test(url.port) ||
        Number(url.port) < 1 ||
        Number(url.port) > 65535)
    )
      return null;
    if (
      !host.startsWith("[") &&
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
        host,
      )
    )
      return null;
    if (
      /^\d+(?:\.\d+){3}$/.test(host) &&
      host.split(".").some((part) => Number(part) > 255)
    )
      return null;
    // Keep the exact CLI link; never invent or rewrite a LAN/tunnel address.
    return value;
  } catch {
    return null;
  }
}
