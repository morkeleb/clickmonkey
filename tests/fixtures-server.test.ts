import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serveSite } from "./helpers/fixture-server.js";

describe("fixture server", () => {
  it("serves validates at /", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      const res = await fetch(baseUrl);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /data-testid="home"/);
      assert.match(body, /novalidate/);
    } finally {
      await close();
    }
  });
});
