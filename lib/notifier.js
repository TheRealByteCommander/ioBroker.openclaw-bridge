'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

/**
 * Pushes bridge events to OpenClaw and to local subscribers (SSE stream).
 *
 * OpenClaw side: gateway webhook (hooks.enabled = true)
 *   mode "agent" → POST <url> (…/hooks/agent) { message, name, agentId?, deliver, wakeMode, idempotencyKey }
 *   mode "wake"  → POST <url> (…/hooks/wake)  { text, mode: "now" }
 *   Authorization: Bearer <hooks.token>
 */
class Notifier extends EventEmitter {
  /**
   * @param {object} config normalized bridge config
   * @param {{ log?: object, fetchImpl?: typeof fetch, now?: () => number }} [deps]
   */
  constructor(config, deps = {}) {
    super();
    this.setMaxListeners(50);
    this.config = config;
    this.log = deps.log || console;
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
    this.now = deps.now || (() => Date.now());
    this.lastSent = new Map();
    this.stats = { emitted: 0, sent: 0, failed: 0, throttled: 0 };
  }

  get webhookEnabled() {
    return Boolean(this.config.openclawWebhookUrl && this.config.openclawWebhookToken);
  }

  wants(type) {
    return this.config.openclawNotifyEvents.includes(type);
  }

  throttleKey(event) {
    return `${event.type}:${event.id || event.name || ''}`;
  }

  isThrottled(event) {
    const minMs = this.config.notifyMinIntervalSec * 1000;
    if (!minMs) return false;
    const key = this.throttleKey(event);
    const last = this.lastSent.get(key) || 0;
    if (this.now() - last < minMs) return true;
    this.lastSent.set(key, this.now());
    return false;
  }

  /**
   * Publish an event. Always emitted locally; forwarded to OpenClaw when the
   * event type is enabled and not throttled. Never throws.
   * @returns {Promise<boolean>} true when forwarded to OpenClaw
   */
  async publish(event) {
    const record = { ...event, ts: new Date(this.now()).toISOString(), eventId: crypto.randomUUID() };
    this.stats.emitted += 1;
    this.emit('event', record);

    if (!this.webhookEnabled || !this.wants(record.type)) return false;
    if (this.isThrottled(record)) {
      this.stats.throttled += 1;
      return false;
    }
    try {
      await this.send(record);
      this.stats.sent += 1;
      return true;
    } catch (err) {
      this.stats.failed += 1;
      this.log.warn(`OpenClaw webhook failed for ${record.type}: ${err?.message || err}`);
      return false;
    }
  }

  buildBody(record) {
    const message = formatMessage(record);
    if (this.config.openclawWebhookMode === 'wake') {
      return { text: message, mode: 'now' };
    }
    const body = {
      message,
      name: 'ioBroker',
      deliver: this.config.openclawDeliver,
      wakeMode: 'now',
      idempotencyKey: record.eventId,
    };
    if (this.config.openclawAgentId) body.agentId = this.config.openclawAgentId;
    return body;
  }

  async send(record) {
    if (typeof this.fetchImpl !== 'function') throw new Error('fetch is not available');
    const res = await this.fetchImpl(this.config.openclawWebhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.openclawWebhookToken}`,
        'idempotency-key': record.eventId,
      },
      body: JSON.stringify(this.buildBody(record)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

const TITLES = {
  guard_block: 'Regel hat eine Schaltung blockiert',
  max_on_elapsed: 'Maximale Einschaltdauer erreicht – automatisch ausgeschaltet',
  confirmation_pending: 'Bestätigung durch den Operator erforderlich',
  confirmation_resolved: 'Bestätigung entschieden',
  habit_mode_changed: 'Gewohnheitsmodus geändert',
  state_changed: 'Beobachteter State hat sich geändert',
};

/** Human readable first line + compact JSON so the agent can act on it. */
function formatMessage(record) {
  const title = TITLES[record.type] || record.type;
  const { eventId, ...payload } = record;
  return [
    `[ioBroker openclaw-bridge] ${title}.`,
    'Nutze das Tool iobroker_constraints bzw. die Bridge-Actions, bevor du reagierst. Keine Regeln umgehen.',
    `Event: ${JSON.stringify(payload)}`,
  ].join('\n');
}

module.exports = { Notifier, formatMessage };
