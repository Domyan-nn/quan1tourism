export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const aiIssues: Record<string, [string, string]> = {
  source_copy: [
    "AI chép lại bài nguồn, chưa tạo được bản dịch.",
    "AI copied the source instead of translating.",
  ],
  wrong_language: [
    "Bản AI không đúng ngôn ngữ đã chọn hoặc bị trộn ngôn ngữ.",
    "AI output uses the wrong or mixed languages.",
  ],
  wrong_script: [
    "Bản AI dùng sai hệ chữ của ngôn ngữ đã chọn.",
    "AI output uses the wrong writing system.",
  ],
  language_uncertain: [
    "Chưa đủ tin cậy để xác định ngôn ngữ. Hãy chỉnh tay hoặc kiểm tra lại.",
    "The language could not be identified confidently. Edit or review it manually.",
  ],
  empty_output: [
    "AI trả nội dung rỗng hoặc thiếu tiêu đề/bài.",
    "AI returned an empty title or narration.",
  ],
  invalid_output: [
    "Đầu ra AI không đúng định dạng hoặc nguồn quá dài cho cấu hình hiện tại.",
    "AI output has an invalid format, or the source exceeds the current context limit.",
  ],
  incomplete_generation: [
    "AI chưa tạo xong hoặc nội dung bị cắt.",
    "AI generation is incomplete or truncated.",
  ],
  repetitive_output: [
    "Bản AI lặp nội dung bất thường.",
    "AI output contains excessive repetition.",
  ],
  damaged_unicode: [
    "Bản AI chứa ký tự bị hỏng.",
    "AI output contains damaged characters.",
  ],
  model_timeout: [
    "Model AI xử lý quá thời gian giới hạn.",
    "The AI model exceeded its inference time limit.",
  ],
  worker_unavailable: [
    "Máy AI chưa kết nối hoặc lượt xử lý đã hết hạn.",
    "The AI worker is unavailable or its processing lease expired.",
  ],
  generation_failed: [
    "Tạo nội dung AI thất bại; nguyên nhân chưa được phân loại.",
    "AI generation failed for an unclassified reason.",
  ],
  source_changed: [
    "Nguồn đã thay đổi. Hãy tạo yêu cầu mới; nội dung cũ được giữ nguyên.",
    "The source changed. Generate a new request; existing content was preserved.",
  ],
  target_changed: [
    "Bản dịch đã được chỉnh sửa sau yêu cầu AI. Nội dung được giữ nguyên.",
    "The target was edited after the AI request. Existing content was preserved.",
  ],
  batch_limited: [
    "Chọn rõ ngôn ngữ cần dịch và tuân theo giới hạn mỗi lượt.",
    "Select target languages explicitly and stay within the batch limit.",
  ],
  language_not_verified: [
    "Dịch hàng loạt chưa được mở cho những ngôn ngữ này. Hãy thử từng ngôn ngữ.",
    "Batch generation is not verified for these languages. Try one language at a time.",
  ],
};
export function aiIssueMessage(code: string, locale: string): string {
  return aiIssues[code]?.[locale === "en" ? 1 : 0] ?? "";
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
  const mediaErrors: Record<string, [string, string]> = {
    media_storage_not_configured: [
      "Máy chủ chưa cấu hình Supabase Storage. Ảnh chưa được lưu; kiểm tra cấu hình backend.",
      "Supabase Storage is not configured on the server. The image was not saved; check backend settings.",
    ],
    media_storage_unavailable: [
      "Chưa kết nối được kho ảnh. Hãy thử lại; ảnh hiện có được giữ nguyên.",
      "Image storage is unavailable. Try again; the existing image was preserved.",
    ],
    media_integrity_failed: [
      "File trong kho ảnh không khớp dữ liệu đã lưu. Cần kiểm tra lại ảnh.",
      "The stored image does not match its saved metadata. Review the image.",
    ],
    media_file_not_found: [
      "Không tìm thấy file ảnh.",
      "The image file was not found.",
    ],
    invalid_media_path: [
      "Đường dẫn kho ảnh không hợp lệ.",
      "The image storage path is invalid.",
    ],
  };
  if (typeof detail === "string" && mediaErrors[detail])
    return mediaErrors[detail][vi ? 0 : 1];
  if (typeof detail === "string" && aiIssueMessage(detail, vi ? "vi" : "en"))
    return aiIssueMessage(detail, vi ? "vi" : "en");
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

export function recordVisit() {
  void api("/events/visit", { method: "POST" }).catch(() => {});
}
