import { registerBridgeTools } from './register.mjs';

// Plain plugin definition object. Older gateways (2026.3.x) accept a default
// export with `register`; newer ones wrap the same shape via definePluginEntry.
// Avoiding the SDK import keeps the plugin loadable on both.
export default {
  id: 'iobroker-bridge',
  name: 'ioBroker Bridge',
  description: 'Control ioBroker home automation through the openclaw-bridge adapter, strictly inside the operator-defined envelope.',
  register(api) {
    const tools = registerBridgeTools(api);
    api.logger?.info?.(`ioBroker bridge tools registered: ${tools.join(', ')}`);
  },
};
