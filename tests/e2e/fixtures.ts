import { test as base, expect, type BrowserContext } from "@playwright/test";

export async function offline(context: BrowserContext) {
    // Required scenarios must work without tile/image/CDN Internet availability.
    await context.route(/https?:\/\/.*/, async (route) => {
      const url = new URL(route.request().url());
      if (["127.0.0.1", "localhost"].includes(url.hostname) && !url.pathname.startsWith("/map-tiles/")) {
        await route.continue();
      } else if (url.hostname === "tile.openstreetmap.org" || url.pathname.startsWith("/map-tiles/")) {
        await route.fulfill({ contentType: "image/png", body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
      } else {
        await route.abort();
      }
    });
}
export const test = base.extend({
  context: async ({ context }, use) => {
    await offline(context);
    await use(context);
  },
});
export { expect };
