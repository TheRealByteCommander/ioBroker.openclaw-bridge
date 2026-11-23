import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { registerBridgeTools } from './register.mjs';

export default definePluginEntry({
  id: 'iobroker-bridge',
  name: 'ioBroker Bridge',
  description: 'Control ioBroker home automation through the openclaw-bridge adapter, strictly inside the operator-defined envelope.',
  register(api) {
    const tools = registerBridgeTools(api);
    api.logger?.info?.(`ioBroker bridge tools registered: ${tools.join(', ')}`);
  },
});
