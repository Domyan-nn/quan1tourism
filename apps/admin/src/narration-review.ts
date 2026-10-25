import type { NarrationReview, Poi } from "@quan1/contracts";

export function displayedReviews(form: Poi, saved: Poi): Record<string, NarrationReview> {
  const result = { ...saved.narration_review };
  for (const [code, tr] of Object.entries(form.translations)) {
    const previous = saved.translations[code];
    if (tr.title !== previous?.title || tr.text !== previous?.text) {
      const hasContent = Boolean(tr.title.trim() || tr.text.trim());
      result[code] = {
        state: hasContent ? "pending" : result[code]?.pending_job_id ? "pending" : "empty",
        source: hasContent ? "manual" : result[code]?.pending_job_id ? "ai" : null,
        approved_current: false,
        pending_job_id: result[code]?.pending_job_id ?? null,
        preserves_approved: false,
      };
    }
    // No approval evidence from an older API must never become a checkmark.
    result[code] ??= {
      state: tr.title.trim() || tr.text.trim() ? "pending" : "empty",
      source: tr.title.trim() || tr.text.trim() ? "manual" : null,
      approved_current: false, pending_job_id: null, preserves_approved: false,
    };
  }
  return result;
}

export function reviewLabel(review: NarrationReview | undefined, vi: boolean): string {
  if (review?.preserves_approved)
    return vi
      ? "Có bản AI mới chưa duyệt; bản đã duyệt trước vẫn được giữ."
      : "A new AI draft needs review; the previously approved version is preserved.";
  if (review?.state === "approved")
    return vi ? "Nội dung hiện tại đã được admin duyệt" : "Current content approved by an administrator";
  if (review?.state === "pending")
    return review.source === "ai"
      ? vi ? "Bản AI chưa duyệt" : "AI draft awaiting administrator review"
      : vi ? "Bản nháp chưa duyệt" : "Manual draft awaiting administrator review";
  return vi ? "Chưa có nội dung" : "No content yet";
}
