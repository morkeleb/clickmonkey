import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generatedTsPath } from "../persist/workspace.js";
import type { PageModelDraft } from "../schema/page-model.js";
import {
  type EmittedAction,
  type EmittedGraph,
  type EmittedPage,
  type EmittedSurface,
  claimIdent,
  isSafeMethodName,
  pagePropertyName,
  RESERVED_CLASS_NAMES,
  RESERVED_IDS,
  surfaceClassName,
  widgetMethodName,
} from "./graph.js";

function keepWidget(widget: { status?: string }): boolean {
  return widget.status !== "unresolved" && widget.status !== "drift";
}

function emittedAction(
  action: { id: string; opens?: string },
  surfaces: ReadonlyMap<string, { kind: "page" | "dialog" }>,
  pageIds: ReadonlySet<string>,
): EmittedAction {
  const out: EmittedAction = { id: action.id };
  const opens = action.opens;
  if (!opens) return out;
  const surface = surfaces.get(opens);
  if (surface) {
    out.opens = opens;
    out.opensKind = surface.kind;
    return out;
  }
  if (pageIds.has(opens)) {
    out.opens = opens;
    out.opensKind = "page";
  }
  return out;
}

export function graphFromModel(model: PageModelDraft, intro: readonly string[]): EmittedGraph {
  const pageIds = new Set(model.pages.map((page) => page.id));
  const pages: EmittedPage[] = [];
  for (const page of model.pages) {
    const surfaceById = new Map(page.surfaces.map((surface) => [surface.id, surface]));
    const surfaces: EmittedSurface[] = page.surfaces.map((surface) => ({
      id: surface.id,
      kind: surface.kind,
      fields: (surface.fields ?? [])
        .filter((field) => keepWidget(field))
        .map((field) => ({
          id: field.id,
          type: field.type,
          required: field.required === true,
        })),
      actions: (surface.actions ?? [])
        .filter((action) => keepWidget(action))
        .map((action) => emittedAction(action, surfaceById, pageIds)),
    }));
    const emitted: EmittedPage = {
      id: page.id,
      path: page.path,
      ...(page.entry === true ? { entry: true } : {}),
      surfaces,
    };
    pages.push(emitted);
  }
  return {
    app: model.app,
    intro: [...intro],
    pages,
  };
}

function pageClassName(page: EmittedPage): string {
  const surface = page.surfaces.find((s) => s.kind === "page") ?? { id: "page", kind: "page" as const };
  return surfaceClassName(page.id, surface);
}

function targetClassName(
  page: EmittedPage,
  action: EmittedAction,
  pages: readonly EmittedPage[],
): string | undefined {
  if (!action.opens || !action.opensKind) return undefined;
  if (action.opensKind === "dialog") {
    const surface = page.surfaces.find((s) => s.id === action.opens);
    if (!surface) return undefined;
    return surfaceClassName(page.id, surface);
  }
  const targetPage = pages.find((p) => p.id === action.opens);
  if (targetPage) return pageClassName(targetPage);
  const surface = page.surfaces.find((s) => s.id === action.opens);
  if (!surface) return undefined;
  return surfaceClassName(page.id, surface);
}

function appPropertyMap(pages: readonly EmittedPage[]): Map<string, { prop: string; cls: string }> {
  const used = new Set<string>(["findings", "ledger", "close", "runtime", ...RESERVED_IDS]);
  const out = new Map<string, { prop: string; cls: string }>();
  for (const page of pages) {
    out.set(page.id, {
      prop: claimIdent(pagePropertyName(page.id), used),
      cls: pageClassName(page),
    });
  }
  return out;
}

function emitAppClass(pages: readonly EmittedPage[]): string {
  const props = appPropertyMap(pages);
  const lines: string[] = ["export class App {"];
  for (const page of pages) {
    const entry = props.get(page.id)!;
    lines.push(`  readonly ${entry.prop}: ${entry.cls};`);
  }
  lines.push("  constructor(readonly runtime: SessionRuntime) {");
  for (const page of pages) {
    const entry = props.get(page.id)!;
    lines.push(`    this.${entry.prop} = new ${entry.cls}(runtime);`);
  }
  lines.push("  }");
  lines.push("  get findings() {");
  lines.push("    return this.runtime.findings;");
  lines.push("  }");
  lines.push("  get ledger() {");
  lines.push("    return this.runtime.ledger;");
  lines.push("  }");
  lines.push("  close() {");
  lines.push("    return this.runtime.close();");
  lines.push("  }");
  lines.push("  async [Symbol.asyncDispose]() {");
  lines.push("    await this.close();");
  lines.push("  }");
  lines.push("}");
  return lines.join("\n");
}

