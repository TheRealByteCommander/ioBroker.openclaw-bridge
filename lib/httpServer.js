'use strict';

const http = require('node:http');
const catalog = require('./catalog');
const { safeEqual } = require('./util');

const MAX_BODY_BYTES = 256 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const STATUS_BY_CODE = {
  EUNAUTHORIZED: 401,
  EBADJSON: 400,
  EQUEUEFULL: 429,
  ETIMEOUT: 504,
};

/**
 * REST interface for OpenClaw. No polling: every command is answered
 * synchronously. Endpoints (prefix /api/v1):
 *
 *   GET  /health               liveness, no auth
 *   GET  /tools?format=…       tool catalog (raw | openai | anthropic)
 *   GET  /constraints          shortcut for getConstraints
 *   POST /command              { action, ...params } → bridge response
 *   POST /actions/:action      params → bridge response
 *   GET  /events               Server-Sent Events stream of bridge events
 */
class BridgeHttpServer {
  /**
   * @param {{ runtime: object, notifier: object, log: object }} deps
   */
  constructor({ runtime, notifier, log }) {
    this.runtime = runtime;
    this.notifier = notifier;
    this.log = log || console;
    this.server = null;
    this.sseClients = new Set();
  }

  get config() {
    return this.runtime.config;
  }

  /** Refuse to expose an unauthenticated API beyond loopback. */
  static checkStartupPolicy(config) {
    if (!config.authToken && !LOOPBACK.has(config.httpBind)) {
      return `HTTP API not started: bind address ${config.httpBind} needs an authToken`;
    }
    return null;
  }

  async start() {
    const problem = BridgeHttpServer.checkStartupPolicy(this.config);
    if (problem) {
      this.log.error(problem);
      return false;
    }
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((err) => {
        this.log.error(`HTTP handler error: ${err?.stack || err}`);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'EINTERNAL', message: 'internal error' } });
        else res.end();
      });
    });
    this.server.requestTimeout = 60_000;
    this.server.headersTimeout = 15_000;

    this.onEvent = (event) => this.broadcast(event);
    this.notifier.on('event', this.onEvent);

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.httpPort, this.config.httpBind, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.heartbeat = setInterval(() => {
      for (const res of this.sseClients) res.write(': keepalive\n\n');
    }, 25_000);
    if (typeof this.heartbeat.unref === 'function') this.heartbeat.unref();
    return true;
  }

  get port() {
    const address = this.server && this.server.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  async stop() {
    clearInterval(this.heartbeat);
    if (this.onEvent) this.notifier.off('event', this.onEvent);
    for (const res of this.sseClients) res.end();
    this.sseClients.clear();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(() => resolve()));
    this.server = null;
  }

  authorized(req) {
    if (!this.config.authToken) return true;
    const header = String(req.headers.authorization || '');
    const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const alt = String(req.headers['x-bridge-token'] || '');
    return safeEqual(bearer || alt, this.config.authToken);
  }

  async route(req, res) {
    const url = new URL(req.url || '/', 'http://bridge.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    res.setHeader('cache-control', 'no-store');

    if (req.method === 'GET' && path === '/api/v1/health') {
      sendJson(res, 200, {
        ok: true,
        adapter: 'openclaw-bridge',
        version: this.runtime.version,
        uptimeMs: Date.now() - this.runtime.startedAt,
      });
      return;
    }

    if (!path.startsWith('/api/v1/')) {
      sendJson(res, 404, { ok: false, error: { code: 'ENOTFOUND', message: `no route ${path}` } });
      return;
    }

    if (!this.authorized(req)) {
      res.setHeader('www-authenticate', 'Bearer');
      sendJson(res, 401, { ok: false, error: { code: 'EUNAUTHORIZED', message: 'missing or invalid bearer token', nextAction: 'send_valid_token' } });
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/tools') {
      const format = ['openai', 'anthropic'].includes(url.searchParams.get('format')) ? url.searchParams.get('format') : 'raw';
      sendJson(res, 200, { ok: true, format, tools: catalog.describeTools(this.config.allowedActions, format) });
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/constraints') {
      const response = await this.runtime.handleCommand({ action: 'getConstraints' }, { transport: 'http', trusted: true });
      sendJson(res, httpStatus(response), response);
      return;
    }

    if (req.method === 'GET' && path === '/api/v1/events') {
      this.openStream(req, res);
      return;
    }

    const actionMatch = /^\/api\/v1\/actions\/([A-Za-z]+)$/.exec(path);
    if (req.method === 'POST' && (path === '/api/v1/command' || actionMatch)) {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        sendJson(res, err.status || 400, { ok: false, error: { code: err.code || 'EBADJSON', message: err.message, nextAction: 'fix_request_payload' } });
        return;
      }
      const payload = actionMatch ? { ...body, action: actionMatch[1] } : body;
      const idemKey = req.headers['idempotency-key'];
      if (idemKey && payload && typeof payload === 'object' && !payload.requestId) payload.requestId = String(idemKey);
      // Token already verified via header; the runtime must not demand it again.
      const response = await this.runtime.handleCommand(payload, { transport: 'http', trusted: true });
      sendJson(res, httpStatus(response), response);
      return;
    }

    sendJson(res, 405, { ok: false, error: { code: 'EMETHOD', message: `${req.method} ${path} not supported` } });
  }

  openStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ version: this.runtime.version })}\n\n`);
    this.sseClients.add(res);
    req.on('close', () => this.sseClients.delete(res));
  }

  broadcast(event) {
    const frame = `event: ${event.type}\nid: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of this.sseClients) res.write(frame);
  }
}

function httpStatus(response) {
  if (response.ok) return 200;
  return STATUS_BY_CODE[response.error?.code] || 200;
}

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error(`body exceeds ${MAX_BODY_BYTES} bytes`);
        err.code = 'EBODYTOOLARGE';
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object');
        resolve(parsed);
      } catch (err) {
        const e = new Error(err.message || 'invalid JSON');
        e.code = 'EBADJSON';
        e.status = 400;
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { BridgeHttpServer, httpStatus, MAX_BODY_BYTES };
