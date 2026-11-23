'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { BridgeRuntime } = require('../lib/bridge');
const { BridgeHttpServer } = require('../lib/httpServer');
const catalog = require('../lib/catalog');
const ioPackage = require('../io-package.json');
const { MockAdapter } = require('./helpers');

const root = path.join(__dirname, '..');
const pluginDir = path.join(root, 'openclaw', 'plugin');
const skillDir = path.join(root, 'openclaw', 'skill', 'iobroker-bridge');
const TOKEN = 'plugin-token';

const load = (rel) => import(path.join(root, rel));

async function liveBridge() {
  const adapter = new MockAdapter();
  adapter.foreignStates.set('0_userdata.0.valve.bed1', { val: false });
  adapter.foreignStates.set('0_userdata.0.pump.well', { val: false });
  const bridge = new BridgeRuntime(adapter, {
    allowedPrefixes: '0_userdata.0',
    authToken: TOKEN,
    habitLearnFromCommands: false,
    requireConfirmationActions: '',
    guardRules: [{
      enabled: true,
      name: 'brunnenpumpe',
      targetId: '0_userdata.0.pump.well',
      when: 'turn_on',
      combinator: 'or',
      conditionIds: '0_userdata.0.valve.bed1',
    }],
  });
  bridge.config.httpPort = 0;
  const server = new BridgeHttpServer({ runtime: bridge, notifier: bridge.notifier, log: adapter.log });
  await server.start();
  return { adapter, bridge, server, baseUrl: `http://127.0.0.1:${server.port}` };
}

test('plugin tools map to existing bridge actions and known parameters', async () => {
  const { TOOLS } = await load('openclaw/plugin/tools.mjs');
  for (const tool of TOOLS) {
    const spec = catalog.getAction(tool.action);
    assert.ok(spec, `${tool.name} → unknown action ${tool.action}`);
    assert.equal(tool.write, spec.mutates, `${tool.name} write flag must match catalog`);
    for (const key of Object.keys(tool.parameters.properties)) {
      assert.ok(key in spec.params, `${tool.name}: parameter ${key} not in catalog for ${tool.action}`);
    }
    assert.match(tool.name, /^iobroker_[a-z_]+$/);
  }
});

test('plugin manifest declares every tool and marks write tools optional', async () => {
  const { TOOLS } = await load('openclaw/plugin/tools.mjs');
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'openclaw.plugin.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
  assert.equal(manifest.id, 'iobroker-bridge');
  assert.ok(manifest.configSchema);
  assert.deepEqual(manifest.contracts.tools, TOOLS.map((tool) => tool.name));
  for (const tool of TOOLS) {
    assert.equal(Boolean(manifest.toolMetadata[tool.name]?.optional), tool.write, tool.name);
  }
  assert.deepEqual(pkg.openclaw.extensions, ['./index.js']);
  assert.equal(pkg.version, ioPackage.common.version);
  assert.equal(manifest.version, ioPackage.common.version);
});

test('skill and plugin ship the same client', () => {
  const a = fs.readFileSync(path.join(pluginDir, 'client.mjs'), 'utf8');
  const b = fs.readFileSync(path.join(skillDir, 'scripts', 'client.mjs'), 'utf8');
  assert.equal(a, b, 'copy openclaw/plugin/client.mjs to the skill scripts folder');
});

test('SKILL.md has OpenClaw frontmatter and documents the safe loop', () => {
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const front = skill.split('---')[1];
  assert.match(front, /^name: iobroker-bridge$/m);
  assert.match(front, /^description: .+/m);
  assert.match(front, /"openclaw"/);
  assert.match(front, /IOBROKER_BRIDGE_TOKEN/);
  for (const token of ['{baseDir}/scripts/iobroker.mjs', 'getConstraints', 'planWithinBounds', 'ECONFIRMPENDING', 'hint.type']) {
    assert.ok(skill.includes(token), `SKILL.md misses ${token}`);
  }
});

