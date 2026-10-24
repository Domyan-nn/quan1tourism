// Offsets are UTF-16 code units, matching browser speech boundary events.
export function voiceMatches(requested: string, available: string) {
  const wanted = requested.replace(/_/g, "-").toLowerCase();
  const actual = available.replace(/_/g, "-").toLowerCase();
  const base = wanted.split("-")[0];
  if (base !== actual.split("-")[0]) return false;
  const script = (tag: string) =>
    tag.split("-").find((part) => part.length === 4) ??
    (tag.startsWith("zh-")
      ? /-(tw|hk|mo)(-|$)/.test(tag)
        ? "hant"
        : /-(cn|sg)(-|$)/.test(tag)
          ? "hans"
          : undefined
      : undefined);
  return !script(wanted) || script(wanted) === script(actual);
}

export function nextChunk(text: string, start: number) {
  let end = Math.min(start + 180, text.length);
  if (end < text.length) {
    const fragment = text.slice(start, end);
    const boundaries = [...fragment.matchAll(/[.!?。！？\n](?:\s|$)/gu)];
    const sentence = boundaries.at(-1);
    if (sentence && sentence.index! >= 20)
      end = start + sentence.index! + sentence[0].length;
    else {
      const space = fragment.lastIndexOf(" ");
      if (space > 0) end = start + space + 1;
    }
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  return text.slice(start, end);
}
