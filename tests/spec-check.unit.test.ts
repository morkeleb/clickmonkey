import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig } from "../src/persist/config.js";
import { specsDir } from "../src/persist/workspace.js";
import { checkSpecFile, formatCheckReport, listSpecFiles } from "../src/playbooks/spec.js";
import { emptyConfig, requirePageModel } from "../src/schema/config.js";
import { PageModel } from "../src/schema/page-model.js";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function homeWithGo(): PageModel {
  return PageModel.parse({
    schemaVersion: 1,
    app: "fixture",
    generation: 0,
    pages: [
      {
        id: "home",
        path: "/",
        params: [],
        ready: { by: "testId", value: "home" },
        surfaces: [
          {
            id: "page",
            kind: "page",
            fields: [],
            actions: [{ id: "go", by: "testId", value: "go", status: "ok" }],
          },
        ],
      },
    ],
  });
}

function writeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "cm-spec-check-"));
  const configPath = join(dir, "clickmonkey.json");
  saveConfig(configPath, { ...emptyConfig("http://127.0.0.1:4173/", "fixture"), map: homeWithGo() });
  const specs = specsDir(configPath);
  mkdirSync(specs, { recursive: true });
  writeFileSync(
    join(specs, "ok.md"),
    `# Add customer requires a name

\`\`\`clickmonkey
open home
click page.go
\`\`\`
`,
  );
  writeFileSync(
    join(specs, "bad.md"),
    `# Login

\`\`\`clickmonkey
open home
click page.nope
\`\`\`
`,
  );
  return { dir, configPath, specs };
}

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
  });
}

describe("spec --check", () => {
  it("lists markdown under clickmonkey/specs and checks fence ids against the map", () => {
    const { configPath, specs } = writeWorkspace();
    const listed = listSpecFiles(configPath);
    assert.deepEqual(
      listed.map((f) => f.slice(specs.length + 1)),
      ["bad.md", "ok.md"],
    );
    assert.deepEqual(listSpecFiles(configPath, "ok.md"), [join(specs, "ok.md")]);

    const model = requirePageModel(loadConfig(configPath).map);
    const ok = checkSpecFile(model, join(specs, "ok.md"));
    assert.equal(ok.cases.length, 1);
    assert.equal(ok.cases[0]?.title, "Add customer requires a name");
    assert.deepEqual(ok.cases[0]?.missing, []);

    const bad = checkSpecFile(model, join(specs, "bad.md"));
    assert.equal(bad.cases[0]?.title, "Login");
    assert.deepEqual(bad.cases[0]?.missing, ["page.nope"]);

    const report = formatCheckReport([ok, bad]);
    assert.equal(
      report,
      "  OK   specs/ok.md  Add customer requires a name\n  MISS specs/bad.md  Login  missing: page.nope\n",
    );
  });

  it("clickmonkey spec --check exits 1 when a fence cites a missing id", () => {
    const { configPath } = writeWorkspace();
    const result = run(["spec", "--check", "--config", configPath]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OK\s+specs\/ok\.md/);
    assert.match(result.stdout, /MISS specs\/bad\.md  Login  missing: page\.nope/);
  });

  it("clickmonkey spec file.md --check exits 0 when every cited id is on the map", () => {
    const { configPath } = writeWorkspace();
    const result = run(["spec", "ok.md", "--check", "--config", configPath]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /OK\s+specs\/ok\.md  Add customer requires a name/);
    assert.doesNotMatch(result.stdout, /MISS/);
  });

  it("exits 2 with no spec files under clickmonkey/specs/", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-empty-"));
    const configPath = join(dir, "clickmonkey.json");
    saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
    const result = run(["spec", "--check", "--config", configPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no spec files under clickmonkey\/specs\//);
  });

  it("without --check exits 2 when no spec files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-empty-run-"));
    const configPath = join(dir, "clickmonkey.json");
    saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
    const result = run(["spec", "--config", configPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no spec files under clickmonkey\/specs\//);
  });

  it("without --check exits 2 when the map has no pages", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-nomap-"));
    const configPath = join(dir, "clickmonkey.json");
    saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
    mkdirSync(specsDir(configPath), { recursive: true });
    writeFileSync(
      join(specsDir(configPath), "ok.md"),
      "# Go\n\n```clickmonkey\nopen home\n```\n",
    );
    const result = run(["spec", "--config", configPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /map has no pages \(run inspect\)/);
  });

  it("without --check exits 2 when the spec file is missing", () => {
    const { configPath } = writeWorkspace();
    const result = run(["spec", "nope.md", "--config", configPath]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /spec not found: nope\.md/);
  });
});
