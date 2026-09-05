'use strict';

const ioPackage = require('../io-package.json');

function currentVersion() {
  return ioPackage.common.version;
}

function parseSemver(value) {
  return String(value || '')
    .split('+')[0]
    .split('-')[0]
    .split('.')
    .map((part) => Number(part));
}

function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Replace only stale/older cache. Keep a newer repo version so Admin can show an update. */
function shouldReplaceRepoVersion(cached, installed) {
  if (!cached || cached === installed) return false;
  if (!parseSemver(cached).every((n) => Number.isFinite(n))) return true;
  return compareSemver(cached, installed) < 0;
}

function repoSources() {
  return {
    meta: 'https://raw.githubusercontent.com/TheRealByteCommander/ioBroker.openclaw-bridge/master/io-package.json',
    icon: 'https://raw.githubusercontent.com/TheRealByteCommander/ioBroker.openclaw-bridge/master/openclaw-bridge.png',
    type: ioPackage.common.type || 'misc-data',
    version: currentVersion(),
    news: ioPackage.common.news,
  };
}

/**
 * Admin "available version" comes from system.repositories, not from the
 * installed GitHub package. A stale cache (e.g. 0.9.0) survives url-upgrades.
 */
async function syncAdminAvailableVersion(adapter) {
  const version = currentVersion();
  const news = ioPackage.common.news;
  const name = adapter.name || 'openclaw-bridge';
  const log = [];

  const adapterId = `system.adapter.${name}`;
  try {
    const obj = await adapter.getForeignObjectAsync(adapterId);
    if (obj && obj.common && obj.common.version !== version) {
      log.push(`${adapterId}: ${obj.common.version} → ${version}`);
      await adapter.extendForeignObjectAsync(adapterId, { common: { version, news } });
    }
  } catch (err) {
    adapter.log?.warn?.(`could not sync ${adapterId}: ${err?.message || err}`);
  }

  try {
    const repos = await adapter.getForeignObjectAsync('system.repositories');
    const repositories = repos && repos.native && repos.native.repositories;
    if (!repositories) return log;

    let changed = false;
    for (const [repoName, repo] of Object.entries(repositories)) {
      const json = repo && repo.json;
      if (!json || typeof json !== 'object') continue;
      const entry = json[name];
      if (!entry || typeof entry !== 'object') continue;
      if (!shouldReplaceRepoVersion(entry.version, version)) continue;
      log.push(`repo ${repoName}: ${entry.version} → ${version}`);
      json[name] = {
        ...entry,
        ...repoSources(),
        version,
        news,
      };
      changed = true;
    }

    if (changed) {
      await adapter.setForeignObjectAsync('system.repositories', repos);
    }
  } catch (err) {
    adapter.log?.warn?.(`could not sync system.repositories: ${err?.message || err}`);
  }

  return log;
}

module.exports = {
  currentVersion,
  repoSources,
  compareSemver,
  shouldReplaceRepoVersion,
  syncAdminAvailableVersion,
};
