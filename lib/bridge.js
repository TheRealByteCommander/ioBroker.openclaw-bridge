'use strict';

const { randomUUID } = require('node:crypto');
const habits = require('./habits');
const guards = require('./guards');
const catalog = require('./catalog');
const ioPackage = require('../io-package.json');
const { handlers } = require('./actions');
const { SerialQueue, ResponseCache } = require('./queue');
const { ConfirmationStore, isTrustedConfirmationSource } = require('./confirmations');
const { Notifier } = require('./notifier');
const { BridgeError, toStructuredError } = require('./errors');
const {
  DEFAULT_ALLOWED_ACTIONS,
  HABIT_MODES,
  normalizeConfig,
} = require('./config');
const {
  isAllowedId,
  isCriticalId,
  retryAsync,
  execFileAsync,
  withTimeout,
  safeEqual,
  resolveInsideDir,
  stateValue,
} = require('./util');

function sanitizeRequest(input) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('command must be a JSON object');
  }
  return payload;
}

function withConstraintHint(guard, op = {}) {
  return {
    ...toStructuredError({ code: guard.code, message: guard.message, details: guard }),
    hint: guards.constraintHint(guard, op),
  };
}

const INTENT_PATTERNS = [
  { comfort: 'cold', words: ['mir ist kalt', 'zu kalt', 'wärmer', 'i am cold', "i'm cold", 'warmer'] },
  { comfort: 'hot', words: ['zu warm', 'mir ist heiß', 'mir ist warm', 'kühler', 'i am hot', "i'm hot", 'cooler'] },
  { name: 'bedtime', words: ['gute nacht', 'ich gehe schlafen', 'schlafenszeit', 'good night'] },
  { name: 'morning', words: ['guten morgen', 'aufstehen', 'good morning'] },
  { name: 'arrive_home', words: ['ich bin zuhause', 'ich bin da', 'bin heim', 'heimgekommen', 'i am home', "i'm home"] },
  { name: 'leave_home', words: ['ich gehe weg', 'ich verlasse', 'außer haus', 'leaving home'] },
  { name: 'lights_off', words: ['licht aus', 'lichter aus', 'mach das licht aus', 'lights off'] },
  { name: 'lights_on', words: ['licht an', 'lichter an', 'mach das licht an', 'lights on'] },
];

function detectIntent(text) {
  const value = String(text || '').toLowerCase();
  const result = { names: [], comfort: null };
  for (const pattern of INTENT_PATTERNS) {
    if (!pattern.words.some((word) => value.includes(word))) continue;
    if (pattern.comfort) result.comfort = pattern.comfort;
    if (pattern.name && !result.names.includes(pattern.name)) result.names.push(pattern.name);
  }
  return result;
}

