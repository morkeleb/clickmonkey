import { ChevronDown } from "lucide-react";
import { type ReactNode } from "react";
import type { Page } from "@schema/page-model";
import type { QualityIssue, QualityPage, QualityRuntimeEvent } from "@schema/quality";
import type { TestabilityIssue, TestabilityPage } from "@schema/testability";
import { monkeyOfBrain } from "@schema/fog";
import { DOCS_MAP } from "@schema/site";
import type { UiGraphNode, UiMapFinding, UiRun, UiSnapshot } from "@schema/ui";
import { checkOf } from "../../../src/reports/check.ts";
import {
  chapterOf,
  splitOverflowByViewport,
  type ChapterExtras,
  type OverflowViewport,
  type ReportChapter,
} from "../../../src/reports/wcag.ts";
import { Shot } from "@/components/shot";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { prettyIdent, prettyLeadingIdent } from "@ui/graph-labels";
import { FOG_JOBS, fogHeatColor, landAgeLabel } from "@/lib/fog";
import { runHue, sameLedgerPage } from "@/lib/utils";

type LedgerKey = { path: string; origin?: string };

function WhyItMatters({ rule, extras }: { rule: string; extras?: ChapterExtras }) {
  const check = checkOf(rule, extras);
  if (!check) return null;
  return <p className="mt-1 text-xs break-words text-muted-foreground">Why it matters: {check.why}</p>;
}

function alsoOnOtherPages(n: number): string | undefined {
  if (n <= 0) return undefined;
  return n === 1 ? "also on 1 other page" : `also on ${n} other pages`;
}

function otherPagesWithTestabilityCode(pages: TestabilityPage[], current: LedgerKey, code: string): number {
  return pages.filter((page) => !sameLedgerPage(page, current) && page.issues.some((issue) => issue.code === code))
    .length;
}

function qualityPageHasRule(page: QualityPage, rule: string): boolean {
  return (
    page.html.some((issue) => issue.rule === rule) ||
    page.a11y.some((issue) => issue.rule === rule) ||
    (page.seo ?? []).some((issue) => issue.rule === rule) ||
    page.visual.some((issue) => issue.rule === rule) ||
    page.runtime.some((issue) => issue.rule === rule)
  );
}

function otherPagesWithQualityRule(pages: QualityPage[], current: LedgerKey, rule: string): number {
  return pages.filter((page) => !sameLedgerPage(page, current) && qualityPageHasRule(page, rule)).length;
}

function chapterExtras(
  issue: QualityIssue,
  extras?: { where?: string; viewport?: OverflowViewport },
): ChapterExtras {
  return {
    message: issue.message,
    where: extras?.where ?? issue.where,
    source: issue.source,
    viewport: extras?.viewport,
  };
}

function issueChapter(rule: string, extras: ChapterExtras): ReportChapter {
  return checkOf(rule, extras)?.chapter ?? chapterOf(rule, extras);
}

/** Same Check split as the report: axe + WCAG-mapped DOM (incl. 320 overflow) vs leftover layout. */
function chapterIssues(issues: QualityIssue[], chapter: ReportChapter): QualityIssue[] {
  const out: QualityIssue[] = [];
  for (const issue of issues) {
    if (issue.rule === "overflow") {
      for (const seg of splitOverflowByViewport(issue.where, issue.message)) {
        if (issueChapter(issue.rule, chapterExtras(issue, seg)) !== chapter) continue;
        out.push(seg.where ? { ...issue, where: seg.where } : issue);
      }
      continue;
    }
    if (issueChapter(issue.rule, chapterExtras(issue)) === chapter) out.push(issue);
  }
  return out;
}

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

