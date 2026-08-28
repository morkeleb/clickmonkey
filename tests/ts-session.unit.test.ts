import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { secret, SessionStepError, SurfaceChain } from "../src/ts/handle.js";
import type { SessionRuntime } from "../src/ts/session.js";
import type { Finding } from "../src/schema/finding.js";
import type { Step } from "../src/schema/log.js";
import type { StepResult } from "../src/executor/run.js";
import type { View } from "../src/schema/view.js";

function dummyView(pageId: string): View {
  return { page: pageId, surface: "page", stack: [pageId], shown: [], actions: [] };
}

function finding(kind: Finding["kind"], message: string): Finding {
  return {
    schemaVersion: 1,
    id: `fnd_0_${kind}`,
    kind,
    message,
    tapePath: "replay.log",
    stepIndex: 0,
  };
}

function fakeRuntime(initPageId = "home"): {
  runtime: SessionRuntime;
  steps: Step[];
  setPageId: (id: string) => void;
  setResult: (fn: (step: Step) => Partial<StepResult>) => void;
} {
  const steps: Step[] = [];
  let pageId = initPageId;
  let reply: (step: Step) => Partial<StepResult> = () => ({});
  const findings: Finding[] = [];
  const runtime = {
    findings,
    get blocking() {
      return findings.filter((f) => f.kind !== "visualIssue");
    },
    get pageId() {
      return pageId;
    },
    async runStep(step: Step): Promise<StepResult> {
      steps.push(step);
      if (step.kind === "open") pageId = step.page;
      const extra = reply(step);
      return {
        ok: !extra.finding && !extra.bounced && !extra.writePolicyBlocked,
        step,
        view: dummyView(pageId),
        ...extra,
      };
    },
    async close() {},
  } as SessionRuntime;
  return {
    runtime,
    steps,
    setPageId: (id) => {
      pageId = id;
    },
    setResult: (fn) => {
      reply = fn;
    },
  };
}

class PageChain extends SurfaceChain {
  readonly pageId: string;
  readonly surfaceId: string;

  constructor(runtime: SessionRuntime, pageId = "home", surfaceId = "page") {
    super(runtime);
    this.pageId = pageId;
    this.surfaceId = surfaceId;
  }

  fill(fields: Record<string, string | undefined>, surface = this.surfaceId): this {
    return this.fillFields(surface, fields);
  }

  click(id: string, surface = this.surfaceId): this {
    return this.clickAction(surface, id);
  }

  open<T extends SurfaceChain>(
    id: string,
    Ctor: new (runtime: SessionRuntime) => T,
    surface = this.surfaceId,
  ): T {
    return this.clickAction(surface, id, Ctor);
  }

  seed(step: Step): this {
    this.queue.push(step);
    return this;
  }
}

class CreateDialog extends SurfaceChain {
  readonly pageId = "home";
  readonly surfaceId = "createDialog";
}

class Customers extends SurfaceChain {
  readonly pageId = "customers";
  readonly surfaceId = "page";

  fill(fields: Record<string, string | undefined>): this {
    return this.fillFields(this.surfaceId, fields);
  }
}

describe("secret", () => {
  it('prefixes CLICKMONKEY_USER with $', () => {
    assert.equal(secret("CLICKMONKEY_USER"), "$CLICKMONKEY_USER");
  });

  it("leaves an existing $ token alone", () => {
    assert.equal(secret("$CLICKMONKEY_USER"), "$CLICKMONKEY_USER");
  });
});

