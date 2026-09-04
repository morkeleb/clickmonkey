import { Faker, en } from "@faker-js/faker";
import { dateFillValue, looksLikeDateFieldName, looksLikeDateMask } from "../executor/date-mask.js";
import type { ShownField, ShownFieldConstraints } from "../schema/view.js";

export type FillCtx = {
  id: string;
  type: ShownField["type"];
  tokens: Set<string>;
  /** Compact id (letters/digits only). Used to find `email` inside `salespersonemail`. */
  compact: string;
  autocomplete: string[];
  htmlType: string;
  inputMode: string;
  constraints: ShownFieldConstraints;
};

type FillRule = {
  id: string;
  score: (ctx: FillCtx) => number;
  generate: (faker: Faker, ctx: FillCtx) => string;
};

const SYNONYMS: Record<string, readonly string[]> = {
  firstname: ["first", "name"],
  givenname: ["first", "name"],
  given: ["first"],
  lastname: ["last", "name"],
  surname: ["last", "name"],
  familyname: ["last", "name"],
  family: ["last"],
  middlename: ["middle", "name"],
  fullname: ["full", "name"],
  displayname: ["display", "name"],
  zipcode: ["zip"],
  postcode: ["zip"],
  postalcode: ["zip"],
  postal: ["zip"],
  phonenumber: ["phone"],
  telephone: ["phone"],
  mobile: ["phone"],
  cellphone: ["phone"],
  tel: ["phone"],
  fax: ["phone"],
  emailaddress: ["email"],
  mail: ["email"],
  username: ["username"],
  userid: ["username"],
  login: ["username"],
  website: ["url"],
  webpage: ["url"],
  homepage: ["url"],
  web: ["url"],
  qty: ["quantity"],
  count: ["quantity"],
  dob: ["birth", "date"],
  birthday: ["birth", "date"],
  birthdate: ["birth", "date"],
  birth: ["birth"],
  organisation: ["organization"],
  org: ["organization"],
  employer: ["organization"],
  business: ["organization"],
  company: ["organization"],
  desc: ["description"],
  comments: ["comment"],
  notes: ["note"],
  msg: ["message"],
  pwd: ["password"],
  passwd: ["password"],
  pass: ["password"],
  cvv: ["csc"],
  cvc: ["csc"],
  cid: ["csc"],
  ssn: ["ssn"],
  ein: ["ssn"],
};

const ALIASES: Record<string, string> = {
  email: "email",
  mail: "email",
  emial: "email",
  emai: "email",
  useremail: "email",
  emailaddress: "email",
  emailadress: "email",
  username: "username",
  user: "username",
  login: "username",
  password: "password",
  passwd: "password",
  pwd: "password",
  first: "firstName",
  firstname: "firstName",
  last: "lastName",
  lastname: "lastName",
  surname: "lastName",
  phone: "phone",
  mobile: "phone",
  telephone: "phone",
  tel: "phone",
  url: "url",
  website: "url",
  homepage: "url",
  city: "city",
  town: "city",
  state: "state",
  province: "state",
  zip: "zip",
  zipcode: "zip",
  postcode: "zip",
  postal: "zip",
  country: "country",
  address: "street",
  street: "street",
  company: "organization",
  organization: "organization",
  organisation: "organization",
  ssn: "ssn",
  ein: "ssn",
  guid: "uuid",
  uuid: "uuid",
  ip: "ip",
  ipv4: "ip",
  ipv6: "ip",
  urlpath: "url",
  domain: "domain",
  hostname: "domain",
  dollar: "amount",
  price: "amount",
  amount: "amount",
  hash: "hash",
  profession: "jobTitle",
  job: "jobTitle",
  age: "age",
  dob: "birthdate",
  birthday: "birthdate",
  color: "color",
  colour: "color",
  lat: "lat",
  latitude: "lat",
  lng: "lng",
  lon: "lng",
  longitude: "lng",
  vin: "vin",
  iban: "iban",
};