class BridgeRuntime {
  /**
   * @param {object} adapter ioBroker adapter (or a test double)
   * @param {object} config raw native config
   * @param {{ notifier?: Notifier, fetchImpl?: typeof fetch }} [deps]
   */
  constructor(adapter, config, deps = {}) {
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
      unauthorized: 0,
      replayed: 0,
    };
    this.durationMsWindow = [];
    this.queue = new SerialQueue({ highWatermark: this.config.queueHighWatermark });
    this.responseCache = new ResponseCache({ ttlMs: this.config.idempotencyTtlMinutes * 60_000 });
    this.confirmations = new ConfirmationStore({ ttlMs: this.config.confirmationTtlMinutes * 60_000 });
    this.notifier = deps.notifier || new Notifier(this.config, { log: adapter.log, fetchImpl: deps.fetchImpl });
    this.activeSignal = null;
    this.agentLastSeen = 0;
    this.connectionState = null;
    this.habitMode = this.config.habitMode;
    this.ownWrites = new Map();
    this.manualTimestamps = new Map();
    this.lastAppliedHabits = new Map();
    this.guardTimers = new Map();
    this.guardLastOn = new Map();
    this.guardLastOff = new Map();
    this.scenes = habits.parseSceneMap(this.config.habitScenesJson, {
      lightStateId: this.config.habitLightStateId,
      temperatureStateId: this.config.comfortTemperatureStateId,
      bedtimeTemperature: this.config.habitBedtimeTemperature,
      morningTemperature: this.config.habitMorningTemperature,
    });
  }

  get version() {
    return this.adapter.version || ioPackage.common.version;
  }

  get queueDepth() {
    return this.queue.depth;
  }

  get log() {
    return this.adapter.log || { info() {}, warn() {}, error() {}, debug() {} };
  }

  // ---------------------------------------------------------------------------
  // Object / state helpers
  // ---------------------------------------------------------------------------

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
      common: { name, type, role, read: true, write: false, def },
      native: {},
    });
  }

  async ensureRuntimeStates() {
    const instanceObjects = ioPackage.instanceObjects || [];
    for (const obj of instanceObjects) {
      if (!obj || !obj._id) continue;
      await this.adapter.setObjectNotExistsAsync(obj._id, {
        type: obj.type,
        common: { ...(obj.common || {}) },
        native: { ...(obj.native || {}) },
      });
    }

    if (this.runtimeStatesLoaded) return;
    this.runtimeStatesLoaded = true;

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

    const runtime = await this.getJsonState('guards.runtime', {});
    if (runtime && typeof runtime === 'object') {
      this.guardLastOn = new Map(Object.entries(runtime.lastOn || {}).map(([id, ts]) => [id, Number(ts)]));
      this.guardLastOff = new Map(Object.entries(runtime.lastOff || {}).map(([id, ts]) => [id, Number(ts)]));
    }

    this.confirmations.restore(await this.getJsonState('safety.pendingConfirmations', []));

    for (const id of guards.targetIds(this.config.guardRules)) {
      if (this.guardLastOn.has(id)) this.armGuardTimers(id);
    }
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

  assertAllowedId(id) {
    if (!isAllowedId(id, this.config.allowedPrefixes)) {
      throw new BridgeError('EIDFORBIDDEN', `state id is not allowed: ${id}`, {
        hint: { type: 'use_allowed_prefix', withinBounds: false, allowedPrefixes: this.config.allowedPrefixes },
      });
    }
  }

  now() {
    return Date.now();
  }

  // ---------------------------------------------------------------------------
  // Guards (operating envelope)
  // ---------------------------------------------------------------------------

  guardTargetIds() {
    return guards.targetIds(this.config.guardRules);
  }

  isGuardTarget(id) {
    return this.config.guardRules.some((rule) => rule.targetId === id);
  }

  async persistGuardRuntime() {
    await this.adapter.setStateAsync('guards.runtime', JSON.stringify({
      lastOn: Object.fromEntries(this.guardLastOn.entries()),
      lastOff: Object.fromEntries(this.guardLastOff.entries()),
    }), true);
  }

  async expandRuleIds(rule) {
    if (!rule.conditionPrefix) return [];
    const prefix = rule.conditionPrefix.endsWith('.') ? rule.conditionPrefix.slice(0, -1) : rule.conditionPrefix;
    try {
      const view = await this.adapter.getObjectViewAsync('system', 'state', {
        startkey: `${prefix}.`,
        endkey: `${prefix}.香`,
      });
      return (view.rows || []).map((row) => row.id);
    } catch {
      return [];
    }
  }

  sortOperationsForGuards(operations) {
    const guardedTargets = new Set(this.config.guardRules.map((rule) => rule.targetId));
    const conditionIds = new Set();
    for (const rule of this.config.guardRules) {
      for (const id of rule.conditionIds) conditionIds.add(id);
      for (const condition of rule.conditions) conditionIds.add(condition.id);
    }
    const first = [];
    const second = [];
    for (const op of operations) {
      if (guardedTargets.has(op.id) && !conditionIds.has(op.id)) second.push(op);
      else first.push(op);
    }
    return [...first, ...second];
  }

  async checkWriteGuards(op, pending = {}) {
    const matching = this.config.guardRules.filter((rule) => guards.ruleApplies(rule, op.id, op.value));
    if (!matching.length) return { ok: true, rules: [], details: [] };

    const expandedIds = {};
    const needed = new Set();
    for (const rule of matching) {
      const expanded = await this.expandRuleIds(rule);
      expandedIds[rule.name] = expanded;
      for (const id of rule.conditionIds) needed.add(id);
      for (const id of expanded) needed.add(id);
      for (const condition of rule.conditions) needed.add(condition.id);
      if (rule.thresholdId) needed.add(rule.thresholdId);
    }

    const snapshot = await this.snapshotFromIds([...needed]);
    return guards.evaluateWrite(op, matching, {
      now: this.now(),
      getValue: guards.overlayGetValue(snapshot, pending),
      lastOn: Object.fromEntries(this.guardLastOn),
      lastOff: Object.fromEntries(this.guardLastOff),
      expandedIds,
    });
  }

  async recordGuardBlock(guard, op) {
    const nextAction = toStructuredError({ code: guard.code, message: guard.message }).nextAction;
    await this.adapter.setStateAsync('safety.lastGuardBlock', JSON.stringify({
      op,
      guard,
      blockedAt: new Date(this.now()).toISOString(),
      nextAction,
    }), true);
    await this.notifier.publish({
      type: 'guard_block',
      id: op.id,
      value: op.value,
      code: guard.code,
      message: guard.message,
      hint: guards.constraintHint(guard, op),
    });
  }

  clearGuardTimers(id) {
    const timer = this.guardTimers.get(id);
    if (timer) clearTimeout(timer);
    this.guardTimers.delete(id);
  }

  stopGuardTimers() {
    for (const id of [...this.guardTimers.keys()]) this.clearGuardTimers(id);
  }

  armGuardTimers(id) {
    const timed = this.config.guardRules.filter((rule) => rule.targetId === id && rule.maxOnMs > 0);
    if (!timed.length) return;
    const lastOn = this.guardLastOn.get(id) || this.now();
    const maxOnMs = Math.min(...timed.map((rule) => rule.maxOnMs));
    const remaining = Math.max(0, maxOnMs - (this.now() - lastOn));
    this.clearGuardTimers(id);
    const fire = () => {
      this.runInternal(() => this.forceOff(id)).catch((err) => {
        this.log.error(`max-on auto-off failed for ${id}: ${err?.message || err}`);
      });
    };
    if (remaining === 0) {
      fire();
      return;
    }
    const timer = setTimeout(fire, remaining);
    if (typeof timer.unref === 'function') timer.unref();
    this.guardTimers.set(id, timer);
  }

  async forceOff(id) {
    const rule = this.config.guardRules.find((item) => item.targetId === id && item.maxOnMs > 0);
    const offValue = rule ? rule.offValue : false;
    this.clearGuardTimers(id);
    await this.executePlan([{ type: 'setState', id, value: offValue, reason: 'guard.max_on' }], {
      confirmation: true,
      humanApproved: true,
      skipGuards: true,
      learn: false,
      sourceAction: 'guardAutoOff',
    });
    await this.emitContextEvent({ type: 'guard', name: 'max_on_elapsed', id, offValue });
    await this.notifier.publish({ type: 'max_on_elapsed', id, offValue, rule: rule?.name });
  }

  async noteGuardWrite(op) {
    if (!this.isGuardTarget(op.id)) return;
    const now = this.now();
    if (guards.isTruthy(op.value)) {
      if (!this.guardLastOn.has(op.id)) this.guardLastOn.set(op.id, now);
      this.armGuardTimers(op.id);
    } else {
      this.guardLastOn.delete(op.id);
      this.guardLastOff.set(op.id, now);
      this.clearGuardTimers(op.id);
    }
    await this.persistGuardRuntime();
  }

  trackGuardState(id, state) {
    if (!this.isGuardTarget(id) || !state) return;
    this.noteGuardWrite({ id, value: state.val }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Habits
  // ---------------------------------------------------------------------------

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
        status.mode = promoted;
        status.autoPromoted = true;
        await this.applyHabitMode(promoted, 'autoPromote');
      }
    }

    await this.adapter.setStateAsync('habits.profiles', JSON.stringify(profiles), true);
    await this.adapter.setStateAsync('habits.learningStatus', JSON.stringify(status), true);
    return { profiles, status };
  }

  async applyHabitMode(mode, source) {
    const previous = this.habitMode;
    this.habitMode = mode;
    await this.adapter.setStateAsync('habits.mode', mode, true);
    if (previous !== mode) {
      await this.notifier.publish({ type: 'habit_mode_changed', id: 'habits.mode', from: previous, to: mode, source });
    }
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
    ids.add(this.config.pvPowerStateId);
    for (const load of this.config.surplusLoads) ids.add(load.targetId);
    for (const rule of this.config.guardRules) {
      if (rule.thresholdId) ids.add(rule.thresholdId);
    }
    return this.snapshotFromIds([...ids]);
  }

  fallbackSurplusLoad() {
    return {
      enabled: true,
      name: 'default',
      targetId: this.config.pvSurplusLoadStateId,
      minWatts: this.config.pvSurplusMinWatts,
      offBelowWatts: this.config.pvSurplusMinWatts,
      priority: 100,
      onValue: true,
      offValue: false,
    };
  }

  async resolveWatts(payload = {}) {
    if (payload.watts !== undefined && payload.watts !== null && payload.watts !== '') {
      const direct = Number(payload.watts);
      if (Number.isFinite(direct)) return direct;
    }
    if (!this.config.pvPowerStateId) return NaN;
    const state = await this.getForeignStateWithRetry(this.config.pvPowerStateId);
    const value = stateValue(state);
    if (value === null || value === undefined || value === '') return NaN;
    return Number(value);
  }

  surplusOperations(watts, snapshot = {}) {
    return guards.surplusLoadOperations(
      this.config.surplusLoads,
      watts,
      snapshot,
      this.fallbackSurplusLoad(),
    );
  }

  async splitByEnvelope(operations, extraPending = {}) {
    const pending = { ...extraPending };
    const allowed = [];
    const blocked = [];
    const list = Array.isArray(operations) ? operations : [];
    const ordered = this.sortOperationsForGuards(list);

    for (const op of ordered) {
      try {
        this.validateOperation(op);
      } catch (err) {
        blocked.push({ op, error: toStructuredError(err), hint: { type: 'use_allowed_prefix', withinBounds: false } });
        continue;
      }
      const guard = await this.checkWriteGuards(op, pending);
      if (!guard.ok) {
        const error = withConstraintHint(guard, op);
        blocked.push({ op, error, hint: error.hint });
        continue;
      }
      allowed.push(op);
      pending[op.id] = op.value;
    }

    return {
      withinBounds: blocked.length === 0,
      allowed,
      blocked,
      principle: 'OpenClaw may optimize freely inside allowed operations; blocked items are outside the configured envelope.',
    };
  }

  async buildConstraints(payload = {}) {
    const watts = await this.resolveWatts(payload);
    const extraPending = {};
    if (Number.isFinite(watts) && this.config.pvPowerStateId) extraPending[this.config.pvPowerStateId] = watts;

    const needed = new Set([this.config.pvPowerStateId, this.config.pvSurplusLoadStateId]);
    for (const load of this.config.surplusLoads) needed.add(load.targetId);
    for (const rule of this.config.guardRules) {
      for (const id of rule.conditionIds) needed.add(id);
      if (rule.thresholdId) needed.add(rule.thresholdId);
      needed.add(rule.targetId);
    }
    const snapshot = await this.snapshotFromIds([...needed]);
    const surplus = Number.isFinite(watts) ? this.surplusOperations(watts, snapshot) : { decisions: [] };

    const rules = [];
    for (const rule of this.config.guardRules) {
      const probe = { type: 'setState', id: rule.targetId, value: true };
      const guard = await this.checkWriteGuards(probe, extraPending);
      rules.push({
        ...guards.describeRule(rule),
        currentlyAllowsTurnOn: guard.ok === true,
        currentValue: stateValue(snapshot[rule.targetId]),
        hint: guards.constraintHint(guard, probe),
      });
    }

    return {
      role: 'operating_envelope',
      principle: 'Diese Regeln sind die Rahmenbedingungen. Der OpenClaw-Agent steuert und optimiert nur innerhalb dieser Grenzen.',
      habitMode: this.habitMode,
      confirmationMode: this.config.confirmationMode,
      allowedPrefixes: this.config.allowedPrefixes,
      allowedActions: this.config.allowedActions,
      criticalStatePrefixes: this.config.criticalStatePrefixes,
      rules,
      surplusLoads: surplus.decisions.length
        ? surplus.decisions
        : this.config.surplusLoads.map((load) => ({
          name: load.name,
          id: load.targetId,
          minWatts: load.minWatts,
          offBelowWatts: load.offBelowWatts || load.minWatts,
        })),
      energy: Number.isFinite(watts) ? { watts, pvPowerStateId: this.config.pvPowerStateId } : null,
      pendingConfirmations: this.confirmations.list().length,
      agent: {
        may: [
          'States in allowedPrefixes lesen und schreiben',
          'Gewohnheiten lernen und nach der Lernphase optimieren',
          'PV-Lasten zuschalten, sobald deren Schwellwert erreicht ist',
          'Mehrere erlaubte Schritte in einem Plan kombinieren (z. B. Ventil, dann Pumpe)',
        ],
        mustNot: [
          'Rahmenbedingungen umgehen (AND/OR/XOR, Schwellwerte, max. Einschaltdauer)',
          'Lasten unterhalb ihrer Watt-Schwelle einschalten',
          'Kritische Prefixe ohne confirmation schreiben',
          'Eine gesperrte Schaltung unverändert wiederholen',
        ],
      },
    };
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
    if (!text) throw new BridgeError('EBADREQUEST', 'missing text');

    const detected = detectIntent(text);
    if (detected.comfort) {
      const sign = detected.comfort === 'cold' ? 1 : -1;
      const target = Number(payload.currentTargetTemp ?? 21) + sign * this.config.comfortTempStep;
      plan.operations.push({
        type: 'setState',
        id: this.config.comfortTemperatureStateId,
        value: target,
        ack: false,
        reason: `comfort.${detected.comfort}`,
      });
      plan.contextEvents.push(detected.comfort === 'cold'
        ? { type: 'comfort', name: 'user_feels_cold', confidence: 0.95 }
        : { type: 'comfort', name: 'user_feels_hot', confidence: 0.9 });
    }

    for (const name of detected.names) {
      plan.contextEvents.push({ type: 'habit', name, confidence: 0.9 });
      for (const op of habits.sceneToOperations(name, this.scenes, 'scene')) {
        if (!plan.operations.some((existing) => existing.id === op.id && existing.reason === op.reason)) {
          plan.operations.push(op);
        }
      }
    }

    if (plan.operations.length === 0 && plan.contextEvents.length === 0) {
      plan.contextEvents.push({ type: 'intent', name: 'unmapped_intent', confidence: 0.3 });
      plan.agentHint = 'Kein festes Intent erkannt. Nutze listStates/getConstraints und plane selbst mit planWithinBounds.';
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

  async emitContextEvent(event) {
    const ts = new Date().toISOString();
    const record = { ...event, ts };
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

  // ---------------------------------------------------------------------------
  // Plans and writes
  // ---------------------------------------------------------------------------

  validateOperation(op) {
    if (!op || op.type !== 'setState' || !op.id) {
      throw new BridgeError('EBADREQUEST', 'only setState operations with id are supported');
    }
    this.assertAllowedId(op.id);
  }

  isCriticalOperation(op) {
    return op.critical === true || isCriticalId(op.id, this.config.criticalStatePrefixes);
  }

  async validatePlan(operations, options = {}) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new BridgeError('EBADREQUEST', 'missing operations array');
    }

    const confirmation = this.effectiveConfirmation(options);
    const pending = { ...(options.pending || {}) };
    for (const op of operations) {
      if (op && op.id) pending[op.id] = op.value;
    }
    const checks = [];

    for (const op of operations) {
      const base = {
        id: op?.id,
        type: op?.type,
        critical: false,
        confirmationRequired: false,
        executable: false,
        guard: null,
      };

      try {
        this.validateOperation(op);
        const critical = this.isCriticalOperation(op);
        const confirmationRequired = critical && !confirmation;
        const guard = options.skipGuards === true ? { ok: true } : await this.checkWriteGuards(op, pending);
        const blockedByGuard = guard && guard.ok === false;
        checks.push({
          ...base,
          critical,
          confirmationRequired,
          confirmationBy: confirmationRequired ? this.config.confirmationMode : null,
          guard: blockedByGuard ? guard : { ok: true, rules: guard.rules || [] },
          executable: !confirmationRequired && !blockedByGuard,
          error: blockedByGuard ? withConstraintHint(guard, op) : undefined,
        });
      } catch (err) {
        checks.push({ ...base, executable: false, error: toStructuredError(err, 'EBADREQUEST') });
      }
    }

    return {
      valid: checks.every((check) => check.executable),
      confirmationProvided: confirmation,
      confirmationMode: this.config.confirmationMode,
      checks,
    };
  }

  /** In human mode the agent's `confirmation: true` carries no weight. */
  effectiveConfirmation(options) {
    if (options.humanApproved === true) return true;
    if (this.config.confirmationMode === 'human') return false;
    return options.confirmation === true;
  }

  throwIfAborted() {
    const signal = this.activeSignal;
    if (signal && signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new BridgeError('ETIMEOUT', 'command aborted; remaining writes skipped');
    }
  }

  async executePlan(operations, options = {}) {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new BridgeError('EBADREQUEST', 'missing operations array');
    }
    const confirmation = this.effectiveConfirmation(options);
    const results = [];
    const needsHuman = [];
    const pending = {};
    for (const op of operations) {
      if (op && op.id) pending[op.id] = op.value;
    }
    const ordered = this.sortOperationsForGuards(operations);

    for (const op of ordered) {
      this.validateOperation(op);
      if (this.isCriticalOperation(op) && !confirmation) {
        delete pending[op.id];
        if (this.config.confirmationMode === 'human') {
          needsHuman.push(op);
          continue;
        }
        await this.adapter.setStateAsync('safety.pendingConfirmation', JSON.stringify({
          op,
          requestedAt: new Date().toISOString(),
          nextAction: 'resend_with_confirmation_true',
        }), true);
        results.push({ ok: false, id: op.id, error: toStructuredError(new BridgeError('ECONFIRMREQUIRED', 'critical operation needs confirmation')) });
        continue;
      }

      if (options.skipGuards !== true) {
        const guard = await this.checkWriteGuards(op, pending);
        if (!guard.ok) {
          await this.recordGuardBlock(guard, op);
          results.push({ ok: false, id: op.id, error: withConstraintHint(guard, op) });
          delete pending[op.id];
          continue;
        }
      }

      this.throwIfAborted();
      await this.setForeignStateWithRetry(op.id, op.value, Boolean(op.ack), { trackManual: options.learn !== false });
      await this.noteGuardWrite(op);
      results.push({ ok: true, id: op.id, value: op.value, ack: Boolean(op.ack) });
    }

    if (needsHuman.length) {
      const item = await this.requestHumanConfirmation({
        kind: 'plan',
        operations: needsHuman,
        requestId: options.requestId,
        source: options.sourceAction,
      });
      const error = toStructuredError(new BridgeError('ECONFIRMPENDING', 'operator approval pending', { details: item }));
      for (const op of needsHuman) results.push({ ok: false, id: op.id, confirmationId: item.id, error });
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
    return retryAsync(
      () => this.adapter.setForeignStateAsync(id, value, ack),
      this.config.retryAttempts,
      this.config.retryBackoffMs,
      () => { this.counts.retries += 1; },
    );
  }

  async getForeignStateWithRetry(id) {
    return retryAsync(
      () => this.adapter.getForeignStateAsync(id),
      this.config.retryAttempts,
      this.config.retryBackoffMs,
      () => { this.counts.retries += 1; },
    );
  }

  async stateIdsUnder(prefix) {
    const clean = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;
    const view = await this.adapter.getObjectViewAsync('system', 'state', {
      startkey: `${clean}.`,
      endkey: `${clean}.香`,
    });
    return view.rows || [];
  }

  async getSyncSnapshot() {
    const snapshot = {};
    for (const prefix of this.config.allowedPrefixes) {
      for (const row of await this.stateIdsUnder(prefix)) {
        snapshot[row.id] = await this.getForeignStateWithRetry(row.id);
      }
    }
    return snapshot;
  }

  async listStates(payload = {}) {
    const limit = Number(payload.limit) > 0 ? Math.min(Number(payload.limit), 5000) : 500;
    const search = payload.search ? String(payload.search).toLowerCase() : '';
    let prefixes = this.config.allowedPrefixes;
    if (payload.prefix) {
      const prefix = String(payload.prefix).replace(/\.$/, '');
      const insideAcl = isAllowedId(prefix, this.config.allowedPrefixes);
      const parentOfAcl = this.config.allowedPrefixes.filter((allowed) => allowed.startsWith(`${prefix}.`));
      if (!insideAcl && !parentOfAcl.length) this.assertAllowedId(prefix);
      prefixes = insideAcl ? [prefix] : parentOfAcl;
    }

    const out = [];
    let total = 0;
    for (const prefix of prefixes) {
      for (const row of await this.stateIdsUnder(prefix)) {
        const common = row.value && row.value.common ? row.value.common : {};
        const name = typeof common.name === 'object' ? (common.name.de || common.name.en || '') : (common.name || '');
        if (search && !row.id.toLowerCase().includes(search) && !String(name).toLowerCase().includes(search)) continue;
        total += 1;
        if (out.length >= limit) continue;
        if (payload.withMeta === true) {
          out.push({
            id: row.id,
            name,
            role: common.role,
            type: common.type,
            unit: common.unit,
            write: common.write !== false,
            min: common.min,
            max: common.max,
            states: common.states,
          });
        } else {
          out.push(row.id);
        }
      }
    }
    return { states: out, count: out.length, total, truncated: total > out.length };
  }

  async speakText(text) {
    const message = String(text || '').trim();
    if (!message) throw new BridgeError('EBADREQUEST', 'missing text');
    const stateId = this.config.alexaTtsStateId;
    this.assertAllowedId(stateId);
    this.throwIfAborted();
    await this.setForeignStateWithRetry(stateId, message, false, { trackManual: false });
    return { stateId, text: message };
  }

  async transcribeAudio(payload) {
    const audioPath = resolveInsideDir(String(payload.audioPath || '').trim(), this.config.sttAudioDir);
    const args = [audioPath, '--model', this.config.sttModel, '--language', this.config.sttLanguage, '--output-format', 'txt'];
    const out = await execFileAsync(this.config.sttCommand, args, this.config.commandTimeoutMs);
    const text = out.stdout.trim();
    if (!text) throw new BridgeError('ESTTEMPTY', 'STT returned empty transcript');
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

    const watts = await this.resolveWatts(payload);
    const surplus = Number.isFinite(watts)
      ? this.surplusOperations(watts, snapshot)
      : { operations: [], decisions: [] };

    const plan = habits.optimizePlan({
      profiles: matches.map((match) => match.profile),
      snapshot,
      now,
      mode: this.habitMode,
      execute: payload.execute === true,
      energyOperations: surplus.operations,
      cooldownIds,
      minConfidence: 0,
      readyOnly: false,
      habitName: payload.name,
      preventExecute: payload.execute === false,
    });

    const extraPending = {};
    if (Number.isFinite(watts) && this.config.pvPowerStateId) extraPending[this.config.pvPowerStateId] = watts;
    const envelope = await this.splitByEnvelope(plan.operations, extraPending);
    plan.operations = envelope.allowed;
    plan.blocked = envelope.blocked;
    plan.withinBounds = envelope.withinBounds;
    plan.mode = this.habitMode;
    plan.skippedRecent = allMatches.length - matches.length;
    plan.energy = Number.isFinite(watts) ? { watts, decisions: surplus.decisions } : null;
    return { plan, snapshot, matches };
  }

  maybeExecuteFromMode(payload) {
    if (payload.execute === false) return false;
    if (this.habitMode === 'autonomous') return payload.execute !== false;
    if (this.habitMode === 'suggest') return payload.execute === true;
    return false;
  }

  telemetry() {
    const avgDurationMs = this.durationMsWindow.length
      ? this.durationMsWindow.reduce((a, b) => a + b, 0) / this.durationMsWindow.length
      : 0;
    return {
      counts: this.counts,
      queueDepth: this.queueDepth,
      avgDurationMs,
      uptimeMs: Date.now() - this.startedAt,
      habitMode: this.habitMode,
      agentLastSeen: this.agentLastSeen ? new Date(this.agentLastSeen).toISOString() : null,
      notifier: this.notifier.stats,
      pendingConfirmations: this.confirmations.list().length,
    };
  }

  // ---------------------------------------------------------------------------
  // Human confirmation
  // ---------------------------------------------------------------------------

  async persistConfirmations() {
    const list = this.confirmations.list();
    await this.adapter.setStateAsync('safety.pendingConfirmations', JSON.stringify(list), true);
    return list;
  }

  async requestHumanConfirmation(entry) {
    const item = this.confirmations.create(entry);
    const { expiresAtMs, ...view } = item;
    await this.persistConfirmations();
    await this.adapter.setStateAsync('safety.pendingConfirmation', JSON.stringify({
      ...view,
      nextAction: 'operator_writes_id_to_safety.confirm',
    }), true);
    await this.notifier.publish({ type: 'confirmation_pending', id: item.id, kind: item.kind, summary: item.summary, expiresAt: item.expiresAt });
    this.log.info(`confirmation ${item.id} pending: ${item.summary}`);
    return { confirmationId: item.id, summary: item.summary, expiresAt: item.expiresAt, approveVia: `${this.adapter.namespace || 'openclaw-bridge.0'}.safety.confirm` };
  }

  /**
   * Approve or reject a pending confirmation. Approval executes the stored
   * operations with guards re-checked. Must be called outside the command
   * queue (it enqueues the execution itself).
   */
  async resolveConfirmation(id, approve, meta = {}) {
    const item = this.confirmations.take(id);
    if (!item) {
      const result = { ok: false, id, error: 'unknown or expired confirmation id' };
      await this.adapter.setStateAsync('safety.lastConfirmation', JSON.stringify(result), true);
      return result;
    }

    let outcome;
    if (!approve) {
      outcome = { ok: true, id: item.id, approved: false, reason: meta.reason || 'rejected' };
    } else if (item.kind === 'habitMode') {
      await this.runInternal(() => this.applyHabitMode(item.mode, 'operator'));
      outcome = { ok: true, id: item.id, approved: true, mode: item.mode };
    } else {
      const execution = await this.runInternal(() => this.executePlan(item.operations, {
        humanApproved: true,
        sourceAction: 'humanConfirmation',
        requestId: item.requestId,
      }));
      outcome = { ok: execution.results.every((row) => row.ok), id: item.id, approved: true, execution };
    }

    outcome.source = meta.source || null;
    outcome.resolvedAt = new Date().toISOString();
    await this.adapter.setStateAsync('safety.lastConfirmation', JSON.stringify(outcome), true);
    await this.persistConfirmations();
    await this.notifier.publish({
      type: 'confirmation_resolved',
      id: item.id,
      approved: outcome.approved,
      ok: outcome.ok,
      summary: item.summary,
    });
    return outcome;
  }

  /** Handle a write to safety.confirm / safety.reject. */
  async handleConfirmationState(stateId, state) {
    if (!state || state.ack || !state.val) return null;
    const approve = stateId.endsWith('.confirm');
    if (!isTrustedConfirmationSource(state.from, this.config.confirmationDenySources)) {
      this.log.warn(`confirmation from untrusted source ${state.from} ignored`);
      await this.adapter.setStateAsync('safety.lastConfirmation', JSON.stringify({
        ok: false,
        id: String(state.val),
        error: `source ${state.from} may not approve confirmations`,
      }), true);
      return null;
    }
    const outcome = await this.resolveConfirmation(String(state.val).trim(), approve, { source: state.from });
    await this.adapter.setStateAsync(stateId.split('.').slice(-2).join('.'), '', true);
    return outcome;
  }

  async expireConfirmations() {
    const expired = this.confirmations.expire();
    if (!expired.length) return 0;
    await this.persistConfirmations();
    for (const item of expired) {
      await this.notifier.publish({ type: 'confirmation_resolved', id: item.id, approved: false, ok: false, summary: item.summary, reason: 'expired' });
    }
    return expired.length;
  }

  // ---------------------------------------------------------------------------
  // Command pipeline
  // ---------------------------------------------------------------------------

  /** Run an internal task (timer, confirmation) serialized with agent commands. */
  runInternal(task) {
    return this.queue.push(async () => {
      this.activeSignal = null;
      return task();
    }, { force: true });
  }

  async executeAction(payload, ctx = {}) {
    const action = payload.action;
    if (!action) throw new BridgeError('EBADREQUEST', 'missing action');
    if (!this.config.allowedActions.includes(action)) {
      throw new BridgeError('EACTIONFORBIDDEN', `action not allowed: ${action}`, {
        details: { allowedActions: this.config.allowedActions },
      });
    }
    const handler = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
    if (!handler) throw new BridgeError('ENOTSUPPORTED', `unsupported action: ${action}`);
    catalog.validatePayload(action, payload);
    return handler(this, payload, ctx);
  }

  async markAgentSeen() {
    this.agentLastSeen = Date.now();
    await this.adapter.setStateAsync('info.agentLastSeen', new Date(this.agentLastSeen).toISOString(), true);
    await this.refreshConnection();
  }

  /** info.connection = an agent talked to the bridge within agentHeartbeatMinutes. */
  async refreshConnection() {
    const connected = Boolean(this.agentLastSeen)
      && Date.now() - this.agentLastSeen < this.config.agentHeartbeatMinutes * 60_000;
    if (connected !== this.connectionState) {
      this.connectionState = connected;
      await this.adapter.setStateAsync('info.connection', connected, true);
    }
    return connected;
  }

  /**
   * Process one command from any transport.
   * @param {unknown} rawPayload JSON string or object
   * @param {{ transport?: 'state'|'http'|'message', trusted?: boolean }} ctx
   *   trusted = the transport already authenticated the caller (HTTP bearer)
   */
  async handleCommand(rawPayload, ctx = {}) {
    const started = Date.now();
    const transport = ctx.transport || 'state';
    this.counts.total += 1;

    let payload;
    try {
      payload = { ...sanitizeRequest(rawPayload) };
    } catch (err) {
      return this.finish({
        ok: false,
        requestId: randomUUID(),
        action: undefined,
        error: toStructuredError(new BridgeError('EBADJSON', err.message)),
        durationMs: Date.now() - started,
      }, transport);
    }

    const clientRequestId = payload.requestId ? String(payload.requestId) : null;
    const requestId = clientRequestId || randomUUID();
    payload.requestId = requestId;
    const action = payload.action;
    const token = payload.token;
    delete payload.token;

    if (this.config.authToken && !ctx.trusted && !safeEqual(typeof token === 'string' ? token : '', this.config.authToken)) {
      this.counts.unauthorized += 1;
      return this.finish({
        ok: false,
        requestId,
        action,
        error: toStructuredError(new BridgeError('EUNAUTHORIZED', 'missing or invalid token')),
        durationMs: Date.now() - started,
      }, transport);
    }

    if (clientRequestId) {
      const cached = this.responseCache.get(clientRequestId);
      if (cached) {
        this.counts.replayed += 1;
        const previous = await cached.value;
        return { ...previous, replayed: true };
      }
    }

    // Enqueue synchronously so commands execute in arrival order.
    const responsePromise = this.enqueueAction(payload, requestId, started, transport);
    if (clientRequestId) this.responseCache.set(clientRequestId, responsePromise);
    await this.markAgentSeen().catch((err) => this.log.debug(`agent heartbeat: ${err?.message || err}`));
    const response = await responsePromise;
    if (clientRequestId) this.responseCache.set(clientRequestId, response);
    return this.finish(response, transport);
  }

  enqueueAction(payload, requestId, started, transport) {
    const action = payload.action;
    return new Promise((resolve) => {
      const task = async () => {
        const controller = new AbortController();
        this.activeSignal = controller.signal;
        const execution = this.executeAction(payload, { transport, signal: controller.signal });
        try {
          const data = await withTimeout(execution, this.config.commandTimeoutMs, action, controller);
          resolve({
            ok: true,
            requestId,
            action,
            data,
            durationMs: Date.now() - started,
            operatorHint: action === 'help' ? 'use quickStart samples to avoid payload mistakes' : 'ok',
          });
        } catch (err) {
          if (err?.code === 'ETIMEOUT') this.counts.timedOut += 1;
          resolve({
            ok: false,
            requestId,
            action,
            error: toStructuredError(err),
            durationMs: Date.now() - started,
          });
        }
        // Keep the queue slot until the action really settled (timeouts included).
        await execution.catch(() => {});
        this.activeSignal = null;
      };

      this.queue.push(task).catch((err) => {
        this.counts.queueRejected += 1;
        resolve({
          ok: false,
          requestId,
          action,
          error: toStructuredError(err, 'EQUEUEFULL'),
          durationMs: Date.now() - started,
        });
      });
    });
  }

  async finish(response, transport) {
    if (response.ok) this.counts.success += 1;
    else this.counts.failed += 1;
    try {
      await this.publishResponse(response, transport);
    } catch (err) {
      this.log.warn(`could not publish response ${response.requestId}: ${err?.message || err}`);
    }
    return response;
  }

  /** Legacy entry point: command written to control.command. */
  async processCommand(rawPayload) {
    await this.redactCommandState(rawPayload);
    return this.handleCommand(rawPayload, { transport: 'state' });
  }

  /** The token must not stay readable in control.command (e.g. via simple-api). */
  async redactCommandState(rawPayload) {
    let parsed;
    try {
      parsed = sanitizeRequest(rawPayload);
    } catch {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'token')) return;
    const { token: _token, ...rest } = parsed;
    await this.adapter.setStateAsync('control.command', JSON.stringify({ ...rest, token: '***' }), true);
  }

  async publishResponse(response, transport = 'state') {
    this.durationMsWindow.push(response.durationMs || 0);
    if (this.durationMsWindow.length > 100) this.durationMsWindow.shift();

    const encoded = JSON.stringify(response);
    await this.adapter.setStateAsync('control.lastResult', encoded, true);
    // Only the state transport needs a per-request response state; HTTP and
    // sendTo answer directly and do not grow the object database.
    if (transport === 'state') {
      const perRequestId = await this.ensureResponseState(response.requestId);
      await this.adapter.setStateAsync(perRequestId, encoded, true);
    }

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

  /** Delete responses.<requestId> states older than responseRetentionMinutes. */
  async cleanupResponses(now = Date.now()) {
    if (typeof this.adapter.getStatesAsync !== 'function') return 0;
    const cutoff = now - this.config.responseRetentionMinutes * 60_000;
    const states = await this.adapter.getStatesAsync('responses.*');
    let removed = 0;
    for (const [id, state] of Object.entries(states || {})) {
      const ts = state && Number(state.ts);
      if (state && Number.isFinite(ts) && ts >= cutoff) continue;
      try {
        await this.adapter.delForeignObjectAsync(id);
        removed += 1;
      } catch (err) {
        this.log.debug(`could not delete ${id}: ${err?.message || err}`);
      }
    }
    return removed;
  }

  /** Forward watched foreign state changes to OpenClaw. */
  isWatchedForAgent(id) {
    return this.config.openclawWatchStates.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
  }

  async notifyWatchedState(id, state) {
    if (!state || !this.isWatchedForAgent(id)) return false;
    return this.notifier.publish({ type: 'state_changed', id, value: state.val, ack: state.ack, from: state.from });
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
