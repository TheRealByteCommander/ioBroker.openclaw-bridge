'use strict';

const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { BridgeRuntime } = require('../lib/bridge');
const { BridgeHttpServer } = require('../lib/httpServer');
const { Notifier, formatMessage } = require('../lib/notifier');
const { normalizeConfig } = require('../lib/config');
const { MockAdapter } = require('./helpers');

const TOKEN = 'test-token-123';

async function startServer(config = {}) {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.light.hall', { val: false });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    authToken: TOKEN,
    httpEnabled: true,
    httpBind: '127.0.0.1',
    httpPort: 1,
    habitLearnFromCommands: false,
    ...config,
  });
  bridge.config.httpPort = 0; // ephemeral port for tests
  const server = new BridgeHttpServer({ runtime: bridge, notifier: bridge.notifier, log: adapter.log });
  assert.equal(await server.start(), true);
  const base = `http://127.0.0.1:${server.port}`;
  return { adapter, bridge, server, base };
}

function request(base, method, path, { body, token = TOKEN, headers = {} } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

test('HTTP API: health is public, everything else needs the bearer token', async () => {
  const { server, base } = await startServer();
  try {
    const health = await request(base, 'GET', '/api/v1/health', { token: null });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const denied = await request(base, 'GET', '/api/v1/tools', { token: null });
    assert.equal(denied.status, 401);
    const wrong = await request(base, 'GET', '/api/v1/tools', { token: 'wrong' });
    assert.equal(wrong.status, 401);

    const tools = await request(base, 'GET', '/api/v1/tools?format=openai');
    assert.equal(tools.status, 200);
    const body = await tools.json();
    assert.equal(body.format, 'openai');
    assert.ok(body.tools.some((tool) => tool.function.name === 'planWithinBounds'));
  } finally {
    await server.stop();
  }
});

test('HTTP API: synchronous commands, action routes and error mapping', async () => {
  const { adapter, server, base } = await startServer();
  try {
    const ping = await request(base, 'POST', '/api/v1/command', { body: { action: 'ping' } });
    assert.equal(ping.status, 200);
    assert.equal((await ping.json()).data.pong, true);

    const set = await request(base, 'POST', '/api/v1/actions/setState', { body: { id: '0_userdata.0.light.hall', value: true } });
    const setBody = await set.json();
    assert.equal(setBody.ok, true);
    assert.equal(adapter.foreignStates.get('0_userdata.0.light.hall').val, true);

    const forbidden = await request(base, 'POST', '/api/v1/actions/getState', { body: { id: 'system.adapter.admin.0.alive' } });
    const forbiddenBody = await forbidden.json();
    assert.equal(forbidden.status, 200);
    assert.equal(forbiddenBody.error.code, 'EIDFORBIDDEN');

    const badJson = await request(base, 'POST', '/api/v1/command', { body: '{nope' });
    assert.equal(badJson.status, 400);

    const missing = await request(base, 'GET', '/api/v1/unknown');
    assert.equal(missing.status, 405);

    const constraints = await request(base, 'GET', '/api/v1/constraints');
    assert.equal((await constraints.json()).data.role, 'operating_envelope');
  } finally {
    await server.stop();
  }
});

test('HTTP API: Idempotency-Key header deduplicates writes', async () => {
  const { adapter, server, base } = await startServer();
  try {
    const opts = { body: { action: 'setState', id: '0_userdata.0.light.hall', value: true }, headers: { 'idempotency-key': 'abc' } };
    await request(base, 'POST', '/api/v1/command', opts);
    const again = await (await request(base, 'POST', '/api/v1/command', opts)).json();
    assert.equal(again.replayed, true);
    assert.equal(adapter.writes.length, 1);
  } finally {
    await server.stop();
  }
});

test('HTTP API: server-sent events stream bridge events', async () => {
  const { bridge, server } = await startServer();
  try {
    const received = await new Promise((resolve, reject) => {
      const req = http.get({
        host: '127.0.0.1',
        port: server.port,
        path: '/api/v1/events',
        headers: { authorization: `Bearer ${TOKEN}` },
      }, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          if (buffer.includes('event: hello') && !buffer.includes('guard_block')) {
            bridge.notifier.publish({ type: 'guard_block', id: '0_userdata.0.pump' });
          }
          if (buffer.includes('event: guard_block')) {
            req.destroy();
            resolve(buffer);
          }
        });
      });
      req.on('error', (err) => (err.code === 'ECONNRESET' ? null : reject(err)));
      setTimeout(() => reject(new Error('no SSE event')), 2000);
    });
    assert.match(received, /"id":"0_userdata.0.pump"/);
  } finally {
    await server.stop();
  }
});

