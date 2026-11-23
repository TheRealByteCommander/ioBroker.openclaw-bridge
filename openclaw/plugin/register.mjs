import { createClient, renderResponse } from './client.mjs';
import { TOOLS } from './tools.mjs';

/**
 * Registers the ioBroker tools. Read-only tools are always available; write
 * tools are registered as optional so the operator opts in explicitly via
 * tools.allow in openclaw.json.
 *
 * @param {object} api OpenClawPluginApi (registerTool, pluginConfig, logger)
 * @param {{ createClientImpl?: typeof createClient }} [deps]
 */
export function registerBridgeTools(api, deps = {}) {
  const config = api.pluginConfig || {};
  const makeClient = deps.createClientImpl || createClient;
  let client = null;
  const getClient = () => {
    if (!client) {
      client = makeClient({
        baseUrl: config.baseUrl || process.env.IOBROKER_BRIDGE_URL,
        token: config.token || process.env.IOBROKER_BRIDGE_TOKEN || '',
        timeoutMs: Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 15000,
      });
    }
    return client;
  };

  const registered = [];
  for (const spec of TOOLS) {
    const tool = {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_callId, params) {
        try {
          const response = await getClient().command(spec.action, params || {});
          return { content: [{ type: 'text', text: renderResponse(response) }], details: response };
        } catch (err) {
          api.logger?.warn?.(`${spec.name} failed: ${err?.message || err}`);
          return {
            content: [{ type: 'text', text: `ioBroker-Bridge nicht erreichbar: ${err?.message || err}` }],
            details: { ok: false, error: { code: 'EUNREACHABLE', message: String(err?.message || err) } },
          };
        }
      },
    };
    if (spec.write) {
      api.registerTool(() => tool, { name: spec.name, optional: true });
    } else {
      api.registerTool(tool);
    }
    registered.push(spec.name);
  }
  return registered;
}
