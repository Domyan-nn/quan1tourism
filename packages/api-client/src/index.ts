export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Pending responses and notices may outlive a UI language switch.
export function uiMessage(
  message: string,
  locale: string,
  kind: "error" | "success" = "error",
) {
  if (!message) return "";
  const vietnamese = /[À-ỹ]/u.test(message);
  const vi = locale !== "en";
  if (vi === vietnamese) return message;
  if (kind === "success")
    return vi ? "Đã hoàn tất thao tác." : "Action completed.";
  return vi
    ? "Chưa xử lý được yêu cầu. Kiểm tra các trường rồi thử lại."
    : "The request could not be completed. Check the fields and try again.";
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  headers.set("X-Requested-With", "Quan1Admin");
  const vi = document.documentElement.lang !== "en";
  headers.set("Accept-Language", vi ? "vi" : "en");
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
      vi
        ? "Không kết nối được máy chủ. Kiểm tra kết nối rồi thử lại."
        : "Cannot reach the server. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      localizedError(
        response.status,
        data.detail,
        document.documentElement.lang !== "en",
      ),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function localizedError(status: number, detail: unknown, vi: boolean) {
  if (
    typeof detail === "string" &&
    (vi ? /[À-ỹ]/u.test(detail) : !/[À-ỹ]/u.test(detail))
  )
    return detail;
  const messages: Record<number, [string, string]> = {
    401: ["Vui lòng đăng nhập lại.", "Please sign in again."],
    403: [
      "Bạn không có quyền thực hiện thao tác này.",
      "You do not have permission for this action.",
    ],
    404: ["Không tìm thấy nội dung.", "Content was not found."],
    409: [
      "Nội dung hoặc nguồn đã thay đổi, hoặc nội dung đã tồn tại. Mở lại để kiểm tra trước khi lưu.",
      "Content or source has changed, or already exists. Reopen and review before saving.",
    ],
    422: [
      "Kiểm tra các trường bắt buộc, nội dung đầy đủ và xác nhận duyệt.",
      "Check required fields, complete narration and review confirmation.",
    ],
    429: [
      "Có quá nhiều yêu cầu. Hãy chờ rồi thử lại.",
      "Too many requests. Wait and try again.",
    ],
  };
  return (messages[status] ?? [
    "Máy chủ chưa xử lý được yêu cầu. Hãy thử lại.",
    "The server could not process this request. Please try again.",
  ])[vi ? 0 : 1];
}
export function mediaUrl(id: string) {
  return `/api/v1/media/${encodeURIComponent(id)}`;
}
export { SpeechPlayer, isSpeechBusy } from "./SpeechPlayer";
export { SourceAttribution } from "./SourceAttribution";
export { PlaceMap, LocationEditor } from "./PlaceMap";

export function recordEngagement(id: string, kind: "view" | "listen") {
  // Statistics must never prevent someone from reading or listening.
  void api(`/pois/${encodeURIComponent(id)}/events/${kind}`, {
    method: "POST",
  }).catch(() => {});
}
