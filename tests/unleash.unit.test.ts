import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clickKey,
  decideUnleash,
  formSubmitAction,
  freshClicks,
  listModeScore,
  rememberClick,
} from "../src/brains/unleash.js";
import type { View } from "../src/schema/view.js";

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    ...partial,
  };
}

describe("clickKey", () => {
  it("groups sort toggles and pagination, and leaves other ids alone", () => {
    assert.equal(clickKey("button_sorted_descending__switch_to_ascending"), "~sort");
    assert.equal(clickKey("button_sorted_ascending__switch_to_descending"), "~sort");
    assert.equal(clickKey("button_previous"), "~page");
    assert.equal(clickKey("button_next"), "~page");
    assert.equal(clickKey("button_open_next_js_dev_tools"), "button_open_next_js_dev_tools");
    assert.equal(clickKey("~sort"), "~sort");
  });
});

describe("freshClicks", () => {
  it("drops both sort buttons after one flip", () => {
    const actions = [
      { id: "button_sorted_descending__switch_to_ascending" },
      { id: "button_sorted_ascending__switch_to_descending" },
    ];
    assert.equal(freshClicks(actions, ["button_sorted_descending__switch_to_ascending"]).length, 0);
  });

  it("drops a two-key ping-pong and keeps a third widget", () => {
    const actions = [
      { id: "combobox_status" },
      { id: "combobox_readiness" },
      { id: "button_save_draft" },
    ];
    const pingPong = [
      "combobox_status",
      "combobox_readiness",
      "combobox_status",
      "combobox_readiness",
    ];
    assert.deepEqual(
      freshClicks(actions, pingPong).map((a) => a.id),
      ["button_save_draft"],
    );
    assert.deepEqual(rememberClick(["a", "b", "c"], "d", 3), ["b", "c", "d"]);
  });
});

describe("formSubmitAction", () => {
  it("treats wizard Next as submit and list Next as pagination", () => {
    assert.equal(formSubmitAction([{ id: "button_next", label: "Next" }])?.id, "button_next");
    assert.equal(formSubmitAction([{ id: "button_next_step", label: "Next" }])?.id, "button_next_step");
    const list = [
      { id: "combobox_status", role: "combobox" as const },
      { id: "button_sorted_descending__switch_to_ascending" },
      { id: "button_next", label: "Next" },
    ];
    assert.equal(formSubmitAction(list), undefined);
    assert.equal(
      formSubmitAction(list, undefined, viewOf({ actions: list })),
      undefined,
    );
    const filterPager = viewOf({
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
      ],
    });
    assert.equal(formSubmitAction(filterPager.actions, undefined, filterPager), undefined);
  });
});

describe("listModeScore", () => {
  it("needs two kinds of chrome, not two comboboxes", () => {
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_status", role: "combobox" },
            { id: "combobox_readiness", role: "combobox" },
          ],
        }),
      ),
      1,
    );
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_status", role: "combobox" },
            { id: "button_sorted_descending__switch_to_ascending" },
          ],
        }),
      ),
      2,
    );
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_language", role: "combobox", nav: true },
            { id: "combobox_currency", role: "combobox", nav: true },
            { id: "button_expand" },
          ],
        }),
      ),
      0,
    );
  });
});

describe("sort stay", () => {
  it("treats asc/desc as one control and hops after one flip", () => {
    const view = viewOf({
      page: "runs",
      pages: ["home", "runs"],
      actions: [
        { id: "button_sorted_descending__switch_to_ascending" },
        { id: "button_sorted_ascending__switch_to_descending" },
      ],
    });
    const first = decideUnleash({ view, stepsUsed: 0, recentClicks: [] }, () => 0);
    assert.equal(first.line, "click page.button_sorted_descending__switch_to_ascending");
    const afterOne = decideUnleash(
      { view, stepsUsed: 1, recentClicks: ["button_sorted_descending__switch_to_ascending"] },
      () => 0,
    );
    assert.match(afterOne.line, /^open /);
    assert.equal(afterOne.mode, "nav");
  });
});