function compactId(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const TRAILING_FIELD_WORDS = ["datetime", "date", "time"] as const;
/** Whole ids that end in `date` but are not date fields (`update`, `candidate`). */
const NOT_DATE_IDS = new Set(["update", "candidate", "validate", "mandate", "predate", "antedate"]);

/** `invoicedate` → date. Skip English words that merely end in those letters. */
function addTrailingFieldWords(compact: string, tokens: Set<string>): void {
  for (const suffix of TRAILING_FIELD_WORDS) {
    if (compact.length <= suffix.length || !compact.endsWith(suffix)) continue;
    if (suffix === "date" && !compactLooksLikeDateField(compact)) continue;
    tokens.add(suffix);
    const head = compact.slice(0, -suffix.length);
    if (head.length >= 2) tokens.add(head);
    return;
  }
}

function compactLooksLikeDateField(compact: string): boolean {
  if (!compact.endsWith("date") || compact.endsWith("time")) return false;
  if (NOT_DATE_IDS.has(compact)) return false;
  return compact.length - 4 >= 3;
}

function tokenize(...parts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const raw of parts) {
    if (!raw) continue;
    const camel = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
    for (const t of camel.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 2 || t === "q") tokens.add(t);
    }
    const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (compact.length >= 2) tokens.add(compact);
    addTrailingFieldWords(compact, tokens);
    addKnownCompounds(compact, tokens);
  }
  for (const t of [...tokens]) {
    const extra = SYNONYMS[t];
    if (extra) for (const e of extra) tokens.add(e);
  }
  return tokens;
}

/** Concatenated ids (`clientcode`, `taxidentificationnumber`) that tokenize as one word. */
function addKnownCompounds(compact: string, tokens: Set<string>): void {
  if (compact.includes("taxidentification") || /(^|tax)(ein|id)$/.test(compact) || compact === "ein") {
    tokens.add("ein");
    tokens.add("tin");
  }
  if (/(client|matter|vendor|short|sku)code$/.test(compact) || compact === "shortcode") {
    tokens.add("recordcode");
  }
  if (/(^|_)places(_|$)/.test(compact) || compact === "places" || compact.endsWith("placessearch") || compact === "placeid") {
    tokens.add("places");
  }
}

function autocompleteKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^section-/, ""))
    .filter((t) => t && t !== "on" && t !== "off" && t !== "shipping" && t !== "billing");
}

export function fillContext(field: ShownField): FillCtx {
  const constraints = field.constraints ?? {};
  return {
    id: field.id,
    type: field.type,
    tokens: tokenize(field.id, field.label ?? ""),
    compact: compactId(field.id),
    autocomplete: autocompleteKeys(constraints.autocomplete),
    htmlType: (constraints.htmlType ?? "").toLowerCase(),
    inputMode: (constraints.inputMode ?? "").toLowerCase(),
    constraints,
  };
}

/** Same-length substitution or adjacent transposition. Skips short keys (`age`/`page`). */
function sameLengthEdit1(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 5) return false;
  let diffs = 0;
  let first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    diffs += 1;
    if (diffs === 1) {
      first = i;
      continue;
    }
    if (diffs === 2 && i === first + 1 && a[first] === b[i] && a[i] === b[first]) continue;
    return false;
  }
  return diffs === 1 || diffs === 2;
}

/**
 * Alias hits from id/name tokens. Exact > compact contains > same-length typo.
 * Contains requires leftover on each side empty or ≥2 so `estate` does not become `state`.
 */
function aliasScores(ctx: FillCtx): Map<string, number> {
  const scores = new Map<string, number>();
  const bump = (ruleId: string, score: number) => {
    scores.set(ruleId, Math.max(scores.get(ruleId) ?? 0, score));
  };
  for (const t of ctx.tokens) {
    const ruleId = ALIASES[t];
    if (ruleId) bump(ruleId, 96);
  }
  const compact = ctx.compact;
  if (compact.length >= 5) {
    for (const [alias, ruleId] of Object.entries(ALIASES)) {
      if (alias.length < 5) continue;
      const i = compact.indexOf(alias);
      if (i === -1) continue;
      const before = i;
      const after = compact.length - i - alias.length;
      if (before > 0 && before < 2) continue;
      if (after > 0 && after < 2) continue;
      bump(ruleId, 90);
    }
  }
  for (const t of ctx.tokens) {
    if (t.length < 5 || ALIASES[t]) continue;
    const hits: string[] = [];
    for (const [alias, ruleId] of Object.entries(ALIASES)) {
      if (sameLengthEdit1(t, alias)) hits.push(ruleId);
    }
    const unique = [...new Set(hits)];
    if (unique.length === 1) bump(unique[0]!, 82);
  }
  return scores;
}

