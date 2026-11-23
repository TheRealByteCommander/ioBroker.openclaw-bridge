'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { BridgeRuntime } = require('../lib/bridge');
const { SerialQueue, ResponseCache } = require('../lib/queue');
const { ConfirmationStore, isTrustedConfirmationSource } = require('../lib/confirmations');
const { resolveInsideDir } = require('../lib/util');
const { MockAdapter } = require('./helpers');

function runtime(config = {}, adapterOptions = {}) {
  const adapter = new MockAdapter(adapterOptions);
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    habitLearnFromCommands: false,
    retryAttempts: 1,
    ...config,
  });
  return { adapter, bridge };
}

const interlock = [
  {
    enabled: true,
    name: 'heaterA',
    targetId: '0_userdata.0.heater.a',
    when: 'turn_on',
    combinator: 'and',
    conditions: [{ id: '0_userdata.0.heater.b', op: 'falsy' }],
  },
  {
    enabled: true,
    name: 'heaterB',
    targetId: '0_userdata.0.heater.b',
    when: 'turn_on',
    combinator: 'and',
    conditions: [{ id: '0_userdata.0.heater.a', op: 'falsy' }],
  },
];

// --- queue -------------------------------------------------------------------

test('SerialQueue runs tasks strictly one after another', async () => {
  const queue = new SerialQueue({ highWatermark: 10 });
  const log = [];
  const task = (name, ms) => () => new Promise((resolve) => {
    log.push(`start ${name}`);
    setTimeout(() => { log.push(`end ${name}`); resolve(name); }, ms);
  });
  const results = await Promise.all([queue.push(task('a', 20)), queue.push(task('b', 1))]);
  assert.deepEqual(results, ['a', 'b']);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b']);
  assert.equal(queue.depth, 0);
});

