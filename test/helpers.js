'use strict';

/** In-memory stand-in for the ioBroker adapter API used by the bridge. */
class MockAdapter {
  constructor({ delayMs = 0 } = {}) {
    this.version = '0.13.0';
    this.namespace = 'openclaw-bridge.0';
    this.delayMs = delayMs;
    this.states = new Map();
    this.objects = new Map();
    this.foreignStates = new Map();
    this.foreignObjects = new Map();
    this.writes = [];
    this.log = { info() {}, warn() {}, error() {}, debug() {} };
  }

  async pause() {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async setObjectNotExistsAsync(id, obj) {
    if (!this.objects.has(id)) this.objects.set(id, obj);
  }

  async setStateAsync(id, value, ack) {
    this.states.set(id, { val: value, ack, ts: Date.now() });
  }

  async getStateAsync(id) {
    return this.states.get(id) ?? null;
  }

  async getStatesAsync(pattern) {
    const prefix = pattern.replace(/\*$/, '');
    const out = {};
    for (const [id, state] of this.states) {
      if (id.startsWith(prefix)) out[`${this.namespace}.${id}`] = state;
    }
    return out;
  }

  async delForeignObjectAsync(id) {
    const local = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
    this.objects.delete(local);
    this.states.delete(local);
  }

  async getForeignStateAsync(id) {
    await this.pause();
    return this.foreignStates.get(id) ?? null;
  }

  async setForeignStateAsync(id, value, ack) {
    await this.pause();
    this.writes.push({ id, value });
    this.foreignStates.set(id, { val: value, ack });
  }

  async getObjectViewAsync(_design, _search, query) {
    const rows = [];
    const ids = new Set([...this.foreignStates.keys(), ...this.foreignObjects.keys()]);
    for (const key of [...ids].sort()) {
      if (key >= query.startkey && key <= query.endkey) rows.push({ id: key, value: this.foreignObjects.get(key) });
    }
    return { rows };
  }
}

module.exports = { MockAdapter };
