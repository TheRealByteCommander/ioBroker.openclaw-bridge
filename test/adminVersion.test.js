'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ioPackage = require('../io-package.json');
const { currentVersion, repoSources, syncAdminAvailableVersion } = require('../lib/adminVersion');

class MockAdapter {
  constructor() {
    this.name = 'openclaw-bridge';
    this.log = { warn() {}, info() {} };
    this.objects = new Map();
  }

  async getForeignObjectAsync(id) {
    return this.objects.get(id) ?? null;
  }

  async extendForeignObjectAsync(id, patch) {
    const current = this.objects.get(id) || { common: {}, native: {} };
    this.objects.set(id, {
      ...current,
      common: { ...current.common, ...patch.common },
      native: { ...current.native, ...patch.native },
    });
  }

  async setForeignObjectAsync(id, obj) {
    this.objects.set(id, obj);
  }
}

test('repoSources version matches io-package', () => {
  assert.equal(currentVersion(), ioPackage.common.version);
  assert.equal(repoSources().version, ioPackage.common.version);
  assert.equal(repoSources().type, 'misc-data');
});

test('syncAdminAvailableVersion updates stale adapter object and repo cache', async () => {
  const adapter = new MockAdapter();
  adapter.objects.set('system.adapter.openclaw-bridge', {
    common: { version: '0.9.0', news: { '0.9.0': { en: 'old' } } },
    native: {},
  });
  adapter.objects.set('system.repositories', {
    native: {
      repositories: {
        latest: {
          json: {
            'openclaw-bridge': { version: '0.9.0', type: 'misc-data' },
            admin: { version: '7.0.0' },
          },
        },
      },
    },
  });

  const log = await syncAdminAvailableVersion(adapter);
  assert.ok(log.some((line) => line.includes('0.9.0')));

  const adapterObj = adapter.objects.get('system.adapter.openclaw-bridge');
  assert.equal(adapterObj.common.version, ioPackage.common.version);

  const repoEntry = adapter.objects.get('system.repositories').native.repositories.latest.json['openclaw-bridge'];
  assert.equal(repoEntry.version, ioPackage.common.version);
  assert.equal(
    adapter.objects.get('system.repositories').native.repositories.latest.json.admin.version,
    '7.0.0',
  );
});

test('syncAdminAvailableVersion leaves other adapters and current versions alone', async () => {
  const adapter = new MockAdapter();
  const version = ioPackage.common.version;
  adapter.objects.set('system.adapter.openclaw-bridge', { common: { version }, native: {} });
  adapter.objects.set('system.repositories', {
    native: {
      repositories: {
        latest: { json: { javascript: { version: '8.0.0' } } },
      },
    },
  });

  const log = await syncAdminAvailableVersion(adapter);
  assert.deepEqual(log, []);
  assert.equal(
    adapter.objects.get('system.repositories').native.repositories.latest.json.javascript.version,
    '8.0.0',
  );
});