test('SerialQueue keeps running after a failing task and respects force', async () => {
  const queue = new SerialQueue({ highWatermark: 1 });
  await assert.rejects(queue.push(async () => { throw new Error('boom'); }), /boom/);
  let release;
  const blocking = queue.push(() => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(queue.push(async () => 1), { code: 'EQUEUEFULL' });
  const forced = queue.push(async () => 'forced', { force: true });
  release('done');
  assert.equal(await blocking, 'done');
  assert.equal(await forced, 'forced');
});

test('ResponseCache expires entries after the TTL', () => {
  let now = 0;
  const cache = new ResponseCache({ ttlMs: 100, now: () => now });
  cache.set('r1', { ok: true });
  assert.deepEqual(cache.get('r1').value, { ok: true });
  now = 150;
  assert.equal(cache.get('r1'), null);
});

// --- serialization / timeout / idempotency ------------------------------------

test('concurrent commands cannot both pass an interlock rule', async () => {
  const { adapter, bridge } = runtime({ guardRules: interlock }, { delayMs: 5 });
  adapter.foreignStates.set('0_userdata.0.heater.a', { val: false });
  adapter.foreignStates.set('0_userdata.0.heater.b', { val: false });

  const [first, second] = await Promise.all([
    bridge.processCommand({ action: 'setState', id: '0_userdata.0.heater.a', value: true }),
    bridge.processCommand({ action: 'setState', id: '0_userdata.0.heater.b', value: true }),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'EGUARDFAILED');
  assert.equal(adapter.foreignStates.get('0_userdata.0.heater.b').val, false);
});

test('timeout aborts the remaining writes of a plan', async () => {
  const { adapter, bridge } = runtime({ commandTimeoutMs: 30, requireConfirmationActions: '' }, { delayMs: 15 });
  const operations = [1, 2, 3, 4, 5, 6].map((n) => ({ type: 'setState', id: `0_userdata.0.slow.${n}`, value: true }));

  const response = await bridge.processCommand({ action: 'executePlan', operations });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ETIMEOUT');
  await bridge.queue.drain();
  assert.ok(adapter.writes.length < operations.length, `expected aborted plan, got ${adapter.writes.length} writes`);
  assert.equal(bridge.counts.timedOut, 1);
});

test('a repeated requestId is answered from cache without a second write', async () => {
  const { adapter, bridge } = runtime();
  const payload = { action: 'setState', id: '0_userdata.0.light.hall', value: true, requestId: 'req-1' };
  const first = await bridge.processCommand(payload);
  const second = await bridge.processCommand(payload);
  assert.equal(first.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.requestId, 'req-1');
  assert.equal(adapter.writes.length, 1);
});

// --- auth ------------------------------------------------------------------------

test('authToken is enforced and never echoed', async () => {
  const { adapter, bridge } = runtime({ authToken: 'secret-token' });
  const denied = await bridge.processCommand({ action: 'ping' });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'EUNAUTHORIZED');

  const wrong = await bridge.processCommand({ action: 'ping', token: 'nope' });
  assert.equal(wrong.error.code, 'EUNAUTHORIZED');

  const allowed = await bridge.processCommand(JSON.stringify({ action: 'ping', token: 'secret-token' }));
  assert.equal(allowed.ok, true);
  assert.equal(String(adapter.states.get('control.lastResult').val).includes('secret-token'), false);

  const redacted = JSON.parse(adapter.states.get('control.command').val);
  assert.equal(redacted.token, '***');
  assert.equal(adapter.states.get('control.command').ack, true);

  const trusted = await bridge.handleCommand({ action: 'ping' }, { transport: 'http', trusted: true });
  assert.equal(trusted.ok, true);
  assert.equal(bridge.counts.unauthorized, 2);
});

test('info.connection follows agent activity', async () => {
  const { adapter, bridge } = runtime({ agentHeartbeatMinutes: 1 });
  await bridge.processCommand({ action: 'ping' });
  assert.equal(adapter.states.get('info.connection').val, true);
  bridge.agentLastSeen = Date.now() - 2 * 60_000;
  await bridge.refreshConnection();
  assert.equal(adapter.states.get('info.connection').val, false);
});

// --- payload validation / catalog ---------------------------------------------

test('payload validation reports missing and mistyped fields with schema', async () => {
  const { bridge } = runtime();
  const missing = await bridge.processCommand({ action: 'getState' });
  assert.equal(missing.error.code, 'EBADREQUEST');
  assert.deepEqual(missing.error.details.problems, [{ field: 'id', problem: 'required' }]);
  assert.equal(missing.error.details.schema.required[0], 'id');

  const wrongType = await bridge.processCommand({ action: 'getStates', ids: 'a,b' });
  assert.equal(wrongType.error.details.problems[0].problem, 'expected array');
});

test('describeTools returns allowed actions in several formats', async () => {
  const { bridge } = runtime({ allowedActions: 'getState,setState' });
  const raw = await bridge.processCommand({ action: 'describeTools' });
  const names = raw.data.tools.map((tool) => tool.name);
  assert.ok(names.includes('getState'));
  assert.ok(names.includes('describeTools'));
  assert.equal(names.includes('executePlan'), false);

  const openai = await bridge.processCommand({ action: 'describeTools', format: 'openai' });
  assert.equal(openai.data.tools[0].type, 'function');
  const anthropic = await bridge.processCommand({ action: 'describeTools', format: 'anthropic' });
  assert.ok(anthropic.data.tools[0].input_schema);
});

// --- listStates ----------------------------------------------------------------

test('listStates filters by prefix and search and returns metadata', async () => {
  const { adapter, bridge } = runtime({ allowedPrefixes: '0_userdata.0,shelly.0' });
  adapter.foreignObjects.set('shelly.0.pump.Relay0.Switch', { common: { name: 'Brunnenpumpe', role: 'switch', type: 'boolean', write: true } });
  adapter.foreignObjects.set('shelly.0.pump.Relay0.Power', { common: { name: 'Leistung', role: 'value.power', type: 'number', unit: 'W', write: false } });
  adapter.foreignObjects.set('0_userdata.0.light.hall', { common: { name: { de: 'Flurlicht', en: 'Hall light' }, role: 'switch.light' } });

  const all = await bridge.processCommand({ action: 'listStates' });
  assert.equal(all.data.total, 3);

  const pump = await bridge.processCommand({ action: 'listStates', prefix: 'shelly.0', search: 'brunnen', withMeta: true });
  assert.deepEqual(pump.data.states.map((s) => s.id), ['shelly.0.pump.Relay0.Switch']);
  assert.equal(pump.data.states[0].role, 'switch');

  const limited = await bridge.processCommand({ action: 'listStates', limit: 1 });
  assert.equal(limited.data.count, 1);
  assert.equal(limited.data.truncated, true);

  const forbidden = await bridge.processCommand({ action: 'listStates', prefix: 'system.adapter' });
  assert.equal(forbidden.error.code, 'EIDFORBIDDEN');
});

// --- human confirmation ----------------------------------------------------------

test('human mode: agent cannot self-confirm, operator approves via safety.confirm', async () => {
  const { adapter, bridge } = runtime({
    confirmationMode: 'human',
    criticalStatePrefixes: '0_userdata.0.critical',
  });
  const response = await bridge.processCommand({
    action: 'setState',
    id: '0_userdata.0.critical.mainValve',
    value: true,
    confirmation: true,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'ECONFIRMPENDING');
  assert.equal(adapter.foreignStates.has('0_userdata.0.critical.mainValve'), false);

  const pending = await bridge.processCommand({ action: 'getPendingConfirmations' });
  assert.equal(pending.data.pending.length, 1);
  const id = pending.data.pending[0].id;

  // the agent's own channel (simple-api) may not approve
  await bridge.handleConfirmationState('openclaw-bridge.0.safety.confirm', { val: id, ack: false, from: 'system.adapter.simple-api.0' });
  assert.equal(adapter.foreignStates.has('0_userdata.0.critical.mainValve'), false);

  const outcome = await bridge.handleConfirmationState('openclaw-bridge.0.safety.confirm', { val: id, ack: false, from: 'system.adapter.javascript.0' });
  assert.equal(outcome.approved, true);
  assert.equal(outcome.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.critical.mainValve').val, true);
  assert.equal(bridge.confirmations.list().length, 0);
  assert.equal(JSON.parse(adapter.states.get('safety.lastConfirmation').val).approved, true);
});

test('human mode: rejection and agent cancel do not write', async () => {
  const { adapter, bridge } = runtime({ confirmationMode: 'human', criticalStatePrefixes: '0_userdata.0.critical' });
  const first = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.critical.a', value: 1 });
  const second = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.critical.b', value: 1 });
  const [a, b] = bridge.confirmations.list();
  assert.equal(first.error.code, 'ECONFIRMPENDING');
  assert.equal(second.error.code, 'ECONFIRMPENDING');

  const rejected = await bridge.handleConfirmationState('openclaw-bridge.0.safety.reject', { val: a.id, ack: false, from: 'system.adapter.admin.0' });
  assert.equal(rejected.approved, false);
  const cancelled = await bridge.processCommand({ action: 'cancelConfirmation', confirmationId: b.id });
  assert.equal(cancelled.ok, true);
  assert.equal(adapter.writes.length, 0);
  assert.equal(bridge.confirmations.list().length, 0);
});

test('human mode: approved plan still has to satisfy guard rules', async () => {
  const { adapter, bridge } = runtime({
    confirmationMode: 'human',
    criticalStatePrefixes: '0_userdata.0.heater',
    guardRules: interlock,
  });
  adapter.foreignStates.set('0_userdata.0.heater.a', { val: false });
  adapter.foreignStates.set('0_userdata.0.heater.b', { val: false });
  await bridge.processCommand({ action: 'setState', id: '0_userdata.0.heater.a', value: true });
  const [item] = bridge.confirmations.list();
  adapter.foreignStates.set('0_userdata.0.heater.b', { val: true }); // changed meanwhile
  const outcome = await bridge.resolveConfirmation(item.id, true, { source: 'test' });
  assert.equal(outcome.ok, false);
  assert.equal(adapter.foreignStates.get('0_userdata.0.heater.a').val, false);
});

test('ConfirmationStore expires entries and restores persisted ones', () => {
  let now = 1_000;
  const store = new ConfirmationStore({ ttlMs: 100, now: () => now });
  const item = store.create({ kind: 'plan', operations: [{ id: 'x', value: 1 }] });
  assert.equal(store.list().length, 1);
  assert.match(item.summary, /x = 1/);
  now = 2_000;
  assert.equal(store.expire().length, 1);
  assert.equal(store.list().length, 0);
  assert.equal(isTrustedConfirmationSource('system.adapter.simple-api.0', ['system.adapter.simple-api']), false);
  assert.equal(isTrustedConfirmationSource('system.adapter.web.0', ['system.adapter.simple-api']), true);
});

test('agent mode keeps the legacy confirmation flag', async () => {
  const { adapter, bridge } = runtime({ criticalStatePrefixes: '0_userdata.0.critical' });
  const blocked = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.critical.a', value: 1 });
  assert.equal(blocked.error.code, 'ECONFIRMREQUIRED');
  const ok = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.critical.a', value: 1, confirmation: true });
  assert.equal(ok.ok, true);
  assert.equal(adapter.foreignStates.get('0_userdata.0.critical.a').val, 1);
});

// --- STT path / housekeeping -----------------------------------------------------

test('transcribe only reads files inside sttAudioDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocb-audio-'));
  fs.writeFileSync(path.join(dir, 'cmd.wav'), 'x');
  assert.equal(resolveInsideDir('cmd.wav', dir), fs.realpathSync(path.join(dir, 'cmd.wav')));
  assert.throws(() => resolveInsideDir('/etc/hosts', dir), { code: 'EAUDIOPATH' });
  assert.throws(() => resolveInsideDir('../../etc/hosts', dir), { code: 'EAUDIOPATH' });
  assert.throws(() => resolveInsideDir('cmd.wav', ''), { code: 'EAUDIOPATH' });

  const { bridge } = runtime({});
  const response = await bridge.processCommand({ action: 'transcribe', audioPath: '/etc/passwd' });
  assert.equal(response.error.code, 'EAUDIOPATH');
});

