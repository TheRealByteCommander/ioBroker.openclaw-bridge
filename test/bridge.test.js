const test = require('node:test');
const assert = require('node:assert/strict');

const { BridgeRuntime, isAllowedId, normalizeConfig, isCriticalId, retryAsync } = require('../lib/bridge');

class MockAdapter {
  constructor(config = {}) {
    this.version = '0.4.0';
    this.config = config;
    this.states = new Map();
    this.objects = new Map();
    this.foreignStates = new Map();
  }

  async setObjectNotExistsAsync(id, obj) {
    if (!this.objects.has(id)) this.objects.set(id, obj);
  }

  async setStateAsync(id, value, ack) {
    this.states.set(id, { val: value, ack });
  }

  async getStateAsync(id) {
    return this.states.get(id) ?? null;
  }

  async getForeignStateAsync(id) {
    return this.foreignStates.get(id) ?? null;
  }

  async setForeignStateAsync(id, value, ack) {
    this.foreignStates.set(id, { val: value, ack });
  }

  async getObjectViewAsync(_design, _search, query) {
    const rows = [];
    for (const key of this.foreignStates.keys()) {
      if (key >= query.startkey && key <= query.endkey) rows.push({ id: key });
    }
    return { rows };
  }
}

test('isAllowedId enforces prefix ACL', () => {
  assert.equal(isAllowedId('javascript.0.foo', ['javascript.0']), true);
  assert.equal(isAllowedId('system.adapter.admin.0', ['javascript.0']), false);
});

test('isCriticalId marks critical prefixes', () => {
  assert.equal(isCriticalId('system.adapter.admin.0.alive', ['system.']), true);
  assert.equal(isCriticalId('0_userdata.0.safe', ['system.']), false);
});

test('normalizeConfig applies sane defaults', () => {
  const cfg = normalizeConfig({});
  assert.deepEqual(cfg.allowedPrefixes, ['javascript.0', '0_userdata.0']);
  assert.equal(cfg.commandTimeoutMs, 5000);
  assert.equal(cfg.pvSurplusMinWatts, 1500);
  assert.equal(cfg.maxBatchOperations, 25);
});

test('normalizeConfig accepts chip arrays from the admin settings page', () => {
  const cfg = normalizeConfig({
    allowedPrefixes: ['javascript.0', '0_userdata.0'],
    allowedActions: ['ping', 'help'],
    habitWatchPrefixes: ['zigbee.0'],
  });
  assert.deepEqual(cfg.allowedPrefixes, ['javascript.0', '0_userdata.0']);
  assert.deepEqual(cfg.allowedActions, ['ping', 'help']);
  assert.deepEqual(cfg.habitWatchPrefixes, ['zigbee.0']);
});

test('retryAsync retries and succeeds', async () => {
  let attempts = 0;
  const value = await retryAsync(async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('temporary');
    return 42;
  }, 3, 1);
  assert.equal(value, 42);
});

test('processCommand supports request correlation and getState', async () => {
  const adapter = new MockAdapter({});
  adapter.foreignStates.set('0_userdata.0.test', { val: 42, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'getState',
  });

  const response = await bridge.processCommand({
    requestId: 'req-1',
    action: 'getState',
    id: '0_userdata.0.test',
  });

  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'req-1');
  assert.equal(response.data.state.val, 42);
});

test('action whitelist blocks disallowed actions', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'ping',
  });

  const response = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.x', value: 1 });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'EACTIONFORBIDDEN');
});

test('batchSetStates supports batched writes', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'batchSetStates',
  });

  const response = await bridge.processCommand({
    action: 'batchSetStates',
    operations: [
      { type: 'setState', id: '0_userdata.0.a', value: 1 },
      { type: 'setState', id: '0_userdata.0.b', value: 2 },
    ],
    confirmation: true,
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.results.length, 2);
});

test('batchSetStates negative path rejects oversized batch', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'batchSetStates',
    maxBatchOperations: 1,
  });

  const response = await bridge.processCommand({
    action: 'batchSetStates',
    operations: [
      { type: 'setState', id: '0_userdata.0.a', value: 1 },
      { type: 'setState', id: '0_userdata.0.b', value: 2 },
    ],
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'EBATCHLIMIT');
});

test('syncSnapshot returns allowed prefix states', async () => {
  const adapter = new MockAdapter({});
  adapter.foreignStates.set('0_userdata.0.alpha', { val: 'A', ack: true });
  adapter.foreignStates.set('0_userdata.0.beta', { val: 'B', ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'syncSnapshot',
  });

  const response = await bridge.processCommand({ action: 'syncSnapshot' });
  assert.equal(response.ok, true);
  assert.equal(response.data.count, 2);
});

