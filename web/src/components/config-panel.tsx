import type { ReactNode } from "react";
import type { UiLeash } from "@schema/ui";
import { ScrollArea } from "@/components/ui/scroll-area";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border/70 py-3 last:border-b-0">
      <dt className="pt-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function CodeList({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty>none</Empty>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={`${item}-${i}`}>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{item}</code>
        </li>
      ))}
    </ul>
  );
}

export function ConfigPanel({ leash }: { leash: UiLeash }) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="text-lg font-semibold">Config</h1>
        <p className="mt-1 text-sm text-muted-foreground">Leash sent by the CLI. Secrets are never shown.</p>
        <dl className="mt-6">
          <Row label="URL">
            <code className="font-mono text-xs break-all">{leash.url}</code>
          </Row>
          <Row label="Fence path">{leash.fence?.path ? <code className="font-mono text-xs">{leash.fence.path}</code> : <Empty>unset</Empty>}</Row>
          <Row label="Blacklist">
            <CodeList items={leash.fence?.blacklist ?? []} />
          </Row>
          <Row label="Intro">
            <CodeList items={leash.intro} />
          </Row>
          <Row label="Skip">
            <CodeList items={leash.skip} />
          </Row>
          <Row label="Write policy">
            <code className="font-mono text-xs">{leash.writePolicy}</code>
          </Row>
          <Row label="Brain model">
            {leash.brainModel ? <code className="font-mono text-xs">{leash.brainModel}</code> : <Empty>unset</Empty>}
          </Row>
        </dl>
      </div>
    </ScrollArea>
  );
}