function has(ctx: FillCtx, ...toks: string[]): boolean {
  return toks.every((t) => ctx.tokens.has(t));
}

function hasAny(ctx: FillCtx, ...toks: string[]): boolean {
  return toks.some((t) => ctx.tokens.has(t));
}

function auto(ctx: FillCtx, ...keys: string[]): boolean {
  return ctx.autocomplete.some((a) => keys.includes(a));
}

function html(ctx: FillCtx, ...types: string[]): boolean {
  return types.includes(ctx.htmlType);
}

function mode(ctx: FillCtx, ...modes: string[]): boolean {
  return modes.includes(ctx.inputMode);
}

function fieldType(ctx: FillCtx, ...types: NonNullable<ShownField["type"]>[]): boolean {
  return ctx.type !== undefined && types.includes(ctx.type);
}

function isNumberInput(ctx: FillCtx): boolean {
  return html(ctx, "number", "range") || fieldType(ctx, "number") || mode(ctx, "numeric", "decimal");
}

/** Name says currency. A code/picker is not money unless the control is a number. */
function looksLikeCurrency(ctx: FillCtx): boolean {
  return has(ctx, "currency") || ctx.compact.includes("currency");
}

function parseNum(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function clampRange(min: number, max: number): { min: number; max: number } {
  if (min > max) return { min: max, max: min };
  return { min, max };
}

function genNumber(faker: Faker, ctx: FillCtx, fallbackMin: number, fallbackMax: number): string {
  const parsedMin = parseNum(ctx.constraints.min);
  const parsedMax = parseNum(ctx.constraints.max);
  const { min, max } = clampRange(parsedMin ?? fallbackMin, parsedMax ?? fallbackMax);
  const step = parseNum(ctx.constraints.step);
  try {
    if (step !== undefined && step > 0 && step < 1) {
      return String(faker.number.float({ min, max, multipleOf: step }));
    }
    const multipleOf = step !== undefined && step >= 1 && Number.isInteger(step) ? step : 1;
    return String(faker.number.int({ min: Math.ceil(min), max: Math.floor(max), multipleOf }));
  } catch {
    return String(min);
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ymdhm(d: Date): string {
  return d.toISOString().slice(0, 16);
}

function genDate(faker: Faker, ctx: FillCtx, kind: "date" | "datetime" | "month"): string {
  const from = ctx.constraints.min ? new Date(ctx.constraints.min) : faker.date.past({ years: 2 });
  const to = ctx.constraints.max ? new Date(ctx.constraints.max) : faker.date.soon({ days: 60 });
  const start = Number.isNaN(from.getTime()) ? faker.date.past({ years: 1 }) : from;
  const end = Number.isNaN(to.getTime()) ? faker.date.soon({ days: 30 }) : to;
  const d =
    start.getTime() <= end.getTime()
      ? faker.date.between({ from: start, to: end })
      : start;
  if (kind === "month") return d.toISOString().slice(0, 7);
  if (kind === "datetime") return ymdhm(d);
  return dateFillValue(ymd(d), {
    placeholder: ctx.constraints.placeholder,
    htmlType: ctx.htmlType,
    fieldType: ctx.type,
  });
}

function genEmail(faker: Faker, ctx: FillCtx): string {
  const max = ctx.constraints.maxLength;
  if (max !== undefined && max < 16) {
    const n = Math.max(1, max - 12);
    return `${faker.string.alpha({ length: n, casing: "lower" })}@example.com`.slice(0, max);
  }
  return faker.internet.exampleEmail({ allowSpecialCharacters: false });
}

function genPassword(faker: Faker, ctx: FillCtx): string {
  const min = ctx.constraints.minLength ?? 10;
  const max = ctx.constraints.maxLength ?? Math.max(min, 16);
  const length = Math.min(Math.max(min, 10), max);
  return faker.internet.password({ length, memorable: false });
}

function genPhone(faker: Faker, ctx: FillCtx): string {
  const max = ctx.constraints.maxLength;
  const pattern = ctx.constraints.pattern ?? "";
  const digitsOnly = max !== undefined && max <= 11 || /^\[[0-9\\d]+\]/.test(pattern) || pattern.includes("\\d");
  if (digitsOnly || max !== undefined && max <= 15) {
    const len = max ?? 10;
    return faker.string.numeric({ length: Math.min(Math.max(len, 7), 15), allowLeadingZeros: false });
  }
  return faker.phone.number({ style: "national" });
}

function genZip(faker: Faker, ctx: FillCtx): string {
  const max = ctx.constraints.maxLength;
  if (max !== undefined && max <= 5) return faker.string.numeric(5).slice(0, max);
  return faker.location.zipCode();
}

function genText(faker: Faker, ctx: FillCtx, words: number): string {
  const max = ctx.constraints.maxLength;
  const text = faker.lorem.words(words);
  if (max !== undefined && text.length > max) return text.slice(0, max).trim();
  return text;
}

const RULES: FillRule[] = [
  {
    id: "email",
    score: (c) =>
      auto(c, "email") || html(c, "email") || fieldType(c, "email") || mode(c, "email") || has(c, "email")
        ? 100
        : 0,
    generate: genEmail,
  },
  {
    id: "username",
    score: (c) =>
      auto(c, "username") || has(c, "username") ? 95 : has(c, "user") && has(c, "name") && !hasAny(c, "first", "last") ? 80 : 0,
    generate: (f) => f.internet.username(),
  },
  {
    id: "password",
    score: (c) =>
      auto(c, "new-password", "current-password") || html(c, "password") || fieldType(c, "password") || has(c, "password")
        ? 100
        : 0,
    generate: genPassword,
  },
  {
    id: "otp",
    score: (c) => (auto(c, "one-time-code") || hasAny(c, "otp", "totp") || (has(c, "code") && hasAny(c, "sms", "auth", "verify", "mfa")) ? 95 : 0),
    generate: (f, c) => f.string.numeric(c.constraints.maxLength ?? c.constraints.minLength ?? 6),
  },
  {
    id: "firstName",
    score: (c) => (auto(c, "given-name") || (has(c, "first") && has(c, "name")) || has(c, "firstname") ? 90 : 0),
    generate: (f) => f.person.firstName(),
  },
  {
    id: "lastName",
    score: (c) =>
      auto(c, "family-name") || (has(c, "last") && has(c, "name")) || hasAny(c, "lastname", "surname") ? 90 : 0,
    generate: (f) => f.person.lastName(),
  },
  {
    id: "middleName",
    score: (c) => (auto(c, "additional-name") || (has(c, "middle") && has(c, "name")) ? 90 : 0),
    generate: (f) => f.person.middleName(),
  },
  {
    id: "fullName",
    score: (c) =>
      auto(c, "name") || has(c, "fullname") || (has(c, "full") && has(c, "name"))
        ? 85
        : has(c, "name") && !hasAny(c, "user", "organization", "file", "schema", "display", "first", "last", "middle")
          ? 55
          : 0,
    generate: (f) => f.person.fullName(),
  },
  {
    id: "jobTitle",
    score: (c) =>
      auto(c, "organization-title") || hasAny(c, "jobtitle", "job") || (has(c, "title") && hasAny(c, "job", "role", "position"))
        ? 88
        : 0,
    generate: (f) => f.person.jobTitle(),
  },
  {
    id: "phone",
    score: (c) =>
      auto(c, "tel", "tel-national", "tel-local", "tel-country-code") ||
      html(c, "tel") ||
      mode(c, "tel") ||
      has(c, "phone")
        ? 92
        : 0,
    generate: genPhone,
  },
  {
    id: "url",
    score: (c) => (auto(c, "url") || html(c, "url") || mode(c, "url") || has(c, "url") ? 90 : 0),
    generate: (f) => f.internet.url(),
  },
  {
    id: "street",
    score: (c) =>
      auto(c, "street-address", "address-line1") ||
      hasAny(c, "street", "addressline1", "places") ||
      (has(c, "address") && !hasAny(c, "email", "ip", "type")) ||
      (hasAny(c, "place", "places", "geo", "location") && hasAny(c, "search", "q", "query"))
        ? 86
        : 0,
    generate: (f) => f.location.streetAddress(),
  },
  {
    id: "line2",
    score: (c) => (auto(c, "address-line2") || hasAny(c, "addressline2", "apt", "suite", "unit") ? 86 : 0),
    generate: (f) => f.location.secondaryAddress(),
  },
  {
    id: "city",
    score: (c) => (auto(c, "address-level2") || hasAny(c, "city", "town") ? 86 : 0),
    generate: (f) => f.location.city(),
  },
  {
    id: "state",
    score: (c) => (auto(c, "address-level1") || hasAny(c, "state", "province", "region") ? 86 : 0),
    generate: (f) => f.location.state({ abbreviated: true }),
  },
  {
    id: "zip",
    score: (c) => (auto(c, "postal-code") || has(c, "zip") ? 90 : 0),
    generate: genZip,
  },
  {
    id: "country",
    score: (c) => (auto(c, "country", "country-name") || has(c, "country") ? 86 : 0),
    generate: (f, c) =>
      hasAny(c, "code", "iso") || (c.constraints.maxLength !== undefined && c.constraints.maxLength <= 3)
        ? f.location.countryCode()
        : f.location.country(),
  },
  {
    id: "organization",
    score: (c) => (auto(c, "organization") || has(c, "organization") ? 88 : 0),
    generate: (f) => f.company.name(),
  },
  {
    id: "ccNumber",
    score: (c) => (auto(c, "cc-number") || (hasAny(c, "card", "cc", "credit") && hasAny(c, "number", "num", "no")) ? 94 : 0),
    generate: (f) => f.finance.creditCardNumber().replace(/\D/g, ""),
  },
  {
    id: "ccCsc",
    score: (c) => (auto(c, "cc-csc") || has(c, "csc") ? 94 : 0),
    generate: (f) => f.finance.creditCardCVV(),
  },
  {
    id: "ccExp",
    score: (c) => (auto(c, "cc-exp") || (hasAny(c, "exp", "expiry", "expiration") && hasAny(c, "date", "card", "cc")) ? 90 : 0),
    generate: (f) => {
      const d = f.date.future({ years: 4 });
      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
    },
  },
  {
    id: "iban",
    score: (c) => (has(c, "iban") ? 94 : 0),
    generate: (f) => f.finance.iban(),
  },
  {
    id: "ssn",
    score: (c) => (hasAny(c, "ssn", "ein", "tin") ? 90 : 0),
    generate: (f, c) => {
      const n = f.string.numeric(9);
      // EIN / tax id is 2-7; SSN is 3-2-4. `ein` synonyms include `ssn`.
      if (hasAny(c, "ein", "tin")) return `${n.slice(0, 2)}-${n.slice(2)}`;
      return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
    },
  },
  {
    id: "recordCode",
    score: (c) => (has(c, "recordcode") ? 88 : 0),
    generate: (f, c) => {
      const max = c.constraints.maxLength ?? 10;
      const min = Math.min(c.constraints.minLength ?? 6, max);
      const len = Math.max(min, Math.min(max, 8));
      return f.string.alphanumeric({ length: len, casing: "upper" });
    },
  },
  {
    id: "domain",
    score: (c) => (hasAny(c, "domain", "hostname") ? 85 : 0),
    generate: (f) => f.internet.domainName(),
  },
  {
    id: "hash",
    score: (c) => (hasAny(c, "hash", "sha", "md5") ? 80 : 0),
    generate: (f) => f.string.hexadecimal({ length: 32, prefix: "" }),
  },
  {
    id: "account",
    score: (c) => (has(c, "account") && hasAny(c, "number", "num", "no", "routing") ? 80 : has(c, "routing") ? 80 : 0),
    generate: (f, c) => (has(c, "routing") ? f.finance.routingNumber() : f.finance.accountNumber()),
  },
  {
    id: "currencyCode",
    score: (c) => (looksLikeCurrency(c) && !isNumberInput(c) ? 86 : 0),
    generate: (f) => f.finance.currencyCode(),
  },
  {
    id: "amount",
    score: (c) =>
      auto(c, "transaction-amount") ||
      hasAny(c, "price", "cost", "salary", "amount") ||
      (looksLikeCurrency(c) && isNumberInput(c))
        ? 75
        : 0,
    generate: (f, c) => {
      const min = parseNum(c.constraints.min) ?? 1;
      const max = parseNum(c.constraints.max) ?? 999;
      return f.finance.amount({ min, max, dec: 2 });
    },
  },
  {
    id: "birthdate",
    score: (c) => (auto(c, "bday") || has(c, "birth") ? 90 : 0),
    generate: (f, c) => {
      const d = f.date.birthdate({ min: 18, max: 80, mode: "age" });
      const min = c.constraints.min ? new Date(c.constraints.min) : undefined;
      const max = c.constraints.max ? new Date(c.constraints.max) : undefined;
      if (min && d < min) return ymd(min);
      if (max && d > max) return ymd(max);
      return ymd(d);
    },
  },
  {
    id: "date",
    score: (c) =>
      html(c, "date") ||
      fieldType(c, "date") ||
      looksLikeDateMask(c.constraints.placeholder) ||
      (has(c, "date") && !has(c, "time")) ||
      looksLikeDateFieldName(c.id) ||
      (has(c, "due") && hasAny(c, "from", "to", "on")) ||
      compactLooksLikeDateField(c.compact)
        ? 70
        : 0,
    generate: (f, c) => genDate(f, c, "date"),
  },
  {
    id: "datetime",
    score: (c) => (html(c, "datetime-local") || fieldType(c, "datetime") || hasAny(c, "datetime", "timestamp") ? 80 : 0),
    generate: (f, c) => genDate(f, c, "datetime"),
  },
  {
    id: "time",
    score: (c) => (html(c, "time") || (has(c, "time") && !hasAny(c, "date", "datetime")) ? 80 : 0),
    generate: (f) => {
      const d = f.date.anytime();
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    },
  },
  {
    id: "month",
    score: (c) => (html(c, "month") || (has(c, "month") && !has(c, "cc")) ? 75 : 0),
    generate: (f, c) => genDate(f, c, "month"),
  },
  {
    id: "year",
    score: (c) => (auto(c, "bday-year") || (has(c, "year") && !hasAny(c, "cc")) ? 80 : 0),
    generate: (f, c) => genNumber(f, c, 1970, 2030),
  },
  {
    id: "age",
    score: (c) => (has(c, "age") ? 85 : 0),
    generate: (f, c) => genNumber(f, c, 18, 90),
  },
  {
    id: "quantity",
    score: (c) => (hasAny(c, "quantity", "qty") ? 80 : 0),
    generate: (f, c) => genNumber(f, c, 1, 20),
  },
  {
    id: "percent",
    score: (c) => (hasAny(c, "percent", "percentage", "pct") ? 80 : 0),
    generate: (f, c) => genNumber(f, c, 0, 100),
  },
  {
    id: "rating",
    score: (c) => (hasAny(c, "rating", "stars") ? 80 : 0),
    generate: (f, c) => genNumber(f, c, 1, 5),
  },
  {
    id: "number",
    score: (c) =>
      html(c, "number", "range") || fieldType(c, "number") || mode(c, "numeric", "decimal") ? 60 : 0,
    generate: (f, c) => genNumber(f, c, 1, 99),
  },
  {
    id: "color",
    score: (c) => (html(c, "color") || hasAny(c, "color", "colour") ? 80 : 0),
    generate: (f) => f.color.rgb({ prefix: "#" }),
  },
  {
    id: "uuid",
    score: (c) => (hasAny(c, "uuid", "guid") ? 90 : 0),
    generate: (f) => f.string.uuid(),
  },
  {
    id: "ip",
    score: (c) => (has(c, "ipv6") ? 90 : has(c, "ip") || has(c, "ipv4") ? 88 : 0),
    generate: (f, c) => (has(c, "ipv6") ? f.internet.ipv6() : f.internet.ipv4()),
  },
  {
    id: "lat",
    score: (c) => (hasAny(c, "lat", "latitude") ? 88 : 0),
    generate: (f) => String(f.location.latitude()),
  },
  {
    id: "lng",
    score: (c) => (hasAny(c, "lng", "lon", "longitude") ? 88 : 0),
    generate: (f) => String(f.location.longitude()),
  },
  {
    id: "vin",
    score: (c) => (has(c, "vin") ? 90 : 0),
    generate: (f) => f.vehicle.vin(),
  },
  {
    id: "filename",
    score: (c) => (hasAny(c, "filename", "file") && hasAny(c, "name", "filename") ? 70 : has(c, "filename") ? 85 : 0),
    generate: (f) => f.system.fileName(),
  },
  {
    id: "sex",
    score: (c) => (auto(c, "sex") || hasAny(c, "sex", "gender") ? 80 : 0),
    generate: (f) => f.person.sex(),
  },
  {
    id: "search",
    score: (c) =>
      html(c, "search") || hasAny(c, "q", "query", "search", "filter", "find") ? 72 : 0,
    generate: (f, c) => genText(f, c, 1),
  },
  {
    id: "title",
    score: (c) => (has(c, "title") ? 45 : 0),
    generate: (f, c) => genText(f, c, 3),
  },
  {
    id: "textarea",
    score: (c) =>
      fieldType(c, "textarea") || hasAny(c, "description", "note", "comment", "message", "bio", "body", "summary")
        ? 50
        : 0,
    generate: (f, c) => {
      const max = c.constraints.maxLength;
      const text = f.lorem.sentences({ min: 1, max: 2 });
      if (max !== undefined && text.length > max) return text.slice(0, max).trim();
      return text;
    },
  },
  {
    id: "text",
    score: (c) => (fieldType(c, "text") || !c.type ? 10 : 0),
    generate: (f, c) => genText(f, c, 2),
  },
];

export function pickFillRule(field: ShownField): FillRule {
  const ctx = fillContext(field);
  const alias = aliasScores(ctx);
  let best: FillRule = RULES[RULES.length - 1]!;
  let bestScore = -1;
  for (const rule of RULES) {
    const score = Math.max(rule.score(ctx), alias.get(rule.id) ?? 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

export function fillRuleId(field: ShownField): string {
  return pickFillRule(field).id;
}

function fakerFromRng(rng: () => number): Faker {
  return new Faker({
    locale: en,
    randomizer: {
      next: () => {
        const n = rng();
        if (!Number.isFinite(n) || n <= 0) return 0;
        if (n >= 1) return 1 - Number.EPSILON;
        return n;
      },
      seed: () => undefined,
    },
  });
}

function applyLength(value: string, ctx: FillCtx, faker: Faker): string {
  const max = ctx.constraints.maxLength;
  let min = ctx.constraints.minLength;
  if (min !== undefined && max !== undefined && min > max) min = max;
  let out = value;
  if (max !== undefined && out.length > max) out = out.slice(0, max).trimEnd();
  if (min !== undefined && out.length < min) {
    out += faker.string.alpha({ length: min - out.length, casing: "lower" });
  }
  return out;
}

function applyPattern(generate: () => string, pattern: string | undefined): string {
  if (!pattern) return generate();
  try {
    const re = new RegExp(`^(?:${pattern})$`);
    let last = "";
    for (let i = 0; i < 8; i++) {
      last = generate();
      if (re.test(last)) return last;
    }
    return last;
  } catch {
    return generate();
  }
}

/** Random plausible value from field name, type, autocomplete, and live min/max/length. */
export function fakerFill(field: ShownField, rng: () => number = Math.random): string {
  const ctx = fillContext(field);
  const faker = fakerFromRng(rng);
  const rule = pickFillRule(field);
  const once = () => {
    try {
      return rule.generate(faker, ctx);
    } catch {
      return "x";
    }
  };
  const raw = applyPattern(once, ctx.constraints.pattern);
  const next = applyLength(raw, ctx, faker);
  const pattern = ctx.constraints.pattern;
  if (!pattern) return next;
  try {
    const re = new RegExp(`^(?:${pattern})$`);
    if (re.test(raw) && !re.test(next)) return raw;
  } catch {
    /* invalid pattern already ignored in applyPattern */
  }
  return next;
}
