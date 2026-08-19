import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSecretToken, resolveSecret, resolveSecretAsync } from "../src/executor/secrets.js";

describe("secrets", () => {
  it("resolves $CLICKMONKEY_PASSWORD from env", () => {
    const env = { CLICKMONKEY_PASSWORD: "s3cret" };
    assert.equal(resolveSecret("$CLICKMONKEY_PASSWORD", env), "s3cret");
  });

  it("resolves ${NAME}", () => {
    assert.equal(resolveSecret("${NAME}", { NAME: "x" }), "x");
  });

  it("returns a non-token as-is", () => {
    assert.equal(resolveSecret("plain"), "plain");
    assert.equal(isSecretToken("plain"), false);
    assert.equal(isSecretToken("$CLICKMONKEY_PASSWORD"), true);
    assert.equal(isSecretToken("${NAME}"), true);
  });

  it("throws when the token is missing", () => {
    assert.throws(
      () => resolveSecret("$CLICKMONKEY_PASSWORD", {}),
      /\$CLICKMONKEY_PASSWORD is not set/,
    );
  });

  it("resolveSecretAsync uses prompt when env is missing", async () => {
    const value = await resolveSecretAsync("$MISSING_TOKEN", {
      env: {},
      prompt: async (name) => `prompted-${name}`,
    });
    assert.equal(value, "prompted-MISSING_TOKEN");
  });
});
