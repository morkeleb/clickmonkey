import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hoppablePages } from "../src/executor/hop.js";
import type { RunState } from "../src/executor/run.js";
import { pickSeedPageId } from "../src/playbooks/seed.js";
import type { Config } from "../src/schema/config.js";
import type { Page } from "../src/schema/page-model.js";
import {
  findPageForHref,
  isSameOriginPage,
  openHref,
  pageMatchesHref,
} from "../src/surveyor/ready.js";

const app = "https://app.example.com/login";
const appOrigin = "https://app.example.com";
const idp = "https://idp.example.com";

const login = { id: "login", path: "/login" };
const uLogin = { id: "u_login", path: "/u/login", origin: idp };
const legacy = { id: "u_login", path: "/u/login" };

function mapped(
  id: string,
  path: string,
  extra: Partial<Page> & { widgets?: boolean; entry?: boolean; origin?: string } = {},
): Page {
  const { widgets = true, ...rest } = extra;
  return {
    id,
    path,
    params: [],
    ready: { by: "testId", value: id },
    surfaces: [
      {
        id: "page",
        kind: "page",
        fields: [],
        actions: widgets
          ? [{ id: "go", by: "testId", value: "go", status: "ok" }]
          : [],
      },
    ],
    ...rest,
  };
}

describe("openHref", () => {
  it("resolves a leash page against the app url", () => {
    assert.equal(openHref(login, app), "https://app.example.com/login");
  });

  it("does not rewrite a foreign path onto the app host", () => {
    assert.equal(openHref(uLogin, app), "https://idp.example.com/u/login");
    assert.equal(
      openHref(legacy, app),
      "https://app.example.com/u/login",
    );
  });
});

describe("page matching", () => {
  it("matches origin-less pages only on the leash origin", () => {
    assert.equal(pageMatchesHref(login, "https://app.example.com/login", appOrigin), true);
    assert.equal(pageMatchesHref(login, "https://idp.example.com/login", appOrigin), false);
  });

  it("matches a stamped page only on its origin", () => {
    assert.equal(
      pageMatchesHref(uLogin, "https://idp.example.com/u/login", appOrigin),
      true,
    );
    assert.equal(
      pageMatchesHref(uLogin, "https://app.example.com/u/login", appOrigin),
      false,
    );
  });

  it("does not reuse an origin-less page for a foreign host", () => {
    const hit = findPageForHref([legacy], "https://idp.example.com/u/login", appOrigin);
    assert.equal(hit, undefined);
    const stamped = findPageForHref([uLogin], "https://app.example.com/u/login", appOrigin);
    assert.equal(stamped, undefined);
    const appLogin = findPageForHref([login], "https://idp.example.com/login", appOrigin);
    assert.equal(appLogin, undefined);
  });

  it("treats origin-less pages as leash pages", () => {
    assert.equal(isSameOriginPage(login, appOrigin), true);
    assert.equal(isSameOriginPage(uLogin, appOrigin), false);
  });
});

describe("hoppablePages", () => {
  const loginPage = mapped("login", "/login");
  const callbackPage = mapped("callback", "/callback", { widgets: false });
  const homePage = mapped("home", "/");
  const idpPage = mapped("u_login", "/u/login", { origin: idp });

  it("drops foreign, fenced, empty, and start pages after intro has left", () => {
    const ids = hoppablePages([loginPage, callbackPage, idpPage, homePage], {
      appUrl: app,
      fence: { blacklist: ["example.com/login"] },
      intro: ["click page.go"],
      currentHref: "https://app.example.com/",
    }).map((p) => p.id);
    assert.deepEqual(ids, ["home"]);
  });

  it("drops parameterized templates so open does not goto :id1", () => {
    const ids = hoppablePages(
      [mapped("customers_id1_migrations", "/customers/:id1/migrations", { params: ["id1"] }), homePage],
      { appUrl: app, currentHref: "https://app.example.com/" },
    ).map((p) => p.id);
    assert.deepEqual(ids, ["home"]);
  });

  it("drops pages marked entry", () => {
    const ids = hoppablePages(
      [mapped("login", "/login", { entry: true }), homePage],
      { appUrl: app, currentHref: "https://app.example.com/" },
    ).map((p) => p.id);
    assert.deepEqual(ids, ["home"]);
  });
});

describe("pickSeedPageId", () => {
  it("refuses foreign, fenced, empty, and start pages after intro", () => {
    const state = {
      config: {
        url: app,
        intro: ["click page.go"],
        fence: { blacklist: ["example.com/login"] },
      } as Config,
      model: {
        pages: [
          mapped("login", "/login"),
          mapped("u_login", "/u/login", { origin: idp }),
          mapped("callback", "/callback", { widgets: false }),
          mapped("home", "/"),
        ],
      },
      page: { url: () => "https://app.example.com/" },
    } as RunState;
    assert.equal(pickSeedPageId(state, "u_login"), "home");
    assert.equal(pickSeedPageId(state, "login"), "home");
    assert.equal(pickSeedPageId(state, "callback"), "home");
    assert.equal(pickSeedPageId(state, "home"), "home");
  });
});
