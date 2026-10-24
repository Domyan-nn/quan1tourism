import { test } from "node:test";
import assert from "node:assert/strict";
import { getCategoryLabel } from "../packages/contracts/src/index.ts";

test("category labels follow UI language, with a safe legacy fallback", () => {
  const category = {
    id: "heritage",
    name: "Historical Sites",
    name_vi: "Di tích lịch sử",
  };
  assert.equal(getCategoryLabel(category, "vi"), "Di tích lịch sử");
  assert.equal(getCategoryLabel(category, "en"), "Historical Sites");
  for (const name_vi of [null, undefined, "", "   "]) {
    assert.equal(
      getCategoryLabel({ ...category, name_vi }, "vi"),
      "Historical Sites",
    );
  }
  assert.equal(getCategoryLabel(undefined, "vi"), "");
  assert.equal(category.id, "heritage");
});
