// ioBroker openclaw-bridge HTTP client (zero dependencies, Node >= 20).
// Identical copies live in openclaw/plugin and openclaw/skill/iobroker-bridge/scripts.

import { randomUUID } from 'node:crypto';

export class BridgeClientError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'BridgeClientError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{ baseUrl: string, token?: string, timeoutMs?: number, fetchImpl?: typeof fetch }} options
 *   baseUrl e.g. http://iobroker.local:8097 (without /api/v1)
 */
export function createClient({ baseUrl, token = '', timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw new BridgeClientError('baseUrl is required (e.g. http://iobroker:8097)');
  const root = `${String(baseUrl).replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;

  async function call(method, path, body, headers = {}) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new BridgeClientError(`non-JSON response (HTTP ${res.status})`, { status: res.status, body: text.slice(0, 500) });
    }
    if (res.status === 401) {
      throw new BridgeClientError('unauthorized: check IOBROKER_BRIDGE_TOKEN / plugin token', { status: 401, body: parsed });
    }
    return parsed;
  }

  return {
    health: () => call('GET', '/health'),
    tools: (format = 'raw') => call('GET', `/tools?format=${encodeURIComponent(format)}`),

    /**
     * Run a bridge action. A requestId is generated once and reused for a
     * single retry on network errors, so the bridge never executes twice.
     */
    async command(action, params = {}, { requestId = randomUUID() } = {}) {
      const payload = { ...params, action, requestId };
      try {
        return await call('POST', '/command', payload, { 'idempotency-key': requestId });
      } catch (err) {
        if (err instanceof BridgeClientError) throw err;
        return call('POST', '/command', payload, { 'idempotency-key': requestId });
      }
    },
  };
}

/** Short, model-friendly rendering of a bridge response. */
export function renderResponse(response) {
  if (!response || typeof response !== 'object') return String(response);
  if (response.ok) return JSON.stringify(response.data ?? {}, null, 2);
  const err = response.error || {};
  const lines = [`FEHLER ${err.code || 'EUNKNOWN'}: ${err.message || 'unknown error'}`];
  if (err.nextAction) lines.push(`nextAction: ${err.nextAction}`);
  if (err.hint) lines.push(`hint: ${JSON.stringify(err.hint)}`);
  if (err.details) lines.push(`details: ${JSON.stringify(err.details).slice(0, 2000)}`);
  return lines.join('\n');
}
