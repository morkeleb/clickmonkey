import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { renderReportHtml } from "@/lib/markdown";

export function ReportMarkdown({ markdown }: { markdown: string | undefined }) {
  const html = useMemo(() => (markdown ? renderReportHtml(markdown) : ""), [markdown]);

  if (!markdown) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No findings report in this snapshot.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <article className="markdown mx-auto max-w-3xl px-8 py-8" dangerouslySetInnerHTML={{ __html: html }} />
    </ScrollArea>
  );
}