test('getTelemetry returns runtime counters', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'ping,getTelemetry',
  });

  await bridge.processCommand({ action: 'ping' });
  const response = await bridge.processCommand({ action: 'getTelemetry' });
  assert.equal(response.ok, true);
  assert.equal(typeof response.data.avgDurationMs, 'number');
  assert.equal(typeof response.data.queueDepth, 'number');
});

test('handleIntent maps hot/cold comfort routes', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'handleIntent',
    comfortTemperatureStateId: '0_userdata.0.hvac.livingRoom.targetTemperature',
    comfortTempStep: 1,
  });

  const hot = await bridge.processCommand({ action: 'handleIntent', text: 'mir ist heiß', execute: false, currentTargetTemp: 22 });
  assert.equal(hot.ok, true);
  assert.equal(hot.data.plan.operations[0].value, 21);

  const cold = await bridge.processCommand({ action: 'handleIntent', text: 'mir ist kalt', execute: false, currentTargetTemp: 21 });
  assert.equal(cold.ok, true);
  assert.equal(cold.data.plan.operations[0].value, 22);
});

test('help action returns capabilities', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'help',
  });

  const response = await bridge.processCommand({ action: 'help' });
  assert.equal(response.ok, true);
  assert.equal(Array.isArray(response.data.allowedActions), true);
  assert.equal(response.data.adapter, 'openclaw-bridge');
  assert.ok(response.data.envelope.principle.includes('Rahmenbedingungen'));
  assert.equal(response.data.envelope.actions.includes('getConstraints'), true);
});


test('speak action writes alexa tts state', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: 'alexa2.0,0_userdata.0',
    allowedActions: 'speak',
    alexaTtsStateId: 'alexa2.0.echo.speak',
  });

  const response = await bridge.processCommand({ action: 'speak', text: 'Hallo Wohnzimmer' });
  assert.equal(response.ok, true);
  assert.equal(adapter.foreignStates.get('alexa2.0.echo.speak').val, 'Hallo Wohnzimmer');
});

test('transcribe negative path requires audioPath', async () => {
  const adapter = new MockAdapter({});
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'transcribe',
  });

  const response = await bridge.processCommand({ action: 'transcribe' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'EBADREQUEST');
});

