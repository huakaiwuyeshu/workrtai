export async function createPlaywrightBrowserFactory({ headless = true } = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless });
  return {
    newPage: (...args) => browser.newPage(...args),
    close: () => browser.close(),
  };
}
