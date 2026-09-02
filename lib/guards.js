'use strict';

const combinators = new Set(['and', 'or', 'xor']);
const whenModes = new Set(['turn_on', 'turn_off', 'always']);
const compareOps = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'truthy', 'falsy', 'contains']);

function minutesToMs(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60 * 1000;
}

function unwrapVal(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'val' in value) return value.val;
  return value;
}

function isTruthy(value) {
  const raw = unwrapVal(value);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0 && !Number.isNaN(raw);
  if (raw == null || raw === '') return false;
  const text = String(raw).trim().toLowerCase();
  if (['0', 'false', 'off', 'closed', 'zu', 'aus', 'close'].includes(text)) return false;
  if (['1', 'true', 'on', 'open', 'offen', 'an', 'opened'].includes(text)) return true;
  return Boolean(text);
}

function writeKind(value) {
  return isTruthy(value) ? 'on' : 'off';
}

function valuesEqual(left, right) {
  return JSON.stringify(unwrapVal(left)) === JSON.stringify(unwrapVal(right));
}

function compare(op, actual, expected) {
  const left = unwrapVal(actual);
  const right = unwrapVal(expected);
  switch (op) {
    case 'truthy':
      return isTruthy(left);
    case 'falsy':
      return !isTruthy(left);
    case 'eq':
      return valuesEqual(left, right);
    case 'neq':
      return !valuesEqual(left, right);
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'contains':
      return String(left).includes(String(right));
    default:
      return false;
  }
}

function parseList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseConditionsJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((item) => item && item.id);
  if (typeof raw === 'object') return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id) : [];
  } catch {
    return [];
  }
}

function normalizeRule(row = {}) {
  const targetId = String(row.targetId || row.id || '').trim();
  const combinator = combinators.has(row.combinator) ? row.combinator : 'or';
  const when = whenModes.has(row.when) ? row.when : 'turn_on';
  const extra = parseConditionsJson(row.conditionsJson || row.conditions);
  return {
    enabled: row.enabled !== false,
    name: String(row.name || targetId || 'rule').trim(),
    targetId,
    when,
    combinator,
    conditionIds: parseList(row.conditionIds),
    conditionPrefix: String(row.conditionPrefix || '').trim(),
    conditions: extra.map((item) => ({
      id: String(item.id).trim(),
      op: compareOps.has(item.op) ? item.op : 'truthy',
      value: item.value,
    })),
    maxOnMs: minutesToMs(row.maxOnMinutes) || (Number(row.maxOnMs) > 0 ? Number(row.maxOnMs) : 0),
    minOffMs: minutesToMs(row.minOffMinutes) || (Number(row.minOffMs) > 0 ? Number(row.minOffMs) : 0),
    offValue: row.offValue === undefined ? false : row.offValue,
  };
}

function parseGuardRules(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map(normalizeRule).filter((rule) => rule.targetId && rule.enabled);
}

function ruleApplies(rule, targetId, value) {
  if (!rule || !rule.enabled || rule.targetId !== targetId) return false;
  if (rule.when === 'always') return true;
  const kind = writeKind(value);
  if (rule.when === 'turn_on') return kind === 'on';
  if (rule.when === 'turn_off') return kind === 'off';
  return false;
}

function combine(combinator, flags) {
  if (!flags.length) return true;
  const trueCount = flags.filter(Boolean).length;
  if (combinator === 'and') return trueCount === flags.length;
  if (combinator === 'xor') return trueCount === 1;
  return trueCount >= 1;
}

function conditionList(rule, expandedIds = []) {
  const fromIds = [...new Set([...(rule.conditionIds || []), ...expandedIds])]
    .filter((id) => id && id !== rule.targetId)
    .map((id) => ({ id, op: 'truthy' }));
  return [...fromIds, ...(rule.conditions || [])];
}