function IssueList({
  issues,
  pages,
  current,
}: {
  issues: TestabilityIssue[];
  pages: TestabilityPage[];
  current: LedgerKey;
}) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">No testability issues.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue, i) => {
        const alsoOn = alsoOnOtherPages(otherPagesWithTestabilityCode(pages, current, issue.code));
        return (
          <li key={`${issue.code}-${issue.tag}-${i}`} className="min-w-0 rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={issue.severity === "block" ? "destructive" : "secondary"}>{issue.severity}</Badge>
              <span className="min-w-0 truncate font-medium" title={issue.code}>
                {prettyIdent(issue.code)}
              </span>
              {alsoOn ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{alsoOn}</span> : null}
            </div>
            <div className="mt-1 text-xs break-words text-muted-foreground">
              {issue.tag}
              {issue.role ? ` · ${issue.role}` : ""}
              {issue.inputType ? ` · ${issue.inputType}` : ""}
            </div>
            <WhyItMatters
              rule={issue.code}
              extras={{
                source: "testability",
                message: issue.tag,
                ...(issue.where ? { where: issue.where } : {}),
              }}
            />
            {issue.where ? (
              <p className="mt-0.5 text-[11px] break-all text-muted-foreground">Where: {issue.where}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function QualityIssueCards({
  items,
  pages,
  current,
}: {
  items: Array<QualityIssue | QualityRuntimeEvent>;
  pages: QualityPage[];
  current: LedgerKey;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((issue, i) => {
        const alsoOn = alsoOnOtherPages(otherPagesWithQualityRule(pages, current, issue.rule));
        return (
          <li key={`${issue.source}-${issue.rule}-${i}`} className="min-w-0 rounded-md border border-border px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity}</Badge>
              <span className="max-w-full text-xs font-medium break-all" title={issue.rule}>
                {prettyIdent(issue.rule)}
              </span>
              {"confidence" in issue && issue.confidence ? (
                <span className="text-xs text-muted-foreground">{issue.confidence}</span>
              ) : null}
              {issue.count > 1 ? <span className="text-xs text-muted-foreground">×{issue.count}</span> : null}
              {alsoOn ? <span className="text-xs text-muted-foreground">{alsoOn}</span> : null}
            </div>
            <p className="mt-1 text-xs break-words text-muted-foreground">{issue.message}</p>
            <WhyItMatters
              rule={issue.rule}
              extras={{
                source: issue.source,
                message: issue.message,
                ...("where" in issue && issue.where ? { where: issue.where } : {}),
              }}
            />
            {"where" in issue && issue.where ? (
              <p className="mt-0.5 text-[11px] break-all text-muted-foreground">Where: {issue.where}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function QualityGroup({
  title,
  items,
  pages,
  current,
}: {
  title: string;
  items: Array<QualityIssue | QualityRuntimeEvent>;
  pages: QualityPage[];
  current: LedgerKey;
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
        <div className="mb-3">
          <QualityIssueCards items={items} pages={pages} current={current} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function qualityScannerCount(page: QualityPage): number {
  return page.html.length + (page.seo ?? []).length + page.runtime.length;
}

function findingOnNode(finding: UiMapFinding, node: UiGraphNode): boolean {
  if (node.kind !== "page") return false;
  if (finding.pageId) return finding.pageId === node.pageId;
  if (finding.path) return finding.path === node.path;
  return false;
}

export function NodeSheet({
  snapshot,
  nodeId,
  onOpenChange,
  onOpenRun,
}: {
  snapshot: UiSnapshot;
  nodeId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenRun?: (runId: string) => void;
}) {
  const node = snapshot.graph.nodes.find((n) => n.id === nodeId);
  const page = node ? findPage(snapshot, node.pageId) : undefined;
  const ledger = node ? ledgerFor(snapshot, node) : {};
  const qualityRows = [...(ledger.quality?.a11y ?? []), ...(ledger.quality?.visual ?? [])];
  const a11yItems = chapterIssues(qualityRows, "accessibility");
  const visualItems = chapterIssues(qualityRows, "visual");
  const counts = node ? widgetCounts(page, node) : { surfaces: 0, fields: 0, actions: 0, widgets: 0 };
  const here =
    node &&
    snapshot.runs.filter((run) => run.live && run.pageId === node.id);
  const pageFindings = node
    ? (snapshot.findings ?? []).filter((f) => findingOnNode(f, node))
    : [];
  const blurb = page?.description ?? node?.blurb;
  const describedBy = page?.describedBy ?? node?.describedBy;
  return (
    <Sheet open={Boolean(node)} onOpenChange={onOpenChange}>
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
              className="mt-3"
              frameClassName="h-48"
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
                {node.kind === "page" ? (
                  <InfoStat label="Last land" wide>
                    <div>{landAgeLabel(node.fogAt)}</div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {FOG_JOBS.map((job) => (
                        <div key={job} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: fogHeatColor(node.jobFog?.[job]) }}
                            aria-hidden
                          />
                          <span className="font-medium text-foreground">{job}</span>
                          <span>{landAgeLabel(node.jobFog?.[job])}</span>
                        </div>
                      ))}
                    </div>
                    <a
                      href={DOCS_MAP}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      How to read the map
                    </a>
                  </InfoStat>
                ) : null}
                <InfoStat label="Surfaces">{counts.surfaces}</InfoStat>
                <InfoStat label="Widgets">
                  <div>{counts.widgets}</div>
                  <div className="text-xs text-muted-foreground">
                    {counts.fields} fields, {counts.actions} actions
                  </div>
                </InfoStat>
              </div>
              <section>
                <h3 className="mb-2 text-sm font-medium">Findings {pageFindings.length}</h3>
                {pageFindings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No finding folders on this page.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {pageFindings.map((finding) => (
                      <li key={`${finding.runId}/${finding.id}`}>
                        <button
                          type="button"
                          className="w-full min-w-0 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/40"
                          onClick={() => onOpenRun?.(finding.runId)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Badge
                              variant={
                                finding.severity === "critical" || finding.severity === "major"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {finding.severity}
                            </Badge>
                            <span className="min-w-0 truncate font-medium" title={finding.kind}>
                              {prettyIdent(finding.kind)}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                              {finding.runId}
                            </span>
                          </div>
                          <p className="mt-1 text-xs break-words text-muted-foreground">
                            {prettyLeadingIdent(finding.message)}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Quality</h3>
                {ledger.quality && qualityScannerCount(ledger.quality) > 0 ? (
                  <div>
                    <QualityGroup
                      title="HTML"
                      items={ledger.quality.html}
                      pages={snapshot.quality.pages}
                      current={node}
                    />
                    <QualityGroup
                      title="SEO"
                      items={ledger.quality.seo ?? []}
                      pages={snapshot.quality.pages}
                      current={node}
                    />
                    <QualityGroup
                      title="Runtime"
                      items={ledger.quality.runtime}
                      pages={snapshot.quality.pages}
                      current={node}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No quality issues.</p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Visual</h3>
                {visualItems.length > 0 ? (
                  <QualityIssueCards items={visualItems} pages={snapshot.quality.pages} current={node} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {ledger.quality?.visualHash ? "Scanned, no extras." : "No visual extras."}
                  </p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Accessibility</h3>
                {a11yItems.length > 0 ? (
                  <QualityIssueCards items={a11yItems} pages={snapshot.quality.pages} current={node} />
                ) : (
                  <p className="text-sm text-muted-foreground">No accessibility issues.</p>
                )}
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Testability</h3>
                <IssueList
                  issues={ledger.testability?.issues ?? []}
                  pages={snapshot.testability.pages}
                  current={node}
                />
              </section>
              {here && here.length > 0 ? (
                <InfoStat label="Here now">
                  <ul className="flex min-w-0 flex-col gap-1">
                    {here.map((run: UiRun) => (
                      <li key={run.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: runHue(run.hue) }} />
                        <span className="min-w-0 truncate font-medium">{run.name}</span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {monkeyOfBrain(run.brain) ?? run.brain ?? run.id}
                        </span>
                      </li>
                    ))}
                  </ul>
                </InfoStat>
              ) : null}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
