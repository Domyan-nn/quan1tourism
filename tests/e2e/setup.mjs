import { readFileSync } from "node:fs";

export default async function setup() {
  // Fail explicitly when the production artifact has not been built.
  JSON.parse(readFileSync("apps/web/dist/release.json", "utf8"));
}
