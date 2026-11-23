'use strict';

const { BridgeError } = require('./errors');

/*
 * Single source of truth for every bridge action:
 *  - payload validation (required fields, primitive types)
 *  - `help` / `describeTools` output
 *  - tool definitions served to OpenClaw (GET /api/v1/tools)
 *
 * Descriptions are written for an LLM agent: what it does, when to use it.
 */

const operation = {
  type: 'object',
  description: 'A single state write.',
  properties: {
    type: { type: 'string', enum: ['setState'], description: 'Always "setState".' },
    id: { type: 'string', description: 'Full ioBroker state id, e.g. "0_userdata.0.light.livingroom".' },
    value: { description: 'Target value (boolean, number or string).' },
    ack: { type: 'boolean', description: 'Write as acknowledged value. Usually false (command).' },
    reason: { type: 'string', description: 'Short free-text reason for the audit log.' },
  },
  required: ['type', 'id', 'value'],
};

const operations = { type: 'array', items: operation, description: 'Ordered list of state writes.' };
const confirmation = {
  type: 'boolean',
  description: 'Confirms critical writes. In human confirmation mode this flag is ignored and an operator must approve.',
};
const execute = { type: 'boolean', description: 'false = plan only (dry run), true = write allowed operations.' };
const watts = { type: 'number', description: 'Current PV surplus in watts. Omit to read pvPowerStateId.' };