test('end-to-end: plugin tools drive the bridge over HTTP within the envelope', async () => {
  const { registerBridgeTools } = await load('openclaw/plugin/register.mjs');
  const { adapter, server, baseUrl } = await liveBridge();
  try {
    const tools = new Map();
    const optional = new Set();
    const api = {
      pluginConfig: { baseUrl, token: TOKEN },
      logger: { info() {}, warn() {} },
      registerTool(tool, opts) {
        if (typeof tool === 'function') {
          optional.add(opts.name);
          tools.set(opts.name, tool({}));
        } else {
          tools.set(tool.name, tool);
        }
      },
    };
    registerBridgeTools(api);
    assert.ok(optional.has('iobroker_execute'));
    assert.equal(optional.has('iobroker_constraints'), false);

    const constraints = await tools.get('iobroker_constraints').execute('c1', {});
    assert.equal(constraints.details.ok, true);
    assert.equal(constraints.details.data.rules[0].currentlyAllowsTurnOn, false);

    const plan = await tools.get('iobroker_plan').execute('c2', {
      operations: [{ type: 'setState', id: '0_userdata.0.pump.well', value: true }],
    });
    assert.equal(plan.details.data.blocked.length, 1);
    const companions = plan.details.data.blocked[0].hint.companions;
    assert.ok(companions.length > 0);

    const execution = await tools.get('iobroker_execute').execute('c3', {
      operations: [companions[0], { type: 'setState', id: '0_userdata.0.pump.well', value: true }],
    });
    assert.equal(execution.details.ok, true);
    assert.equal(adapter.foreignStates.get('0_userdata.0.pump.well').val, true);
    assert.match(execution.content[0].text, /pump.well/);

    const failed = await tools.get('iobroker_set_state').execute('c4', { id: 'system.adapter.admin.0.alive', value: false });
    assert.match(failed.content[0].text, /FEHLER EIDFORBIDDEN/);
  } finally {
    await server.stop();
  }
});

test('plugin reports an unreachable bridge instead of throwing', async () => {
  const { registerBridgeTools } = await load('openclaw/plugin/register.mjs');
  const tools = new Map();
  registerBridgeTools({
    pluginConfig: { baseUrl: 'http://127.0.0.1:9', token: 'x', timeoutMs: 1000 },
    registerTool(tool, opts) { tools.set(opts?.name || tool.name, typeof tool === 'function' ? tool({}) : tool); },
  });
  const result = await tools.get('iobroker_constraints').execute('c', {});
  assert.equal(result.details.error.code, 'EUNREACHABLE');
});

test('skill CLI prints data, errors and exit codes', async () => {
  const { main } = await load('openclaw/skill/iobroker-bridge/scripts/iobroker.mjs');
  const { server, baseUrl } = await liveBridge();
  const env = { IOBROKER_BRIDGE_URL: baseUrl, IOBROKER_BRIDGE_TOKEN: TOKEN };
  const capture = () => {
    const out = { text: '', write(chunk) { this.text += chunk; } };
    return out;
  };
  try {
    let out = capture();
    assert.equal(await main(['ping'], env, out), 0);
    assert.match(out.text, /"pong": true/);

    out = capture();
    assert.equal(await main(['getState', '{"id":"system.x"}'], env, out), 1);
    assert.match(out.text, /FEHLER EIDFORBIDDEN/);

    out = capture();
    assert.equal(await main(['ping', '{nope'], env, out), 2);

    out = capture();
    assert.equal(await main(['ping'], { ...env, IOBROKER_BRIDGE_TOKEN: 'wrong' }, out), 2);
    assert.match(out.text, /unauthorized/);

    out = capture();
    assert.equal(await main(['tools', 'anthropic'], env, out), 0);
    assert.match(out.text, /input_schema/);
  } finally {
    await server.stop();
  }
});
