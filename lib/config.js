'use strict';

const guards = require('./guards');
const { parseList, positiveNumber, nonNegativeNumber } = require('./util');

const DEFAULT_ALLOWED_ACTIONS = [
  'getState',
  'setState',
  'listStates',
  'getStates',
  'ping',
  'handleIntent',
  'executePlan',
  'validatePlan',
  'emitContextEvent',
  'getContextEvents',
  'handlePvSurplus',
  'help',
  'speak',
  'transcribe',
  'voiceCommand',
  'batchSetStates',
  'syncSnapshot',
  'getTelemetry',
  'recordObservation',
  'getHabits',
  'getLearningStatus',
  'setHabitMode',
  'evaluateHabits',
  'suggestAutomation',
  'applyHabit',
  'optimizeHome',
  'checkGuards',
  'getConstraints',
  'planWithinBounds',
  'describeTools',
  'getPendingConfirmations',
  'cancelConfirmation',
];

/** Read-only discovery actions that stay available even with a custom whitelist. */
const ALWAYS_ALLOWED_ACTIONS = ['ping', 'help', 'describeTools', 'getPendingConfirmations'];

const HABIT_MODES = ['observe', 'suggest', 'autonomous'];
const CONFIRMATION_MODES = ['agent', 'human'];
const WEBHOOK_MODES = ['agent', 'wake'];
const NOTIFY_EVENTS = [
  'guard_block',
  'max_on_elapsed',
  'confirmation_pending',
  'confirmation_resolved',
  'habit_mode_changed',
  'state_changed',
];

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeConfig(config = {}) {
  const allowedActions = parseList(config.allowedActions, DEFAULT_ALLOWED_ACTIONS);
  for (const action of ALWAYS_ALLOWED_ACTIONS) {
    if (!allowedActions.includes(action)) allowedActions.push(action);
  }

  return {
    allowedPrefixes: parseList(config.allowedPrefixes, ['javascript.0', '0_userdata.0']),
    allowedActions,
    commandTimeoutMs: positiveNumber(config.commandTimeoutMs, 5000),
    setStateAckAllowed: config.setStateAckAllowed !== false,
    criticalStatePrefixes: parseList(config.criticalStatePrefixes, ['system.', 'admin.0']),
    requireConfirmationActions: parseList(config.requireConfirmationActions, ['executePlan']),
    comfortTemperatureStateId: config.comfortTemperatureStateId || '0_userdata.0.hvac.livingRoom.targetTemperature',
    comfortTempStep: positiveNumber(config.comfortTempStep, 1),
    contextEventHistoryLimit: positiveNumber(config.contextEventHistoryLimit, 50),
    pvSurplusMinWatts: positiveNumber(config.pvSurplusMinWatts, 1500),
    pvSurplusLoadStateId: config.pvSurplusLoadStateId || '0_userdata.0.energy.pvSurplusMode',
    pvPowerStateId: config.pvPowerStateId || '0_userdata.0.energy.pvSurplusWatts',
    surplusLoads: guards.parseSurplusLoads(config.surplusLoads),
    retryAttempts: positiveNumber(config.retryAttempts, 3),
    retryBackoffMs: nonNegativeNumber(config.retryBackoffMs, 100),
    maxBatchOperations: positiveNumber(config.maxBatchOperations, 25),
    queueHighWatermark: positiveNumber(config.queueHighWatermark, 100),
    alexaTtsStateId: config.alexaTtsStateId || 'alexa2.0.Echo-Devices.Speak',
    sttCommand: config.sttCommand || 'faster-whisper',
    sttModel: config.sttModel || 'small',
    sttLanguage: config.sttLanguage || 'de',
    sttAudioDir: String(config.sttAudioDir || '').trim(),
    habitMode: oneOf(config.habitMode, HABIT_MODES, 'observe'),
    habitMinObservations: positiveNumber(config.habitMinObservations, 7),
    habitMinDays: positiveNumber(config.habitMinDays, 3),
    habitMinConfidence: positiveNumber(config.habitMinConfidence, 0.65),
    habitSlotMinutes: positiveNumber(config.habitSlotMinutes, 30),
    habitMatchSlackMinutes: nonNegativeNumber(config.habitMatchSlackMinutes, 30),
    habitObservationLimit: positiveNumber(config.habitObservationLimit, 500),
    habitOverrideCooldownMs: nonNegativeNumber(config.habitOverrideCooldownMs, 2 * 60 * 60 * 1000),
    habitMinApplyIntervalMs: nonNegativeNumber(config.habitMinApplyIntervalMs, 30 * 60 * 1000),
    habitAutoPromote: config.habitAutoPromote !== false,
    habitLearnFromCommands: config.habitLearnFromCommands !== false,
    habitWatchPrefixes: parseList(config.habitWatchPrefixes, []),
    habitLightStateId: config.habitLightStateId || '0_userdata.0.light.livingroom',
    habitBedtimeTemperature: Number.isFinite(Number(config.habitBedtimeTemperature)) ? Number(config.habitBedtimeTemperature) : 18,
    habitMorningTemperature: Number.isFinite(Number(config.habitMorningTemperature)) ? Number(config.habitMorningTemperature) : 21,
    habitScenesJson: config.habitScenesJson || '',
    guardRules: guards.parseGuardRules(config.guardRules),

    // --- OpenClaw interface ---
    authToken: String(config.authToken || '').trim(),
    httpEnabled: config.httpEnabled === true,
    httpBind: String(config.httpBind || '127.0.0.1').trim(),
    httpPort: positiveNumber(config.httpPort, 8097),
    responseRetentionMinutes: positiveNumber(config.responseRetentionMinutes, 60),
    idempotencyTtlMinutes: positiveNumber(config.idempotencyTtlMinutes, 10),
    agentHeartbeatMinutes: positiveNumber(config.agentHeartbeatMinutes, 15),
    confirmationMode: oneOf(config.confirmationMode, CONFIRMATION_MODES, 'agent'),
    confirmationTtlMinutes: positiveNumber(config.confirmationTtlMinutes, 10),
    confirmationDenySources: parseList(config.confirmationDenySources, [
      'system.adapter.simple-api',
      'system.adapter.rest-api',
      'system.adapter.openclaw-bridge',
    ]),
    openclawWebhookUrl: String(config.openclawWebhookUrl || '').trim(),
    openclawWebhookToken: String(config.openclawWebhookToken || '').trim(),
    openclawWebhookMode: oneOf(config.openclawWebhookMode, WEBHOOK_MODES, 'agent'),
    openclawAgentId: String(config.openclawAgentId || '').trim(),
    openclawDeliver: config.openclawDeliver !== false,
    openclawNotifyEvents: parseList(config.openclawNotifyEvents, [
      'guard_block',
      'max_on_elapsed',
      'confirmation_pending',
      'confirmation_resolved',
    ]).filter((name) => NOTIFY_EVENTS.includes(name)),
    openclawWatchStates: parseList(config.openclawWatchStates, []),
    notifyMinIntervalSec: nonNegativeNumber(config.notifyMinIntervalSec, 60),
  };
}

module.exports = {
  DEFAULT_ALLOWED_ACTIONS,
  ALWAYS_ALLOWED_ACTIONS,
  HABIT_MODES,
  CONFIRMATION_MODES,
  WEBHOOK_MODES,
  NOTIFY_EVENTS,
  normalizeConfig,
};
