import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { renderReportHtml } from "@/lib/markdown";
import { fetchFirstJson } from "@/lib/paths";

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

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
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
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto print:h-auto print:overflow-visible">
        <article className="markdown mx-auto max-w-3xl px-8 py-8" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
