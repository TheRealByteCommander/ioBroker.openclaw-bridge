const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGuardRules,
  evaluateWrite,
  overlayGetValue,
  isTruthy,
} = require('../lib/guards');
const { BridgeRuntime } = require('../lib/bridge');

class MockAdapter {
  constructor() {
    this.version = '0.10.0';
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

const pumpRule = {
  enabled: true,
  name: 'brunnenpumpe',
  targetId: '0_userdata.0.pump.well',
  when: 'turn_on',
  combinator: 'or',
  conditionIds: '0_userdata.0.valve.bed1,0_userdata.0.valve.bed2',
};

const socketRule = {
  enabled: true,
  name: 'steckdose3',
  targetId: '0_userdata.0.socket.3',
  when: 'turn_on',
  combinator: 'or',
  maxOnMinutes: 60,
  minOffMinutes: 0,
};

test('isTruthy understands typical home automation values', () => {
  assert.equal(isTruthy(true), true);
  assert.equal(isTruthy('offen'), true);
  assert.equal(isTruthy('aus'), false);
  assert.equal(isTruthy({ val: 1 }), true);
});

test('OR guard blocks pump when all valves are closed', () => {
  const rules = parseGuardRules([pumpRule]);
  const result = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({ '0_userdata.0.valve.bed1': false, '0_userdata.0.valve.bed2': false }, {}) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EGUARDFAILED');
  assert.equal(result.combinator, 'or');
});

test('OR guard allows pump when at least one valve is open', () => {
  const rules = parseGuardRules([pumpRule]);
  const result = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({ '0_userdata.0.valve.bed1': false, '0_userdata.0.valve.bed2': true }, {}) },
  );
  assert.equal(result.ok, true);
});

test('XOR guard fails when two conditions are true', () => {
  const rules = parseGuardRules([{ ...pumpRule, combinator: 'xor' }]);
  const result = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({ '0_userdata.0.valve.bed1': true, '0_userdata.0.valve.bed2': true }, {}) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.combinator, 'xor');
});

test('AND guard requires every condition plus numeric compare', () => {
  const rules = parseGuardRules([{
    ...pumpRule,
    combinator: 'and',
    conditionsJson: JSON.stringify([{ id: '0_userdata.0.tank.level', op: 'gte', value: 20 }]),
  }]);
  const closed = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({
      '0_userdata.0.valve.bed1': true,
      '0_userdata.0.valve.bed2': true,
      '0_userdata.0.tank.level': 5,
    }, {}) },
  );
  assert.equal(closed.ok, false);

  const ok = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({
      '0_userdata.0.valve.bed1': true,
      '0_userdata.0.valve.bed2': false,
      '0_userdata.0.tank.level': 25,
    }, {}) },
  );
  assert.equal(ok.ok, false);

  const all = evaluateWrite(
    { id: '0_userdata.0.pump.well', value: true },
    rules,
    { getValue: overlayGetValue({
      '0_userdata.0.valve.bed1': true,
      '0_userdata.0.valve.bed2': true,
      '0_userdata.0.tank.level': 25,
    }, {}) },
  );
  assert.equal(all.ok, true);
});

test('max on duration blocks keeping a socket on beyond 1h', () => {
  const rules = parseGuardRules([socketRule]);
  const now = Date.now();
  const result = evaluateWrite(
    { id: '0_userdata.0.socket.3', value: true },
    rules,
    { now, lastOn: { '0_userdata.0.socket.3': now - 61 * 60 * 1000 }, lastOff: {} },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EDURATIONLIMIT');
});

function pumpBridge(valves = {}) {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pump.well', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.valve.bed1', { val: Boolean(valves.bed1), ack: true });
  adapter.foreignStates.set('0_userdata.0.valve.bed2', { val: Boolean(valves.bed2), ack: true });
  adapter.foreignStates.set('0_userdata.0.socket.3', { val: false, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'setState,executePlan,checkGuards,batchSetStates,planWithinBounds,getConstraints',
    habitLearnFromCommands: false,
    guardRules: [pumpRule, socketRule],
  });
  return { adapter, bridge };
}

