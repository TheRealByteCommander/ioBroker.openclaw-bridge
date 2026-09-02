const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ioPackage = require('../io-package.json');

function collectSavedKeys(node, keys = new Set()) {
  if (!node || typeof node !== 'object') return keys;
  if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
    for (const [key, child] of Object.entries(node.items)) {
      if (!key.startsWith('_') && child && typeof child === 'object' && child.type && !['tabs', 'panel', 'header', 'staticText', 'divider'].includes(child.type)) {
        keys.add(key);
      }
      collectSavedKeys(child, keys);
    }
  }
  return keys;
}

test('admin UI is enabled as typical jsonConfig settings page', () => {
  assert.equal(ioPackage.common.adminUI.config, 'json');
  const configPath = path.join(__dirname, '..', 'admin', 'jsonConfig.json');
  assert.equal(fs.existsSync(configPath), true);
});

test('jsonConfig is valid JSON with tabs for operator settings', () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'admin', 'jsonConfig.json'), 'utf8');
  const config = JSON.parse(raw);
  assert.equal(config.type, 'tabs');
  assert.ok(config.items.tabSecurity);
  assert.ok(config.items.tabRules);
  assert.ok(config.items.tabDevices);
  assert.ok(config.items.tabHabits);
  assert.ok(config.items.tabVoice);
  assert.ok(config.items.tabAdvanced);
});

test('jsonConfig exposes every native setting from io-package', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'admin', 'jsonConfig.json'), 'utf8'));
  const uiKeys = collectSavedKeys(config);
  const nativeKeys = Object.keys(ioPackage.native);
  const missing = nativeKeys.filter((key) => !uiKeys.has(key));
  assert.deepEqual(missing, [], `settings page missing native keys: ${missing.join(', ')}`);
});
