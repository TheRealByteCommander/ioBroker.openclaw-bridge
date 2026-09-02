# Actions — openclaw-bridge 0.12.0

JSON nach `control.command`. Antwort unter `responses.<requestId>` und `control.lastResult`.

Jede Action muss in `allowedActions` stehen. Default-Whitelist = alle hier gelisteten Actions.

## Basis

### `ping`

```json
{ "action": "ping" }
```

Liefert `pong`, `ts`, `uptimeMs`, `version`, `habitMode`.

### `help`

```json
{ "action": "help" }
```

Liefert erlaubte Actions, Safety, Envelope-Prinzip, Phasen, `quickStart`.

### `getState` / `getStates` / `listStates`

```json
{ "action": "getState", "id": "0_userdata.0.light.livingroom" }
```

```json
{ "action": "getStates", "ids": ["0_userdata.0.light.livingroom"] }
```

```json
{ "action": "listStates" }
```

`listStates` listet States unter `allowedPrefixes`. IDs außerhalb der ACL: `EIDFORBIDDEN`.

### `setState`

```json
{ "action": "setState", "id": "0_userdata.0.light.livingroom", "value": true }
```

Läuft intern über denselben Guard-/Envelope-Pfad wie `executePlan`. Bei Sperre: `error.hint`.

`ack: true` nur wenn `setStateAckAllowed`. Sonst `EACKFORBIDDEN`.

## Pläne

### `handleIntent`

```json
{
  "action": "handleIntent",
  "text": "mir ist kalt",
  "currentTargetTemp": 21,
  "execute": false
}
```

Erkennt u. a. *mir ist kalt/heiß*, *gute Nacht*, *guten Morgen*, *ich bin da*, *ich gehe weg*, *Licht an/aus*. Gelernte Habit-Ziele ersetzen Szenen-Templates. Mit `execute: true` nur `allowed` aus der Envelope.

### `validatePlan`

Dry-Run: ACL, kritisch, Confirmation, Guards. Pro Operation `executable`, `guard`, `error` (inkl. `hint`).

```json
{
  "action": "validatePlan",
  "operations": [
    { "type": "setState", "id": "0_userdata.0.pump.well", "value": true }
  ]
}
```

### `executePlan`

```json
{
  "action": "executePlan",
  "confirmation": true,
  "operations": [
    { "type": "setState", "id": "0_userdata.0.valve.bed1", "value": true },
    { "type": "setState", "id": "0_userdata.0.pump.well", "value": true }
  ]
}
```

Bedingungen (Ventile) werden vor dem geschützten Objekt geschaltet. Kritische IDs brauchen `confirmation: true` (`ECONFIRMREQUIRED`).

### `batchSetStates`

Wie `executePlan`, begrenzt durch `maxBatchOperations` (`EBATCHLIMIT`).

## Envelope

### `getConstraints`

```json
{ "action": "getConstraints", "watts": 1200 }
```

`data.role = operating_envelope`. Optional `watts` oder State `pvPowerStateId`.

### `planWithinBounds`

```json
{
  "action": "planWithinBounds",
  "watts": 1200,
  "operations": [
    { "type": "setState", "id": "0_userdata.0.pool.heater", "value": true }
  ]
}
```

Kurzform: `id` + `value` statt `operations`. Ergebnis: `withinBounds`, `allowed`, `blocked[].hint`.

### `checkGuards`

Dry-Run nur für Objekt-Regeln (wie `validatePlan` mit Guards). `watts` overlayt den PV-State.

```json
{ "action": "checkGuards", "id": "0_userdata.0.pool.heater", "value": true, "watts": 1200 }
```

## Lernen und Optimierung

### `recordObservation`

```json
{
  "action": "recordObservation",
  "trigger": "snapshot",
  "context": { "type": "habit", "name": "bedtime" },
  "states": {
    "0_userdata.0.light.livingroom": false,
    "0_userdata.0.hvac.livingRoom.targetTemperature": 18
  }
}
```

Alternativ `ids` + Live-Snapshot. Command-Writes können automatisch mitlernen (`habitLearnFromCommands`).

### `getHabits` / `evaluateHabits` / `getLearningStatus`

```json
{ "action": "getHabits" }
```

```json
{ "action": "evaluateHabits" }
```

```json
{ "action": "getLearningStatus" }
```

Status enthält Zähler, Konfidenz, `readyForSuggest`, `readyForAutonomy`.

### `setHabitMode`

```json
{ "action": "setHabitMode", "mode": "autonomous", "confirmation": true }
```

`mode`: `observe` | `suggest` | `autonomous`. Autonomie ohne Reife: `ENOTREADY`. Unbekanntes Mode: `EMODEFORBIDDEN`. Habit nicht gefunden: `EHABITNOTFOUND`.

### `suggestAutomation`

Dry-Run von `optimizeHome` (`execute: false`), schreibt `habits.lastSuggestion`.

### `applyHabit`

```json
{ "action": "applyHabit", "name": "bedtime", "execute": true, "confirmation": true }
```

Führt nur Envelope-`allowed` aus. Fallback: Szenen-Templates aus `habitScenesJson` / Licht- und Temperatur-Defaults.

### `optimizeHome`

```json
{ "action": "optimizeHome", "watts": 1800, "confirmation": true }
```

Passt gelernte Profile plus PV-Lasten an. In `observe` keine Ausführung. Ergebnis enthält `operations` (allowed), `blocked`, `withinBounds`.

## Energie

### `handlePvSurplus`

```json
{ "action": "handlePvSurplus", "watts": 4100, "confirmation": true }
```

Schaltet die Tabelle **PV-Überschuss-Lasten** (`surplusLoads`) mit Hysterese. Ist die Tabelle leer, Fallback auf `pvSurplusLoadStateId` / `pvSurplusMinWatts`. `watts` optional, sonst State `pvPowerStateId`.

## Kontext

### `emitContextEvent` / `getContextEvents`

```json
{
  "action": "emitContextEvent",
  "event": { "type": "habit", "name": "arrived_home", "confidence": 0.88 }
}
```

```json
{ "action": "getContextEvents", "limit": 10 }
```

History begrenzt durch `contextEventHistoryLimit`.

## Sync, Telemetrie, Sprache

### `syncSnapshot`

Snapshot aller States unter `allowedPrefixes`.

### `getTelemetry`

`counts`, `queueDepth`, `avgDurationMs`, `uptimeMs`, `habitMode`.

### `speak` / `transcribe` / `voiceCommand`

Siehe [ALEXA_TTS_STT_INTEGRATION.md](ALEXA_TTS_STT_INTEGRATION.md).