/** @type {Record<string, {group: string, mutates: boolean, description: string, params: object}>} */
const ACTIONS = {
  ping: {
    group: 'basics',
    mutates: false,
    description: 'Health check. Returns adapter version, uptime and habit mode.',
    params: {},
  },
  help: {
    group: 'basics',
    mutates: false,
    description: 'Overview of allowed actions, safety settings and quick-start payloads.',
    params: {},
  },
  describeTools: {
    group: 'basics',
    mutates: false,
    description: 'Machine readable catalog of every allowed action with JSON schema parameters.',
    params: { format: { type: 'string', enum: ['raw', 'openai', 'anthropic'], description: 'Output format.' } },
  },
  getState: {
    group: 'states',
    mutates: false,
    description: 'Read one state (value, ack, timestamp).',
    params: { id: { type: 'string', description: 'State id inside allowedPrefixes.' } },
    required: ['id'],
  },
  getStates: {
    group: 'states',
    mutates: false,
    description: 'Read several states at once. Forbidden ids are reported per id.',
    params: { ids: { type: 'array', items: { type: 'string' }, description: 'State ids.' } },
    required: ['ids'],
  },
  listStates: {
    group: 'states',
    mutates: false,
    description: 'Discover devices: list state ids (optionally with name, role, unit, writable) under the allowed prefixes. Use prefix and limit on large installations.',
    params: {
      prefix: { type: 'string', description: 'Only ids starting with this prefix (must be inside allowedPrefixes).' },
      search: { type: 'string', description: 'Case-insensitive filter on id and name.' },
      withMeta: { type: 'boolean', description: 'Include name, role, type, unit and write flag.' },
      limit: { type: 'number', description: 'Maximum number of ids (default 500).' },
    },
  },
  setState: {
    group: 'states',
    mutates: true,
    description: 'Write one state. Subject to ACL, guard rules and confirmation. Prefer planWithinBounds first.',
    params: {
      id: { type: 'string', description: 'State id inside allowedPrefixes.' },
      value: { description: 'Target value.' },
      ack: { type: 'boolean', description: 'Write acknowledged (only if policy allows).' },
      confirmation,
    },
    required: ['id', 'value'],
  },
  batchSetStates: {
    group: 'states',
    mutates: true,
    description: 'Write several states in one request (limited by maxBatchOperations).',
    params: { operations, confirmation },
    required: ['operations'],
  },
  syncSnapshot: {
    group: 'states',
    mutates: false,
    description: 'Full snapshot of every state under allowedPrefixes. Expensive on large installations.',
    params: {},
  },
  getConstraints: {
    group: 'envelope',
    mutates: false,
    description: 'Read the operating envelope first: rules, thresholds, what may be switched on right now, and what the agent must not do.',
    params: { watts },
  },
  planWithinBounds: {
    group: 'envelope',
    mutates: false,
    description: 'Split desired writes into allowed and blocked (with hints how to satisfy the rules). Never writes.',
    params: {
      operations,
      id: { type: 'string', description: 'Shortcut for a single operation.' },
      value: { description: 'Value for the single-operation shortcut.' },
      watts,
    },
  },
  checkGuards: {
    group: 'envelope',
    mutates: false,
    description: 'Detailed guard evaluation per operation (rules, confirmation need). Never writes.',
    params: { operations, id: { type: 'string' }, value: {}, watts, confirmation },
  },
  validatePlan: {
    group: 'plans',
    mutates: false,
    description: 'Dry run of executePlan: per operation executable / blocked / confirmation required.',
    params: { operations, confirmation },
    required: ['operations'],
  },
  executePlan: {
    group: 'plans',
    mutates: true,
    description: 'Execute an ordered list of writes. Guards are re-checked; blocked steps return hints.',
    params: { operations, confirmation },
    required: ['operations'],
  },
  handleIntent: {
    group: 'plans',
    mutates: true,
    description: 'Map a natural-language request ("mir ist kalt", "gute Nacht") to a plan. With execute=true only allowed steps are written.',
    params: {
      text: { type: 'string', description: 'User utterance.' },
      execute,
      confirmation,
      currentTargetTemp: { type: 'number', description: 'Current target temperature for comfort intents.' },
    },
    required: ['text'],
  },
  handlePvSurplus: {
    group: 'energy',
    mutates: true,
    description: 'Switch configured surplus loads on/off for the given PV surplus.',
    params: { watts, confirmation },
  },
  emitContextEvent: {
    group: 'context',
    mutates: false,
    description: 'Store a context event (e.g. presence, comfort). Habit events with states are learned.',
    params: {
      event: {
        type: 'object',
        description: 'Event with type, name and optional states/confidence.',
        properties: {
          type: { type: 'string' },
          name: { type: 'string' },
          states: { type: 'object' },
          confidence: { type: 'number' },
        },
      },
    },
    required: ['event'],
  },
  getContextEvents: {
    group: 'context',
    mutates: false,
    description: 'Most recent context events, newest first.',
    params: { limit: { type: 'number', description: 'Number of events (capped by contextEventHistoryLimit).' } },
  },
  recordObservation: {
    group: 'habits',
    mutates: false,
    description: 'Record an observation for habit learning (states object, ids to snapshot, or includeSnapshot).',
    params: {
      states: { type: 'object', description: 'Map of state id to value.' },
      ids: { type: 'array', items: { type: 'string' } },
      includeSnapshot: { type: 'boolean' },
      trigger: { type: 'string' },
      context: { type: 'object' },
    },
  },
  getHabits: {
    group: 'habits',
    mutates: false,
    description: 'Learned habit profiles.',
    params: { readyOnly: { type: 'boolean' } },
  },
  getLearningStatus: {
    group: 'habits',
    mutates: false,
    description: 'Learning progress and readiness for suggest / autonomous.',
    params: {},
  },
  evaluateHabits: {
    group: 'habits',
    mutates: false,
    description: 'Re-mine habit profiles from all observations.',
    params: {},
  },
  setHabitMode: {
    group: 'habits',
    mutates: true,
    description: 'Switch observe / suggest / autonomous. autonomous requires confirmation and a completed learning phase.',
    params: {
      mode: { type: 'string', enum: ['observe', 'suggest', 'autonomous'] },
      confirmation,
      force: { type: 'boolean', description: 'Skip readiness check (operator use only).' },
    },
    required: ['mode'],
  },
  suggestAutomation: {
    group: 'habits',
    mutates: false,
    description: 'Suggest habit-based operations for now without writing.',
    params: { name: { type: 'string' }, watts },
  },
  applyHabit: {
    group: 'habits',
    mutates: true,
    description: 'Apply a learned habit or configured scene by name (within the envelope).',
    params: { name: { type: 'string' }, execute, confirmation },
    required: ['name'],
  },
  optimizeHome: {
    group: 'habits',
    mutates: true,
    description: 'Combine matching habits and PV surplus into one plan; executes depending on habit mode and execute flag.',
    params: { execute, confirmation, name: { type: 'string' }, watts },
  },
  speak: {
    group: 'voice',
    mutates: true,
    description: 'Speak a text via the configured Alexa TTS state.',
    params: { text: { type: 'string' } },
    required: ['text'],
  },
  transcribe: {
    group: 'voice',
    mutates: false,
    description: 'Transcribe an audio file inside sttAudioDir with the local STT command.',
    params: { audioPath: { type: 'string', description: 'File name relative to sttAudioDir.' } },
    required: ['audioPath'],
  },
  voiceCommand: {
    group: 'voice',
    mutates: true,
    description: 'Transcribe audio, run handleIntent and optionally speak a confirmation.',
    params: {
      audioPath: { type: 'string' },
      execute,
      confirmation,
      speak: { type: 'boolean' },
      speakText: { type: 'string' },
    },
    required: ['audioPath'],
  },
  getTelemetry: {
    group: 'ops',
    mutates: false,
    description: 'Counters, queue depth and average latency.',
    params: {},
  },
  getPendingConfirmations: {
    group: 'safety',
    mutates: false,
    description: 'Operations waiting for a human operator to approve (human confirmation mode).',
    params: {},
  },
  cancelConfirmation: {
    group: 'safety',
    mutates: false,
    description: 'Withdraw one of your own pending confirmation requests.',
    params: { confirmationId: { type: 'string' } },
    required: ['confirmationId'],
  },
};

