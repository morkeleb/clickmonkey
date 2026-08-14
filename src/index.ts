export const version = "2.0.0-alpha.0";
export * from "./schema/index.js";
export { withRun } from "./executor/session.js";
export type { RunHandle } from "./executor/session.js";
export { toPlaywrightLocator } from "./executor/locators.js";
export { liveValidate } from "./executor/live-validate.js";
export type { LiveFailure } from "./executor/live-validate.js";
export { resolveCount } from "./surveyor/resolve.js";
