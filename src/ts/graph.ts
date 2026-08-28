/**
 * Snapshot `clickmonkey emit` writes. Runtime locators come from the live map;
 * the chain sends these ids to the executor. `opens` is a page id or a surface
 * id on the same page.
 */
export type EmittedField = {
  id: string;
  type: string;
  required: boolean;
};

export type EmittedAction = {
  id: string;
  opens?: string;
  opensKind?: "page" | "dialog";
};

export type EmittedSurface = {
  id: string;
  kind: "page" | "dialog";
  fields: EmittedField[];
  actions: EmittedAction[];
};

export type EmittedPage = {
  id: string;
  path: string;
  entry?: boolean;
  surfaces: EmittedSurface[];
};

export type EmittedGraph = {
  app: string;
  intro: string[];
  pages: EmittedPage[];
};

/** JS/TS names we must not emit as methods (thenable + chain API). */
export const RESERVED_IDS = new Set([
  "then",
  "catch",
  "finally",
  "fill",
  "open",
  "close",
  "findings",
  "ledger",
  "expect",
  "runtime",
  "constructor",
  "valueOf",
  "toJSON",
  "toString",
  "session",
  "graph",
  "pageId",
  "surfaceId",
  "expectInvalid",
  "expectVisible",
  "expectHidden",
  "expectText",
  "expectValue",
  "expectPath",
  "expectPageText",
  "fillFields",
  "clickAction",
  "flush",
  "runQueued",
  "requireSurface",
  "queue",
  "landPageId",
  "inflight",
]);

const TS_KEYWORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "await",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
]);

export function isSafeMethodName(id: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return false;
  if (RESERVED_IDS.has(id)) return false;
  if (TS_KEYWORDS.has(id)) return false;
  return true;
}

export function pascalCase(id: string): string {
  return id.replace(/(^[a-z])|_+([a-z])/gi, (_, a: string, b?: string) => (b ? b : a).toUpperCase());
}

/** Facade + imports that page/dialog classes must not reuse. */
export const RESERVED_CLASS_NAMES = new Set([
  "App",
  "SurfaceChain",
  "SessionRuntime",
  "SessionOpts",
  "FlushResult",
  "SessionStepError",
]);

/** Page classes always end in `Page` so `app` cannot collide with the facade `App`. */
export function surfaceClassName(pageId: string, surface: { id: string; kind: string }): string {
  if (surface.kind === "page") return `${pascalCase(pageId)}Page`;
  return `${pascalCase(pageId)}${pascalCase(surface.id)}`;
}

export function pagePropertyName(id: string): string {
  if (isSafeMethodName(id)) return id;
  const mangled = `${id}Page`;
  if (isSafeMethodName(mangled)) return mangled;
  throw new Error(`cannot emit page id ${JSON.stringify(id)} as a TypeScript property`);
}

export function widgetMethodName(id: string): string {
  if (isSafeMethodName(id)) return id;
  const mangled = `${id}Action`;
  if (isSafeMethodName(mangled)) return mangled;
  throw new Error(`cannot emit widget id ${JSON.stringify(id)} as a TypeScript method`);
}

export function claimIdent(preferred: string, used: Set<string>): string {
  let name = preferred;
  for (let n = 2; n < 1000; n++) {
    if (!used.has(name) && isSafeMethodName(name)) {
      used.add(name);
      return name;
    }
    name = `${preferred}${n}`;
  }
  throw new Error(`cannot emit unique ident from ${JSON.stringify(preferred)}`);
}
