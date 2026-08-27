import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ACTION_TIMEOUT_MS,
  MIN_LIST_WAIT_MS,
  PEEK_TIMEOUT_MS,
  rememberActionTimeout,
  actionTimeoutMs,
  actionDeadline,
  remainingTimeoutMs,
  sliceTimeoutMs,
  typeaheadListWaitMs,
} from "../src/executor/timeout.js";
import { LISTED_CLICK_LOCATOR_COUNT, LISTED_CLICK_MS, listedPeekMs } from "../src/executor/typeahead.js";

function pageWithTimeout(ms: number): { context(): object } {
  const ctx = {};
  rememberActionTimeout(ctx as never, ms);
  return { context: () => ctx };
}

describe("typeahead list wait", () => {
  it("scales with --timeout instead of a 500ms race", () => {
    const slow = pageWithTimeout(60_000) as never;
    const fast = pageWithTimeout(4_000) as never;
    assert.ok(typeaheadListWaitMs(slow) > 500);
    assert.ok(typeaheadListWaitMs(slow) > typeaheadListWaitMs(fast));
    assert.equal(typeaheadListWaitMs(slow), 15_000);
    assert.equal(typeaheadListWaitMs(fast), MIN_LIST_WAIT_MS);
    assert.ok(MIN_LIST_WAIT_MS > 500);
  });

  it("falls back to Playwright's default when the context was not recorded", () => {
    const orphan = { context: () => ({}) } as never;
    assert.equal(actionTimeoutMs(orphan), DEFAULT_ACTION_TIMEOUT_MS);
  });

  it("peeks with a 1ms try-now, not timeout 0 (no timeout) or the --timeout default", () => {
    assert.equal(PEEK_TIMEOUT_MS, 1);
    assert.ok(PEEK_TIMEOUT_MS > 0);
    assert.ok(PEEK_TIMEOUT_MS < MIN_LIST_WAIT_MS);
  });

  it("uses a --timeout slice for listed kind/attribute reads, not 1ms", () => {
    const page = pageWithTimeout(30_000) as never;
    const peek = listedPeekMs(page);
    assert.equal(peek, LISTED_CLICK_MS);
    assert.ok(peek > PEEK_TIMEOUT_MS);
    assert.ok(peek < DEFAULT_ACTION_TIMEOUT_MS);
  });
});

describe("action timeout slices", () => {
  it("shares --timeout across locators instead of 8 × the full budget", () => {
    const now = 0;
    const slice = sliceTimeoutMs(90_000, { cap: LISTED_CLICK_MS, attempts: LISTED_CLICK_LOCATOR_COUNT, now });
    assert.equal(slice, LISTED_CLICK_MS);
    assert.equal(LISTED_CLICK_LOCATOR_COUNT, 8);
    assert.ok(slice * LISTED_CLICK_LOCATOR_COUNT < 90_000);
    assert.ok(slice * LISTED_CLICK_LOCATOR_COUNT < DEFAULT_ACTION_TIMEOUT_MS);
  });

  it("returns 0 after the deadline so the fill path can abort", () => {
    const now = 1_000;
    assert.equal(remainingTimeoutMs(now - 1, now), 0);
    assert.equal(sliceTimeoutMs(now - 50, { cap: LISTED_CLICK_MS, attempts: 8, now }), 0);
    const page = pageWithTimeout(90_000) as never;
    const past = actionDeadline(page, now - 90_000);
    assert.equal(remainingTimeoutMs(past, now), 0);
  });

  it("splits a short remainder across attempts instead of giving each the cap", () => {
    const now = 0;
    const slice = sliceTimeoutMs(400, { cap: LISTED_CLICK_MS, attempts: 8, now });
    assert.equal(slice, 50);
    assert.ok(slice * 8 <= 400);
  });
});
