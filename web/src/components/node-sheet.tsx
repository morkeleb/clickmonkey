import { ChevronDown } from "lucide-react";
import type { Page } from "@schema/page-model";
import type { QualityIssue, QualityPage, QualityRuntimeEvent } from "@schema/quality";
import type { TestabilityIssue, TestabilityPage } from "@schema/testability";
import type { UiGraphNode, UiRun, UiSnapshot } from "@schema/ui";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { runHue, sameLedgerPage } from "@/lib/utils";

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
        <li key={`${issue.code}-${issue.tag}-${i}`} className="rounded-md border border-border px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={issue.severity === "block" ? "destructive" : "secondary"}>{issue.severity}</Badge>
            <span className="font-medium">{issue.code}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {issue.tag}
            {issue.role ? ` · ${issue.role}` : ""}
            {issue.inputType ? ` · ${issue.inputType}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

function QualityGroup({
  title,
  items,
}: {
  title: string;
  items: Array<QualityIssue | QualityRuntimeEvent>;
}) {
  if (items.length === 0) return null;
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-sm font-medium">
        <ChevronDown className="size-3.5 text-muted-foreground" />
        {title}
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mb-3 flex flex-col gap-2">
          {items.map((issue, i) => (
            <li key={`${issue.source}-${issue.rule}-${i}`} className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity}</Badge>
                <code className="text-xs">{issue.rule}</code>
                {issue.count > 1 ? <span className="text-xs text-muted-foreground">×{issue.count}</span> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{issue.message}</p>
            </li>
          ))}
        </ul>
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

  return (
    <Sheet open={Boolean(node)} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{node?.label ?? "Node"}</SheetTitle>
          <SheetDescription>{node?.kind === "dialog" ? "Dialog surface" : "Page"}</SheetDescription>
        </SheetHeader>
        {node ? (
          <Tabs defaultValue="info" className="min-h-0 flex-1 gap-0">
            <div className="px-4 pt-3">
              <TabsList>
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="issues">Issues</TabsTrigger>
                <TabsTrigger value="runs">Runs</TabsTrigger>
              </TabsList>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="info" className="px-4 py-3">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Path</dt>
                  <dd className="font-mono text-xs break-all">{node.path}</dd>
                  <dt className="text-muted-foreground">Origin</dt>
                  <dd className="font-mono text-xs break-all">{node.origin ?? "—"}</dd>
                  <dt className="text-muted-foreground">Entry</dt>
                  <dd>{node.entry ? "yes" : "no"}</dd>
                  <dt className="text-muted-foreground">Surfaces</dt>
                  <dd>{counts.surfaces}</dd>
                  <dt className="text-muted-foreground">Widgets</dt>
                  <dd>
                    {counts.widgets}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({counts.fields} fields, {counts.actions} actions)
                    </span>
                  </dd>
                </dl>
              </TabsContent>
              <TabsContent value="issues" className="px-4 py-3">
                <h3 className="mb-2 text-sm font-medium">Testability</h3>
                <IssueList issues={ledger.testability?.issues ?? []} />
                <Separator className="my-4" />
                <h3 className="mb-2 text-sm font-medium">Quality</h3>
                {ledger.quality ? (
                  <div>
                    <QualityGroup title="HTML" items={ledger.quality.html} />
                    <QualityGroup title="Accessibility" items={ledger.quality.a11y} />
                    <QualityGroup title="Runtime" items={ledger.quality.runtime} />
                    {ledger.quality.html.length + ledger.quality.a11y.length + ledger.quality.runtime.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No quality issues.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No quality issues.</p>
                )}
              </TabsContent>
              <TabsContent value="runs" className="px-4 py-3">
                <p className="mb-2 text-xs text-muted-foreground">Live runs on this node</p>
                {here && here.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {here.map((run: UiRun) => (
                      <li key={run.id} className="flex items-center gap-2 text-sm">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: runHue(run.hue) }} />
                        <span className="font-medium">{run.name}</span>
                        <span className="text-xs text-muted-foreground">{run.brain ?? run.id}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nobody is here.</p>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
