export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  headers.set("X-Requested-With", "Quan1Admin");
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(
      0,
      "Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      typeof data.detail === "string"
        ? data.detail
        : "Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function mediaUrl(id: string) {
  return `/api/v1/media/${encodeURIComponent(id)}`;
}
export { SpeechPlayer } from "./SpeechPlayer";
