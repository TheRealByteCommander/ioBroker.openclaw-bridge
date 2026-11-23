#!/usr/bin/env node
// CLI for the ioBroker openclaw-bridge REST API.
//
//   node iobroker.mjs <action> ['{"json":"params"}']
//   node iobroker.mjs tools [raw|openai|anthropic]
//   node iobroker.mjs health
//
// Env: IOBROKER_BRIDGE_URL (e.g. http://192.168.178.63:8097), IOBROKER_BRIDGE_TOKEN
// Exit code: 0 = ok, 1 = bridge returned ok:false, 2 = usage / connection error.

import { createClient, renderResponse } from './client.mjs';

const USAGE = 'usage: iobroker.mjs <action> [json-params] | tools [format] | health';

export async function main(argv, env = process.env, out = process.stdout, client = null) {
  const [action, rawParams] = argv;
  if (!action || action === '--help' || action === '-h') {
    out.write(`${USAGE}\n`);
    return 2;
  }
  let params = {};
  if (rawParams && action !== 'tools') {
    try {
      params = JSON.parse(rawParams);
    } catch (err) {
      out.write(`invalid JSON params: ${err.message}\n`);
      return 2;
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      out.write('params must be a JSON object\n');
      return 2;
    }
  }

  const bridge = client || createClient({
    baseUrl: env.IOBROKER_BRIDGE_URL,
    token: env.IOBROKER_BRIDGE_TOKEN || '',
    timeoutMs: Number(env.IOBROKER_BRIDGE_TIMEOUT_MS) || 15000,
  });

  try {
    if (action === 'health') {
      out.write(`${JSON.stringify(await bridge.health(), null, 2)}\n`);
      return 0;
    }
    if (action === 'tools') {
      out.write(`${JSON.stringify(await bridge.tools(rawParams || 'raw'), null, 2)}\n`);
      return 0;
    }
    const response = await bridge.command(action, params);
    out.write(`${renderResponse(response)}\n`);
    return response.ok ? 0 : 1;
  } catch (err) {
    out.write(`bridge not reachable: ${err.message}\n`);
    return 2;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