test('setState blocks the well pump without an open valve', async () => {
  const { adapter, bridge } = pumpBridge({ bed1: false, bed2: false });
  const response = await bridge.processCommand({
    action: 'setState',
    id: '0_userdata.0.pump.well',
    value: true,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'EGUARDFAILED');
  assert.equal(response.error.hint.type, 'satisfy_any');
  assert.equal(response.error.hint.companions[0].id, '0_userdata.0.valve.bed1');
  assert.equal(adapter.foreignStates.get('0_userdata.0.pump.well').val, false);
});

test('executePlan allows pump when a valve is opened in the same plan', async () => {
  const { adapter, bridge } = pumpBridge({ bed1: false, bed2: false });
  const response = await bridge.processCommand({
    action: 'executePlan',
    confirmation: true,
    operations: [
      { type: 'setState', id: '0_userdata.0.pump.well', value: true },
      { type: 'setState', id: '0_userdata.0.valve.bed1', value: true },
    ],
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.results.every((row) => row.ok), true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.valve.bed1').val, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pump.well').val, true);
});

test('prefix OR matches any child valve state', async () => {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pump.well', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.valve.bed1', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.valve.bed2', { val: true, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'setState',
    habitLearnFromCommands: false,
    guardRules: [{
      enabled: true,
      name: 'pumpe-prefix',
      targetId: '0_userdata.0.pump.well',
      when: 'turn_on',
      combinator: 'or',
      conditionPrefix: '0_userdata.0.valve',
    }],
  });
  const response = await bridge.processCommand({
    action: 'setState',
    id: '0_userdata.0.pump.well',
    value: true,
  });
  assert.equal(response.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pump.well').val, true);
});

