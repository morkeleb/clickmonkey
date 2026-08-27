import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSecretToken,
  redactEnvInText,
  resolveSecret,
  resolveSecretAsync,
  tapeFillValue,
} from "../src/executor/secrets.js";

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

  it("redactEnvInText replaces every env value with $NAME, longest first", () => {
    const env = {
      CLICKMONKEY_PASSWORD: "s3cret-pass",
      CLICKMONKEY_USER: "Ada@example.com",
      PATH: "/usr/bin:/s3cret-pass/bin",
    };
    const raw = 'fill page.password "s3cret-pass"\nfill page.username Ada@example.com';
    const out = redactEnvInText(raw, env);
    assert.equal(out.includes("s3cret-pass"), false);
    assert.equal(out.includes("Ada@example.com"), false);
    assert.match(out, /\$CLICKMONKEY_PASSWORD/);
    assert.match(out, /\$CLICKMONKEY_USER/);
  });

  it("does not smash filesystem paths with TMPDIR/HOME", () => {
    const tmp = "/var/folders/ab/tmp";
    const env = { TMPDIR: tmp, HOME: "/Users/ada", CLICKMONKEY_PASSWORD: "s3cret-pass" };
    const path = `${tmp}/cm-fnd/findings/fnd_3/screenshot.png`;
    const out = redactEnvInText(path, env);
    assert.equal(out, path);
    assert.equal(redactEnvInText('fill x "s3cret-pass"', env).includes("s3cret-pass"), false);
  });

  it("tapeFillValue keeps $TOKEN and never writes an env value", () => {
    const env = { CLICKMONKEY_PASSWORD: "s3cret-pass" };
    assert.equal(
      tapeFillValue("$CLICKMONKEY_PASSWORD", "s3cret-pass", { id: "password", type: "password" }, env),
      "$CLICKMONKEY_PASSWORD",
    );
    assert.equal(tapeFillValue("s3cret-pass", "s3cret-pass", { id: "username" }, env), "$CLICKMONKEY_PASSWORD");
    assert.equal(tapeFillValue("hunter2", "hunter2", { type: "password", id: "pass" }, env), "••••");
    assert.equal(tapeFillValue("Norway", "Norway", { id: "country" }, env), "Norway");
  });

  it("resolveSecretAsync uses prompt when env is missing", async () => {
    const value = await resolveSecretAsync("$MISSING_TOKEN", {
      env: {},
      prompt: async (name) => `prompted-${name}`,
    });
    assert.equal(value, "prompted-MISSING_TOKEN");
  });
});
