const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const habits = require('./habits');

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
];

const HABIT_MODES = ['observe', 'suggest', 'autonomous'];

function parseList(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : fallback;
  }
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeConfig(config = {}) {
  return {
    allowedPrefixes: parseList(config.allowedPrefixes, ['javascript.0', '0_userdata.0']),
    allowedActions: parseList(config.allowedActions, DEFAULT_ALLOWED_ACTIONS),
    commandTimeoutMs: Number(config.commandTimeoutMs) > 0 ? Number(config.commandTimeoutMs) : 5000,
    setStateAckAllowed: config.setStateAckAllowed !== false,
    criticalStatePrefixes: parseList(config.criticalStatePrefixes, ['system.', 'admin.0']),
    requireConfirmationActions: parseList(config.requireConfirmationActions, ['executePlan']),
    comfortTemperatureStateId: config.comfortTemperatureStateId || '0_userdata.0.hvac.livingRoom.targetTemperature',
    comfortTempStep: Number(config.comfortTempStep) > 0 ? Number(config.comfortTempStep) : 1,
    contextEventHistoryLimit: Number(config.contextEventHistoryLimit) > 0 ? Number(config.contextEventHistoryLimit) : 50,
    pvSurplusMinWatts: Number(config.pvSurplusMinWatts) > 0 ? Number(config.pvSurplusMinWatts) : 1500,
    pvSurplusLoadStateId: config.pvSurplusLoadStateId || '0_userdata.0.energy.pvSurplusMode',
    retryAttempts: Number(config.retryAttempts) > 0 ? Number(config.retryAttempts) : 3,
    retryBackoffMs: Number(config.retryBackoffMs) >= 0 ? Number(config.retryBackoffMs) : 100,
    maxBatchOperations: Number(config.maxBatchOperations) > 0 ? Number(config.maxBatchOperations) : 25,
    queueHighWatermark: Number(config.queueHighWatermark) > 0 ? Number(config.queueHighWatermark) : 100,
    alexaTtsStateId: config.alexaTtsStateId || 'alexa2.0.Echo-Devices.Speak',
    sttCommand: config.sttCommand || 'faster-whisper',
    sttModel: config.sttModel || 'small',
    sttLanguage: config.sttLanguage || 'de',
    habitMode: HABIT_MODES.includes(config.habitMode) ? config.habitMode : 'observe',
    habitMinObservations: Number(config.habitMinObservations) > 0 ? Number(config.habitMinObservations) : 7,
    habitMinDays: Number(config.habitMinDays) > 0 ? Number(config.habitMinDays) : 3,
    habitMinConfidence: Number(config.habitMinConfidence) > 0 ? Number(config.habitMinConfidence) : 0.65,
    habitSlotMinutes: Number(config.habitSlotMinutes) > 0 ? Number(config.habitSlotMinutes) : 30,
    habitMatchSlackMinutes: Number(config.habitMatchSlackMinutes) >= 0 ? Number(config.habitMatchSlackMinutes) : 30,
    habitObservationLimit: Number(config.habitObservationLimit) > 0 ? Number(config.habitObservationLimit) : 500,
    habitOverrideCooldownMs: Number(config.habitOverrideCooldownMs) >= 0 ? Number(config.habitOverrideCooldownMs) : 2 * 60 * 60 * 1000,
    habitMinApplyIntervalMs: Number(config.habitMinApplyIntervalMs) >= 0 ? Number(config.habitMinApplyIntervalMs) : 30 * 60 * 1000,
    habitAutoPromote: config.habitAutoPromote !== false,
    habitLearnFromCommands: config.habitLearnFromCommands !== false,
    habitWatchPrefixes: parseList(config.habitWatchPrefixes, []),
    habitLightStateId: config.habitLightStateId || '0_userdata.0.light.livingroom',
    habitBedtimeTemperature: Number.isFinite(Number(config.habitBedtimeTemperature)) ? Number(config.habitBedtimeTemperature) : 18,
    habitMorningTemperature: Number.isFinite(Number(config.habitMorningTemperature)) ? Number(config.habitMorningTemperature) : 21,
    habitScenesJson: config.habitScenesJson || '',
  };
}

function isAllowedId(id, allowedPrefixes) {
  if (!id || typeof id !== 'string') return false;
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) return false;
  return allowedPrefixes.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
}

function isCriticalId(id, criticalPrefixes) {
  if (!id || typeof id !== 'string') return false;
  return (criticalPrefixes || []).some((prefix) => id.startsWith(prefix));
}

function sanitizeRequest(input) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('command must be a JSON object');
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryAsync(fn, attempts = 3, backoffMs = 100) {
  let lastErr;
  for (let i = 1; i <= Math.max(1, attempts); i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(backoffMs * i);
    }
  }
  throw lastErr;
}

function execFileAsync(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(stderr || error.message || 'command failed');
        err.code = 'ESTTFAILED';
        err.details = { command, args, stderr: String(stderr || '').slice(0, 2000) };
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function withTimeout(promise, timeoutMs, action) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`action timed out after ${timeoutMs}ms`);
      err.code = 'ETIMEOUT';
      err.details = { action, timeoutMs };
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function toStructuredError(err, fallbackCode = 'EUNKNOWN') {
  const code = err?.code || fallbackCode;
  const details = err?.details;
  let nextAction = 'retry';
  if (code === 'EACTIONFORBIDDEN') nextAction = 'use_allowed_action_or_update_config';
  if (code === 'EIDFORBIDDEN') nextAction = 'use_allowed_prefix_or_update_config';
  if (code === 'ECONFIRMREQUIRED') nextAction = 'resend_with_confirmation_true';
  if (code === 'ETIMEOUT') nextAction = 'check_adapter_latency_or_raise_timeout';
  if (code === 'EBADREQUEST' || code === 'EBADJSON') nextAction = 'fix_request_payload';
  if (code === 'EQUEUEFULL') nextAction = 'retry_later';
  if (code === 'EHABITNOTFOUND') nextAction = 'record_more_observations_or_use_known_habit_name';
  if (code === 'EMODEFORBIDDEN') nextAction = 'use_observe_suggest_or_autonomous';
  if (code === 'ENOTREADY') nextAction = 'keep_observing_until_learning_status_ready';
  return {
    code,
    message: err?.message || String(err),
    details,
    nextAction,
  };
}

