'use strict';

const habits = require('../habits');
const catalog = require('../catalog');
const { BridgeError } = require('../errors');
const { HABIT_MODES } = require('../config');
const { isAllowedId, stateValue } = require('../util');

/*
 * Action handlers. Each handler receives the BridgeRuntime, the validated
 * payload and the command context ({ transport, signal }). Handlers contain
 * request mapping only; state access, guards and writes live in the runtime.
 */

function wattsPending(rt, watts) {
  const pending = {};
  if (Number.isFinite(watts) && rt.config.pvPowerStateId) pending[rt.config.pvPowerStateId] = watts;
  return pending;
}

function operationsFromPayload(payload) {
  if (Array.isArray(payload.operations) && payload.operations.length) return payload.operations;
  if (payload.id) return [{ type: 'setState', id: payload.id, value: payload.value }];
  return [];
}

const handlers = {
  async ping(rt) {
    return {
      pong: true,
      ts: new Date().toISOString(),
      uptimeMs: Date.now() - rt.startedAt,
      version: rt.version,
      habitMode: rt.habitMode,
      confirmationMode: rt.config.confirmationMode,
    };
  },

  async help(rt) {
    return {
      adapter: 'openclaw-bridge',
      version: rt.version,
      allowedActions: rt.config.allowedActions,
      habitMode: rt.habitMode,
      safety: {
        criticalStatePrefixes: rt.config.criticalStatePrefixes,
        requireConfirmationActions: rt.config.requireConfirmationActions,
        confirmationMode: rt.config.confirmationMode,
        setStateAckAllowed: rt.config.setStateAckAllowed,
        guardRules: rt.config.guardRules.length,
      },
      handbook: {
        adminTab: 'Anleitung',
        html: '/adapter/openclaw-bridge/ANLEITUNG.html',
        markdown: 'docs/de/ANLEITUNG.md',
      },
      envelope: {
        principle: 'Der Agent steuert nur innerhalb der konfigurierten Rahmenbedingungen (ACL, AND/OR/XOR, Schwellwerte, Einschaltdauer).',
        actions: ['getConstraints', 'planWithinBounds', 'optimizeHome', 'checkGuards'],
      },
      phases: {
        observe: 'Gewohnheiten nur lernen, keine autonome Steuerung',
        suggest: 'Vorschläge aus gelernten Profilen, Ausführung nur mit execute=true',
        autonomous: 'Nach Lernphase: innerhalb der Rahmenbedingungen steuern und optimieren',
      },
      tools: catalog.describeTools(rt.config.allowedActions, 'raw').map((tool) => ({
        name: tool.name,
        group: tool.group,
        mutates: tool.mutates,
        description: tool.description,
      })),
      quickStart: [
        { action: 'ping', payload: { action: 'ping' } },
        { action: 'getConstraints', payload: { action: 'getConstraints' } },
        { action: 'listStates', payload: { action: 'listStates', prefix: rt.config.allowedPrefixes[0], withMeta: true, limit: 50 } },
        { action: 'handleIntent', payload: { action: 'handleIntent', text: 'mir ist kalt', execute: false } },
        { action: 'recordObservation', payload: { action: 'recordObservation', trigger: 'snapshot', states: { [rt.config.habitLightStateId]: false } } },
        { action: 'getLearningStatus', payload: { action: 'getLearningStatus' } },
        { action: 'optimizeHome', payload: { action: 'optimizeHome', execute: false } },
        { action: 'planWithinBounds', payload: { action: 'planWithinBounds', operations: [{ type: 'setState', id: '0_userdata.0.pool.heater', value: true }] } },
      ],
    };
  },

  async describeTools(rt, payload) {
    const format = payload.format || 'raw';
    return { format, tools: catalog.describeTools(rt.config.allowedActions, format) };
  },

  async speak(rt, payload) {
    return rt.speakText(payload.text);
  },

  async transcribe(rt, payload) {
    return rt.transcribeAudio(payload);
  },

  async voiceCommand(rt, payload, ctx) {
    const transcript = await rt.transcribeAudio(payload);
    const planResult = await handlers.handleIntent(rt, {
      action: 'handleIntent',
      text: transcript.text,
      execute: payload.execute !== false,
      confirmation: payload.confirmation === true,
      currentTargetTemp: payload.currentTargetTemp,
    }, ctx);
    if (payload.speak !== false) {
      await rt.speakText(payload.speakText || `Verstanden: ${transcript.text}`);
    }
    return { transcript, planResult };
  },

  async emitContextEvent(rt, payload) {
    return { event: await rt.emitContextEvent(payload.event || {}) };
  },

  async handleIntent(rt, payload) {
    const plan = await rt.enrichPlanWithHabits(rt.buildIntentPlan(payload), payload.now);
    const envelope = await rt.splitByEnvelope(plan.operations);
    plan.withinBounds = envelope.withinBounds;
    plan.blocked = envelope.blocked;
    await rt.ensureState('intents.lastPlan', 'Last generated intent plan', 'json');
    await rt.adapter.setStateAsync('intents.lastPlan', JSON.stringify({ input: payload.text, plan }), true);

    for (const event of plan.contextEvents) {
      await rt.emitContextEvent(event);
    }

    if (payload.execute === true && envelope.allowed.length > 0) {
      const habitEvent = plan.contextEvents.find((event) => event.type === 'habit') || plan.contextEvents[0] || null;
      const execution = await rt.executePlan(envelope.allowed, {
        confirmation: payload.confirmation === true,
        sourceAction: 'handleIntent',
        trigger: 'intent',
        context: habitEvent,
        now: payload.now,
        requestId: payload.requestId,
      });
      return { plan, execution };
    }
    return { plan, execution: null };
  },

  async handlePvSurplus(rt, payload) {
    const watts = await rt.resolveWatts(payload);
    if (!Number.isFinite(watts)) {
      throw new BridgeError('EBADREQUEST', 'missing numeric watts (payload.watts or pvPowerStateId)');
    }
    const snapshot = await rt.snapshotFromIds([
      rt.config.pvSurplusLoadStateId,
      rt.config.pvPowerStateId,
      ...rt.config.surplusLoads.map((load) => load.targetId),
    ]);
    const surplus = rt.surplusOperations(watts, snapshot);
    const execution = surplus.operations.length
      ? await rt.executePlan(surplus.operations, {
        confirmation: payload.confirmation === true,
        sourceAction: 'handlePvSurplus',
        trigger: 'energy',
        requestId: payload.requestId,
      })
      : { results: [] };
    await rt.emitContextEvent({ type: 'energy', name: 'pv_surplus_evaluated', watts, decisions: surplus.decisions });
    return { watts, threshold: rt.config.pvSurplusMinWatts, loads: surplus.decisions, execution };
  },

  async executePlan(rt, payload) {
    if (!Array.isArray(payload.operations) || payload.operations.length === 0) {
      throw new BridgeError('EBADREQUEST', 'missing operations array');
    }
    const requiresConfirmation = rt.config.requireConfirmationActions.includes('executePlan');
    return rt.executePlan(payload.operations, {
      confirmation: requiresConfirmation ? payload.confirmation === true : true,
      sourceAction: 'executePlan',
      requestId: payload.requestId,
    });
  },

  async validatePlan(rt, payload) {
    return rt.validatePlan(payload.operations, { confirmation: payload.confirmation === true });
  },

  async getContextEvents(rt, payload) {
    const maxLimit = rt.config.contextEventHistoryLimit;
    const requested = Number(payload.limit);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, maxLimit) : 10;
    const history = await rt.getJsonState('events.context.history', []);
    const events = Array.isArray(history) ? history.slice(-limit).reverse() : [];
    return { events, limit, total: Array.isArray(history) ? history.length : 0 };
  },

  async recordObservation(rt, payload) {
    const states = payload.states && typeof payload.states === 'object' ? payload.states : null;
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    let resolvedStates = states;
    if (!resolvedStates) {
      if (ids.length === 0 && payload.includeSnapshot !== true) {
        throw new BridgeError('EBADREQUEST', 'missing states object or ids array');
      }
      const snapshot = ids.length ? await rt.snapshotFromIds(ids) : await rt.getSyncSnapshot();
      resolvedStates = {};
      for (const [id, state] of Object.entries(snapshot || {})) resolvedStates[id] = stateValue(state);
    }
    return rt.recordObservationInternal({
      trigger: payload.trigger || 'snapshot',
      sourceAction: 'recordObservation',
      context: payload.context || null,
      states: resolvedStates,
      ts: payload.ts || payload.now,
    });
  },

  async evaluateHabits(rt) {
    await rt.ensureRuntimeStates();
    return rt.evaluateHabitsInternal();
  },

  async getHabits(rt, payload) {
    await rt.ensureRuntimeStates();
    const profiles = await rt.getProfiles();
    const filtered = payload.readyOnly === true ? profiles.filter((profile) => profile.ready) : profiles;
    return { mode: rt.habitMode, profiles: filtered, count: filtered.length };
  },

  async getLearningStatus(rt) {
    await rt.ensureRuntimeStates();
    const status = habits.learningStatus(await rt.getProfiles(), await rt.getObservations(), rt.miningOptions());
    status.mode = rt.habitMode;
    return status;
  },

  async setHabitMode(rt, payload) {
    const mode = String(payload.mode || '').trim();
    if (!HABIT_MODES.includes(mode)) {
      throw new BridgeError('EMODEFORBIDDEN', `invalid habit mode: ${mode || '(empty)'}`, { details: { allowed: HABIT_MODES } });
    }
    if (mode === 'autonomous') {
      const human = rt.config.confirmationMode === 'human';
      if (!human && payload.confirmation !== true) {
        throw new BridgeError('ECONFIRMREQUIRED', 'autonomous mode needs confirmation');
      }
      const status = habits.learningStatus(await rt.getProfiles(), await rt.getObservations(), rt.miningOptions());
      if (!status.readyForAutonomy && payload.force !== true) {
        throw new BridgeError('ENOTREADY', 'learning phase is not complete', { details: status });
      }
      if (human) {
        const pending = await rt.requestHumanConfirmation({ kind: 'habitMode', mode, requestId: payload.requestId });
        throw new BridgeError('ECONFIRMPENDING', 'autonomous mode needs operator approval', { details: pending });
      }
    }
    await rt.applyHabitMode(mode, 'agent');
    return { mode };
  },

  async suggestAutomation(rt, payload) {
    await rt.ensureRuntimeStates();
    const built = await rt.buildOptimization({ ...payload, execute: false });
    await rt.adapter.setStateAsync('habits.lastSuggestion', JSON.stringify(built.plan), true);
    return built.plan;
  },

  async applyHabit(rt, payload) {
    const name = String(payload.name || '').trim();
    if (!name) throw new BridgeError('EBADREQUEST', 'missing habit name');
    await rt.ensureRuntimeStates();
    const profile = habits.findProfileByName(await rt.getProfiles(), name);
    const sceneOps = habits.sceneToOperations(name, rt.scenes, 'scene');
    if (!profile && sceneOps.length === 0) {
      throw new BridgeError('EHABITNOTFOUND', `habit not found: ${name}`);
    }
    const snapshot = payload.snapshot || await rt.snapshotForHabits(profile ? [profile] : [], sceneOps.map((op) => op.id));
    const operations = profile
      ? habits.habitToOperations(profile, snapshot, { cooldownIds: rt.cooldownIds() })
      : sceneOps.filter((op) => !habits.valuesEqual(stateValue(snapshot[op.id]), op.value));
    const envelope = await rt.splitByEnvelope(operations);
    const shouldExecute = payload.execute === true || rt.habitMode === 'autonomous';
    const execution = shouldExecute && envelope.allowed.length
      ? await rt.executePlan(envelope.allowed, {
        confirmation: payload.confirmation === true,
        learn: false,
        sourceAction: 'applyHabit',
        trigger: 'habit',
        context: { type: 'habit', name },
        requestId: payload.requestId,
      })
      : null;
    if (execution) {
      rt.lastAppliedHabits.set(profile?.id || `named:${name}`, Date.now());
      await rt.persistLastApplied();
    }
    return {
      name,
      profile: profile ? { id: profile.id, confidence: profile.confidence, ready: profile.ready } : null,
      operations: envelope.allowed,
      blocked: envelope.blocked,
      withinBounds: envelope.withinBounds,
      execution,
    };
  },

  async optimizeHome(rt, payload) {
    await rt.ensureRuntimeStates();
    const built = await rt.buildOptimization(payload);
    const shouldExecute = rt.maybeExecuteFromMode(payload) && built.plan.operations.length > 0;
    let execution = null;
    if (shouldExecute) {
      execution = await rt.executePlan(built.plan.operations, {
        confirmation: payload.confirmation === true,
        learn: false,
        sourceAction: 'optimizeHome',
        trigger: 'optimizer',
        requestId: payload.requestId,
      });
      for (const match of built.matches) rt.lastAppliedHabits.set(match.profile.id, Date.now());
      await rt.persistLastApplied();
    }
    const result = { ...built.plan, execution };
    await rt.adapter.setStateAsync('habits.lastOptimization', JSON.stringify(result), true);
    return result;
  },

  async getConstraints(rt, payload) {
    return rt.buildConstraints(payload);
  },

  async planWithinBounds(rt, payload) {
    const operations = operationsFromPayload(payload);
    if (!operations.length) throw new BridgeError('EBADREQUEST', 'missing operations array');
    const watts = await rt.resolveWatts(payload);
    const split = await rt.splitByEnvelope(operations, wattsPending(rt, watts));
    split.energy = Number.isFinite(watts) ? { watts } : null;
    return split;
  },

  async checkGuards(rt, payload) {
    const operations = operationsFromPayload(payload);
    if (!operations.length) operations.push({ type: 'setState', id: payload.id, value: payload.value });
    const watts = await rt.resolveWatts(payload);
    return rt.validatePlan(operations, { confirmation: payload.confirmation === true, pending: wattsPending(rt, watts) });
  },

  async listStates(rt, payload) {
    return rt.listStates(payload);
  },

  async getState(rt, payload) {
    rt.assertAllowedId(payload.id);
    return { id: payload.id, state: await rt.getForeignStateWithRetry(payload.id) };
  },

  async getStates(rt, payload) {
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    if (ids.length === 0) throw new BridgeError('EBADREQUEST', 'missing ids array');
    const result = {};
    for (const id of ids) {
      if (!isAllowedId(id, rt.config.allowedPrefixes)) {
        result[id] = { ok: false, error: { code: 'EIDFORBIDDEN', message: `state id is not allowed: ${id}` } };
        continue;
      }
      try {
        result[id] = { ok: true, state: await rt.getForeignStateWithRetry(id) };
      } catch (err) {
        result[id] = { ok: false, error: { code: err?.code || 'EGETSTATE', message: err?.message || String(err) } };
      }
    }
    return { result };
  },

  async batchSetStates(rt, payload) {
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    if (operations.length === 0) throw new BridgeError('EBADREQUEST', 'missing operations array');
    if (operations.length > rt.config.maxBatchOperations) {
      throw new BridgeError('EBATCHLIMIT', `batch too large: max ${rt.config.maxBatchOperations}`);
    }
    return rt.executePlan(operations, {
      confirmation: payload.confirmation === true,
      sourceAction: 'batchSetStates',
      requestId: payload.requestId,
    });
  },

  async syncSnapshot(rt) {
    const snapshot = await rt.getSyncSnapshot();
    return { snapshot, count: Object.keys(snapshot).length };
  },

  async getTelemetry(rt) {
    return rt.telemetry();
  },

  async setState(rt, payload) {
    const targetId = payload.id;
    rt.assertAllowedId(targetId);
    const ackRequested = Boolean(payload.ack);
    if (ackRequested && !rt.config.setStateAckAllowed) {
      throw new BridgeError('EACKFORBIDDEN', 'ack=true is not allowed by policy');
    }
    const execution = await rt.executePlan([
      { type: 'setState', id: targetId, value: payload.value, ack: ackRequested },
    ], {
      confirmation: payload.confirmation === true,
      sourceAction: 'setState',
      requestId: payload.requestId,
    });
    const result = execution.results[0];
    if (!result?.ok) {
      throw new BridgeError(result?.error?.code || 'EUNKNOWN', result?.error?.message || 'setState blocked', {
        details: result?.error?.details,
        hint: result?.error?.hint,
      });
    }
    return { id: targetId, ack: ackRequested };
  },

  async getPendingConfirmations(rt) {
    return { mode: rt.config.confirmationMode, pending: rt.confirmations.list() };
  },

  async cancelConfirmation(rt, payload) {
    const item = rt.confirmations.get(payload.confirmationId);
    if (!item) throw new BridgeError('EBADREQUEST', `unknown or expired confirmation: ${payload.confirmationId}`);
    await rt.resolveConfirmation(item.id, false, { source: 'agent', reason: 'cancelled by agent' });
    return { cancelled: item.id };
  },
};

module.exports = { handlers };
