/* eslint-disable no-console */
const utils = require('@iobroker/adapter-core');
const { BridgeRuntime } = require('./lib/bridge');

class OpenclawBridge extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'openclaw-bridge',
    });

    this.bridge = null;

    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  async onReady() {
    this.log.info('openclaw-bridge starting ...');

    this.bridge = new BridgeRuntime(this, this.config);
    await this.bridge.ensureRuntimeStates();

    await this.subscribeStatesAsync('control.command');
    for (const prefix of this.bridge.config.habitWatchPrefixes) {
      await this.subscribeForeignStatesAsync(`${prefix}.*`);
      this.log.info(`habit watch enabled for ${prefix}.*`);
    }
    for (const id of this.bridge.guardTargetIds()) {
      await this.subscribeForeignStatesAsync(id);
      this.log.info(`guard watch enabled for ${id}`);
    }

    await this.setStateAsync('control.lastResult', JSON.stringify({ ok: true, message: 'bridge ready', habitMode: this.bridge.habitMode }), true);
    await this.setStateAsync('info.lastUpdated', new Date().toISOString(), true);
  }

  async onStateChange(id, state) {
    if (!state) return;

    try {
      if (!state.ack && id.endsWith('control.command')) {
        await this.bridge.processCommand(state.val);
        return;
      }
      if (this.bridge.isGuardTarget(id)) {
        this.bridge.trackGuardState(id, state);
      }
      if (!state.ack && this.bridge.shouldLearnFromState(id)) {
        await this.bridge.observeForeignStateChange(id, state);
      }
    } catch (err) {
      this.log.error(`unexpected command processing error: ${err?.stack || err}`);
    }
  }

  async onUnload(callback) {
    try {
      this.log.info('openclaw-bridge stopping ...');
      if (this.bridge) this.bridge.stopGuardTimers();
      callback();
    } catch {
      callback();
    }
  }
}

if (require.main !== module) {
  module.exports = (options) => new OpenclawBridge(options);
} else {
  (() => new OpenclawBridge())();
}