test('HTTP API refuses to listen on a public address without a token', () => {
  const problem = BridgeHttpServer.checkStartupPolicy(normalizeConfig({ httpBind: '0.0.0.0' }));
  assert.match(problem, /needs an authToken/);
  assert.equal(BridgeHttpServer.checkStartupPolicy(normalizeConfig({ httpBind: '127.0.0.1' })), null);
  assert.equal(BridgeHttpServer.checkStartupPolicy(normalizeConfig({ httpBind: '0.0.0.0', authToken: 'x' })), null);
});

// --- notifier -------------------------------------------------------------------

function fakeFetch(calls, status = 200) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 300, status, text: async () => 'err' };
  };
}

function notifierConfig(overrides = {}) {
  return normalizeConfig({
    openclawWebhookUrl: 'http://gw:18789/hooks/agent',
    openclawWebhookToken: 'hook-secret',
    openclawAgentId: 'main',
    notifyMinIntervalSec: 60,
    ...overrides,
  });
}

test('Notifier posts /hooks/agent payload with bearer token', async () => {
  const calls = [];
  const notifier = new Notifier(notifierConfig(), { fetchImpl: fakeFetch(calls), log: { warn() {} } });
  const sent = await notifier.publish({ type: 'guard_block', id: '0_userdata.0.pump', code: 'EGUARDFAILED' });
  assert.equal(sent, true);
  assert.equal(calls[0].url, 'http://gw:18789/hooks/agent');
  assert.equal(calls[0].init.headers.authorization, 'Bearer hook-secret');
  assert.equal(calls[0].body.agentId, 'main');
  assert.equal(calls[0].body.name, 'ioBroker');
  assert.ok(calls[0].body.idempotencyKey);
  assert.match(calls[0].body.message, /Regel hat eine Schaltung blockiert/);
});

test('Notifier wake mode, throttling and event filter', async () => {
  const calls = [];
  const notifier = new Notifier(notifierConfig({ openclawWebhookMode: 'wake' }), { fetchImpl: fakeFetch(calls), log: { warn() {} } });
  await notifier.publish({ type: 'max_on_elapsed', id: 'a' });
  await notifier.publish({ type: 'max_on_elapsed', id: 'a' }); // throttled
  await notifier.publish({ type: 'max_on_elapsed', id: 'b' });
  await notifier.publish({ type: 'state_changed', id: 'c' }); // not enabled by default
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.mode, 'now');
  assert.ok(calls[0].body.text);
  assert.equal(notifier.stats.throttled, 1);
});

test('Notifier never throws on webhook failure', async () => {
  const notifier = new Notifier(notifierConfig(), { fetchImpl: fakeFetch([], 500), log: { warn() {} } });
  assert.equal(await notifier.publish({ type: 'guard_block', id: 'x' }), false);
  assert.equal(notifier.stats.failed, 1);
});

test('formatMessage keeps a readable title and machine readable payload', () => {
  const text = formatMessage({ type: 'confirmation_pending', id: 'ab12', summary: 'x = 1', eventId: 'e1' });
  assert.match(text, /Bestätigung durch den Operator/);
  assert.match(text, /"id":"ab12"/);
  assert.equal(text.includes('e1'), false);
});

test('guard blocks are pushed to OpenClaw', async () => {
  const calls = [];
  const adapter = new MockAdapter();
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    habitLearnFromCommands: false,
    openclawWebhookUrl: 'http://gw/hooks/agent',
    openclawWebhookToken: 't',
    guardRules: [{ enabled: true, name: 'pump', targetId: '0_userdata.0.pump', when: 'turn_on', combinator: 'or', conditionIds: '0_userdata.0.valve' }],
  }, { fetchImpl: fakeFetch(calls) });
  const response = await bridge.processCommand({ action: 'setState', id: '0_userdata.0.pump', value: true });
  assert.equal(response.error.code, 'EGUARDFAILED');
  assert.equal(calls.length, 1);
  assert.match(calls[0].body.message, /0_userdata.0.pump/);
});
