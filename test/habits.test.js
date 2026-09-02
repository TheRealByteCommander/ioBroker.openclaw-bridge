const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeObservation,
  appendObservation,
  mineProfiles,
  matchHabits,
  findProfileByName,
  learningStatus,
  habitToOperations,
  optimizePlan,
  sceneToOperations,
  defaultScenes,
  shouldAutoPromote,
  inTimeWindow,
} = require('../lib/habits');

function localIso(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0).toISOString();
}

function bedtimeObservation(day, hour = 22, minute = 10) {
  return normalizeObservation({
    ts: localIso(2026, 3, day, hour, minute),
    trigger: 'intent',
    context: { type: 'habit', name: 'bedtime' },
    states: {
      '0_userdata.0.light.livingroom': false,
      '0_userdata.0.hvac.livingRoom.targetTemperature': 18,
    },
  }, { slotMinutes: 30 });
}

test('normalizeObservation derives weekday slot metadata', () => {
  const obs = normalizeObservation({
    ts: localIso(2026, 3, 2, 22, 11),
    states: { '0_userdata.0.light.livingroom': false },
  }, { slotMinutes: 30 });

  assert.equal(obs.hour, 22);
  assert.equal(obs.timeSlot, '22:00-22:29');
  assert.equal(obs.weekdayType, 'weekday');
});

test('appendObservation respects ring buffer limit', () => {
  const history = appendObservation([{ id: 1 }, { id: 2 }], { id: 3 }, 2);
  assert.deepEqual(history.map((row) => row.id), [2, 3]);
});

test('mineProfiles builds named bedtime and temporal clusters', () => {
  const observations = [1, 2, 3, 4, 5, 8, 9].map((day) => bedtimeObservation(day));
  const profiles = mineProfiles(observations, {
    minObservations: 7,
    minDays: 3,
    minConfidence: 0.65,
    matchSlackMinutes: 30,
  });

  const named = findProfileByName(profiles, 'bedtime');
  assert.ok(named);
  assert.equal(named.kind, 'named');
  assert.equal(named.ready, true);
  assert.equal(named.targets['0_userdata.0.light.livingroom'].value, false);
  assert.equal(named.targets['0_userdata.0.hvac.livingRoom.targetTemperature'].value, 18);
  assert.ok(named.confidence >= 0.65);
});

test('matchHabits selects ready profiles inside the time window', () => {
  const observations = [1, 2, 3, 4, 5, 8, 9].map((day) => bedtimeObservation(day));
  const profiles = mineProfiles(observations, { minObservations: 7, minDays: 3, minConfidence: 0.6 });
  const matches = matchHabits(profiles, { now: localIso(2026, 3, 10, 22, 15) }, { readyOnly: true });
  assert.ok(matches.length >= 1);
  assert.equal(matches.some((row) => row.profile.name === 'bedtime'), true);
});

test('habitToOperations skips already matching snapshot values', () => {
  const profile = {
    name: 'bedtime',
    targets: {
      '0_userdata.0.light.livingroom': { value: false, support: 7, consistency: 1 },
      '0_userdata.0.hvac.livingRoom.targetTemperature': { value: 18, support: 7, consistency: 1 },
    },
  };
  const operations = habitToOperations(profile, {
    '0_userdata.0.light.livingroom': { val: false },
    '0_userdata.0.hvac.livingRoom.targetTemperature': { val: 21 },
  });
  assert.equal(operations.length, 1);
  assert.equal(operations[0].id, '0_userdata.0.hvac.livingRoom.targetTemperature');
  assert.equal(operations[0].value, 18);
});

test('optimizePlan stays dry-run in observe mode and can execute in autonomous', () => {
  const profile = {
    id: 'named:bedtime',
    name: 'bedtime',
    kind: 'named',
    weekdayType: 'any',
    ready: true,
    confidence: 0.9,
    timeWindow: { startHour: 21, startMinute: 0, endHour: 23, endMinute: 0 },
    targets: {
      '0_userdata.0.light.livingroom': { value: false, support: 7, consistency: 1 },
    },
  };

  const observed = optimizePlan({
    profiles: [profile],
    snapshot: { '0_userdata.0.light.livingroom': { val: true } },
    now: localIso(2026, 3, 10, 22, 0),
    mode: 'observe',
  });
  assert.equal(observed.execute, false);
  assert.equal(observed.operations.length, 1);

  const autonomous = optimizePlan({
    profiles: [profile],
    snapshot: { '0_userdata.0.light.livingroom': { val: true } },
    now: localIso(2026, 3, 10, 22, 0),
    mode: 'autonomous',
  });
  assert.equal(autonomous.execute, true);
});

test('optimizePlan overlays PV surplus without dropping habit operations', () => {
  const profile = {
    id: 'named:morning',
    name: 'morning',
    kind: 'named',
    weekdayType: 'any',
    ready: true,
    confidence: 0.9,
    timeWindow: { startHour: 7, startMinute: 0, endHour: 9, endMinute: 0 },
    targets: {
      '0_userdata.0.light.livingroom': { value: true, support: 7, consistency: 1 },
    },
  };

  const plan = optimizePlan({
    profiles: [profile],
    snapshot: {
      '0_userdata.0.light.livingroom': { val: false },
      '0_userdata.0.energy.pvSurplusMode': { val: false },
    },
    now: localIso(2026, 3, 10, 8, 0),
    mode: 'suggest',
    watts: 2000,
    pvSurplusLoadStateId: '0_userdata.0.energy.pvSurplusMode',
    pvSurplusMinWatts: 1500,
  });

  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations.some((op) => op.id === '0_userdata.0.energy.pvSurplusMode' && op.value === true), true);
});

test('learningStatus reports progress and auto-promote candidate', () => {
  const observations = [1, 2, 3, 4, 5, 8, 9].map((day) => bedtimeObservation(day));
  const profiles = mineProfiles(observations, { minObservations: 7, minDays: 3, minConfidence: 0.6 });
  const status = learningStatus(profiles, observations, { minObservations: 7, minDays: 3, minConfidence: 0.6 });
  assert.equal(status.readyForSuggest, true);
  assert.equal(status.readyForAutonomy, true);
  assert.equal(shouldAutoPromote(status, 'observe'), 'suggest');
  assert.equal(shouldAutoPromote(status, 'suggest'), null);
});

test('scene templates cover bedtime and presence', () => {
  const scenes = defaultScenes({
    lightStateId: '0_userdata.0.light.livingroom',
    temperatureStateId: '0_userdata.0.hvac.livingRoom.targetTemperature',
    bedtimeTemperature: 18,
    morningTemperature: 21,
  });
  const bedtime = sceneToOperations('bedtime', scenes);
  assert.equal(bedtime.length, 2);
  assert.equal(bedtime[0].value, false);
});

test('inTimeWindow supports overnight ranges', () => {
  assert.equal(inTimeWindow(23, 30, { startHour: 22, startMinute: 0, endHour: 1, endMinute: 0 }), true);
  assert.equal(inTimeWindow(0, 30, { startHour: 22, startMinute: 0, endHour: 1, endMinute: 0 }), true);
  assert.equal(inTimeWindow(12, 0, { startHour: 22, startMinute: 0, endHour: 1, endMinute: 0 }), false);
});