describe("SurfaceChain", () => {
  it("queues fill then click in order and skips undefined fields", async () => {
    const { runtime, steps } = fakeRuntime("home");
    const page = new PageChain(runtime);
    page.fill({ name: "Ada", email: undefined, pass: "x" }).click("submit");
    await page;
    assert.deepEqual(steps, [
      { kind: "fill", surface: "page", id: "name", value: "Ada" },
      { kind: "fill", surface: "page", id: "pass", value: "x" },
      { kind: "click", surface: "page", id: "submit" },
    ]);
  });

  it("moves the queue onto a Ctor instance from clickAction", async () => {
    const { runtime, steps } = fakeRuntime("home");
    const home = new PageChain(runtime);
    home.fill({ name: "Ada" });
    const dialog = home.open("openCreate", CreateDialog);
    assert.ok(dialog instanceof CreateDialog);
    dialog.fillFields("createDialog", { title: "Hi" });
    await dialog;
    assert.deepEqual(steps, [
      { kind: "fill", surface: "page", id: "name", value: "Ada" },
      { kind: "click", surface: "page", id: "openCreate" },
      { kind: "fill", surface: "createDialog", id: "title", value: "Hi" },
    ]);
    const n = steps.length;
    await home;
    assert.equal(steps.length, n);
  });

  it("prepends open when pageId differs from the runtime", async () => {
    const { runtime, steps } = fakeRuntime("login");
    const home = new PageChain(runtime, "home");
    home.fill({ q: "1" });
    await home;
    assert.deepEqual(steps, [
      { kind: "open", page: "home" },
      { kind: "fill", surface: "page", id: "q", value: "1" },
    ]);
  });

  it("does not prepend open when already on that page", async () => {
    const { runtime, steps } = fakeRuntime("home");
    await new PageChain(runtime, "home");
    assert.deepEqual(steps, []);
  });

  it("does not duplicate an open that already heads the queue", async () => {
    const { runtime, steps } = fakeRuntime("login");
    await new PageChain(runtime, "home").seed({ kind: "open", page: "home" }).click("x");
    assert.deepEqual(steps, [
      { kind: "open", page: "home" },
      { kind: "click", surface: "page", id: "x" },
    ]);
  });

  it("does not throw on visualIssue", async () => {
    const { runtime, steps, setResult } = fakeRuntime("home");
    setResult(() => ({ finding: finding("visualIssue", "low contrast") }));
    const page = new PageChain(runtime);
    await page.expectVisible();
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.kind, "expectVisible");
  });

  it("throws SessionStepError on expectFailed", async () => {
    const { runtime, setResult } = fakeRuntime("home");
    setResult(() => ({ finding: finding("expectFailed", "not invalid") }));
    const page = new PageChain(runtime);
    await assert.rejects(Promise.resolve(page.expectInvalid("name")), (err: unknown) => {
      assert.ok(err instanceof SessionStepError);
      assert.equal(err.message, "not invalid");
      assert.equal(err.finding?.kind, "expectFailed");
      return true;
    });
  });

  it("page hop does not open dest before the click", async () => {
    const { runtime, steps } = fakeRuntime("home");
    const home = new PageChain(runtime, "home");
    home.fill({ q: "1" });
    const customers = home.open("goCustomers", Customers);
    customers.fill({ name: "Acme" });
    await customers;
    assert.deepEqual(steps, [
      { kind: "fill", surface: "page", id: "q", value: "1" },
      { kind: "click", surface: "page", id: "goCustomers" },
      { kind: "fill", surface: "page", id: "name", value: "Acme" },
    ]);
  });

  it("after a hop flush, later fills stay on dest instead of re-opening source", async () => {
    const { runtime, steps, setPageId, setResult } = fakeRuntime("home");
    setResult((step) => {
      if (step.kind === "click") setPageId("customers");
      return {};
    });
    const home = new PageChain(runtime, "home");
    const customers = home.open("goCustomers", Customers);
    await customers;
    customers.fill({ name: "Acme" });
    await customers;
    assert.deepEqual(steps, [
      { kind: "click", surface: "page", id: "goCustomers" },
      { kind: "fill", surface: "page", id: "name", value: "Acme" },
    ]);
  });

  it("after a dialog flush, later fills do not remount the page", async () => {
    const { runtime, steps } = fakeRuntime("home");
    const dialog = new PageChain(runtime, "home").open("openCreate", CreateDialog);
    await dialog;
    dialog.fillFields("createDialog", { name: "Ada" });
    await dialog;
    assert.deepEqual(steps, [
      { kind: "click", surface: "page", id: "openCreate" },
      { kind: "fill", surface: "createDialog", id: "name", value: "Ada" },
    ]);
  });

  it("hop then failed fill does not re-open source on retry", async () => {
    const { runtime, steps, setPageId, setResult } = fakeRuntime("home");
    setResult((step) => {
      if (step.kind === "click") {
        setPageId("customers");
        return {};
      }
      if (step.kind === "fill") return { finding: finding("expectFailed", "nope") };
      return {};
    });
    const customers = new PageChain(runtime, "home").open("goCustomers", Customers);
    await assert.rejects(Promise.resolve(customers.fill({ name: "x" })));
    setResult(() => ({}));
    customers.fill({ name: "Ada" });
    await customers;
    assert.deepEqual(
      steps.filter((s) => s.kind === "open"),
      [],
    );
    assert.equal(steps.at(-1)?.kind, "fill");
  });

  it("throws SessionStepError when write policy blocks a click", async () => {
    const { runtime, setResult } = fakeRuntime("home");
    setResult(() => ({ writePolicyBlocked: true }));
    const page = new PageChain(runtime);
    await assert.rejects(Promise.resolve(page.click("submit")), (err: unknown) => {
      assert.ok(err instanceof SessionStepError);
      assert.equal(err.writePolicyBlocked, true);
      assert.match(err.message, /write policy blocked/);
      return true;
    });
  });

  it("throws SessionStepError on bounced", async () => {
    const { runtime, setResult } = fakeRuntime("home");
    setResult(() => ({ bounced: true }));
    const page = new PageChain(runtime);
    await assert.rejects(Promise.resolve(page.click("leave")), (err: unknown) => {
      assert.ok(err instanceof SessionStepError);
      assert.equal(err.message, "left the leash");
      assert.equal(err.bounced, true);
      return true;
    });
  });
});
