import { type Browser, chromium } from "playwright-core";

/**
 * HTML → PDF with headless Chromium (the browser Playwright installs: `pnpm exec playwright
 * install chromium`). One browser per process, started on first use and reused; each document
 * gets its own short-lived page. Kept out of the main entry so only the worker loads Chromium.
 */
let browser: Promise<Browser> | null = null;

function launch(): Promise<Browser> {
  browser ??= chromium.launch({ headless: true }).catch((error: unknown) => {
    browser = null;
    throw error;
  });
  return browser;
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const b = await launch();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  const b = browser;
  browser = null;
  if (b) await (await b).close();
}
