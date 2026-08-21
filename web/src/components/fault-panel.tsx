import { Check, Copy, RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { UiFault, UiNotice } from "@schema/ui";
import { publicUrl } from "@/lib/paths";

function CopyBlock({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title="Copy this error to paste into chat"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setState("copied");
            window.setTimeout(() => setState("idle"), 2000);
          },
          () => {
            setState("failed");
            window.setTimeout(() => setState("idle"), 2500);
          },
        );
      }}
    >
      {state === "copied" ? <Check /> : <Copy />}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </Button>
  );
}

function noticeCopy(notice: UiNotice): string {
  return [notice.title, notice.message, notice.hint, notice.detail].filter(Boolean).join("\n\n");
}

async function waitForUi(): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((r) => window.setTimeout(r, 400));
    try {
      const res = await fetch(publicUrl("api/snapshot"), { cache: "no-store" });
      if (res.ok || res.status === 503) return true;
    } catch {
      /* still down */
    }
  }
  return false;
}

export function RestartUiButton() {
  const [state, setState] = useState<"idle" | "working" | "waiting" | "failed">("idle");
  return (
    <Button
      type="button"
      size="sm"
      title="Restart the clickmonkey ui process"
      disabled={state === "working" || state === "waiting"}
      onClick={() => {
        void (async () => {
          setState("working");
          try {
            await fetch(publicUrl("api/restart"), { method: "POST" });
          } catch {
            /* connection drop is expected once the process exits */
          }
          setState("waiting");
          const up = await waitForUi();
          if (up) {
            window.location.reload();
            return;
          }
          setState("failed");
        })();
      }}
    >
      <RotateCw />
      {state === "waiting" ? "Waiting…" : state === "failed" ? "Restart failed" : "Restart UI"}
    </Button>
  );
}

export function FaultPanel({ fault }: { fault: UiFault }) {
  return (
    <div className="mx-auto flex h-svh max-w-2xl flex-col justify-center gap-4 bg-background p-6 text-foreground">
      <div>
        <h1 className="text-lg font-semibold">{fault.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{fault.message}</p>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed">
        {fault.hint}
      </pre>
      {fault.detail ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 font-mono text-[11px] text-muted-foreground">
          {fault.detail}
        </pre>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <RestartUiButton />
        <CopyBlock text={fault.copy} />
      </div>
    </div>
  );
}

export function NoticeBanner({ notice }: { notice: UiNotice }) {
  const tone =
    notice.level === "error"
      ? "border-red-500/40 bg-red-950/40 text-red-100"
      : "border-amber-500/40 bg-amber-950/40 text-amber-100";
  return (
    <div className={`flex items-start gap-3 border-b px-4 py-2 text-sm ${tone}`}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{notice.title}</div>
        <div className="mt-0.5 text-xs opacity-90">{notice.message}</div>
        {notice.hint ? (
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] opacity-90">{notice.hint}</pre>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {notice.action === "restart" ? <RestartUiButton /> : null}
        <CopyBlock text={noticeCopy(notice)} />
      </div>
    </div>
  );
}
