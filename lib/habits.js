'use strict';

const WEEKEND_DAYS = new Set([0, 6]);

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function minutesOfDay(hour, minute) {
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timeSlotLabel(slotStartMinute, slotMinutes) {
  const startHour = Math.floor(slotStartMinute / 60);
  const startMin = slotStartMinute % 60;
  const endMinute = (slotStartMinute + slotMinutes - 1) % (24 * 60);
  const endHour = Math.floor(endMinute / 60);
  const endMin = endMinute % 60;
  return `${pad2(startHour)}:${pad2(startMin)}-${pad2(endHour)}:${pad2(endMin)}`;
}

function describeTime(date) {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const weekday = date.getDay();
  return {
    ts: date.toISOString(),
    hour,
    minute,
    weekday,
    isWeekend: WEEKEND_DAYS.has(weekday),
    minutesOfDay: minutesOfDay(hour, minute),
  };
}

function slotStartMinute(hour, minute, slotMinutes) {
  const size = Number(slotMinutes) > 0 ? Number(slotMinutes) : 30;
  const total = minutesOfDay(hour, minute);
  return Math.floor(total / size) * size;
}

function stableValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function valuesEqual(a, b) {
  return stableValue(a) === stableValue(b);
}

function modeOf(values) {
  const counts = new Map();
  for (const value of values) {
    const key = stableValue(value);
    const entry = counts.get(key) || { value, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best;
}

function circularMeanMinutes(minutesList) {
  if (!minutesList.length) return 0;
  const TAU = Math.PI * 2;
  let x = 0;
  let y = 0;
  for (const minutes of minutesList) {
    const angle = (minutes / (24 * 60)) * TAU;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  const meanAngle = Math.atan2(y / minutesList.length, x / minutesList.length);
  const normalized = (meanAngle < 0 ? meanAngle + TAU : meanAngle) / TAU;
  return Math.round(normalized * 24 * 60) % (24 * 60);
}

function circularStdMinutes(minutesList, mean) {
  if (minutesList.length < 2) return 0;
  const halfDay = 12 * 60;
  let sumSq = 0;
  for (const minutes of minutesList) {
    let delta = Math.abs(minutes - mean);
    if (delta > halfDay) delta = 24 * 60 - delta;
    sumSq += delta * delta;
  }
  return Math.sqrt(sumSq / minutesList.length);
}

function expandWindow(meanMinutes, stdMinutes, slackMinutes, minObserved, maxObserved) {
  const slack = Number.isFinite(slackMinutes) ? slackMinutes : 30;
  const spread = Math.max(stdMinutes * 1.5, slack, 15);
  let start = Math.round(meanMinutes - spread);
  let end = Math.round(meanMinutes + spread);

  if (Number.isFinite(minObserved) && Number.isFinite(maxObserved)) {
    const observedSpan = (maxObserved - minObserved + 24 * 60) % (24 * 60);
    if (observedSpan <= 12 * 60) {
      start = Math.min(start, minObserved);
      end = Math.max(end, maxObserved);
    }
  }

  start = ((start % (24 * 60)) + 24 * 60) % (24 * 60);
  end = ((end % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    startHour: Math.floor(start / 60),
    startMinute: start % 60,
    endHour: Math.floor(end / 60),
    endMinute: end % 60,
    meanHour: Math.floor(meanMinutes / 60),
    meanMinute: meanMinutes % 60,
  };
}

function inTimeWindow(hour, minute, window) {
  if (!window) return false;
  const t = minutesOfDay(hour, minute);
  const start = minutesOfDay(window.startHour, window.startMinute);
  const end = minutesOfDay(window.endHour, window.endMinute);
  if (start <= end) return t >= start && t <= end;
  return t >= start || t <= end;
}

function weekdayTypeOf(isWeekend) {
  return isWeekend ? 'weekend' : 'weekday';
}

function sanitizeStates(states, allowedPrefixes, isAllowedId) {
  const out = {};
  if (!states || typeof states !== 'object' || Array.isArray(states)) return out;
  for (const [id, value] of Object.entries(states)) {
    if (typeof id !== 'string' || !id) continue;
    if (typeof isAllowedId === 'function' && !isAllowedId(id, allowedPrefixes)) continue;
    out[id] = value;
  }
  return out;
}

function normalizeObservation(input = {}, options = {}) {
  const now = toDate(input.ts || input.now || options.now);
  const described = describeTime(now);
  const slotMinutes = Number(options.slotMinutes) > 0 ? Number(options.slotMinutes) : 30;
  const slotStart = slotStartMinute(described.hour, described.minute, slotMinutes);
  const context = input.context && typeof input.context === 'object' ? input.context : null;
  const states = input.states && typeof input.states === 'object' && !Array.isArray(input.states)
    ? { ...input.states }
    : {};

  return {
    id: input.id || `${described.ts}:${described.minutesOfDay}`,
    ts: described.ts,
    hour: described.hour,
    minute: described.minute,
    weekday: described.weekday,
    isWeekend: described.isWeekend,
    weekdayType: weekdayTypeOf(described.isWeekend),
    timeSlot: timeSlotLabel(slotStart, slotMinutes),
    slotStartMinute: slotStart,
    trigger: input.trigger || 'observation',
    sourceAction: input.sourceAction || null,
    context,
    states,
  };
}

function appendObservation(history, observation, limit = 500) {
  const list = Array.isArray(history) ? history.slice() : [];
  list.push(observation);
  const max = Number(limit) > 0 ? Number(limit) : 500;
  return list.slice(-max);
}

function profileConfidence({ sampleCount, daysSpanned, consistency, temporalStability, minObservations, minDays }) {
  const coverage = clamp01(sampleCount / Math.max(1, minObservations));
  const span = clamp01(daysSpanned / Math.max(1, minDays));
  return clamp01(0.4 * consistency + 0.2 * temporalStability + 0.2 * coverage + 0.2 * span);
}

function daysBetween(firstIso, lastIso) {
  const first = toDate(firstIso);
  const last = toDate(lastIso);
  const diff = Math.abs(last.getTime() - first.getTime());
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

function uniqueDays(observations) {
  const days = new Set();
  for (const obs of observations) {
    days.add(String(obs.ts || '').slice(0, 10));
  }
  return days.size;
}

function buildProfile(key, observations, options = {}) {
  const minObservations = Number(options.minObservations) > 0 ? Number(options.minObservations) : 7;
  const minDays = Number(options.minDays) > 0 ? Number(options.minDays) : 3;
  const minConfidence = Number(options.minConfidence) > 0 ? Number(options.minConfidence) : 0.65;
  const slackMinutes = Number(options.matchSlackMinutes) >= 0 ? Number(options.matchSlackMinutes) : 30;

  const minutesList = observations.map((obs) => minutesOfDay(obs.hour, obs.minute));
  const meanMinutes = circularMeanMinutes(minutesList);
  const stdMinutes = circularStdMinutes(minutesList, meanMinutes);
  const minObserved = Math.min(...minutesList);
  const maxObserved = Math.max(...minutesList);
  const window = expandWindow(meanMinutes, stdMinutes, slackMinutes, minObserved, maxObserved);

  const valuesByState = new Map();
  for (const obs of observations) {
    for (const [id, value] of Object.entries(obs.states || {})) {
      const list = valuesByState.get(id) || [];
      list.push(value);
      valuesByState.set(id, list);
    }
  }

  const targets = {};
  const consistencies = [];
  for (const [id, values] of valuesByState.entries()) {
    const mode = modeOf(values);
    if (!mode) continue;
    const consistency = mode.count / values.length;
    consistencies.push(consistency);
    targets[id] = {
      value: mode.value,
      support: values.length,
      consistency: Number(consistency.toFixed(3)),
    };
  }

  const consistency = consistencies.length
    ? consistencies.reduce((a, b) => a + b, 0) / consistencies.length
    : 0;
  const temporalStability = clamp01(1 - stdMinutes / 180);
  const sampleCount = observations.length;
  const firstSeen = observations[0].ts;
  const lastSeen = observations[observations.length - 1].ts;
  const daysSpanned = Math.max(uniqueDays(observations), daysBetween(firstSeen, lastSeen));
  const confidence = profileConfidence({
    sampleCount,
    daysSpanned,
    consistency,
    temporalStability,
    minObservations,
    minDays,
  });

  const named = key.startsWith('named:');
  const name = named ? key.slice('named:'.length) : key.slice('temporal:'.length);
  const weekdayType = named
    ? 'any'
    : (observations.every((obs) => obs.isWeekend) ? 'weekend'
      : observations.every((obs) => !obs.isWeekend) ? 'weekday'
        : 'any');

  return {
    id: key,
    name,
    kind: named ? 'named' : 'temporal',
    weekdayType,
    timeWindow: window,
    sampleCount,
    firstSeen,
    lastSeen,
    daysSpanned,
    targets,
    consistency: Number(consistency.toFixed(3)),
    temporalStability: Number(temporalStability.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    ready: confidence >= minConfidence && sampleCount >= minObservations && daysSpanned >= minDays,
  };
}

function mineProfiles(observations, options = {}) {
  const list = Array.isArray(observations) ? observations : [];
  const groups = new Map();

  for (const obs of list) {
    const temporalKey = `temporal:${obs.weekdayType}:${obs.timeSlot}`;
    if (!groups.has(temporalKey)) groups.set(temporalKey, []);
    groups.get(temporalKey).push(obs);

    const habitName = obs.context && obs.context.type === 'habit' && obs.context.name
      ? String(obs.context.name)
      : null;
    if (habitName) {
      const namedKey = `named:${habitName}`;
      if (!groups.has(namedKey)) groups.set(namedKey, []);
      groups.get(namedKey).push(obs);
    }
  }

  const profiles = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2 && !key.startsWith('named:')) continue;
    if (group.length < 1) continue;
    profiles.push(buildProfile(key, group, options));
  }

  profiles.sort((a, b) => b.confidence - a.confidence || b.sampleCount - a.sampleCount);
  return profiles;
}

function contextMatchesWeekday(profile, isWeekend) {
  if (!profile || profile.weekdayType === 'any') return true;
  return profile.weekdayType === weekdayTypeOf(isWeekend);
}

function matchHabits(profiles, context = {}, options = {}) {
  const list = Array.isArray(profiles) ? profiles : [];
  const now = toDate(context.now);
  const described = describeTime(now);
  const readyOnly = options.readyOnly !== false;
  const minConfidence = Number(options.minConfidence) >= 0 ? Number(options.minConfidence) : 0;

  const matches = [];
  for (const profile of list) {
    if (readyOnly && !profile.ready) continue;
    if (profile.confidence < minConfidence) continue;
    if (!contextMatchesWeekday(profile, described.isWeekend)) continue;
    if (!inTimeWindow(described.hour, described.minute, profile.timeWindow)) continue;
    if (context.name && profile.kind === 'named' && profile.name !== context.name) continue;
    matches.push({
      profile,
      score: Number((profile.confidence * (profile.kind === 'named' && context.name === profile.name ? 1.1 : 1)).toFixed(3)),
    });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function findProfileByName(profiles, name) {
  const wanted = String(name || '');
  return (profiles || []).find((profile) => profile.kind === 'named' && profile.name === wanted)
    || (profiles || []).find((profile) => profile.name === wanted)
    || null;
}

function learningStatus(profiles, observations, config = {}) {
  const minObservations = Number(config.minObservations) > 0 ? Number(config.minObservations) : 7;
  const minDays = Number(config.minDays) > 0 ? Number(config.minDays) : 3;
  const minConfidence = Number(config.minConfidence) > 0 ? Number(config.minConfidence) : 0.65;
  const list = Array.isArray(observations) ? observations : [];
  const readyProfiles = (profiles || []).filter((profile) => profile.ready);
  const daysSpanned = list.length ? uniqueDays(list) : 0;
  const observationProgress = clamp01(list.length / minObservations);
  const dayProgress = clamp01(daysSpanned / minDays);
  const readyProgress = (profiles || []).length
    ? clamp01(readyProfiles.length / Math.max(1, Math.min(3, profiles.length)))
    : 0;
  const progress = Number((0.4 * observationProgress + 0.3 * dayProgress + 0.3 * readyProgress).toFixed(3));
  const readyForSuggest = list.length >= minObservations && daysSpanned >= minDays && readyProfiles.length >= 1;
  const readyForAutonomy = readyForSuggest && readyProfiles.some((profile) => profile.confidence >= minConfidence);

  return {
    observationCount: list.length,
    profileCount: (profiles || []).length,
    readyProfiles: readyProfiles.length,
    minObservations,
    minDays,
    minConfidence,
    daysSpanned,
    progress,
    readyForSuggest,
    readyForAutonomy,
    nextMode: readyForAutonomy ? 'autonomous' : readyForSuggest ? 'suggest' : 'observe',
  };
}

function habitToOperations(profile, snapshot = {}, options = {}) {
  const operations = [];
  if (!profile || !profile.targets) return operations;
  const cooldownIds = options.cooldownIds instanceof Set ? options.cooldownIds : new Set();
  const minSupport = Number(options.minSupport) > 0 ? Number(options.minSupport) : 1;
  const minConsistency = Number(options.minConsistency) >= 0 ? Number(options.minConsistency) : 0.5;

  for (const [id, target] of Object.entries(profile.targets)) {
    if (target.support < minSupport) continue;
    if (target.consistency < minConsistency) continue;
    if (cooldownIds.has(id)) continue;
    const current = snapshot[id];
    const currentVal = current && typeof current === 'object' && 'val' in current ? current.val : current;
    if (valuesEqual(currentVal, target.value)) continue;
    operations.push({
      type: 'setState',
      id,
      value: target.value,
      ack: false,
      reason: `habit.${profile.name}`,
    });
  }
  return operations;
}

function parseSceneMap(raw, fallbackStateIds = {}) {
  if (!raw) return defaultScenes(fallbackStateIds);
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to defaults
  }
  return defaultScenes(fallbackStateIds);
}

function defaultScenes(ids = {}) {
  const scenes = {};
  const lightId = ids.lightStateId;
  const tempId = ids.temperatureStateId;
  const bedtimeTemp = Number.isFinite(Number(ids.bedtimeTemperature)) ? Number(ids.bedtimeTemperature) : 18;
  const morningTemp = Number.isFinite(Number(ids.morningTemperature)) ? Number(ids.morningTemperature) : 21;

  if (lightId || tempId) {
    scenes.bedtime = [
      ...(lightId ? [{ id: lightId, value: false }] : []),
      ...(tempId ? [{ id: tempId, value: bedtimeTemp }] : []),
    ];
    scenes.leave_home = [
      ...(lightId ? [{ id: lightId, value: false }] : []),
    ];
    scenes.arrive_home = [
      ...(lightId ? [{ id: lightId, value: true }] : []),
    ];
    scenes.morning = [
      ...(lightId ? [{ id: lightId, value: true }] : []),
      ...(tempId ? [{ id: tempId, value: morningTemp }] : []),
    ];
    scenes.lights_off = lightId ? [{ id: lightId, value: false }] : [];
    scenes.lights_on = lightId ? [{ id: lightId, value: true }] : [];
  }
  return scenes;
}

function sceneToOperations(sceneName, scenes, reasonPrefix = 'scene') {
  const steps = scenes && Array.isArray(scenes[sceneName]) ? scenes[sceneName] : [];
  return steps
    .filter((step) => step && step.id)
    .map((step) => ({
      type: 'setState',
      id: step.id,
      value: step.value,
      ack: false,
      reason: `${reasonPrefix}.${sceneName}`,
    }));
}

function mergeOperations(groups) {
  const byId = new Map();
  for (const operations of groups) {
    for (const op of operations || []) {
      if (!op || !op.id) continue;
      byId.set(op.id, op);
    }
  }
  return [...byId.values()];
}

function optimizePlan(input = {}) {
  const snapshot = input.snapshot || {};
  const profiles = input.profiles || [];
  const now = input.now;
  const mode = input.mode || 'observe';
  const matches = matchHabits(profiles, { now, name: input.habitName }, {
    readyOnly: input.readyOnly !== false,
    minConfidence: input.minConfidence,
  });

  const cooldownIds = input.cooldownIds instanceof Set ? input.cooldownIds : new Set(input.cooldownIds || []);
  const habitOps = [];
  for (const match of matches) {
    habitOps.push(...habitToOperations(match.profile, snapshot, {
      cooldownIds,
      minSupport: input.minSupport,
      minConsistency: input.minConsistency,
    }));
  }

  const energyOps = [];
  if (Number.isFinite(Number(input.watts)) && input.pvSurplusLoadStateId) {
    const enabled = Number(input.watts) >= Number(input.pvSurplusMinWatts || 1500);
    const current = snapshot[input.pvSurplusLoadStateId];
    const currentVal = current && typeof current === 'object' && 'val' in current ? current.val : current;
    if (currentVal !== enabled && !cooldownIds.has(input.pvSurplusLoadStateId)) {
      energyOps.push({
        type: 'setState',
        id: input.pvSurplusLoadStateId,
        value: enabled,
        ack: false,
        reason: 'energy.pv_surplus',
      });
    }
  }

  const operations = mergeOperations([habitOps, energyOps]);
  const canExecute = mode === 'autonomous' || (mode === 'suggest' && input.execute === true);
  return {
    mode,
    matches: matches.map((match) => ({
      id: match.profile.id,
      name: match.profile.name,
      kind: match.profile.kind,
      confidence: match.profile.confidence,
      score: match.score,
    })),
    operations,
    execute: canExecute && operations.length > 0 && input.preventExecute !== true,
  };
}

function shouldAutoPromote(status, currentMode) {
  if (currentMode === 'observe' && status.readyForSuggest) return 'suggest';
  return null;
}

module.exports = {
  describeTime,
  normalizeObservation,
  appendObservation,
  mineProfiles,
  matchHabits,
  findProfileByName,
  learningStatus,
  habitToOperations,
  parseSceneMap,
  defaultScenes,
  sceneToOperations,
  optimizePlan,
  inTimeWindow,
  sanitizeStates,
  valuesEqual,
  shouldAutoPromote,
};
