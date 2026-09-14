import { mkdir } from "node:fs/promises";
import path from "node:path";

export class BrowserExecutor {
  constructor({ browserFactory, artifactRoot = path.resolve(".workbench", "artifacts") } = {}) { this.browserFactory = browserFactory; this.artifactRoot = artifactRoot; }

  async run({ taskId, url, actions = [], verify }) {
    if (!this.browserFactory) throw new Error("browser_factory_required");
    const dir = path.join(this.artifactRoot, taskId); await mkdir(dir, { recursive: true });
    const browser = await this.browserFactory(); const page = await browser.newPage(); const log = [];
    try {
      await page.goto(url);
      for (const action of actions) {
        if (action.type === "click") await page.click(action.selector);
        else if (action.type === "fill") await page.fill(action.selector, action.value ?? "");
        else if (action.type === "press") await page.press(action.selector, action.key);
        else throw new Error(`unsupported_browser_action:${action.type}`);
        log.push({ action: action.type, selector: action.selector, ok: true });
      }
      const verified = verify ? await verify(page) : true; const screenshotPath = path.join(dir, "final.png");
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { status: verified ? "completed" : "failed", screenshotPath, log, evidence: [{ kind: "screenshot", path: screenshotPath }, { kind: "browser_log", content: log }, { kind: "verification", content: { passed: verified } }] };
    } catch (error) { log.push({ error: String(error) }); return { status: "failed", log, blockers: [String(error)], evidence: [{ kind: "browser_log", content: log }] }; }
    finally { await browser.close(); }
  }
}

