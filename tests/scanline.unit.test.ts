import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIP_PX, INNER_CLIP_CAP, isClippedBox } from "../src/surveyor/scanline.js";

describe("isClippedBox", () => {
  it("flags overflow past CLIP_PX when text is long enough", () => {
    assert.equal(CLIP_PX, 4);
    assert.equal(INNER_CLIP_CAP, 8);
    assert.equal(isClippedBox({ scrollWidth: 100, clientWidth: 100, text: "Vendor" }), false);
    assert.equal(isClippedBox({ scrollWidth: 104, clientWidth: 100, text: "Vendor" }), false);
    assert.equal(isClippedBox({ scrollWidth: 105, clientWidth: 100, text: "Vendor" }), true);
    assert.equal(isClippedBox({ scrollWidth: 200, clientWidth: 96, text: "AB" }), true);
  });

  it("skips clean ellipsis, scrollable overflow, and short text", () => {
    assert.equal(
      isClippedBox({
        scrollWidth: 200,
        clientWidth: 96,
        textOverflow: "ellipsis",
        overflowX: "hidden",
        text: "Expert Witness Services LLC",
      }),
      false,
    );
    assert.equal(
      isClippedBox({ scrollWidth: 200, clientWidth: 96, overflowX: "auto", text: "Vendor" }),
      false,
    );
    assert.equal(
      isClippedBox({ scrollWidth: 200, clientWidth: 96, overflowX: "scroll", text: "Vendor" }),
      false,
    );
    assert.equal(
      isClippedBox({ scrollWidth: 200, clientWidth: 96, webkitLineClamp: "2", text: "Vendor" }),
      false,
    );
    assert.equal(isClippedBox({ scrollWidth: 200, clientWidth: 96, text: "A" }), false);
    assert.equal(isClippedBox({ scrollWidth: 200, clientWidth: 96, text: "  " }), false);
  });

  it("flags an inner overflow box with no ellipsis", () => {
    assert.equal(
      isClippedBox({
        scrollWidth: 240,
        clientWidth: 96,
        overflowX: "hidden",
        text: "Acme Office Supplies International",
      }),
      true,
    );
  });
});
