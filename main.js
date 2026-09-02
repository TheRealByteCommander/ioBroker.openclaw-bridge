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

    await this.setStateAsync('control.lastResult', JSON.stringify({ ok: true, message: 'bridge ready', habitMode: this.bridge.habitMode }), true);
    await this.setStateAsync('info.lastUpdated', new Date().toISOString(), true);
  }

  async onStateChange(id, state) {
    if (!state || state.ack) return;

    try {
      if (id.endsWith('control.command')) {
        await this.bridge.processCommand(state.val);
        return;
      }
      if (this.bridge.shouldLearnFromState(id)) {
        await this.bridge.observeForeignStateChange(id, state);
      }
    } catch (err) {
      this.log.error(`unexpected command processing error: ${err?.stack || err}`);
    }
  }

  async onUnload(callback) {
    try {
      this.log.info('openclaw-bridge stopping ...');
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