function evaluateConditions(rule, getValue, expandedIds = []) {
  const conditions = conditionList(rule, expandedIds);
  if (!conditions.length) {
    return { ok: true, combinator: rule.combinator, results: [] };
  }
  const results = conditions.map((condition) => {
    const actual = getValue(condition.id);
    const ok = compare(condition.op, actual, condition.value);
    return {
      id: condition.id,
      op: condition.op,
      expected: condition.value,
      actual: unwrapVal(actual),
      ok,
    };
  });
  return {
    ok: combine(rule.combinator, results.map((row) => row.ok)),
    combinator: rule.combinator,
    results,
  };
}

function evaluateDuration(rule, { value, now, lastOn = 0, lastOff = 0 }) {
  const kind = writeKind(value);
  if (kind === 'on' && rule.minOffMs > 0 && lastOff > 0 && now - lastOff < rule.minOffMs) {
    return {
      ok: false,
      code: 'ECOOLDOWN',
      message: `minimum off duration not elapsed for ${rule.targetId}`,
      remainingMs: rule.minOffMs - (now - lastOff),
    };
  }
  if (kind === 'on' && rule.maxOnMs > 0 && lastOn > 0 && now - lastOn >= rule.maxOnMs) {
    return {
      ok: false,
      code: 'EDURATIONLIMIT',
      message: `maximum on duration exceeded for ${rule.targetId}`,
      elapsedMs: now - lastOn,
      maxOnMs: rule.maxOnMs,
    };
  }
  return { ok: true };
}

function remainingOnMs(rule, { now, lastOn = 0, currentlyOn = false }) {
  if (!rule.maxOnMs || !currentlyOn || !lastOn) return rule.maxOnMs || 0;
  return Math.max(0, rule.maxOnMs - (now - lastOn));
}

function evaluateWrite(op, rules, context = {}) {
  const id = op?.id;
  const value = op?.value;
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const getValue = typeof context.getValue === 'function' ? context.getValue : () => undefined;
  const lastOn = (context.lastOn && context.lastOn[id]) || 0;
  const lastOff = (context.lastOff && context.lastOff[id]) || 0;
  const matching = (rules || []).filter((rule) => ruleApplies(rule, id, value));
  const details = [];

  for (const rule of matching) {
    const expanded = (context.expandedIds && context.expandedIds[rule.name]) || context.expandedPrefixIds || [];
    const conditions = evaluateConditions(rule, getValue, expanded);
    if (!conditions.ok) {
      return {
        ok: false,
        code: 'EGUARDFAILED',
        message: `guard "${rule.name}" blocked write to ${id} (${rule.combinator})`,
        rule: rule.name,
        combinator: rule.combinator,
        conditions: conditions.results,
      };
    }
    const duration = evaluateDuration(rule, { value, now, lastOn, lastOff });
    if (!duration.ok) {
      return {
        ok: false,
        code: duration.code,
        message: duration.message,
        rule: rule.name,
        details: duration,
      };
    }
    details.push({
      rule: rule.name,
      conditions,
      remainingOnMs: remainingOnMs(rule, { now, lastOn, currentlyOn: writeKind(value) === 'on' && lastOn > 0 }),
      maxOnMs: rule.maxOnMs,
      minOffMs: rule.minOffMs,
      offValue: rule.offValue,
    });
  }

  return { ok: true, rules: matching.map((rule) => rule.name), details };
}

function targetIds(rules = []) {
  return [...new Set(rules.map((rule) => rule.targetId).filter(Boolean))];
}

function rulesForTarget(rules, id) {
  return (rules || []).filter((rule) => rule.targetId === id && rule.enabled);
}

function overlayGetValue(snapshot = {}, pending = {}) {
  return (id) => {
    if (Object.prototype.hasOwnProperty.call(pending, id)) return pending[id];
    const current = snapshot[id];
    return current && typeof current === 'object' && 'val' in current ? current.val : current;
  };
}

module.exports = {
  isTruthy,
  writeKind,
  compare,
  parseGuardRules,
  normalizeRule,
  ruleApplies,
  evaluateConditions,
  evaluateDuration,
  evaluateWrite,
  remainingOnMs,
  targetIds,
  rulesForTarget,
  overlayGetValue,
  minutesToMs,
};