test('cleanupResponses deletes response states older than the retention', async () => {
  const { adapter, bridge } = runtime({ responseRetentionMinutes: 1 });
  await bridge.processCommand({ action: 'ping', requestId: 'old' });
  await bridge.processCommand({ action: 'ping', requestId: 'new' });
  adapter.states.get('responses.old').ts = Date.now() - 5 * 60_000;
  const removed = await bridge.cleanupResponses();
  assert.equal(removed, 1);
  assert.equal(adapter.states.has('responses.old'), false);
  assert.equal(adapter.states.has('responses.new'), true);
});

test('HTTP and sendTo transports do not create response states', async () => {
  const { adapter, bridge } = runtime();
  await bridge.handleCommand({ action: 'ping', requestId: 'via-http' }, { transport: 'http', trusted: true });
  assert.equal(adapter.objects.has('responses.via-http'), false);
  assert.ok(adapter.states.get('control.lastResult'));
});

test('max-on auto-off runs through the queue and notifies OpenClaw', async () => {
  const events = [];
  const { adapter, bridge } = runtime({
    guardRules: [{ enabled: true, name: 'socket', targetId: '0_userdata.0.socket', when: 'turn_on', maxOnMs: 20 }],
  });
  bridge.notifier.on('event', (event) => events.push(event));
  await bridge.processCommand({ action: 'setState', id: '0_userdata.0.socket', value: true });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await bridge.queue.drain();
  assert.equal(adapter.foreignStates.get('0_userdata.0.socket').val, false);
  assert.ok(events.some((event) => event.type === 'max_on_elapsed'));
  bridge.stopGuardTimers();
});