test('checkGuards dry-run reports the pump interlock', async () => {
  const { bridge } = pumpBridge({ bed1: false, bed2: false });
  const response = await bridge.processCommand({
    action: 'checkGuards',
    id: '0_userdata.0.pump.well',
    value: true,
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.valid, false);
  assert.equal(response.data.checks[0].error.code, 'EGUARDFAILED');
});

test('socket max-on timer writes off after the limit', async () => {
  const { adapter, bridge } = pumpBridge();
  const id = '0_userdata.0.socket.3';
  const rule = bridge.config.guardRules.find((item) => item.targetId === id);
  rule.maxOnMs = 15;
  const on = await bridge.processCommand({ action: 'setState', id, value: true });
  assert.equal(on.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(adapter.foreignStates.get(id).val, false);
});

const poolRule = {
  enabled: true,
  name: 'poolheizung',
  targetId: '0_userdata.0.pool.heater',
  when: 'turn_on',
  combinator: 'or',
  thresholdId: '0_userdata.0.energy.pvSurplusWatts',
  thresholdOp: 'gte',
  thresholdValue: 4000,
};

test('threshold blocks pool heating below 4000 W PV surplus', () => {
  const rules = parseGuardRules([poolRule]);
  const blocked = evaluateWrite(
    { id: '0_userdata.0.pool.heater', value: true },
    rules,
    { getValue: overlayGetValue({ '0_userdata.0.energy.pvSurplusWatts': 1800 }, {}) },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'ETHRESHOLD');

  const allowed = evaluateWrite(
    { id: '0_userdata.0.pool.heater', value: true },
    rules,
    { getValue: overlayGetValue({ '0_userdata.0.energy.pvSurplusWatts': 4200 }, {}) },
  );
  assert.equal(allowed.ok, true);
});

test('handlePvSurplus activates pool heating only from 4000 W', async () => {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pool.heater', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.energy.pvSurplusMode', { val: false, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'handlePvSurplus',
    habitLearnFromCommands: false,
    surplusLoads: [{
      enabled: true,
      name: 'Poolheizung',
      targetId: '0_userdata.0.pool.heater',
      minWatts: 4000,
      offBelowWatts: 2500,
      priority: 1,
    }],
  });

  const low = await bridge.processCommand({ action: 'handlePvSurplus', watts: 1800, confirmation: true });
  assert.equal(low.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pool.heater').val, false);

  const high = await bridge.processCommand({ action: 'handlePvSurplus', watts: 4100, confirmation: true });
  assert.equal(high.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pool.heater').val, true);

  const hysteresis = await bridge.processCommand({ action: 'handlePvSurplus', watts: 3000, confirmation: true });
  assert.equal(hysteresis.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pool.heater').val, true);

  const off = await bridge.processCommand({ action: 'handlePvSurplus', watts: 2000, confirmation: true });
  assert.equal(off.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.pool.heater').val, false);
});

test('setState on pool heater is blocked by the 4000 W guard', async () => {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pool.heater', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.energy.pvSurplusWatts', { val: 1200, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'setState',
    habitLearnFromCommands: false,
    guardRules: [poolRule],
  });
  const response = await bridge.processCommand({
    action: 'setState',
    id: '0_userdata.0.pool.heater',
    value: true,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ETHRESHOLD');
  assert.equal(response.error.hint.type, 'wait_for_threshold');
  assert.equal(adapter.foreignStates.get('0_userdata.0.pool.heater').val, false);
});

test('getConstraints describes the operating envelope for OpenClaw', async () => {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pool.heater', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.energy.pvSurplusWatts', { val: 1200, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'getConstraints',
    habitLearnFromCommands: false,
    guardRules: [poolRule],
    surplusLoads: [{
      enabled: true,
      name: 'Poolheizung',
      targetId: '0_userdata.0.pool.heater',
      minWatts: 4000,
    }],
  });
  const response = await bridge.processCommand({ action: 'getConstraints', watts: 1200 });
  assert.equal(response.ok, true);
  assert.equal(response.data.role, 'operating_envelope');
  assert.equal(response.data.rules[0].currentlyAllowsTurnOn, false);
  assert.equal(response.data.agent.mustNot.length > 0, true);
});

test('planWithinBounds lets the agent move only inside the envelope', async () => {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.pool.heater', { val: false, ack: true });
  adapter.foreignStates.set('0_userdata.0.energy.pvSurplusWatts', { val: 1200, ack: true });
  adapter.foreignStates.set('0_userdata.0.light.livingroom', { val: false, ack: true });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    allowedActions: 'planWithinBounds',
    habitLearnFromCommands: false,
    guardRules: [poolRule],
    pvPowerStateId: '0_userdata.0.energy.pvSurplusWatts',
  });
  const response = await bridge.processCommand({
    action: 'planWithinBounds',
    watts: 1200,
    operations: [
      { type: 'setState', id: '0_userdata.0.light.livingroom', value: true },
      { type: 'setState', id: '0_userdata.0.pool.heater', value: true },
    ],
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.withinBounds, false);
  assert.equal(response.data.allowed.length, 1);
  assert.equal(response.data.allowed[0].id, '0_userdata.0.light.livingroom');
  assert.equal(response.data.blocked[0].hint.type, 'wait_for_threshold');
  assert.ok(response.data.blocked[0].hint.deficit > 0);
});

test('planWithinBounds tells the agent how to stay inside AND/OR bounds', async () => {
  const { bridge } = pumpBridge({ bed1: false, bed2: false });
  const response = await bridge.processCommand({
    action: 'planWithinBounds',
    operations: [{ type: 'setState', id: '0_userdata.0.pump.well', value: true }],
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.withinBounds, false);
  assert.equal(response.data.blocked[0].hint.type, 'satisfy_any');
  assert.equal(response.data.blocked[0].hint.companions.some((op) => op.id.includes('valve')), true);
});