function localIso(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function habitBridge(overrides = {}) {
  const adapter = new MockAdapter({});
  adapter.foreignStates.set('0_userdata.0.light.livingroom', { val: true, ack: true });
  adapter.foreignStates.set('0_userdata.0.hvac.livingRoom.targetTemperature', { val: 21, ack: true });
  adapter.foreignStates.set('0_userdata.0.energy.pvSurplusMode', { val: false, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'recordObservation,getHabits,getLearningStatus,setHabitMode,evaluateHabits,suggestAutomation,applyHabit,optimizeHome,handleIntent,ping,getTelemetry',
    habitAutoPromote: false,
    habitMinObservations: 3,
    habitMinDays: 1,
    habitMinConfidence: 0.5,
    habitOverrideCooldownMs: 0,
    habitMinApplyIntervalMs: 0,
    ...overrides,
  });
  return { adapter, bridge };
}

async function trainBedtime(bridge) {
  for (const day of [2, 3, 4]) {
    const response = await bridge.processCommand({
      action: 'recordObservation',
      trigger: 'intent',
      now: localIso(2026, 3, day, 22, 10),
      context: { type: 'habit', name: 'bedtime' },
      states: {
        '0_userdata.0.light.livingroom': false,
        '0_userdata.0.hvac.livingRoom.targetTemperature': 18,
      },
    });
    assert.equal(response.ok, true);
  }
}

test('handleIntent maps bedtime to scene operations', async () => {
  const { bridge } = habitBridge({ allowedActions: 'handleIntent' });
  const response = await bridge.processCommand({ action: 'handleIntent', text: 'gute nacht', execute: false });
  assert.equal(response.ok, true);
  assert.equal(response.data.plan.contextEvents.some((event) => event.name === 'bedtime'), true);
  assert.ok(response.data.plan.operations.length >= 1);
  assert.equal(response.data.plan.operations.some((op) => op.id === '0_userdata.0.light.livingroom' && op.value === false), true);
});

test('recordObservation learns habits and reports learning status', async () => {
  const { bridge } = habitBridge();
  await trainBedtime(bridge);

  const habits = await bridge.processCommand({ action: 'getHabits' });
  assert.equal(habits.ok, true);
  assert.equal(habits.data.profiles.some((profile) => profile.name === 'bedtime'), true);

  const status = await bridge.processCommand({ action: 'getLearningStatus' });
  assert.equal(status.ok, true);
  assert.equal(status.data.observationCount, 3);
  assert.equal(status.data.readyForSuggest, true);
});

test('observe mode does not execute optimizeHome even with execute=true', async () => {
  const { adapter, bridge } = habitBridge();
  await trainBedtime(bridge);

  const response = await bridge.processCommand({
    action: 'optimizeHome',
    execute: true,
    now: localIso(2026, 3, 10, 22, 10),
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.mode, 'observe');
  assert.equal(response.data.execution, null);
  assert.equal(adapter.foreignStates.get('0_userdata.0.light.livingroom').val, true);
  assert.ok(response.data.operations.length >= 1);
});

test('autonomous mode requires confirmation and completed learning', async () => {
  const { bridge } = habitBridge();
  const missingConfirm = await bridge.processCommand({ action: 'setHabitMode', mode: 'autonomous' });
  assert.equal(missingConfirm.ok, false);
  assert.equal(missingConfirm.error.code, 'ECONFIRMREQUIRED');

  const notReady = await bridge.processCommand({ action: 'setHabitMode', mode: 'autonomous', confirmation: true });
  assert.equal(notReady.ok, false);
  assert.equal(notReady.error.code, 'ENOTREADY');

  await trainBedtime(bridge);
  const enabled = await bridge.processCommand({ action: 'setHabitMode', mode: 'autonomous', confirmation: true });
  assert.equal(enabled.ok, true);
  assert.equal(enabled.data.mode, 'autonomous');
});

test('after learning, optimizeHome controls and can overlay PV surplus', async () => {
  const { adapter, bridge } = habitBridge();
  await trainBedtime(bridge);
  await bridge.processCommand({ action: 'setHabitMode', mode: 'autonomous', confirmation: true });

  const response = await bridge.processCommand({
    action: 'optimizeHome',
    now: localIso(2026, 3, 10, 22, 10),
    watts: 1800,
    confirmation: true,
  });

  assert.equal(response.ok, true);
  assert.ok(response.data.execution);
  assert.equal(adapter.foreignStates.get('0_userdata.0.light.livingroom').val, false);
  assert.equal(adapter.foreignStates.get('0_userdata.0.hvac.livingRoom.targetTemperature').val, 18);
  assert.equal(adapter.foreignStates.get('0_userdata.0.energy.pvSurplusMode').val, true);
});

test('applyHabit executes a named learned profile', async () => {
  const { adapter, bridge } = habitBridge();
  await trainBedtime(bridge);

  const response = await bridge.processCommand({
    action: 'applyHabit',
    name: 'bedtime',
    execute: true,
    confirmation: true,
  });

  assert.equal(response.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.light.livingroom').val, false);
});

test('handleIntent prefers learned habit targets over scene templates', async () => {
  const { adapter, bridge } = habitBridge({ allowedActions: 'recordObservation,handleIntent,getHabits' });
  for (const day of [2, 3, 4]) {
    await bridge.processCommand({
      action: 'recordObservation',
      now: localIso(2026, 3, day, 22, 10),
      context: { type: 'habit', name: 'bedtime' },
      states: {
        '0_userdata.0.light.livingroom': false,
        '0_userdata.0.hvac.livingRoom.targetTemperature': 17,
      },
    });
  }

  const response = await bridge.processCommand({ action: 'handleIntent', text: 'ich gehe schlafen', execute: false });
  assert.equal(response.ok, true);
  assert.equal(response.data.plan.source, 'habit');
  const tempOp = response.data.plan.operations.find((op) => op.id === '0_userdata.0.hvac.livingRoom.targetTemperature');
  assert.equal(tempOp.value, 17);
  assert.equal(adapter.foreignStates.get('0_userdata.0.hvac.livingRoom.targetTemperature').val, 21);
});

test('queue high watermark rejects without corrupting depth', async () => {
  const { bridge } = habitBridge({ allowedActions: 'ping', queueHighWatermark: 1 });
  bridge.queueDepth = 1;
  const rejected = await bridge.processCommand({ action: 'ping' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EQUEUEFULL');
  assert.equal(bridge.queueDepth, 1);
  assert.equal(bridge.counts.queueRejected, 1);
});

test('getTelemetry records duration after successful commands', async () => {
  const { bridge } = habitBridge({ allowedActions: 'ping,getTelemetry' });
  await bridge.processCommand({ action: 'ping' });
  const response = await bridge.processCommand({ action: 'getTelemetry' });
  assert.equal(response.ok, true);
  assert.equal(response.data.avgDurationMs > 0 || response.data.counts.success >= 1, true);
  assert.equal(response.data.habitMode, 'observe');
});

test('auto-promote moves from observe to suggest after enough learning', async () => {
  const { bridge } = habitBridge({ habitAutoPromote: true });
  await trainBedtime(bridge);
  const status = await bridge.processCommand({ action: 'getLearningStatus' });
  assert.equal(status.data.mode, 'suggest');
});