test('intent detection understands english phrases', async () => {
  const { detectIntent } = require('../lib/bridge');
  assert.equal(detectIntent("I'm cold").comfort, 'cold');
  assert.deepEqual(detectIntent('good night').names, ['bedtime']);
});

test('writes to unknown or read-only states are rejected before anything is written', async () => {
  const adapter = new MockAdapter({ strictObjects: true });
  adapter.foreignStates.set('0_userdata.0.valve', { val: false });
  adapter.foreignObjects.set('0_userdata.0.sensor', { type: 'state', common: { write: false } });
  const bridge = new BridgeRuntime(adapter, { allowedPrefixes: '0_userdata.0', habitLearnFromCommands: false, requireConfirmationActions: '' });

  const unknown = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.water.guess', value: true });
  assert.equal(unknown.error.code, 'EIDUNKNOWN');
  assert.equal(unknown.error.nextAction, 'call_listStates_and_use_an_existing_id');
  assert.equal(unknown.error.hint.search, 'guess');

  const readOnly = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.sensor', value: 1 });
  assert.equal(readOnly.error.code, 'EREADONLY');

  // one bad id rejects the whole plan: the valid write must not happen either
  const plan = await bridge.processCommand({ action: 'executePlan', confirmation: true, operations: [
    { type: 'setState', id: '0_userdata.0.valve', value: true },
    { type: 'setState', id: '0_userdata.0.water.guess', value: true },
  ] });
  assert.equal(plan.error.code, 'EIDUNKNOWN');
  assert.equal(adapter.writes.length, 0);

  const split = await bridge.processCommand({ action: 'planWithinBounds', operations: [{ type: 'setState', id: '0_userdata.0.water.guess', value: true }] });
  assert.equal(split.data.blocked[0].error.code, 'EIDUNKNOWN');
  assert.equal(split.data.blocked[0].hint.type, 'use_listStates');

  const relaxed = new BridgeRuntime(adapter, { allowedPrefixes: '0_userdata.0', habitLearnFromCommands: false, requireExistingStates: false });
  assert.equal((await relaxed.processCommand({ action: 'setState', id: '0_userdata.0.water.guess', value: true })).ok, true);
});