function emitSurfaceClass(page: EmittedPage, surface: EmittedSurface, pages: readonly EmittedPage[]): string {
  const className = surfaceClassName(page.id, surface);
  const lines: string[] = [`export class ${className} extends SurfaceChain {`];
  lines.push(`  readonly pageId = ${JSON.stringify(page.id)};`);
  lines.push(`  readonly surfaceId = ${JSON.stringify(surface.id)};`);
  lines.push("  constructor(runtime: SessionRuntime) {");
  lines.push("    super(runtime);");
  lines.push("  }");
  const methods = new Set<string>(RESERVED_IDS);
  if (surface.fields.length > 0) {
    methods.add("fill");
    const shape = surface.fields
      .map((field) => `${isSafeMethodName(field.id) ? field.id : JSON.stringify(field.id)}?: string`)
      .join("; ");
    lines.push(`  fill(fields: { ${shape} }): this {`);
    lines.push("    return this.fillFields(this.surfaceId, fields);");
    lines.push("  }");
  }
  for (const action of surface.actions) {
    const target = targetClassName(page, action, pages);
    const method = claimIdent(widgetMethodName(action.id), methods);
    const surfaceLit = JSON.stringify(surface.id);
    const actionLit = JSON.stringify(action.id);
    if (target) {
      lines.push(`  ${method}(): ${target} {`);
      lines.push(`    return this.clickAction(${surfaceLit}, ${actionLit}, ${target});`);
      lines.push("  }");
    } else {
      lines.push(`  ${method}(): this {`);
      lines.push(`    return this.clickAction(${surfaceLit}, ${actionLit});`);
      lines.push("  }");
    }
  }
  lines.push("}");
  return lines.join("\n");
}

function assertUniqueClassNames(pages: readonly EmittedPage[]): void {
  const used = new Set(RESERVED_CLASS_NAMES);
  for (const page of pages) {
    for (const surface of page.surfaces) {
      const name = surfaceClassName(page.id, surface);
      if (used.has(name)) {
        throw new Error(`emit class name collision: ${name} (page ${page.id}, surface ${surface.id})`);
      }
      used.add(name);
    }
    pagePropertyName(page.id);
  }
}

export function emitTs(
  model: PageModelDraft,
  intro: readonly string[],
  opts?: { importFrom?: string },
): string {
  const graph = graphFromModel(model, intro);
  assertUniqueClassNames(graph.pages);
  const importFrom = opts?.importFrom ?? "clickmonkey";
  const parts: string[] = [
    "/** Generated by `clickmonkey emit`. Do not edit. */",
    "",
    `import { createSession, SurfaceChain, type SessionOpts, type SessionRuntime } from ${JSON.stringify(importFrom)};`,
    "",
    `export const graph = ${JSON.stringify(graph, null, 2)} as const;`,
    "",
    "export async function session(opts?: SessionOpts) {",
    '  const runtime = await createSession({ ...opts, brain: "test" });',
    "  return new App(runtime);",
    "}",
    "",
    emitAppClass(graph.pages),
  ];
  for (const page of graph.pages) {
    for (const surface of page.surfaces) {
      parts.push("", emitSurfaceClass(page, surface, graph.pages));
    }
  }
  return `${parts.join("\n")}\n`;
}

export function writeGeneratedTs(configPath: string, model: PageModelDraft, intro: readonly string[]): string {
  const outPath = generatedTsPath(configPath);
  mkdirSync(dirname(outPath), { recursive: true });
  const source = emitTs(model, intro);
  writeFileSync(outPath, source.endsWith("\n") ? source : `${source}\n`, "utf8");
  return outPath;
}
