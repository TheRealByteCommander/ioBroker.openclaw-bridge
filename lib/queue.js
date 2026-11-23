'use strict';

const { BridgeError } = require('./errors');

/**
 * Strictly serial task queue. Guard rules (AND/OR/XOR, thresholds, max-on)
 * are evaluated against a snapshot; running two commands concurrently could
 * let both pass a rule that only one of them may satisfy. Every write path
 * therefore goes through this queue.
 */
class SerialQueue {
  constructor({ highWatermark = 100 } = {}) {
    this.highWatermark = highWatermark;
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  /** Number of tasks waiting or running. */
  get depth() {
    return this.pending;
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {{ force?: boolean }} [options] force bypasses the high watermark (internal safety tasks)
   * @returns {Promise<T>}
   */
  push(task, options = {}) {
    if (!options.force && this.pending >= this.highWatermark) {
      return Promise.reject(new BridgeError('EQUEUEFULL', 'command queue high watermark exceeded', {
        details: { depth: this.pending, highWatermark: this.highWatermark },
      }));
    }
    this.pending += 1;
    const run = this.tail.then(() => task());
    // The chain continues regardless of the task outcome.
    this.tail = run.then(() => undefined, () => undefined).finally(() => {
      this.pending -= 1;
    });
    return run;
  }

  /** Resolves once everything queued so far has settled. */
  drain() {
    return this.tail;
  }
}

/**
 * Remembers responses per client-supplied requestId so a retried request
 * (e.g. after a network timeout) does not execute twice.
 */
class ResponseCache {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 500, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.ts < cutoff) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  get(requestId) {
    if (!requestId) return null;
    this.prune();
    return this.entries.get(requestId) || null;
  }

  /** Store a promise (in flight) or a final response. */
  set(requestId, value) {
    if (!requestId) return;
    this.entries.delete(requestId);
    this.entries.set(requestId, { value, ts: this.now() });
    this.prune();
  }

  get size() {
    return this.entries.size;
  }
}

module.exports = { SerialQueue, ResponseCache };
