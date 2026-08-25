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
export {
  listReports,
  readReport,
  writeReportFolder,
  reportMarkdownPath,
  plannedReportPath,
  LEGACY_REPORT_ID,
} from "./persist/reports.js";
export { withRun } from "./executor/session.js";
export type { RunHandle } from "./executor/session.js";
export { toPlaywrightLocator, widgetLocator } from "./executor/locators.js";
export { liveValidate } from "./executor/live-validate.js";
export type { LiveFailure } from "./executor/live-validate.js";
export {
  clipFillValue,
  clearTrackedFills,
  fieldLooksInvalid,
  fillCtxForPageError,
  fillShouldLookInvalid,
  fillValueInRequest,
  readFieldValidity,
  rememberTrackedFill,
  requestCarriesFill,
  requestLooksLikeWrite,
  upsertTrackedFill,
  validationMissesToReport,
} from "./executor/field-validity.js";
export type { FieldValidity, TrackedFill, WatchedRequest } from "./executor/field-validity.js";
export { resolveCount } from "./surveyor/resolve.js";
export { inspect, inspectAndSaveConfig } from "./surveyor/inspect.js";
export { templatizePath, looksParametric, pathHasParams, ledgerPath } from "./surveyor/path-template.js";
export {
  applyPageDescription,
  applyMissingPageDescriptions,
  applyVisionBlurb,
  visionMayDescribe,
  descriptionRank,
  descriptionSourceMayWrite,
  mechanicalDescription,
  polishPageDescription,
  pageNotesFromModel,
} from "./surveyor/describe.js";
export { recordPageLedgers } from "./surveyor/record.js";
export {
  blurbLooksLikeLoading,
  htmlLooksLikeLoading,
  textIsLoadingPlaceholder,
} from "./surveyor/loading.js";
export {
  dropPayloadContentVisual,
  examineScreenshot,
  hashPngFile,
  shouldSkipVision,
  visionPass,
  parseVisualReply,
  probeVisionChat,
  VISION_PROBE,
  VISUAL_RULES,
  VISUAL_BLURB_PROMPT,
  VISUAL_PROMPT,
} from "./surveyor/vision.js";
export type { ParsedVisualReply, VisualRule, VisualScan, VisualScanResult } from "./surveyor/vision.js";
export { scanTableLayout } from "./surveyor/scanline.js";
export type { LayoutHit } from "./surveyor/scanline.js";
export { scanLayout, type LayoutScan } from "./surveyor/layout.js";
export { sparseLayoutIssue, sparseMetrics } from "./surveyor/sparse.js";
export type { SparseBox, SparseMetrics, SparsePane, SparseSample } from "./surveyor/sparse.js";
export { scanOverflow, scanOverflowMobile, scanOverflowReflow } from "./surveyor/overflow.js";
export { scanBroken } from "./surveyor/broken.js";
export { scanTextClip } from "./surveyor/text-clip.js";
export { scanOverlap } from "./surveyor/overlap.js";
export { scanListScanline } from "./surveyor/list-scanline.js";
export { scanTargetSize } from "./surveyor/target-size.js";
export { scanFocusObscured } from "./surveyor/focus-obscured.js";
export { scanFocusVisible } from "./surveyor/focus-visible.js";
export { scanTextOcclusion } from "./surveyor/text-occlusion.js";
export { scanFontSize } from "./surveyor/font-size.js";
export { scanTextSpacing } from "./surveyor/text-spacing.js";
export { scanDeadHash } from "./surveyor/dead-hash.js";
export { scanImplicitSubmit } from "./surveyor/implicit-submit.js";
export { scanNoopener } from "./surveyor/noopener.js";
export { scanScrollPadding } from "./surveyor/scroll-padding.js";
export { scanPointerEvents } from "./surveyor/pointer-events.js";
export { validateHtml } from "./surveyor/html.js";
export { scanA11y, TAGS as A11Y_TAGS, EXTRA_RULES as A11Y_EXTRA_RULES } from "./surveyor/a11y.js";
export { scanSeo, scanSeoHtml, seoIsPrivate, issuesFromMeta, metaFromHtml, applyDuplicateTitles } from "./surveyor/seo.js";
export type { PageMeta } from "./surveyor/seo.js";
export { auditVisible, formatTestabilityLine } from "./surveyor/audit.js";
export type { InspectResult, SurveyorContext } from "./surveyor/inspect.js";
export { captureStepShot } from "./executor/steps.js";
export { createExecutor, attachOracles } from "./executor/run.js";
export type { AfterStep, RunState, StepResult } from "./executor/run.js";
export { bootRun, locatorsFromModel, attachInspectAfterStep } from "./executor/boot.js";
export {
  attachNavLog,
  formatClock,
  formatLiveLine,
  formatNavLine,
  logLand,
  logBrainDecide,
  logSight,
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
  ExploreSession,
  applyExploreStep,
  createExploreWalk,
  exploreVisitOf,
  snapshotView,
  withPriorLast,
  writeSessionMd,
  EXPLORE_REPORT_PROMPT,
  replayLog,
  replayReport,
  ReplayLiveValidateError,
  compactLog,
  hoppedStepIndexes,
  replayableSteps,
  keysFromSteps,
  listSpecFiles,
  checkSpecFile,
  formatCheckReport,
  runSpecs,
  formatSpecResults,
  formatSpecTable,
  surveyorErrorCount,
  surveyorShouldFail,
} from "./playbooks/index.js";
export type {
  EmptyRequiredResult,
  UnleashResult,
  ExploreResult,
  ExploreStepResult,
  ExploreStepOpts,
  ExploreWalkCtx,
  ExploreWalkOpts,
  ReplayReportResult,
  SpecCheckCase,
  SpecCheckFileResult,
  SpecRunCase,
  SpecRunResult,
} from "./playbooks/index.js";
export { extractClickmonkeyFences, isFindingsReport } from "./reports/fences.js";
export {
  renderFindingsReport,
  enrichWithBrain,
  writeRunsReport,
} from "./reports/findings-report.js";
export { whyFinding, whyFindingBlock, whyRule } from "./reports/why.js";
export { identityFromRunId, pickDistinctHue, HUE_SLOTS } from "./ui/identity.js";
export { buildUiGraph, badgeCounts, findingOnPage, hopsFromNavLog } from "./ui/graph.js";
export { buildUiSnapshot } from "./ui/snapshot.js";
export { buildRunDetail } from "./ui/run-detail.js";
export { startUiServer, UI_DEFAULT_PORT, resolveUiRoot } from "./ui/server.js";
export { stopUi, readUiPid, spawnDetachedUi, uiSpawnArgs, uiPidPath } from "./ui/pid.js";
export { writeBundle, freezeSnapshot } from "./ui/bundle.js";
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
  loadMapPages,
  stampFog,
  recordFog,
  recordMode,
  resetFog,
  leftoverFogPath,
  shouldStampFog,
  formatFogStatus,
  absorbLeftoverFog,
} from "./persist/fog.js";
export {
  unleashBrain,
  mapBrain,
  decideUnleash,
  decideMap,
  hopPage,
  isWriteAction,
  isLeaveAction,
  isDismissAction,
  legalUnleashActions,
  matchesSkip,
  navigateActions,
  pickAction,
  inPageActions,
  stayActions,
  isPageHop,
  isRecordRowAction,
  looksLikeNavWidget,
  looksLikeSearchField,
  looksLikeRowSelectCheckbox,
  isEmptyStateAction,
  isTabAction,
  isDialogOpener,
  dialogOpeners,
  sharedChromeIds,
  formSubmitAction,
  formSubmitActions,
  formDismissAction,
  decideForm,
  pickSelectOption,
  plausibleFill,
  formatClick,
  rememberClick,
  freshClicks,
  withoutNoops,
  usableClicks,
  viewWidgetSig,
  clickWasNoop,
  clickKey,
  isListChrome,
  listModeScore,
  LANDMARK_BIAS,
  FORM_BURST_MAX,
  FORM_DISMISS_RATE,
  RECENT_CLICK_WINDOW,
  RECENT_CLICK_LIMIT,
  LIST_CHROME_LIMIT,
} from "./brains/unleash.js";
export {
  detectWalkerMode,
  UNLEASH_MODES,
  isFormWorkNote,
  isFormCommitNote,
  shouldStampMode,
  lineMatchesMode,
} from "./brains/walker-mode.js";
export {
  jobOfBrain,
  monkeyOfBrain,
  pageFogTimes,
  jobFogTimes,
  jobFogOf,
  modeFogTimes,
  modeFogKey,
  mergePageFog,
} from "./schema/fog.js";
export type { WalkerJobName, WalkerModeName, MonkeyName } from "./schema/fog.js";
export {
  floodNpc,
  formatNpcStep,
  npcHunger,
  fogHunger,
  FOG_FRESH_MS,
  FOG_OLD_MS,
  staleMsForPage,
  npcKey,
  npcScore,
  pageSurfaceId,
  planNpc,
} from "./brains/npc.js";
export type { NpcEdge, NpcGoal, NpcNode, NpcPlan, NpcReach } from "./brains/npc.js";
export {
  decideFormHunt,
  floodHunt,
  formGoalKey,
  huntHunger,
  huntScore,
  isMapFormSurface,
  mapFormGoals,
  FORM_HUNT_STAY_RATE,
  FORM_HUNT_RETHINK,
  LOOT_EXPLORE_STEPS,
} from "./brains/form-hunt.js";
export type { FormGoal, HuntEdge, HuntNode, HuntReach } from "./brains/form-hunt.js";
export { decideMapScout, fogClicks, visitKey } from "./brains/map-scout.js";
export type { WalkerMode } from "./brains/walker-mode.js";
export { decisionLines } from "./brains/types.js";
export { fakerFill, fillRuleId } from "./brains/faker-fill.js";
export { pickNasty, pickNastyFill, decideUnleashNasty, listCatalogs, samplePayloads, textContainsNastyPayload } from "./brains/nasty.js";
export type { NastyCatalogInfo } from "./brains/nasty.js";
export {
  createExploreBrain,
  ExploreError,
  EXPLORE_DECIDE_RETRIES,
  isScreenshotLine,
  isVisualCharter,
  isBrainMissFinding,
  isNewProductFinding,
  legalOpenIds,
  legalDirectOpenIds,
  isDirectOpenPage,
  pathParentPage,
  wouldRepeatCycle,
  probeExploreChat,
  checkExploreLine,
  draftExplorePlan,
  formatPlanningCards,
  formatReachDag,
  formatExplorePlan,
  parseExplorePlanReply,
  completeCurrentPlanItem,
  EXPLORE_PLAN_PROMPT,
  EXPLORE_PLAN_SYSTEM,
} from "./brains/explore.js";
export { chat } from "./brains/chat.js";
export type {
  ChatClient,
  ChatContent,
  ChatContentPart,
  ChatImageUrl,
  ChatMessage,
  ChatRequest,
} from "./brains/chat.js";
export type { Brain, BrainContext, BrainDecision } from "./brains/types.js";