function detectIntent(text) {
  const value = String(text || '').toLowerCase();
  const result = { names: [], comfort: null };

  if (value.includes('mir ist kalt') || value.includes('zu kalt') || value.includes('wärmer')) {
    result.comfort = 'cold';
  }
  if (value.includes('zu warm') || value.includes('mir ist heiß') || value.includes('kühler')) {
    result.comfort = 'hot';
  }
  if (value.includes('gute nacht') || value.includes('ich gehe schlafen') || value.includes('schlafenszeit')) {
    result.names.push('bedtime');
  }
  if (value.includes('guten morgen') || value.includes('aufstehen')) {
    result.names.push('morning');
  }
  if (value.includes('ich bin zuhause') || value.includes('ich bin da') || value.includes('bin heim') || value.includes('heimgekommen')) {
    result.names.push('arrive_home');
  }
  if (value.includes('ich gehe weg') || value.includes('ich verlasse') || value.includes('außer haus') || value.includes('gehe außer haus')) {
    result.names.push('leave_home');
  }
  if (value.includes('licht aus') || value.includes('lichter aus') || value.includes('mach das licht aus')) {
    result.names.push('lights_off');
  }
  if (value.includes('licht an') || value.includes('lichter an') || value.includes('mach das licht an')) {
    result.names.push('lights_on');
  }

  return result;
}

class BridgeRuntime {
  constructor(adapter, config) {
    this.adapter = adapter;
    this.config = normalizeConfig(config);
    this.startedAt = Date.now();
    this.counts = {
      total: 0,
      success: 0,
      failed: 0,
      timedOut: 0,
      retries: 0,
      queueRejected: 0,
    };
    this.durationMsWindow = [];
    this.queueDepth = 0;
    this.habitMode = this.config.habitMode;
    this.ownWrites = new Map();
    this.manualTimestamps = new Map();
    this.lastAppliedHabits = new Map();
    this.scenes = habits.parseSceneMap(this.config.habitScenesJson, {
      lightStateId: this.config.habitLightStateId,
      temperatureStateId: this.config.comfortTemperatureStateId,
      bedtimeTemperature: this.config.habitBedtimeTemperature,
      morningTemperature: this.config.habitMorningTemperature,
    });
  }

