'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { BridgeError } = require('./errors');

function parseList(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : fallback;
  }
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeNumber(value, fallback) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isAllowedId(id, allowedPrefixes) {
  if (!id || typeof id !== 'string') return false;
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) return false;
  return allowedPrefixes.some((prefix) => id === prefix || id.startsWith(`${prefix}.`));
}

function isCriticalId(id, criticalPrefixes) {
  if (!id || typeof id !== 'string') return false;
  return (criticalPrefixes || []).some((prefix) => id.startsWith(prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryAsync(fn, attempts = 3, backoffMs = 100, onRetry = null) {
  let lastErr;
  const total = Math.max(1, attempts);
  for (let i = 1; i <= total; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < total) {
        if (onRetry) onRetry(err, i);
        await sleep(backoffMs * i);
      }
    }
  }
  throw lastErr;
}

function execFileAsync(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new BridgeError('ESTTFAILED', String(stderr || error.message || 'command failed'), {
          details: { command, stderr: String(stderr || '').slice(0, 2000) },
        }));
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * Race `promise` against a timer. On timeout the given AbortController is
 * aborted, so cooperative code (executePlan) stops issuing further writes.
 */
function withTimeout(promise, timeoutMs, action, controller = null) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new BridgeError('ETIMEOUT', `action timed out after ${timeoutMs}ms`, {
        details: { action, timeoutMs, remainingWritesSkipped: true },
      });
      if (controller) controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/** Constant-time string comparison; false for empty expected values. */
function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(actual).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Resolve `candidate` and ensure it is a regular file inside `baseDir`. */
function resolveInsideDir(candidate, baseDir) {
  if (!baseDir) {
    throw new BridgeError('EAUDIOPATH', 'sttAudioDir is not configured; transcription is disabled');
  }
  if (!candidate || typeof candidate !== 'string') {
    throw new BridgeError('EBADREQUEST', 'missing audioPath');
  }
  let base;
  let target;
  try {
    base = fs.realpathSync(baseDir);
    const joined = path.isAbsolute(candidate) ? candidate : path.join(base, candidate);
    target = fs.realpathSync(joined);
  } catch {
    throw new BridgeError('EAUDIOPATH', `audio file not found: ${candidate}`);
  }
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new BridgeError('EAUDIOPATH', 'audioPath must be inside the configured sttAudioDir', {
      details: { sttAudioDir: baseDir },
    });
  }
  if (!fs.statSync(target).isFile()) {
    throw new BridgeError('EAUDIOPATH', 'audioPath is not a file');
  }
  return target;
}

function stateValue(state) {
  return state && typeof state === 'object' && 'val' in state ? state.val : state;
}

module.exports = {
  parseList,
  positiveNumber,
  nonNegativeNumber,
  isAllowedId,
  isCriticalId,
  sleep,
  retryAsync,
  execFileAsync,
  withTimeout,
  safeEqual,
  resolveInsideDir,
  stateValue,
};
