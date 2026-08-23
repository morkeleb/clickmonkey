import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIALOG_GAP_X,
  DIALOG_NODE,
  PAGE_NODE,
  boxesOverlap,
  dialogRailWidth,
  dialogStackHeight,
  pageBoxSize,
} from "../web/src/lib/layout-metrics.ts";

describe("pageBoxSize", () => {
  it("is just the card when there are no dialogs", () => {
    assert.deepEqual(pageBoxSize(PAGE_NODE, 0), { width: PAGE_NODE.width, height: PAGE_NODE.height });
  });

  it("reserves a rail as wide as the gap plus a dialog card", () => {
    const box = pageBoxSize(PAGE_NODE, 3);
    assert.equal(box.width, PAGE_NODE.width + DIALOG_GAP_X + DIALOG_NODE.width);
    assert.equal(dialogRailWidth(3), DIALOG_GAP_X + DIALOG_NODE.width);
  });

  it("grows taller than the card when the dialog stack is taller", () => {
    const box = pageBoxSize(PAGE_NODE, 15);
    assert.ok(box.height > PAGE_NODE.height);
    assert.equal(box.height, dialogStackHeight(15));
  });
});

describe("boxesOverlap", () => {
  it("detects a dialog stack sitting on the next page card", () => {
    const home = { id: "home", x: 0, y: 0, width: PAGE_NODE.width, height: PAGE_NODE.height };
    const fees = { id: "fees", x: 220, y: 40, width: PAGE_NODE.width, height: PAGE_NODE.height };
    const dialog = {
      id: "home::tabs",
      x: PAGE_NODE.width + 16,
      y: 0,
      width: DIALOG_NODE.width,
      height: dialogStackHeight(12),
    };
    assert.equal(boxesOverlap(home, dialog), false);
    assert.equal(boxesOverlap(dialog, fees), true);
  });
});
