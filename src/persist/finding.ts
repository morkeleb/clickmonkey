import { appendFileSync, copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cannedReport } from "../reports/canned.js";
import { severityForKind, type Finding } from "../schema/finding.js";

export function writeFinding(path: string, finding: Finding): void {
  writeFileSync(path, `${JSON.stringify(finding, null, 2)}\n`, "utf8");
}

export function persistFinding(
  outDir: string,
  finding: Finding,
  opts?: { screenshotPath?: string; replayLog?: string },
): void {
  const dir = join(outDir, "findings", finding.id);
  mkdirSync(dir, { recursive: true });

  const src = opts?.screenshotPath ?? finding.screenshotPath;
  if (src && existsSync(src)) {
    const dest = join(dir, "screenshot.png");
    if (resolve(src) !== resolve(dest)) {
      copyFileSync(src, dest);
      const findingsRoot = resolve(outDir, "findings");
      const fromFindings = relative(findingsRoot, resolve(src));
      if (fromFindings === "" || fromFindings.startsWith("..") || isAbsolute(fromFindings)) {
        try {
          unlinkSync(src);
        } catch {
          // leave the source if it cannot be moved
        }
      }
    }
    finding.screenshotPath = dest;
  } else {
    delete finding.screenshotPath;
  }

  if (opts?.replayLog !== undefined) {
    const replayPath = join(dir, "replay.log");
    writeFileSync(replayPath, opts.replayLog, "utf8");
    finding.tapePath = replayPath;
  }

  finding.severity ??= severityForKind(finding.kind);

  writeFinding(join(dir, "finding.json"), finding);
  writeFileSync(join(dir, "report.md"), cannedReport(finding), "utf8");
}

export function appendFindingReport(outDir: string, findingId: string, extraMarkdown: string): void {
  const path = join(outDir, "findings", findingId, "report.md");
  const extra = extraMarkdown.trim();
  if (!extra || !existsSync(path)) return;
  appendFileSync(path, extra.endsWith("\n") ? `\n${extra}` : `\n${extra}\n`, "utf8");
}
