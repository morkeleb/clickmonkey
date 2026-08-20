import { Check, Copy, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ShotPreview } from "@/components/shot";
import { Button } from "@/components/ui/button";
import { copyReportToClipboard } from "@/lib/report-clipboard";
import { renderReportHtml } from "@/lib/markdown";
import { fetchFirstJson } from "@/lib/paths";
import { shotFromClick } from "@/lib/shot";

type ReportPayload = {
  id: string;
  title: string;
  generatedAt: string;
  runIds: string[];
  findingCount: number;
  markdown: string;
};

export function ReportMarkdown({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    setCopyState("idle");
    setPreview(null);
    void (async () => {
      try {
        const enc = encodeURIComponent(reportId);
        const data = await fetchFirstJson<ReportPayload>([`api/reports/${enc}`, `api/reports/${enc}.json`]);
        if (!cancelled) setReport(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "report failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const html = useMemo(() => (report?.markdown ? renderReportHtml(report.markdown) : ""), [report?.markdown]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{error}</div>
    );
  }
  if (!report) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading report…</div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-3 print:hidden">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{report.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {report.runIds.length > 0 ? report.runIds.join(", ") : "runs unknown"}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={copyState === "copying"}
          title="Copy report text and screenshots (paste into Grok)"
          onClick={() => {
            setCopyState("copying");
            void copyReportToClipboard(report.markdown)
              .then(() => {
                setCopyState("copied");
                window.setTimeout(() => setCopyState("idle"), 2000);
              })
              .catch(() => {
                setCopyState("failed");
                window.setTimeout(() => setCopyState("idle"), 2500);
              });
          }}
        >
          {copyState === "copied" ? <Check /> : <Copy />}
          {copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto print:h-auto print:overflow-visible">
        <article
          className="markdown mx-auto max-w-3xl px-8 py-8"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(event) => {
            const href = shotFromClick(event.target);
            if (!href) return;
            event.preventDefault();
            setPreview(href);
          }}
        />
      </div>
      <ShotPreview
        url={preview}
        alt="Report screenshot"
        description="From this report."
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </div>
  );
}