  async ensureResponseState(requestId) {
    const stateId = `responses.${requestId}`;
    await this.adapter.setObjectNotExistsAsync(stateId, {
      type: 'state',
      common: {
        name: `Response for request ${requestId}`,
        type: 'string',
        role: 'json',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });
    return stateId;
  }

  async ensureState(stateId, name = stateId, role = 'json', type = 'string', def = '') {
    await this.adapter.setObjectNotExistsAsync(stateId, {
      type: 'state',
      common: {
        name,
        type,
        role,
        read: true,
        write: false,
        def,
      },
      native: {},
    });
  }

  async ensureRuntimeStates() {
    await this.ensureState('habits.mode', 'Habit learning / autonomy mode', 'text', 'string', this.habitMode);
    await this.ensureState('habits.profiles', 'Learned habit profiles', 'json', 'string', '[]');
    await this.ensureState('habits.observations', 'Habit observations', 'json', 'string', '[]');
    await this.ensureState('habits.learningStatus', 'Habit learning progress', 'json', 'string', '{}');
    await this.ensureState('habits.lastSuggestion', 'Last automation suggestion', 'json', 'string', '');
    await this.ensureState('habits.lastOptimization', 'Last home optimization', 'json', 'string', '');
    await this.ensureState('habits.lastApplied', 'Last applied habit timestamps', 'json', 'string', '{}');

    const storedModeState = await this.adapter.getStateAsync('habits.mode');
    const storedMode = storedModeState && storedModeState.val != null ? String(storedModeState.val).replace(/^"|"$/g, '') : '';
    if (HABIT_MODES.includes(storedMode)) {
      this.habitMode = storedMode;
    } else {
      await this.adapter.setStateAsync('habits.mode', this.habitMode, true);
    }

    const lastApplied = await this.getJsonState('habits.lastApplied', {});
    if (lastApplied && typeof lastApplied === 'object') {
      this.lastAppliedHabits = new Map(Object.entries(lastApplied));
    }
  }

  async setAuditStates(meta) {
    const updates = [
      this.adapter.setStateAsync('info.lastRequestId', meta.requestId || '', true),
      this.adapter.setStateAsync('info.lastAction', meta.action || '', true),
      this.adapter.setStateAsync('info.lastDurationMs', meta.durationMs, true),
      this.adapter.setStateAsync('info.totalCount', this.counts.total, true),
      this.adapter.setStateAsync('info.successCount', this.counts.success, true),
      this.adapter.setStateAsync('info.failureCount', this.counts.failed, true),
      this.adapter.setStateAsync('info.timeoutCount', this.counts.timedOut, true),
      this.adapter.setStateAsync('info.retryCount', this.counts.retries, true),
      this.adapter.setStateAsync('info.queueRejected', this.counts.queueRejected, true),
      this.adapter.setStateAsync('info.queueDepth', this.queueDepth, true),
      this.adapter.setStateAsync('info.avgDurationMs', meta.avgDurationMs ?? 0, true),
      this.adapter.setStateAsync('info.lastUpdated', new Date().toISOString(), true),
    ];

    if (meta.errorMessage != null) {
      updates.push(this.adapter.setStateAsync('info.lastError', meta.errorMessage, true));
    }

    await Promise.all(updates);
  }

  miningOptions() {
    return {
      minObservations: this.config.habitMinObservations,
      minDays: this.config.habitMinDays,
      minConfidence: this.config.habitMinConfidence,
      slotMinutes: this.config.habitSlotMinutes,
      matchSlackMinutes: this.config.habitMatchSlackMinutes,
    };
  }

  async getProfiles() {
    const profiles = await this.getJsonState('habits.profiles', []);
    return Array.isArray(profiles) ? profiles : [];
  }

  async getObservations() {
    const observations = await this.getJsonState('habits.observations', []);
    return Array.isArray(observations) ? observations : [];
  }

  cooldownIds(now = Date.now()) {
    const cutoff = now - this.config.habitOverrideCooldownMs;
    const ids = new Set();
    for (const [id, ts] of this.manualTimestamps.entries()) {
      if (Number(ts) >= cutoff) ids.add(id);
    }
    return ids;
  }

  shouldLearnFromState(id) {
    if (!id || !this.config.habitWatchPrefixes.length) return false;
    return this.config.habitWatchPrefixes.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
  }

  async observeForeignStateChange(id, state) {
    const ownTs = this.ownWrites.get(id);
    if (ownTs && Date.now() - ownTs < 5000) return null;
    if (!isAllowedId(id, this.config.allowedPrefixes) && !this.shouldLearnFromState(id)) return null;
    this.manualTimestamps.set(id, Date.now());
    return this.recordObservationInternal({
      trigger: 'stateChange',
      sourceAction: 'foreignState',
      states: { [id]: state?.val },
    });
  }

  async recordObservationInternal(input) {
    await this.ensureRuntimeStates();
    const allowedStates = habits.sanitizeStates(input.states, this.config.allowedPrefixes, isAllowedId);
    if (!Object.keys(allowedStates).length && !(input.context && input.context.name)) {
      return { observation: null, skipped: true, reason: 'empty_observation' };
    }
    const observation = habits.normalizeObservation({
      ...input,
      states: allowedStates,
    }, { slotMinutes: this.config.habitSlotMinutes, now: input.now || input.ts });

    const history = await this.getObservations();
    const nextHistory = habits.appendObservation(history, observation, this.config.habitObservationLimit);
    await this.adapter.setStateAsync('habits.observations', JSON.stringify(nextHistory), true);

    const status = await this.evaluateHabitsInternal(nextHistory);
    return { observation, ...status };
  }

  async evaluateHabitsInternal(observations) {
    const list = observations || await this.getObservations();
    const profiles = habits.mineProfiles(list, this.miningOptions());
    const status = habits.learningStatus(profiles, list, this.miningOptions());
    status.mode = this.habitMode;

    if (this.config.habitAutoPromote) {
      const promoted = habits.shouldAutoPromote(status, this.habitMode);
      if (promoted) {
        this.habitMode = promoted;
        status.mode = promoted;
        status.autoPromoted = true;
        await this.adapter.setStateAsync('habits.mode', promoted, true);
      }
    }

    await this.adapter.setStateAsync('habits.profiles', JSON.stringify(profiles), true);
    await this.adapter.setStateAsync('habits.learningStatus', JSON.stringify(status), true);
    return { profiles, status };
  }

  async snapshotFromIds(ids) {
    const snapshot = {};
    for (const id of ids) {
      if (!id) continue;
      try {
        snapshot[id] = await this.getForeignStateWithRetry(id);
      } catch {
        snapshot[id] = null;
      }
    }
    return snapshot;
  }

  async snapshotForHabits(profiles, extraIds = []) {
    const ids = new Set(extraIds.filter(Boolean));
    for (const profile of profiles || []) {
      for (const id of Object.keys(profile.targets || {})) ids.add(id);
    }
    ids.add(this.config.comfortTemperatureStateId);
    ids.add(this.config.habitLightStateId);
    ids.add(this.config.pvSurplusLoadStateId);
    return this.snapshotFromIds([...ids]);
  }

  async persistLastApplied() {
    await this.adapter.setStateAsync(
      'habits.lastApplied',
      JSON.stringify(Object.fromEntries(this.lastAppliedHabits.entries())),
      true,
    );
  }

  filterRecentlyApplied(matches, now = Date.now()) {
    return (matches || []).filter((match) => {
      const last = Number(this.lastAppliedHabits.get(match.profile?.id || match.id) || 0);
      return now - last >= this.config.habitMinApplyIntervalMs;
    });
  }

  buildIntentPlan(payload) {
    const text = String(payload.text || '').toLowerCase();
    const plan = { operations: [], contextEvents: [], source: 'intent' };

    if (!text) {
      const err = new Error('missing text');
      err.code = 'EBADREQUEST';
      throw err;
    }

    const detected = detectIntent(text);

    if (detected.comfort === 'cold') {
      const target = Number(payload.currentTargetTemp ?? 21) + this.config.comfortTempStep;
      plan.operations.push({
        type: 'setState',
        id: this.config.comfortTemperatureStateId,
        value: target,
        ack: false,
        reason: 'comfort.cold',
      });
      plan.contextEvents.push({
        type: 'comfort',
        name: 'user_feels_cold',
        confidence: 0.95,
      });
    }

    if (detected.comfort === 'hot') {
      const target = Number(payload.currentTargetTemp ?? 21) - this.config.comfortTempStep;
      plan.operations.push({
        type: 'setState',
        id: this.config.comfortTemperatureStateId,
        value: target,
        ack: false,
        reason: 'comfort.hot',
      });
      plan.contextEvents.push({ type: 'comfort', name: 'user_feels_hot', confidence: 0.9 });
    }

    for (const name of detected.names) {
      plan.contextEvents.push({ type: 'habit', name, confidence: 0.9 });
      const sceneOps = habits.sceneToOperations(name, this.scenes, 'scene');
      for (const op of sceneOps) {
        if (!plan.operations.some((existing) => existing.id === op.id && existing.reason === op.reason)) {
          plan.operations.push(op);
        }
      }
    }

    if (plan.operations.length === 0 && plan.contextEvents.length === 0) {
      plan.contextEvents.push({ type: 'intent', name: 'unmapped_intent', confidence: 0.3 });
    }

    return plan;
  }

  async enrichPlanWithHabits(plan, now) {
    const habitNames = (plan.contextEvents || [])
      .filter((event) => event.type === 'habit' && event.name)
      .map((event) => event.name);
    if (!habitNames.length) return plan;

    const profiles = await this.getProfiles();
    const snapshot = await this.snapshotForHabits(profiles);
    for (const name of habitNames) {
      const profile = habits.findProfileByName(profiles, name);
      if (!profile || profile.sampleCount < 2) continue;
      const operations = habits.habitToOperations(profile, snapshot, {
        cooldownIds: this.cooldownIds(now ? new Date(now).getTime() : Date.now()),
        minConsistency: 0.5,
      });
      if (operations.length) {
        plan.operations = operations;
        plan.source = 'habit';
        plan.habitProfileId = profile.id;
        plan.habitConfidence = profile.confidence;
        break;
      }
    }
    return plan;
  }

  async getJsonState(id, fallback) {
    const state = await this.adapter.getStateAsync(id);
    if (!state || state.val == null || state.val === '') return fallback;
    if (typeof state.val === 'object') return state.val;
    try {
      return JSON.parse(String(state.val));
    } catch {
      return fallback;
    }
  }

  async emitContextEvent(event) {
    const ts = new Date().toISOString();
    const record = { ...event, ts };
    await this.ensureState('events.context.last', 'Last context event', 'json');
    await this.ensureState('events.context.history', 'Recent context events', 'json');

    const history = await this.getJsonState('events.context.history', []);
    const nextHistory = Array.isArray(history)
      ? [...history, record].slice(-this.config.contextEventHistoryLimit)
      : [record];

    await this.adapter.setStateAsync('events.context.last', JSON.stringify(record), true);
    await this.adapter.setStateAsync('events.context.history', JSON.stringify(nextHistory), true);

    if (event && event.type === 'habit' && event.states && Object.keys(event.states).length && this.config.habitLearnFromCommands) {
      await this.recordObservationInternal({
        trigger: 'event',
        sourceAction: 'emitContextEvent',
        context: event,
        states: event.states,
        ts,
      });
    }

    return record;
  }

  validateOperation(op) {
    if (!op || op.type !== 'setState' || !op.id) {
      const err = new Error('only setState operations with id are supported');
      err.code = 'EBADREQUEST';
      throw err;
    }
    if (!isAllowedId(op.id, this.config.allowedPrefixes)) {
      const err = new Error(`state id is not allowed: ${op.id}`);
      err.code = 'EIDFORBIDDEN';
      throw err;
    }
  }

  validatePlan(operations, options = {}) {
    if (!Array.isArray(operations) || operations.length === 0) {
      const err = new Error('missing operations array');
      err.code = 'EBADREQUEST';
      throw err;
    }

    const confirmation = options.confirmation === true;
    const checks = [];

    for (const op of operations) {
      const base = {
        id: op?.id,
        type: op?.type,
        critical: false,
        confirmationRequired: false,
        executable: false,
      };

      try {
        this.validateOperation(op);
        const critical = op.critical === true || isCriticalId(op.id, this.config.criticalStatePrefixes);
        const confirmationRequired = critical && !confirmation;
        checks.push({
          ...base,
          critical,
          confirmationRequired,
          executable: !confirmationRequired,
        });
      } catch (err) {
        checks.push({
          ...base,
          executable: false,
          error: toStructuredError(err, 'EBADREQUEST'),
        });
      }
    }

    return {
      valid: checks.every((check) => check.executable),
      confirmationProvided: confirmation,
      checks,
    };
  }

  async executePlan(operations, options = {}) {
    const confirmation = options.confirmation === true;
    const results = [];

    for (const op of operations) {
      this.validateOperation(op);
      const critical = op.critical === true || isCriticalId(op.id, this.config.criticalStatePrefixes);
      if (critical && !confirmation) {
        await this.ensureState('safety.pendingConfirmation', 'Pending safety confirmation', 'json');
        await this.adapter.setStateAsync('safety.pendingConfirmation', JSON.stringify({ op, requestedAt: new Date().toISOString(), nextAction: 'resend_with_confirmation_true' }), true);
        results.push({ ok: false, id: op.id, error: { code: 'ECONFIRMREQUIRED', message: 'critical operation needs confirmation' } });
        continue;
      }

      await this.setForeignStateWithRetry(op.id, op.value, Boolean(op.ack), { trackManual: options.learn !== false });
      results.push({ ok: true, id: op.id, value: op.value, ack: Boolean(op.ack) });
    }

    if (options.learn !== false && this.config.habitLearnFromCommands) {
      const succeeded = results.filter((row) => row.ok);
      if (succeeded.length) {
        await this.recordObservationInternal({
          trigger: options.trigger || 'command',
          sourceAction: options.sourceAction || 'executePlan',
          context: options.context || null,
          states: Object.fromEntries(succeeded.map((row) => [row.id, row.value])),
          ts: options.now,
        });
      }
    }

    return { results };
  }

  async setForeignStateWithRetry(id, value, ack, options = {}) {
    this.ownWrites.set(id, Date.now());
    if (options.trackManual !== false) this.manualTimestamps.set(id, Date.now());
    return retryAsync(() => this.adapter.setForeignStateAsync(id, value, ack), this.config.retryAttempts, this.config.retryBackoffMs);
  }

  async getForeignStateWithRetry(id) {
    return retryAsync(() => this.adapter.getForeignStateAsync(id), this.config.retryAttempts, this.config.retryBackoffMs);
  }

  async getSyncSnapshot() {
    const snapshot = {};
    for (const prefix of this.config.allowedPrefixes) {
      const view = await this.adapter.getObjectViewAsync('system', 'state', {
        startkey: `${prefix}.`,
        endkey: `${prefix}.\u9999`,
      });
      for (const row of view.rows || []) {
        snapshot[row.id] = await this.getForeignStateWithRetry(row.id);
      }
    }
    return snapshot;
  }

  async speakText(text) {
    const message = String(text || '').trim();
    if (!message) {
      const err = new Error('missing text');
      err.code = 'EBADREQUEST';
      throw err;
    }
    const stateId = this.config.alexaTtsStateId;
    if (!isAllowedId(stateId, this.config.allowedPrefixes)) {
      const err = new Error(`state id is not allowed: ${stateId}`);
      err.code = 'EIDFORBIDDEN';
      throw err;
    }
    await this.setForeignStateWithRetry(stateId, message, false, { trackManual: false });
    return { stateId, text: message };
  }

  async transcribeAudio(payload) {
    const audioPath = String(payload.audioPath || '').trim();
    if (!audioPath) {
      const err = new Error('missing audioPath');
      err.code = 'EBADREQUEST';
      throw err;
    }
    const args = [audioPath, '--model', this.config.sttModel, '--language', this.config.sttLanguage, '--output-format', 'txt'];
    const out = await execFileAsync(this.config.sttCommand, args, this.config.commandTimeoutMs);
    const text = out.stdout.trim();
    if (!text) {
      const err = new Error('STT returned empty transcript');
      err.code = 'ESTTEMPTY';
      throw err;
    }
    return { text, command: this.config.sttCommand, model: this.config.sttModel, language: this.config.sttLanguage };
  }

  async buildOptimization(payload = {}) {
    const profiles = payload.profiles || await this.getProfiles();
    const now = payload.now || new Date().toISOString();
    const extraIds = Array.isArray(payload.ids) ? payload.ids : [];
    const snapshot = payload.snapshot || await this.snapshotForHabits(profiles, extraIds);
    const cooldownIds = this.cooldownIds(new Date(now).getTime());
    const readyOnly = payload.readyOnly !== false && this.habitMode !== 'observe';
    const allMatches = habits.matchHabits(profiles, { now, name: payload.name }, {
      readyOnly,
      minConfidence: payload.minConfidence ?? (this.habitMode === 'observe' ? 0 : this.config.habitMinConfidence),
    });
    const matches = this.filterRecentlyApplied(
      allMatches.map((match) => ({ ...match, id: match.profile.id })),
      new Date(now).getTime(),
    );

    const plan = habits.optimizePlan({
      profiles: matches.map((match) => match.profile),
      snapshot,
      now,
      mode: this.habitMode,
      execute: payload.execute === true,
      watts: payload.watts,
      pvSurplusLoadStateId: this.config.pvSurplusLoadStateId,
      pvSurplusMinWatts: this.config.pvSurplusMinWatts,
      cooldownIds,
      minConfidence: 0,
      readyOnly: false,
      habitName: payload.name,
      preventExecute: payload.execute === false,
    });

    plan.mode = this.habitMode;
    plan.skippedRecent = allMatches.length - matches.length;
    return { plan, snapshot, matches };
  }

  maybeExecuteFromMode(payload) {
    if (payload.execute === false) return false;
    if (this.habitMode === 'autonomous') return payload.execute !== false;
    if (this.habitMode === 'suggest') return payload.execute === true;
    return false;
  }

  async executeAction(payload) {
    const action = payload.action;
    if (!action) {
      const err = new Error('missing action');
      err.code = 'EBADREQUEST';
      throw err;
    }

    if (!this.config.allowedActions.includes(action)) {
      const err = new Error(`action not allowed: ${action}`);
      err.code = 'EACTIONFORBIDDEN';
      err.details = { allowedActions: this.config.allowedActions };
      throw err;
    }

    if (action === 'ping') {
      return {
        pong: true,
        ts: new Date().toISOString(),
        uptimeMs: Date.now() - this.startedAt,
        version: this.adapter.version,
        habitMode: this.habitMode,
      };
    }

    if (action === 'help') {
      return {
        adapter: 'openclaw-bridge',
        allowedActions: this.config.allowedActions,
        habitMode: this.habitMode,
        safety: {
          criticalStatePrefixes: this.config.criticalStatePrefixes,
          requireConfirmationActions: this.config.requireConfirmationActions,
          setStateAckAllowed: this.config.setStateAckAllowed,
        },
        phases: {
          observe: 'Gewohnheiten nur lernen, keine autonome Steuerung',
          suggest: 'Vorschläge aus gelernten Profilen, Ausführung nur mit execute=true',
          autonomous: 'Nach Lernphase: Home Automation steuern und optimieren',
        },
        quickStart: [
          { action: 'ping', payload: { action: 'ping' } },
          { action: 'getState', payload: { action: 'getState', id: `${this.config.allowedPrefixes[0]}.example` } },
          { action: 'handleIntent', payload: { action: 'handleIntent', text: 'mir ist kalt', execute: false } },
          { action: 'recordObservation', payload: { action: 'recordObservation', trigger: 'snapshot', states: { [this.config.habitLightStateId]: false } } },
          { action: 'getLearningStatus', payload: { action: 'getLearningStatus' } },
          { action: 'optimizeHome', payload: { action: 'optimizeHome', execute: false } },
        ],
      };
    }

    if (action === 'speak') {
      return this.speakText(payload.text);
    }

    if (action === 'transcribe') {
      return this.transcribeAudio(payload);
    }

    if (action === 'voiceCommand') {
      const transcript = await this.transcribeAudio(payload);
      const planResult = await this.executeAction({
        action: 'handleIntent',
        text: transcript.text,
        execute: payload.execute !== false,
        confirmation: payload.confirmation === true,
        currentTargetTemp: payload.currentTargetTemp,
      });
      if (payload.speak !== false) {
        const summary = payload.speakText || `Verstanden: ${transcript.text}`;
        await this.speakText(summary);
      }
      return { transcript, planResult };
    }

    if (action === 'emitContextEvent') {
      const event = payload.event || {};
      return { event: await this.emitContextEvent(event) };
    }

    if (action === 'handleIntent') {
      const plan = await this.enrichPlanWithHabits(this.buildIntentPlan(payload), payload.now);
      await this.ensureState('intents.lastPlan', 'Last generated intent plan', 'json');
      await this.adapter.setStateAsync('intents.lastPlan', JSON.stringify({ input: payload.text, plan }), true);

      for (const event of plan.contextEvents) {
        await this.emitContextEvent(event);
      }

      if (payload.execute === true && plan.operations.length > 0) {
        const habitEvent = plan.contextEvents.find((event) => event.type === 'habit') || plan.contextEvents[0] || null;
        const execution = await this.executePlan(plan.operations, {
          confirmation: payload.confirmation === true,
          sourceAction: 'handleIntent',
          trigger: 'intent',
          context: habitEvent,
          now: payload.now,
        });
        return { plan, execution };
      }

      return { plan, execution: null };
    }

    if (action === 'handlePvSurplus') {
      const watts = Number(payload.watts);
      if (!Number.isFinite(watts)) {
        const err = new Error('missing numeric watts');
        err.code = 'EBADREQUEST';
        throw err;
      }

      const enabled = watts >= this.config.pvSurplusMinWatts;
      const operations = [
        {
          type: 'setState',
          id: this.config.pvSurplusLoadStateId,
          value: enabled,
          ack: false,
          reason: 'energy.pv_surplus',
        },
      ];

      const execution = await this.executePlan(operations, { confirmation: payload.confirmation === true, sourceAction: 'handlePvSurplus', trigger: 'energy' });
      await this.emitContextEvent({ type: 'energy', name: 'pv_surplus_evaluated', watts, enabled });
      return {
        watts,
        threshold: this.config.pvSurplusMinWatts,
        enabled,
        execution,
      };
    }

    if (action === 'executePlan') {
      const requiresConfirmation = this.config.requireConfirmationActions.includes('executePlan');
      return this.executePlan(payload.operations, {
        confirmation: requiresConfirmation ? payload.confirmation === true : true,
        sourceAction: 'executePlan',
      });
    }

    if (action === 'validatePlan') {
      return this.validatePlan(payload.operations, { confirmation: payload.confirmation === true });
    }

    if (action === 'getContextEvents') {
      const maxLimit = this.config.contextEventHistoryLimit;
      const requestedLimit = Number(payload.limit);
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, maxLimit) : 10;
      const history = await this.getJsonState('events.context.history', []);
      const events = Array.isArray(history) ? history.slice(-limit).reverse() : [];
      return { events, limit, total: Array.isArray(history) ? history.length : 0 };
    }

    if (action === 'recordObservation') {
      const states = payload.states && typeof payload.states === 'object' ? payload.states : null;
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      let resolvedStates = states;
      if (!resolvedStates) {
        if (ids.length === 0 && payload.includeSnapshot !== true) {
          const err = new Error('missing states object or ids array');
          err.code = 'EBADREQUEST';
          throw err;
        }
        const snapshot = ids.length ? await this.snapshotFromIds(ids) : await this.getSyncSnapshot();
        resolvedStates = {};
        for (const [id, state] of Object.entries(snapshot || {})) {
          resolvedStates[id] = state && typeof state === 'object' && 'val' in state ? state.val : state;
        }
      }
      return this.recordObservationInternal({
        trigger: payload.trigger || 'snapshot',
        sourceAction: 'recordObservation',
        context: payload.context || null,
        states: resolvedStates,
        ts: payload.ts || payload.now,
      });
    }

    if (action === 'evaluateHabits') {
      await this.ensureRuntimeStates();
      return this.evaluateHabitsInternal();
    }

    if (action === 'getHabits') {
      await this.ensureRuntimeStates();
      const profiles = await this.getProfiles();
      const readyOnly = payload.readyOnly === true;
      const filtered = readyOnly ? profiles.filter((profile) => profile.ready) : profiles;
      return { mode: this.habitMode, profiles: filtered, count: filtered.length };
    }

    if (action === 'getLearningStatus') {
      await this.ensureRuntimeStates();
      const observations = await this.getObservations();
      const profiles = await this.getProfiles();
      const status = habits.learningStatus(profiles, observations, this.miningOptions());
      status.mode = this.habitMode;
      return status;
    }

    if (action === 'setHabitMode') {
      const mode = String(payload.mode || '').trim();
      if (!HABIT_MODES.includes(mode)) {
        const err = new Error(`invalid habit mode: ${mode || '(empty)'}`);
        err.code = 'EMODEFORBIDDEN';
        err.details = { allowed: HABIT_MODES };
        throw err;
      }
      if (mode === 'autonomous' && payload.confirmation !== true) {
        const err = new Error('autonomous mode needs confirmation');
        err.code = 'ECONFIRMREQUIRED';
        throw err;
      }
      if (mode === 'autonomous') {
        const observations = await this.getObservations();
        const profiles = await this.getProfiles();
        const status = habits.learningStatus(profiles, observations, this.miningOptions());
        if (!status.readyForAutonomy && payload.force !== true) {
          const err = new Error('learning phase is not complete');
          err.code = 'ENOTREADY';
          err.details = status;
          throw err;
        }
      }
      await this.ensureRuntimeStates();
      this.habitMode = mode;
      await this.adapter.setStateAsync('habits.mode', mode, true);
      return { mode };
    }

    if (action === 'suggestAutomation') {
      await this.ensureRuntimeStates();
      const built = await this.buildOptimization({ ...payload, execute: false });
      await this.adapter.setStateAsync('habits.lastSuggestion', JSON.stringify(built.plan), true);
      return built.plan;
    }

    if (action === 'applyHabit') {
      const name = String(payload.name || '').trim();
      if (!name) {
        const err = new Error('missing habit name');
        err.code = 'EBADREQUEST';
        throw err;
      }
      await this.ensureRuntimeStates();
      const profiles = await this.getProfiles();
      const profile = habits.findProfileByName(profiles, name);
      const sceneOps = habits.sceneToOperations(name, this.scenes, 'scene');
      if (!profile && sceneOps.length === 0) {
        const err = new Error(`habit not found: ${name}`);
        err.code = 'EHABITNOTFOUND';
        throw err;
      }
      const snapshot = payload.snapshot || await this.snapshotForHabits(profile ? [profile] : [], sceneOps.map((op) => op.id));
      const operations = profile
        ? habits.habitToOperations(profile, snapshot, { cooldownIds: this.cooldownIds() })
        : sceneOps.filter((op) => {
          const current = snapshot[op.id];
          const currentVal = current && typeof current === 'object' && 'val' in current ? current.val : current;
          return !habits.valuesEqual(currentVal, op.value);
        });
      const shouldExecute = payload.execute === true || this.habitMode === 'autonomous';
      const execution = shouldExecute && operations.length
        ? await this.executePlan(operations, {
          confirmation: payload.confirmation === true,
          learn: false,
          sourceAction: 'applyHabit',
          trigger: 'habit',
          context: { type: 'habit', name },
        })
        : null;
      if (execution) {
        this.lastAppliedHabits.set(profile?.id || `named:${name}`, Date.now());
        await this.persistLastApplied();
      }
      return { name, profile: profile ? { id: profile.id, confidence: profile.confidence, ready: profile.ready } : null, operations, execution };
    }

    if (action === 'optimizeHome') {
      await this.ensureRuntimeStates();
      const built = await this.buildOptimization(payload);
      const shouldExecute = this.maybeExecuteFromMode(payload) && built.plan.operations.length > 0;
      let execution = null;
      if (shouldExecute) {
        execution = await this.executePlan(built.plan.operations, {
          confirmation: payload.confirmation === true,
          learn: false,
          sourceAction: 'optimizeHome',
          trigger: 'optimizer',
        });
        for (const match of built.matches) {
          this.lastAppliedHabits.set(match.profile.id, Date.now());
        }
        await this.persistLastApplied();
      }
      const result = { ...built.plan, execution };
      await this.adapter.setStateAsync('habits.lastOptimization', JSON.stringify(result), true);
      return result;
    }

    if (action === 'listStates') {
      const out = [];
      for (const prefix of this.config.allowedPrefixes) {
        const view = await this.adapter.getObjectViewAsync('system', 'state', {
          startkey: `${prefix}.`,
          endkey: `${prefix}.\u9999`,
        });
        for (const row of view.rows || []) out.push(row.id);
      }
      return { states: out };
    }

    if (action === 'getState') {
      const targetId = payload.id;
      if (!isAllowedId(targetId, this.config.allowedPrefixes)) {
        const err = new Error(`state id is not allowed: ${targetId}`);
        err.code = 'EIDFORBIDDEN';
        throw err;
      }
      const state = await this.getForeignStateWithRetry(targetId);
      return { id: targetId, state };
    }

    if (action === 'getStates') {
      const ids = Array.isArray(payload.ids) ? payload.ids : [];
      if (ids.length === 0) {
        const err = new Error('missing ids array');
        err.code = 'EBADREQUEST';
        throw err;
      }
      const result = {};
      for (const id of ids) {
        if (!isAllowedId(id, this.config.allowedPrefixes)) {
          result[id] = { ok: false, error: { code: 'EIDFORBIDDEN', message: `state id is not allowed: ${id}` } };
          continue;
        }
        try {
          result[id] = { ok: true, state: await this.getForeignStateWithRetry(id) };
        } catch (err) {
          result[id] = { ok: false, error: toStructuredError(err, 'EGETSTATE') };
        }
      }
      return { result };
    }

    if (action === 'batchSetStates') {
      const operations = Array.isArray(payload.operations) ? payload.operations : [];
      if (operations.length === 0) {
        const err = new Error('missing operations array');
        err.code = 'EBADREQUEST';
        throw err;
      }
      if (operations.length > this.config.maxBatchOperations) {
        const err = new Error(`batch too large: max ${this.config.maxBatchOperations}`);
        err.code = 'EBATCHLIMIT';
        throw err;
      }
      return this.executePlan(operations, { confirmation: payload.confirmation === true, sourceAction: 'batchSetStates' });
    }

    if (action === 'syncSnapshot') {
      const snapshot = await this.getSyncSnapshot();
      return { snapshot, count: Object.keys(snapshot).length };
    }

    if (action === 'getTelemetry') {
      const avgDurationMs = this.durationMsWindow.length
        ? this.durationMsWindow.reduce((a, b) => a + b, 0) / this.durationMsWindow.length
        : 0;
      return {
        counts: this.counts,
        queueDepth: this.queueDepth,
        avgDurationMs,
        uptimeMs: Date.now() - this.startedAt,
        habitMode: this.habitMode,
      };
    }

    if (action === 'setState') {
      const targetId = payload.id;
      if (!isAllowedId(targetId, this.config.allowedPrefixes)) {
        const err = new Error(`state id is not allowed: ${targetId}`);
        err.code = 'EIDFORBIDDEN';
        throw err;
      }

      const ackRequested = Boolean(payload.ack);
      if (ackRequested && !this.config.setStateAckAllowed) {
        const err = new Error('ack=true is not allowed by policy');
        err.code = 'EACKFORBIDDEN';
        throw err;
      }

      await this.setForeignStateWithRetry(targetId, payload.value, ackRequested);
      if (this.config.habitLearnFromCommands) {
        await this.recordObservationInternal({
          trigger: 'command',
          sourceAction: 'setState',
          states: { [targetId]: payload.value },
        });
      }
      return { id: targetId, ack: ackRequested };
    }

    const err = new Error(`unsupported action: ${action}`);
    err.code = 'ENOTSUPPORTED';
    throw err;
  }

