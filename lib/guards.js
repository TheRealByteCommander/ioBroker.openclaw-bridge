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
    thresholdId: String(row.thresholdId || '').trim(),
    thresholdOp: compareOps.has(row.thresholdOp) ? row.thresholdOp : 'gte',
    thresholdValue: row.thresholdValue === '' || row.thresholdValue == null ? null : Number(row.thresholdValue),
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

function parseSurplusLoads(raw) {
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
  return list
    .map((row = {}) => ({
      enabled: row.enabled !== false,
      name: String(row.name || row.targetId || 'load').trim(),
      targetId: String(row.targetId || '').trim(),
      minWatts: Number(row.minWatts) > 0 ? Number(row.minWatts) : 0,
      offBelowWatts: Number(row.offBelowWatts) > 0 ? Number(row.offBelowWatts) : 0,
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 100,
      onValue: row.onValue === undefined ? true : row.onValue,
      offValue: row.offValue === undefined ? false : row.offValue,
    }))
    .filter((row) => row.enabled && row.targetId && row.minWatts > 0)
    .sort((a, b) => a.priority - b.priority);
}

function hasThreshold(rule) {
  return Boolean(rule && rule.thresholdId && Number.isFinite(rule.thresholdValue));
}

function evaluateThreshold(rule, getValue) {
  if (!hasThreshold(rule)) return null;
  const actual = getValue(rule.thresholdId);
  const ok = compare(rule.thresholdOp, actual, rule.thresholdValue);
  return {
    kind: 'threshold',
    id: rule.thresholdId,
    op: rule.thresholdOp,
    expected: rule.thresholdValue,
    actual: unwrapVal(actual),
    ok,
  };
}

function desiredSurplusValue(load, watts, current) {
  const offBelow = load.offBelowWatts > 0 ? load.offBelowWatts : load.minWatts;
  if (watts >= load.minWatts) return load.onValue;
  if (watts < offBelow) return load.offValue;
  return isTruthy(current) ? load.onValue : load.offValue;
}

function surplusLoadOperations(loads, watts, snapshot = {}, fallback = null) {
  const list = (loads && loads.length)
    ? loads
    : (fallback && fallback.targetId ? [fallback] : []);
  const operations = [];
  const decisions = [];
  for (const load of list) {
    const current = snapshot[load.targetId];
    const currentVal = unwrapVal(current);
    const next = desiredSurplusValue(load, Number(watts), currentVal);
    const changed = typeof next === 'boolean'
      ? isTruthy(currentVal) !== next
      : unwrapVal(currentVal) !== next;
    const decision = {
      name: load.name,
      id: load.targetId,
      minWatts: load.minWatts,
      offBelowWatts: load.offBelowWatts > 0 ? load.offBelowWatts : load.minWatts,
      watts: Number(watts),
      current: currentVal,
      next,
      changed,
    };
    decisions.push(decision);
    if (changed) {
      operations.push({
        type: 'setState',
        id: load.targetId,
        value: next,
        ack: false,
        reason: `energy.pv_surplus.${load.name}`,
      });
    }
  }
  return { operations, decisions };
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
  const combinedOk = combine(rule.combinator, results.map((row) => row.ok));
  const threshold = evaluateThreshold(rule, getValue);
  if (threshold) results.push(threshold);
  return {
    ok: combinedOk && (threshold ? threshold.ok : true),
    combinator: rule.combinator,
    results,
    threshold,
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
      const failedThreshold = conditions.threshold && !conditions.threshold.ok;
      return {
        ok: false,
        code: failedThreshold ? 'ETHRESHOLD' : 'EGUARDFAILED',
        message: failedThreshold
          ? `threshold not met for ${id}: ${conditions.threshold.id} ${conditions.threshold.op} ${conditions.threshold.expected} (actual ${conditions.threshold.actual})`
          : `guard "${rule.name}" blocked write to ${id} (${rule.combinator})`,
        rule: rule.name,
        combinator: rule.combinator,
        conditions: conditions.results,
        threshold: conditions.threshold || undefined,
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

function constraintHint(result, op = {}) {
  if (!result || result.ok) {
    return { type: 'ok', withinBounds: true };
  }
  if (result.code === 'ETHRESHOLD' && result.threshold) {
    const threshold = result.threshold;
    const actual = Number(threshold.actual);
    const expected = Number(threshold.expected);
    const deficit = ['gte', 'gt'].includes(threshold.op) && Number.isFinite(actual) && Number.isFinite(expected)
      ? expected - actual
      : null;
    return {
      type: 'wait_for_threshold',
      withinBounds: false,
      text: `Rahmenbedingung: ${op.id || result.rule} erst wenn ${threshold.id} ${threshold.op} ${threshold.expected} (aktuell ${threshold.actual})`,
      threshold,
      deficit,
    };
  }
  if (result.code === 'EGUARDFAILED') {
    const unsatisfied = (result.conditions || []).filter((row) => !row.ok);
    const companions = unsatisfied
      .filter((row) => row.op === 'truthy' || row.op === 'eq')
      .map((row) => ({
        type: 'setState',
        id: row.id,
        value: row.op === 'truthy' ? true : row.expected,
        reason: 'envelope.satisfy_condition',
      }));
    const type = result.combinator === 'or' ? 'satisfy_any' : result.combinator === 'xor' ? 'satisfy_exactly_one' : 'satisfy_all';
    return {
      type,
      withinBounds: false,
      text: `Rahmenbedingung "${result.rule}": ${String(result.combinator || 'and').toUpperCase()} nicht erfüllt`,
      companions,
      unsatisfied,
    };
  }
  if (result.code === 'EDURATIONLIMIT') {
    return {
      type: 'turn_off_or_wait',
      withinBounds: false,
      text: `Rahmenbedingung: maximale Einschaltdauer für ${op.id || result.rule} erreicht`,
      details: result.details,
    };
  }
  if (result.code === 'ECOOLDOWN') {
    return {
      type: 'wait_for_min_off',
      withinBounds: false,
      text: `Rahmenbedingung: Mindest-Auszeit für ${op.id || result.rule} läuft noch`,
      details: result.details,
    };
  }
  return {
    type: 'blocked',
    withinBounds: false,
    text: result.message || 'outside operating envelope',
  };
}

function describeRule(rule) {
  return {
    name: rule.name,
    targetId: rule.targetId,
    when: rule.when,
    combinator: rule.combinator,
    conditionIds: rule.conditionIds,
    conditionPrefix: rule.conditionPrefix || undefined,
    threshold: hasThreshold(rule)
      ? { id: rule.thresholdId, op: rule.thresholdOp, value: rule.thresholdValue }
      : undefined,
    maxOnMs: rule.maxOnMs || undefined,
    minOffMs: rule.minOffMs || undefined,
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
  parseSurplusLoads,
  surplusLoadOperations,
  hasThreshold,
  constraintHint,
  describeRule,
};
