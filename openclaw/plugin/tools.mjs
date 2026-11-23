// Tool definitions for the OpenClaw plugin. Each tool maps to one bridge
// action; parameter schemas are a subset of lib/catalog.js (checked by tests).

const operation = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['setState'] },
    id: { type: 'string', description: 'ioBroker state id' },
    value: { description: 'target value (boolean, number or string)' },
    reason: { type: 'string', description: 'short reason for the audit log' },
  },
  required: ['type', 'id', 'value'],
};
const operations = { type: 'array', items: operation, description: 'ordered state writes' };
const watts = { type: 'number', description: 'current PV surplus in W (optional)' };

export const TOOLS = [
  {
    name: 'iobroker_constraints',
    action: 'getConstraints',
    write: false,
    description: 'Call FIRST before controlling the home: returns the operating envelope (rules, thresholds, what may be switched on now, what you must not do).',
    parameters: { type: 'object', properties: { watts } },
  },
  {
    name: 'iobroker_list_states',
    action: 'listStates',
    write: false,
    description: 'Find devices and their state ids. Use prefix/search to narrow down; withMeta=true returns name, role, unit and writability.',
    parameters: {
      type: 'object',
      properties: {
        prefix: { type: 'string' },
        search: { type: 'string', description: 'case-insensitive filter on id and name, e.g. "pumpe"' },
        withMeta: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'iobroker_get_states',
    action: 'getStates',
    write: false,
    description: 'Read current values of one or more states.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
  },
  {
    name: 'iobroker_plan',
    action: 'planWithinBounds',
    write: false,
    description: 'Dry run: split intended writes into allowed and blocked, with hints (e.g. open a valve first, wait for PV). Never writes. Use before iobroker_execute.',
    parameters: { type: 'object', properties: { operations, watts }, required: ['operations'] },
  },
  {
    name: 'iobroker_events',
    action: 'getContextEvents',
    write: false,
    description: 'Recent context events from the house (guard blocks, auto-off, energy, comfort), newest first.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'iobroker_learning',
    action: 'getLearningStatus',
    write: false,
    description: 'Habit learning progress and readiness for suggest / autonomous mode.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'iobroker_suggest',
    action: 'suggestAutomation',
    write: false,
    description: 'Suggest habit-based operations for the current time without writing.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, watts } },
  },
  {
    name: 'iobroker_pending_confirmations',
    action: 'getPendingConfirmations',
    write: false,
    description: 'Operations waiting for the human operator to approve.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'iobroker_execute',
    action: 'executePlan',
    write: true,
    description: 'Execute writes inside the envelope. Rules are re-checked; blocked steps come back with hints. Do not retry a blocked step unchanged.',
    parameters: {
      type: 'object',
      properties: { operations, confirmation: { type: 'boolean', description: 'only after the user explicitly agreed' } },
      required: ['operations'],
    },
  },
  {
    name: 'iobroker_set_state',
    action: 'setState',
    write: true,
    description: 'Write a single state (subject to rules and confirmation).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        value: { description: 'target value' },
        confirmation: { type: 'boolean', description: 'only after the user explicitly agreed' },
      },
      required: ['id', 'value'],
    },
  },
  {
    name: 'iobroker_intent',
    action: 'handleIntent',
    write: true,
    description: 'Map a spoken request ("mir ist kalt", "gute Nacht") to a plan. execute=false returns the plan only.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, execute: { type: 'boolean' }, currentTargetTemp: { type: 'number' } },
      required: ['text'],
    },
  },
  {
    name: 'iobroker_optimize',
    action: 'optimizeHome',
    write: true,
    description: 'Combine learned habits and PV surplus into one plan; execute=false for a preview.',
    parameters: { type: 'object', properties: { execute: { type: 'boolean' }, watts } },
  },
  {
    name: 'iobroker_speak',
    action: 'speak',
    write: true,
    description: 'Say a short text on the Alexa device configured in ioBroker.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];
