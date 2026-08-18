export type MainView =
  | { kind: "map" }
  | { kind: "config" }
  | { kind: "run"; id: string }
  | { kind: "report" };

export function parseMain(raw: string | null): MainView {
  if (raw === "config") return { kind: "config" };
  if (raw === "report") return { kind: "report" };
  if (raw?.startsWith("run:")) {
    const id = raw.slice(4);
    if (id.length > 0) return { kind: "run", id };
  }
  return { kind: "map" };
}

export function serializeMain(view: MainView): string {
  return view.kind === "run" ? `run:${view.id}` : view.kind;
}

export function readMainFromLocation(search = window.location.search): MainView {
  return parseMain(new URLSearchParams(search).get("main"));
}

export function writeMainToLocation(view: MainView, mode: "push" | "replace" = "push"): void {
  const url = new URL(window.location.href);
  url.searchParams.set("main", serializeMain(view));
  const href = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}