  async processCommand(rawPayload) {
    const started = Date.now();
    this.counts.total += 1;

    if (this.queueDepth >= this.config.queueHighWatermark) {
      this.counts.failed += 1;
      this.counts.queueRejected += 1;
      const response = {
        ok: false,
        requestId: randomUUID(),
        action: undefined,
        error: toStructuredError({ code: 'EQUEUEFULL', message: 'command queue high watermark exceeded' }, 'EQUEUEFULL'),
        durationMs: Date.now() - started,
      };
      await this.publishResponse(response);
      return response;
    }

    this.queueDepth += 1;
    try {
      let payload;
      try {
        payload = sanitizeRequest(rawPayload);
      } catch (err) {
        this.counts.failed += 1;
        const requestId = randomUUID();
        err.code = 'EBADJSON';
        const response = {
          ok: false,
          requestId,
          action: undefined,
          error: toStructuredError(err, 'EBADJSON'),
          durationMs: Date.now() - started,
        };
        await this.publishResponse(response);
        return response;
      }

      const requestId = payload.requestId || randomUUID();
      const action = payload.action;

      try {
        const data = await withTimeout(this.executeAction(payload), this.config.commandTimeoutMs, action);
        this.counts.success += 1;
        const response = {
          ok: true,
          requestId,
          action,
          data,
          durationMs: Date.now() - started,
          operatorHint: action === 'help' ? 'use quickStart samples to avoid payload mistakes' : 'ok',
        };
        await this.publishResponse(response);
        return response;
      } catch (err) {
        this.counts.failed += 1;
        if (err?.code === 'ETIMEOUT') this.counts.timedOut += 1;
        const response = {
          ok: false,
          requestId,
          action,
          error: toStructuredError(err),
          durationMs: Date.now() - started,
        };
        await this.publishResponse(response);
        return response;
      }
    } finally {
      this.queueDepth = Math.max(0, this.queueDepth - 1);
    }
  }

  async publishResponse(response) {
    this.durationMsWindow.push(response.durationMs || 0);
    if (this.durationMsWindow.length > 100) this.durationMsWindow.shift();

    const encoded = JSON.stringify(response);
    await this.adapter.setStateAsync('control.lastResult', encoded, true);
    const perRequestId = await this.ensureResponseState(response.requestId);
    await this.adapter.setStateAsync(perRequestId, encoded, true);

    await this.setAuditStates({
      requestId: response.requestId,
      action: response.action,
      durationMs: response.durationMs,
      errorMessage: response.ok ? '' : `${response.error.code}: ${response.error.message}`,
      avgDurationMs: this.durationMsWindow.length
        ? this.durationMsWindow.reduce((a, b) => a + b, 0) / this.durationMsWindow.length
        : 0,
    });
  }
}

module.exports = {
  BridgeRuntime,
  normalizeConfig,
  isAllowedId,
  sanitizeRequest,
  toStructuredError,
  isCriticalId,
  retryAsync,
  detectIntent,
  DEFAULT_ALLOWED_ACTIONS,
};
