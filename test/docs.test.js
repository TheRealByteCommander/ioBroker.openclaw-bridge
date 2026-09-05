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

function parseSemver(value) {
  const parts = String(value).split('.').map((item) => Number(item));
  assert.equal(parts.length >= 2 && parts.every((n) => Number.isFinite(n)), true, `invalid version ${value}`);
  return parts;
}

function cmpSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

test('package.json and io-package.json versions match', () => {
  assert.equal(pkg.version, ioPackage.common.version);
});

test('common.news starts at the current version and is newest-first', () => {
  const keys = Object.keys(ioPackage.common.news);
  assert.equal(keys[0], ioPackage.common.version);
  for (let i = 1; i < keys.length; i += 1) {
    assert.ok(
      cmpSemver(keys[i - 1], keys[i]) > 0,
      `news must be descending semver, got ${keys[i - 1]} then ${keys[i]}`,
    );
  }
});

test('news keys must not lexicographically exceed the current version', () => {
  const version = ioPackage.common.version;
  for (const key of Object.keys(ioPackage.common.news)) {
    assert.ok(
      key <= version,
      `Admin string-compares news keys: "${key}" > "${version}" looks like a newer available version`,
    );
  }
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
  assert.equal(readDoc('admin/docs/de/ANLEITUNG.md'), readDoc('docs/de/ANLEITUNG.md'));
  assert.equal(readDoc('admin/docs/en/HANDBOOK.md'), readDoc('docs/en/HANDBOOK.md'));
  const de = readDoc('docs/de/ANLEITUNG.md');
  for (const token of ['simple-api', '8087', 'control.command', 'getConstraints', 'SKILL.md']) {
    assert.equal(de.includes(token), true, `ANLEITUNG.md missing ${token}`);
  }
  assert.deepEqual(ioPackage.common.docs.de, ['docs/de/ANLEITUNG.md']);
  assert.deepEqual(ioPackage.common.docs.en, ['docs/en/HANDBOOK.md']);
});

test('Guide tab embeds the handbook inside the instance, not only an external URL', () => {
  const config = JSON.parse(readDoc('admin/jsonConfig.json'));
  const items = config.items.tabGuide.items;
  assert.equal(items._guideFrame.type, 'iframe');
  assert.match(items._guideFrame.url, /\/adapter\/openclaw-bridge\/ANLEITUNG\.html$/);
  assert.equal(items._guideOpenHtml.type, 'staticLink');
  assert.match(items._guideOpenHtml.href, /ANLEITUNG\.html/);
  const de = `${items._guideWhat.text.de}\n${items._guideTest.text.de}\n${items._guideConnect.text.de}`;
  for (const token of ['control.command', 'getConstraints', 'simple-api', '8087']) {
    assert.equal(de.includes(token), true, `Guide tab missing ${token}`);
  }
});

test('README describes the operating envelope for OpenClaw', () => {
  const readme = readDoc('README.md');
  for (const token of ['getConstraints', 'planWithinBounds', 'Rahmenbedingungen', 'jsonConfig']) {
    assert.equal(readme.includes(token), true, `README.md missing ${token}`);
  }
});
