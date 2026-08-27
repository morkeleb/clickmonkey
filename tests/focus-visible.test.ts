import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { persistVisualIssueFindings } from "../src/persist/finding.js";
import { findingId } from "../src/schema/finding.js";
import { refocusWhereForClip, scanFocusVisible } from "../src/surveyor/focus-visible.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/focus-visible/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanFocusVisible", () => {
  it("flags a control with no focus ring, not one with a :focus-visible outline", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(`(() => {
        window.__focused = [];
        var orig = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function () {
          window.__focused.push(this.id);
          return orig.apply(this, arguments);
        };
      })()`);
      const yBefore = await page.evaluate(() => window.scrollY);
      const { issues, clips } = await scanFocusVisible(page);
      const focused = (await page.evaluate("window.__focused || []")) as string[];
      assert.ok(focused.includes("bare"), `bare must be focused, got ${JSON.stringify(focused)}`);
      assert.ok(focused.includes("ok"), `ok must be focused, got ${JSON.stringify(focused)}`);
      assert.equal(focused.includes("skip"), false, `skip-link must not be focused, got ${JSON.stringify(focused)}`);
      assert.equal(
        focused.includes("disabled-bare"),
        false,
        `disabled must not be focused, got ${JSON.stringify(focused)}`,
      );
      assert.equal(focused.includes("agree"), false, `native checkbox must not be focused, got ${JSON.stringify(focused)}`);
      assert.equal(await page.evaluate(() => window.scrollY), yBefore);

      const hits = issues.filter((i) => i.rule === "focusVisible");
      const dump = blob(hits);

      const save = hits.find((i) => /Save/.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(save, `expected Save with no focus ring, got ${dump}`);
      assert.equal(save.source, "visual");
      assert.equal(save.severity, "warning");
      assert.equal(save.confidence, "high");
      assert.equal(save.count, 1);
      assert.equal(save.via, undefined);
      assert.match(save.message, /Save has no visible focus indicator \(WCAG 2\.4\.7\)/);
      const saveClip = clips.find((c) => c.where === save.where);
      assert.ok(saveClip, `expected a focused clip for Save, got ${JSON.stringify(clips)}`);
      assert.ok(saveClip.clip.x >= 0 && saveClip.clip.y >= 0);
      assert.ok(saveClip.clip.width >= 1 && saveClip.clip.height >= 1);
      assert.ok(saveClip.clip.width <= 1280 && saveClip.clip.height <= 720);

      assert.equal(
        hits.some((i) => /Continue/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `Continue keeps a 2px outline on :focus-visible, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Off|agree|Skip|disabled-bare/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `disabled, native checkbox, and skip-links must be skipped, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /username|Email/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `:focus-within wrapper ring must count, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /js-ring|Ask LOIS/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `JS Tab+focus ring (MUI-style) must count, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /search-lois|Talk to LOIS/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `MUI notched-outline sibling ring must count, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /underline-name|placeholder="Name"|Name has no/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `MUI underline ::after ring must count, got ${dump}`,
      );
    });
  });

  it("files a focusVisible finding with a focused clip, not the full page", async () => {
    await withPage(html, async (page) => {
      const { issues, clips } = await scanFocusVisible(page);
      const save = issues.find((i) => /Save/.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(save);
      assert.ok(save.where);
      const item = clips.find((c) => c.where === save.where);
      assert.ok(item);
      const live = await refocusWhereForClip(page, item.where);
      const clip = live ?? item.clip;
      const outDir = mkdtempSync(join(tmpdir(), "cm-fv-clip-"));
      const clipPath = join(outDir, "focus-clip.png");
      const pagePath = join(outDir, "page.png");
      await page.screenshot({ path: clipPath, clip });
      await page.screenshot({ path: pagePath, fullPage: true });
      const clipPng = readFileSync(clipPath);
      const pagePng = readFileSync(pagePath);
      const clipW = clipPng.readUInt32BE(16);
      const clipH = clipPng.readUInt32BE(20);
      const pageW = pagePng.readUInt32BE(16);
      const pageH = pagePng.readUInt32BE(20);
      assert.ok(clipW < pageW || clipH < pageH, `clip ${clipW}x${clipH} vs page ${pageW}x${pageH}`);
      assert.ok(clipW > 8 && clipH > 8);
      const written = persistVisualIssueFindings(outDir, [save], {
        stepIndex: 1,
        screenshotPath: pagePath,
        issueScreenshots: [{ where: save.where!, screenshotPath: clipPath }],
        tapePath: join(outDir, "replay.log"),
      });
      assert.equal(written.length, 1);
      const shot = readFileSync(join(outDir, "findings", findingId(1, "visualIssue"), "screenshot.png"));
      assert.equal(shot.readUInt32BE(16), clipW);
      assert.equal(shot.readUInt32BE(20), clipH);
    });
  });
});
