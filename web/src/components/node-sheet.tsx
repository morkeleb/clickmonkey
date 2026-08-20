import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Page } from "@schema/page-model";
import type { QualityIssue, QualityPage, QualityRuntimeEvent } from "@schema/quality";
import type { TestabilityIssue, TestabilityPage } from "@schema/testability";
import type { UiGraphNode, UiRun, UiSnapshot } from "@schema/ui";
import { Shot, ShotPreview } from "@/components/shot";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { runHue, sameLedgerPage } from "@/lib/utils";

function InfoStat({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-lg border border-border bg-card px-3 py-2 ${wide ? "col-span-2" : ""}`}>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 min-w-0 text-sm break-words">{children}</div>
    </div>
  );
}

function findPage(snapshot: UiSnapshot, pageId: string): Page | undefined {
  return snapshot.map.pages.find((page) => page.id === pageId);
}

function ledgerFor(snapshot: UiSnapshot, node: UiGraphNode): {
  testability?: TestabilityPage;
  quality?: QualityPage;
} {
  const key = { path: node.path, origin: node.origin };
  return {
    testability: snapshot.testability.pages.find((page) => sameLedgerPage(page, key)),
    quality: snapshot.quality.pages.find((page) => sameLedgerPage(page, key)),
  };
}

function widgetCounts(page: Page | undefined, node: UiGraphNode) {
  if (!page) return { surfaces: 0, fields: 0, actions: 0, widgets: 0 };
  const surfaces =
    node.kind === "dialog" ? page.surfaces.filter((s) => s.id === node.label || `${page.id}::${s.id}` === node.id) : page.surfaces;
  const fields = surfaces.reduce((n, s) => n + s.fields.length, 0);
  const actions = surfaces.reduce((n, s) => n + s.actions.length, 0);
  return { surfaces: surfaces.length, fields, actions, widgets: fields + actions };
}

function IssueList({ issues }: { issues: TestabilityIssue[] }) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">No testability issues.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${issue.tag}-${i}`} className="min-w-0 rounded-md border border-border px-3 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={issue.severity === "block" ? "destructive" : "secondary"}>{issue.severity}</Badge>
            <span className="min-w-0 truncate font-medium">{issue.code}</span>
          </div>
          <div className="mt-1 text-xs break-words text-muted-foreground">
            {issue.tag}
            {issue.role ? ` · ${issue.role}` : ""}
            {issue.inputType ? ` · ${issue.inputType}` : ""}
          </div>
          {issue.where ? (
            <p className="mt-0.5 text-[11px] break-all text-muted-foreground">Where: {issue.where}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function QualityGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<QualityIssue | QualityRuntimeEvent>;
  empty?: string;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-sm font-medium">
        <ChevronDown className="size-3.5 text-muted-foreground" />
        {title}
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {items.length > 0 ? (
          <ul className="mb-3 flex flex-col gap-2">
            {items.map((issue, i) => (
              <li key={`${issue.source}-${issue.rule}-${i}`} className="min-w-0 rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity}</Badge>
                  <code className="max-w-full text-xs break-all">{issue.rule}</code>
                  {"confidence" in issue && issue.confidence ? (
                    <span className="text-xs text-muted-foreground">{issue.confidence}</span>
                  ) : null}
                  {issue.count > 1 ? <span className="text-xs text-muted-foreground">×{issue.count}</span> : null}
                </div>
                <p className="mt-1 text-xs break-words text-muted-foreground">{issue.message}</p>
                {"where" in issue && issue.where ? (
                  <p className="mt-0.5 text-[11px] break-all text-muted-foreground">Where: {issue.where}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">{empty}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NodeSheet({
  snapshot,
  nodeId,
  onOpenChange,
}: {
  snapshot: UiSnapshot;
  nodeId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const node = snapshot.graph.nodes.find((n) => n.id === nodeId);
  const page = node ? findPage(snapshot, node.pageId) : undefined;
  const ledger = node ? ledgerFor(snapshot, node) : {};
  const counts = node ? widgetCounts(page, node) : { surfaces: 0, fields: 0, actions: 0, widgets: 0 };
  const here =
    node &&
    snapshot.runs.filter((run) => run.live && run.pageId === node.id);
  const blurb = page?.description ?? node?.blurb;
  const describedBy = page?.describedBy ?? node?.describedBy;
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <Sheet
      open={Boolean(node)}
      onOpenChange={(open) => {
        if (!open) setPreview(null);
        onOpenChange(open);
      }}
    >
      <SheetContent className="w-full min-w-0 gap-0 overflow-hidden p-0">
        <SheetHeader className="min-w-0 shrink-0 border-b border-border">
          <SheetTitle>{node?.label ?? "Node"}</SheetTitle>
          <SheetDescription>
            {node?.kind === "dialog" ? "Dialog surface" : "Page"}
            {page?.id ? ` · ${page.id}` : ""}
          </SheetDescription>
          {blurb ? (
            <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-left">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[10px] tracking-wide text-zinc-500 uppercase">Description</span>
                {describedBy ? (
                  <Badge variant={describedBy === "inspect" ? "secondary" : "default"}>{describedBy}</Badge>
                ) : null}
              </div>
              <p className="text-sm leading-5 break-words text-zinc-100">{blurb}</p>
            </div>
          ) : node?.kind === "page" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No page description yet. Inspect writes a mechanical line; explore may polish it.
            </p>
          ) : null}
          {node?.screenshotUrl ? (
            <Shot
              url={node.screenshotUrl}
              alt={`Latest screenshot of ${node.label}`}
              onOpen={setPreview}
              className="mt-3"
              imgClassName="max-h-48"
            />
          ) : node?.kind === "page" ? (
            <p className="mt-2 text-xs text-muted-foreground">No screenshot of this page yet. Walk it with screenshots on.</p>
          ) : null}
        </SheetHeader>
        {node ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="flex min-w-0 flex-col gap-5 px-4 py-3">
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <InfoStat label="Path" wide>
                  <span className="font-mono text-xs break-all">{node.path}</span>
                </InfoStat>
                <InfoStat label="Origin">
                  <span className="font-mono text-xs break-all">{node.origin ?? "—"}</span>
                </InfoStat>
                <InfoStat label="Entry">{node.entry ? "yes" : "no"}</InfoStat>
                <InfoStat label="Surfaces">{counts.surfaces}</InfoStat>
                <InfoStat label="Widgets">
                  <div>{counts.widgets}</div>
                  <div className="text-xs text-muted-foreground">
                    {counts.fields} fields, {counts.actions} actions
                  </div>
                </InfoStat>
              </div>
              <section>
                <h3 className="mb-2 text-sm font-medium">Testability</h3>
                <IssueList issues={ledger.testability?.issues ?? []} />
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Quality</h3>
                {ledger.quality ? (
                  <div>
                    <QualityGroup title="HTML" items={ledger.quality.html} />
                    <QualityGroup title="Accessibility" items={ledger.quality.a11y} />
                    <QualityGroup title="SEO" items={ledger.quality.seo ?? []} />
                    <QualityGroup
                      title="Visual"
                      items={ledger.quality.visual}
                      empty={ledger.quality.visualHash ? "Scanned, no extras." : undefined}
                    />
                    <QualityGroup title="Runtime" items={ledger.quality.runtime} />
                    {ledger.quality.html.length +
                      ledger.quality.a11y.length +
                      (ledger.quality.seo ?? []).length +
                      ledger.quality.visual.length +
                      ledger.quality.runtime.length ===
                      0 && !ledger.quality.visualHash ? (
                      <p className="text-sm text-muted-foreground">No quality issues.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No quality issues.</p>
                )}
              </section>
              {here && here.length > 0 ? (
                <InfoStat label="Here now">
                  <ul className="flex min-w-0 flex-col gap-1">
                    {here.map((run: UiRun) => (
                      <li key={run.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: runHue(run.hue) }} />
                        <span className="min-w-0 truncate font-medium">{run.name}</span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">{run.brain ?? run.id}</span>
                      </li>
                    ))}
                  </ul>
                </InfoStat>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
      <ShotPreview
        url={preview}
        alt={node ? `Latest screenshot of ${node.label}` : "Screenshot"}
        description="Latest screenshot of this page."
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </Sheet>
  );
}
