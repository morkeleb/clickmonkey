export const version = "2.0.0-alpha.0";
export * from "./schema/index.js";
export * from "./surveyor/ids.js";
export * from "./surveyor/merge.js";
export * from "./persist/config.js";
export * from "./persist/workspace.js";
export * from "./persist/broken.js";
export * from "./persist/testability.js";
export * from "./persist/quality.js";
export * from "./persist/log.js";
export * from "./persist/finding.js";
export * from "./persist/run-id.js";
export * from "./persist/events.js";
export { withRun } from "./executor/session.js";
export type { RunHandle } from "./executor/session.js";
export { toPlaywrightLocator, widgetLocator } from "./executor/locators.js";
export { liveValidate } from "./executor/live-validate.js";
export type { LiveFailure } from "./executor/live-validate.js";
export { resolveCount } from "./surveyor/resolve.js";
export { inspect, inspectAndSaveConfig } from "./surveyor/inspect.js";
export { recordPageLedgers } from "./surveyor/record.js";
export { validateHtml } from "./surveyor/html.js";
export { scanA11y } from "./surveyor/a11y.js";
export { auditVisible, formatTestabilityLine } from "./surveyor/audit.js";
export type { InspectResult, SurveyorContext } from "./surveyor/inspect.js";
export { createExecutor, attachOracles } from "./executor/run.js";
export type { AfterStep, RunState, StepResult } from "./executor/run.js";
export { bootRun, locatorsFromModel, attachInspectAfterStep } from "./executor/boot.js";
export {
  attachNavLog,
  formatClock,
  formatLiveLine,
  formatNavLine,
  logLand,
  logStepDone,
  logStepStart,
} from "./executor/nav-log.js";
export type { NavEvent, NavVia, NavMeta } from "./executor/nav-log.js";
export { buildView, formatView } from "./executor/view.js";
export { readLook, firstFamily, pickFonts, formatFont } from "./executor/look.js";
export { checkFence, pathPrefixMatch } from "./executor/fence.js";
export { resolveSecret, resolveSecretAsync, isSecretToken } from "./executor/secrets.js";
export { isPotentialWrite } from "./executor/write-policy.js";
export {
  runEmptyRequired,
  runUnleash,
  runExplore,
  replayLog,
  replayReport,
  ReplayLiveValidateError,
  compactLog,
  hoppedStepIndexes,
  replayableSteps,
  keysFromSteps,
} from "./playbooks/index.js";
export type { EmptyRequiredResult, UnleashResult, ExploreResult, ReplayReportResult } from "./playbooks/index.js";
export { extractClickmonkeyFences, isFindingsReport } from "./reports/fences.js";
export { renderFindingsReport, renderQualitySection, enrichWithBrain } from "./reports/findings-report.js";
export { identityFromRunId } from "./ui/identity.js";
export { buildUiGraph, badgeCounts, hopsFromNavLog } from "./ui/graph.js";
export { buildUiSnapshot } from "./ui/snapshot.js";
export { buildRunDetail } from "./ui/run-detail.js";
export { startUiServer, UI_DEFAULT_PORT } from "./ui/server.js";
export type { UiServer, UiServerOpts } from "./ui/server.js";
export {
  startPresence,
  touchPresence,
  stopPresence,
  isPresenceLive,
  listPresences,
} from "./persist/presence.js";
export { collectFindingCases, listRuns } from "./persist/runs.js";
export {
  unleashBrain,
  mapBrain,
  decideUnleash,
  decideMap,
  hopPage,
  isWriteAction,
  isLeaveAction,
  matchesSkip,
  navigateActions,
  pickAction,
  formatClick,
  LANDMARK_BIAS,
} from "./brains/unleash.js";
export { pickNasty, decideUnleashNasty } from "./brains/nasty.js";
export { createExploreBrain } from "./brains/explore.js";
export { chat } from "./brains/chat.js";
export type { ChatClient, ChatMessage, ChatRequest } from "./brains/chat.js";
export type { Brain, BrainContext, BrainDecision } from "./brains/types.js";