const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

function actionNames() {
  return Object.keys(ACTIONS);
}

function getAction(name) {
  return Object.prototype.hasOwnProperty.call(ACTIONS, name) ? ACTIONS[name] : null;
}

/**
 * Validate top-level payload fields against the action schema.
 * Lenient on purpose: unknown fields are ignored, numbers given as numeric
 * strings are rejected so the agent learns the correct shape.
 */
function validatePayload(name, payload) {
  const spec = getAction(name);
  if (!spec) return;
  const problems = [];
  for (const field of spec.required || []) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      problems.push({ field, problem: 'required' });
    }
  }
  for (const [field, schema] of Object.entries(spec.params)) {
    const value = payload[field];
    if (value === undefined || value === null || !schema.type) continue;
    const check = TYPE_CHECKS[schema.type];
    if (check && !check(value)) {
      problems.push({ field, problem: `expected ${schema.type}` });
      continue;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      problems.push({ field, problem: `expected one of ${schema.enum.join(', ')}` });
    }
  }
  if (problems.length) {
    throw new BridgeError('EBADREQUEST', `invalid payload for ${name}: ${problems.map((p) => `${p.field} ${p.problem}`).join('; ')}`, {
      details: { problems, schema: toJsonSchema(name) },
    });
  }
}

function toJsonSchema(name) {
  const spec = getAction(name);
  if (!spec) return null;
  const schema = { type: 'object', properties: { ...spec.params } };
  if (spec.required && spec.required.length) schema.required = [...spec.required];
  return schema;
}

/**
 * Tool list for LLM agents.
 * @param {string[]} allowed allowed action names (config whitelist)
 * @param {'raw'|'openai'|'anthropic'} format
 */
function describeTools(allowed, format = 'raw') {
  const names = actionNames().filter((name) => allowed.includes(name));
  return names.map((name) => {
    const spec = ACTIONS[name];
    const parameters = toJsonSchema(name);
    if (format === 'openai') {
      return { type: 'function', function: { name, description: spec.description, parameters } };
    }
    if (format === 'anthropic') {
      return { name, description: spec.description, input_schema: parameters };
    }
    return { name, group: spec.group, mutates: spec.mutates, description: spec.description, parameters };
  });
}

module.exports = {
  ACTIONS,
  actionNames,
  getAction,
  validatePayload,
  toJsonSchema,
  describeTools,
};
