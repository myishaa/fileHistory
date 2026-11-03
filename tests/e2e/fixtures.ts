import { expect, test as base, type Page } from "@playwright/test";

export { expect };
export type { Page };

/**
 * Keep API calls aligned with the backend started by playwright.config.ts.
 * PLAYWRIGHT_API_BASE_URL still wins when the backend is remote or uses a
 * non-standard host.
 */
export const PLAYWRIGHT_API_BASE_URL = (
  process.env.PLAYWRIGHT_API_BASE_URL ??
  `http://localhost:${Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000)}`
).replace(/\/$/, "");

/**
 * The application can show this prompt on every route.  It is useful in the
 * product, but it must not intercept unrelated E2E interactions.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(
      page.getByRole("dialog", { name: "Urgent reminders and messages" }),
      async (dialog) => {
        const close = dialog.getByRole("button", {
          name: "Close urgent reminders and messages",
        });
        if (await close.isVisible().catch(() => false)) await close.click();
      },
      { noWaitAfter: true },
    );
    await use(page);
  },
});
