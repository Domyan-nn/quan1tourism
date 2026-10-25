import { test } from "node:test";
import assert from "node:assert/strict";
import { displayedReviews } from "../apps/admin/src/narration-review.ts";

const approved = {
  state: "approved",
  source: "manual",
  approved_current: true,
  pending_job_id: null,
  preserves_approved: false,
};
const saved = {
  name: "Place",
  address: "Address",
  source: null,
  short_description: "",
  translations: {
    vi: { title: "Nguồn", text: "Bài nguồn" },
    en: { title: "Story", text: "English text" },
  },
  narration_review: { vi: approved, en: approved },
};

test("editing and reverting narration changes only the corresponding approval evidence", () => {
  const edited = structuredClone(saved);
  edited.translations.en.text = "New manual version";
  assert.equal(displayedReviews(edited, saved).en.state, "pending");
  assert.equal(displayedReviews(edited, saved).vi.state, "approved");
  edited.translations.en.text = saved.translations.en.text;
  assert.equal(displayedReviews(edited, saved).en.approved_current, true);
});
test("an unsaved source change invalidates dependent reviews and obsolete AI proposals without deleting text", () => {
  const previous = structuredClone(saved);
  previous.narration_review.en = {
    ...approved,
    state: "pending",
    source: "ai",
    pending_job_id: "old-result",
    preserves_approved: true,
  };
  const edited = structuredClone(previous);
  edited.translations.vi.text = "Nguồn mới";
  const review = displayedReviews(edited, previous).en;
  assert.equal(review.state, "pending");
  assert.equal(review.approved_current, false);
  assert.equal(review.pending_job_id, null);
  assert.equal(edited.translations.en.text, previous.translations.en.text);
  assert.equal(
    displayedReviews(previous, previous).en.preserves_approved,
    true,
  );
});
test("legacy text with no approval evidence stays pending and empty text has no marker", () => {
  const legacy = {
    ...saved,
    narration_review: undefined,
    translations: { ...saved.translations, fr: { title: "", text: "" } },
  };
  assert.equal(displayedReviews(legacy, legacy).en.state, "pending");
  assert.equal(displayedReviews(legacy, legacy).fr.state, "empty");
});
