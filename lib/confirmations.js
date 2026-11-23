'use strict';

const crypto = require('node:crypto');

/**
 * Pending operations that need a human operator (confirmationMode = "human").
 *
 * The agent can create and cancel requests but never approve them: approval
 * happens by writing the confirmation id to `safety.confirm` from a source
 * that is not on the deny list (VIS, Telegram script, admin), or via sendTo.
 */
class ConfirmationStore {
  constructor({ ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.items = new Map();
  }

  newId() {
    // Short enough to read out loud / type on a phone, long enough not to guess.
    return crypto.randomBytes(4).toString('hex');
  }

  /**
   * @param {{kind: 'plan'|'habitMode', operations?: object[], mode?: string, requestId?: string, source?: string, summary?: string}} entry
   */
  create(entry) {
    const id = this.newId();
    const createdAt = this.now();
    const item = {
      id,
      kind: entry.kind,
      operations: entry.operations || [],
      mode: entry.mode,
      requestId: entry.requestId || null,
      source: entry.source || null,
      summary: entry.summary || summarize(entry),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.ttlMs).toISOString(),
      expiresAtMs: createdAt + this.ttlMs,
    };
    this.items.set(id, item);
    return item;
  }

  get(id) {
    this.expire();
    return this.items.get(String(id || '').trim()) || null;
  }

  take(id) {
    const item = this.get(id);
    if (item) this.items.delete(item.id);
    return item;
  }

  /** Removes expired entries and returns them. */
  expire() {
    const now = this.now();
    const expired = [];
    for (const [id, item] of this.items) {
      if (item.expiresAtMs <= now) {
        this.items.delete(id);
        expired.push(item);
      }
    }
    return expired;
  }

  list() {
    this.expire();
    return [...this.items.values()].map(publicView);
  }

  restore(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || !item.id || !item.expiresAt) continue;
      const expiresAtMs = Date.parse(item.expiresAt);
      if (!Number.isFinite(expiresAtMs)) continue;
      this.items.set(item.id, { ...item, expiresAtMs });
    }
    this.expire();
  }
}

function publicView(item) {
  const { expiresAtMs, ...rest } = item;
  return rest;
}

function summarize(entry) {
  if (entry.kind === 'habitMode') return `Gewohnheitsmodus auf "${entry.mode}" setzen`;
  const ops = entry.operations || [];
  const parts = ops.slice(0, 5).map((op) => `${op.id} = ${JSON.stringify(op.value)}`);
  if (ops.length > 5) parts.push(`… (+${ops.length - 5})`);
  return parts.join(', ');
}

/** True when the writer of a state change may approve confirmations. */
function isTrustedConfirmationSource(from, denyPrefixes) {
  if (!from) return true;
  return !(denyPrefixes || []).some((prefix) => String(from).startsWith(prefix));
}

module.exports = { ConfirmationStore, isTrustedConfirmationSource, publicView };
