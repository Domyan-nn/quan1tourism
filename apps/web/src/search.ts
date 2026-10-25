export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d").toLowerCase().trim().replace(/\s+/g, " ");
}
