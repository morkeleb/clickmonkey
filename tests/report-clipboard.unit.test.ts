import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySrcMap,
  collectImgSrcs,
  collectMarkdownImageRaws,
  rewriteMarkdownImageUrls,
} from "../web/src/lib/clipboard-html.ts";

describe("report clipboard helpers", () => {
  it("collects unique http image srcs and skips data urls", () => {
    const html = [
      '<img src="/files/runs/a/shots/step-001.png" alt="a">',
      '<img alt="b" src="/files/runs/a/shots/step-001.png">',
      '<img src="data:image/png;base64,xx">',
      "<img src='/files/runs/b/findings/fnd_1/screenshot.png'>",
    ].join("");
    assert.deepEqual(collectImgSrcs(html), [
      "/files/runs/a/shots/step-001.png",
      "/files/runs/b/findings/fnd_1/screenshot.png",
    ]);
  });

  it("rewrites html img srcs from a map", () => {
    const html = '<p><img src="/files/runs/a/x.png" alt="shot"></p>';
    const map = new Map([["/files/runs/a/x.png", "data:image/png;base64,QQ=="]]);
    assert.equal(applySrcMap(html, map), '<p><img src="data:image/png;base64,QQ==" alt="shot"></p>');
  });

  it("inlines markdown image destinations", () => {
    const md = "![screenshot](../../runs/a/findings/fnd_1/screenshot.png)\n\nnext";
    assert.deepEqual(collectMarkdownImageRaws(md), ["../../runs/a/findings/fnd_1/screenshot.png"]);
    const rawToData = new Map([["../../runs/a/findings/fnd_1/screenshot.png", "data:image/png;base64,QQ=="]]);
    assert.match(rewriteMarkdownImageUrls(md, rawToData), /!\[screenshot]\(data:image\/png;base64,QQ==\)/);
  });
});
