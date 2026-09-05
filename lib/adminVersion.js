'use strict';

const ioPackage = require('../io-package.json');

function currentVersion() {
  return ioPackage.common.version;
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
      if (entry.version === version) continue;
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
  syncAdminAvailableVersion,
};
