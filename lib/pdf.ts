import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Standard @sparticuz/chromium + puppeteer-core pattern for serverless —
// full puppeteer bundles its own Chromium build that isn't compatible with
// Vercel's runtime, hence puppeteer-core (no bundled browser) paired with
// this pre-optimized binary. Couldn't test this in the sandbox (no
// headless Chrome environment there either) — this is the first genuinely
// untested piece of the pipeline, more likely than most steps to need a
// live fix-up round.
//
// headless: "shell" (not `true`) is required — this package's binary is
// specifically headless_shell, which per its own docs doesn't support
// Chrome's "new" headless mode that `true` would otherwise select. args
// goes through puppeteer.defaultArgs() rather than passing chromium.args
// directly, matching the package's own documented usage — this merges in
// Puppeteer's own required defaults alongside the serverless-tuned flags.
export async function renderPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });

  try {
    const page = await browser.newPage();
    // The document is fully self-contained (inline CSS, no images/fonts
    // fetched over the network), so there's nothing to wait for beyond
    // 'load' — setContent's type doesn't accept networkidle0/2 anyway.
    await page.setContent(html, { waitUntil: "load" });
    const pdfBytes = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    return Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}
