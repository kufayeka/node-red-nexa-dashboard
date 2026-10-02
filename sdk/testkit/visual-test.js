// sdk/testkit/visual-test.js
// ------------------------------------------------------------
// Visual regression test using CDP + pixelmatch
// ------------------------------------------------------------
import { launchChrome } from "./cdp.js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Run a visual regression test for a given URL / selector.
 *
 * @param {Object} opts
 * @param {string} opts.url           URL to navigate to (e.g. http://localhost:1880)
 * @param {string} [opts.selector]    CSS selector to wait for before screenshot (default: "body")
 * @param {string} opts.name          Unique name for the test (used for baseline and diff filenames)
 * @param {number} [opts.threshold]   Pixel‑match threshold (default 0.01 = 1% diff)
 */
export async function runVisualTest({ url, selector = "body", name, threshold = 0.01 }) {
  const { client, page } = await launchChrome({ headless: true });
  try {
    // 1️⃣ Navigate
    await page.navigate({ url });
    await page.waitForLoadEventFired();

    // 2️⃣ Optional wait for selector
    if (selector) {
      await page.waitForSelector({ selector });
    }

    // 3️⃣ Capture screenshot (PNG, base64)
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const screenshot = Buffer.from(data, "base64");
    const outPath = join(__dirname, `${name}.png`);
    writeFileSync(outPath, screenshot);

    // 4️⃣ Load baseline (if exists)
    const baselinePath = join(__dirname, "baseline", `${name}.png`);
    if (!existsSync(baselinePath)) {
      console.log(`[INFO] Baseline not found – creating at ${baselinePath}`);
      writeFileSync(baselinePath, screenshot);
      return { status: "new-baseline" };
    }

    // 5️⃣ Diff comparison
    const img = PNG.sync.read(screenshot);
    const base = PNG.sync.read(readFileSync(baselinePath));
    const { width, height } = img;
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(
      img.data,
      base.data,
      diff.data,
      width,
      height,
      { threshold }
    );
    const diffPath = join(__dirname, `${name}-diff.png`);
    writeFileSync(diffPath, PNG.sync.write(diff));
    const diffRatio = diffPixels / (width * height);
    const passed = diffRatio <= threshold;
    return {
      status: passed ? "passed" : "failed",
      diffPixels,
      diffRatio,
      screenshot: outPath,
      baseline: baselinePath,
      diff: diffPath,
    };
  } finally {
    await client.close();
    await page.close();
  }
}

// -----------------------------------------------------------------
// CLI entry point – allows running: node visual-test.js <url> <test-name>
// -----------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const [url, name] = args;
  if (!url || !name) {
    console.error("Usage: node visual-test.js <url> <test-name>");
    process.exit(1);
  }
  runVisualTest({ url, name })
    .then((res) => console.log(JSON.stringify(res, null, 2)))
    .catch(console.error);
}
