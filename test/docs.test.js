'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('../package.json');
const ioPackage = require('../io-package.json');

const root = path.join(__dirname, '..');

function readDoc(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('package.json and io-package.json versions match', () => {
  assert.equal(pkg.version, ioPackage.common.version);
});

test('changelog and README document the current version', () => {
  const version = pkg.version;
  assert.match(readDoc('CHANGELOG.md'), new RegExp(`## ${version.replaceAll('.', '\\.')}`));
  assert.equal(readDoc('README.md').includes(version), true);
  assert.equal(readDoc('docs/README.md').includes(version), true);
});

test('action reference lists every native allowed action', () => {
  const actionsDoc = readDoc('docs/ACTIONS.md');
  const actions = String(ioPackage.native.allowedActions)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  assert.ok(actions.length > 0);
  const missing = actions.filter((action) => !actionsDoc.includes(`\`${action}\``) && !actionsDoc.includes(action));
  assert.deepEqual(missing, [], `docs/ACTIONS.md missing actions: ${missing.join(', ')}`);
});

test('configuration docs list every native key', () => {
  const configDoc = readDoc('docs/CONFIGURATION.md');
  const missing = Object.keys(ioPackage.native).filter((key) => !configDoc.includes(`\`${key}\``));
  assert.deepEqual(missing, [], `docs/CONFIGURATION.md missing native keys: ${missing.join(', ')}`);
});

test('docs index points at the current operator and agent guides', () => {
  const index = readDoc('docs/README.md');
  const required = [
    'OPERATOR_SETUP_FLOW.md',
    'CONFIGURATION.md',
    'TROUBLESHOOTING.md',
    'DEPLOYMENT_PLAN.md',
    'ALEXA_TTS_STT_INTEGRATION.md',
    'OPENCLAW_AGENT.md',
    'ACTIONS.md',
    'CONVERSATIONAL_AUTOMATION_ARCHITECTURE.md',
    'RELEASE_READINESS.md',
  ];
  for (const name of required) {
    assert.equal(index.includes(name), true, `docs/README.md missing link to ${name}`);
    assert.equal(fs.existsSync(path.join(root, 'docs', name)), true, `missing file docs/${name}`);
  }
});

test('adapter ships the operator handbook for Admin and common.docs', () => {
  assert.equal(fs.existsSync(path.join(root, 'docs/de/ANLEITUNG.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'docs/en/HANDBOOK.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'admin/ANLEITUNG.html')), true);
  const de = readDoc('docs/de/ANLEITUNG.md');
  for (const token of ['simple-api', '8087', 'control.command', 'getConstraints', 'SKILL.md']) {
    assert.equal(de.includes(token), true, `ANLEITUNG.md missing ${token}`);
  }
  assert.deepEqual(ioPackage.common.docs.de, ['docs/de/ANLEITUNG.md']);
  assert.deepEqual(ioPackage.common.docs.en, ['docs/en/HANDBOOK.md']);
});

test('README describes the operating envelope for OpenClaw', () => {
  const readme = readDoc('README.md');
  for (const token of ['getConstraints', 'planWithinBounds', 'Rahmenbedingungen', 'jsonConfig']) {
    assert.equal(readme.includes(token), true, `README.md missing ${token}`);
  }
});
