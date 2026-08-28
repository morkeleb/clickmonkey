import { specStepFailed } from "../playbooks/spec.js";
import type { Finding } from "../schema/finding.js";
import type { Step } from "../schema/log.js";
import type { SessionRuntime } from "./session.js";

export class SessionStepError extends Error {
  readonly finding?: Finding;
  readonly bounced: boolean;
  readonly writePolicyBlocked: boolean;

  constructor(message: string, opts?: { finding?: Finding; bounced?: boolean; writePolicyBlocked?: boolean }) {
    super(message);
    this.name = "SessionStepError";
    this.finding = opts?.finding;
    this.bounced = opts?.bounced ?? false;
    this.writePolicyBlocked = opts?.writePolicyBlocked ?? false;
  }
}

/** Fill value that the executor resolves from env. `$NAME` if `name` has no `$`. */
export function secret(name: string): string {
  return name.includes("$") ? name : `$${name}`;
}

export type FlushResult = {
  findings: Finding[];
  blocking: Finding[];
  pageId: string;
};

/**
 * Thenable that flushes queued steps. Resolves to a plain FlushResult, not `this` —
 * fulfilling a thenable with itself never settles (`await chain` would hang).
 */
export class SurfaceChain implements PromiseLike<FlushResult> {
  readonly pageId?: string;
  readonly surfaceId?: string;
  protected landPageId?: string;
  protected queue: Step[] = [];
  #inflight: Promise<FlushResult> | undefined;

  constructor(readonly runtime: SessionRuntime) {}

  then<TResult1 = FlushResult, TResult2 = never>(
    onfulfilled?: ((value: FlushResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#flush().then(onfulfilled, onrejected);
  }

  protected fillFields(surface: string, fields: Record<string, string | undefined>): this {
    for (const [id, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      this.queue.push({ kind: "fill", surface, id, value });
    }
    return this;
  }

  protected clickAction(surface: string, id: string): this;
  protected clickAction<T extends SurfaceChain>(
    surface: string,
    id: string,
    Ctor: new (runtime: SessionRuntime) => T,
  ): T;
  protected clickAction<T extends SurfaceChain>(
    surface: string,
    id: string,
    Ctor?: new (runtime: SessionRuntime) => T,
  ): this | T {
    this.queue.push({ kind: "click", surface, id });
    if (!Ctor) return this;
    const next = new Ctor(this.runtime);
    next.queue = this.queue;
    next.landPageId = this.landPageId ?? this.pageId;
    this.queue = [];
    return next;
  }

  expectInvalid(id: string): this {
    this.queue.push({ kind: "expectInvalid", surface: this.#requireSurface(), id });
    return this;
  }

  expectVisible(): this {
    this.queue.push({ kind: "expectVisible", surface: this.#requireSurface() });
    return this;
  }

  expectHidden(): this {
    this.queue.push({ kind: "expectHidden", surface: this.#requireSurface() });
    return this;
  }

  expectText(id: string, text: string): this {
    this.queue.push({ kind: "expectText", surface: this.#requireSurface(), id, text });
    return this;
  }

  expectValue(id: string, value: string): this {
    this.queue.push({ kind: "expectValue", surface: this.#requireSurface(), id, value });
    return this;
  }

  expectPath(path: string): this {
    this.queue.push({ kind: "expectPath", path });
    return this;
  }

  expectPageText(text: string): this {
    this.queue.push({ kind: "expectPageText", text });
    return this;
  }

  #requireSurface(): string {
    if (!this.surfaceId) throw new Error("surfaceId is not set");
    return this.surfaceId;
  }

  #flush(): Promise<FlushResult> {
    if (this.#inflight) return this.#inflight;
    this.#inflight = this.#runQueued()
      .then(
        (): FlushResult => ({
          findings: this.runtime.findings,
          blocking: this.runtime.blocking,
          pageId: this.runtime.pageId,
        }),
      )
      .finally(() => {
        this.#inflight = undefined;
      });
    return this.#inflight;
  }

  #runQueued(): Promise<void> {
    const steps = [...this.queue];
    this.queue = [];
    const land = this.landPageId ?? this.pageId;
    if (land && this.runtime.pageId !== land) {
      const head = steps[0];
      const already = head?.kind === "open" && head.page === land;
      if (!already) steps.unshift({ kind: "open", page: land });
    }
    return this.#runSteps(steps);
  }

  async #runSteps(steps: Step[]): Promise<void> {
    for (const step of steps) {
      const result = await this.runtime.runStep(step);
      if (result.bounced || result.writePolicyBlocked || specStepFailed(result.finding?.kind)) {
        const message = result.finding?.message
          ?? (result.bounced
            ? "left the leash"
            : result.writePolicyBlocked
              ? "write policy blocked this click (required fields are filled; set writePolicy allow to commit)"
              : "step failed");
        throw new SessionStepError(message, {
          ...(result.finding ? { finding: result.finding } : {}),
          ...(result.bounced ? { bounced: true } : {}),
          ...(result.writePolicyBlocked ? { writePolicyBlocked: true } : {}),
        });
      }
      if (this.pageId && this.runtime.pageId === this.pageId) this.landPageId = this.pageId;
    }
  }
}
