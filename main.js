'use strict';

const utils = require('@iobroker/adapter-core');
const { BridgeRuntime } = require('./lib/bridge');
const { BridgeHttpServer } = require('./lib/httpServer');
const { syncAdminAvailableVersion } = require('./lib/adminVersion');
const catalog = require('./lib/catalog');

const MAINTENANCE_INTERVAL_MS = 60_000;
const RESPONSE_CLEANUP_EVERY = 5; // maintenance ticks

class OpenclawBridge extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'openclaw-bridge',
    });

    this.bridge = null;
    this.httpServer = null;
    this.maintenanceTimer = null;
    this.maintenanceTick = 0;

    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('message', this.onMessage.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  async onReady() {
    this.log.info('openclaw-bridge starting ...');
    await this.setStateAsync('info.connection', false, true);

    this.bridge = new BridgeRuntime(this, this.config);
    await this.bridge.ensureRuntimeStates();

    try {
      for (const line of await syncAdminAvailableVersion(this)) {
        this.log.info(`Admin available version synced: ${line}`);
      }
    } catch (err) {
      this.log.warn(`Admin available version sync skipped: ${err?.message || err}`);
    }

    if (!this.bridge.config.authToken) {
      this.log.warn('No authToken configured: anyone who can write control.command can control your devices. Set a token in the OpenClaw tab.');
    }

    await this.subscribeStatesAsync('control.command');
    await this.subscribeStatesAsync('safety.confirm');
    await this.subscribeStatesAsync('safety.reject');
    for (const prefix of this.bridge.config.habitWatchPrefixes) {
      await this.subscribeForeignStatesAsync(`${prefix}.*`);
      this.log.info(`habit watch enabled for ${prefix}.*`);
    }
    for (const id of this.bridge.guardTargetIds()) {
      await this.subscribeForeignStatesAsync(id);
      this.log.info(`guard watch enabled for ${id}`);
    }
    for (const id of this.bridge.config.openclawWatchStates) {
      await this.subscribeForeignStatesAsync(id.includes('*') ? id : `${id}*`);
      this.log.info(`OpenClaw watch enabled for ${id}`);
    }

    if (this.bridge.config.httpEnabled) {
      this.httpServer = new BridgeHttpServer({ runtime: this.bridge, notifier: this.bridge.notifier, log: this.log });
      try {
        if (await this.httpServer.start()) {
          this.log.info(`HTTP API listening on http://${this.bridge.config.httpBind}:${this.httpServer.port}/api/v1`);
        }
      } catch (err) {
        this.log.error(`HTTP API could not start: ${err?.message || err}`);
        this.httpServer = null;
      }
    }

    this.maintenanceTimer = this.setInterval(() => {
      this.maintenance().catch((err) => this.log.warn(`maintenance failed: ${err?.message || err}`));
    }, MAINTENANCE_INTERVAL_MS);
    await this.maintenance();

    await this.setStateAsync('control.lastResult', JSON.stringify({ ok: true, message: 'bridge ready', habitMode: this.bridge.habitMode }), true);
    await this.setStateAsync('info.lastUpdated', new Date().toISOString(), true);
    this.log.info(`command channel ready: ${this.namespace}.control.command`);
  }

  async maintenance() {
    if (!this.bridge) return;
    await this.bridge.refreshConnection();
    await this.bridge.expireConfirmations();
    this.maintenanceTick += 1;
    if (this.maintenanceTick % RESPONSE_CLEANUP_EVERY === 1) {
      const removed = await this.bridge.cleanupResponses();
      if (removed) this.log.debug(`removed ${removed} expired response states`);
    }
  }

  async onStateChange(id, state) {
    if (!state || !this.bridge) return;

    try {
      if (id === `${this.namespace}.control.command`) {
        if (!state.ack) await this.bridge.processCommand(state.val);
        return;
      }
      if (id === `${this.namespace}.safety.confirm` || id === `${this.namespace}.safety.reject`) {
        await this.bridge.handleConfirmationState(id, state);
        return;
      }
      if (this.bridge.isGuardTarget(id)) {
        this.bridge.trackGuardState(id, state);
      }
      if (this.bridge.isWatchedForAgent(id)) {
        await this.bridge.notifyWatchedState(id, state);
      }
      if (!state.ack && this.bridge.shouldLearnFromState(id)) {
        await this.bridge.runInternal(() => this.bridge.observeForeignStateChange(id, state));
      }
    } catch (err) {
      this.log.error(`unexpected state processing error: ${err?.stack || err}`);
    }
  }

  /**
   * sendTo('openclaw-bridge.0', command, message, callback)
   *   command  { action, ...params, token? } → bridge response
   *   confirm  { id } | reject { id }       → operator decision
   *   tools    { format? }                  → tool catalog
   *   adminPing / testWebhook               → admin settings page buttons
   */
  async onMessage(obj) {
    if (!obj || !obj.command || !this.bridge) return;
    const reply = (result) => {
      if (obj.callback) this.sendTo(obj.from, obj.command, result, obj.callback);
    };

    try {
      switch (obj.command) {
        case 'command':
          reply(await this.bridge.handleCommand(obj.message, { transport: 'message' }));
          break;
        case 'confirm':
        case 'reject':
          reply(await this.bridge.handleConfirmationState(`${this.namespace}.safety.${obj.command}`, {
            val: obj.message && typeof obj.message === 'object' ? obj.message.id : obj.message,
            ack: false,
            from: obj.from,
          }));
          break;
        case 'tools':
          reply({ ok: true, tools: catalog.describeTools(this.bridge.config.allowedActions, obj.message?.format || 'raw') });
          break;
        case 'adminPing': {
          const response = await this.bridge.handleCommand({ action: 'ping' }, { transport: 'message', trusted: true });
          reply({ result: response.ok ? `OK – Version ${response.data.version}, Modus ${response.data.habitMode}` : response.error.message });
          break;
        }
        case 'testWebhook': {
          if (!this.bridge.notifier.webhookEnabled) {
            reply({ error: 'OpenClaw-Webhook-URL und -Token sind nicht gesetzt (Instanz speichern und neu starten).' });
            break;
          }
          try {
            await this.bridge.notifier.send({ type: 'test', eventId: `test-${Date.now()}`, message: 'Testnachricht aus ioBroker' });
            reply({ result: 'Webhook erfolgreich an OpenClaw gesendet' });
          } catch (err) {
            reply({ error: `Webhook fehlgeschlagen: ${err?.message || err}` });
          }
          break;
        }
        default:
          reply({ ok: false, error: { code: 'ENOTSUPPORTED', message: `unknown command ${obj.command}` } });
      }
    } catch (err) {
      this.log.error(`message ${obj.command} failed: ${err?.stack || err}`);
      reply({ ok: false, error: { code: 'EINTERNAL', message: err?.message || String(err) } });
    }
  }

  async onUnload(callback) {
    try {
      this.log.info('openclaw-bridge stopping ...');
      if (this.maintenanceTimer) this.clearInterval(this.maintenanceTimer);
      if (this.bridge) this.bridge.stopGuardTimers();
      if (this.httpServer) await this.httpServer.stop();
      await this.setStateAsync('info.connection', false, true);
    } catch {
      // ignore errors during shutdown
    } finally {
      callback();
    }
  }
}

if (require.main !== module) {
  module.exports = (options) => new OpenclawBridge(options);
} else {
  (() => new OpenclawBridge())();
}
