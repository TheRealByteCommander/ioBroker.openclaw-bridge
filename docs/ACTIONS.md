# Actions — openclaw-bridge 0.13.0

Transportwege:

| Weg | Request | Antwort |
|---|---|---|
| REST-API (empfohlen) | `POST /api/v1/command` mit `{ "action": … }` oder `POST /api/v1/actions/<action>` | direkt im HTTP-Body |
| `sendTo` | `sendTo('openclaw-bridge.0', 'command', { action: … })` | Callback |
| State | JSON nach `control.command` | `responses.<requestId>` und `control.lastResult` |

Gemeinsame Felder: `requestId` (optional; gleiche ID innerhalb `idempotencyTtlMinutes` liefert die gespeicherte Antwort mit `replayed: true`), `token` (bei gesetztem `authToken`, nicht bei HTTP mit Bearer-Header). Pflichtfelder und Typen werden geprüft; Fehler `EBADREQUEST` enthält `details.problems` und `details.schema`.

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

`listStates` listet States unter `allowedPrefixes`. Optionen: `prefix`, `search` (ID und Name), `withMeta` (Name, Rolle, Typ, Einheit, Schreibbarkeit), `limit` (Default 500). Antwort mit `count`, `total`, `truncated`. IDs außerhalb der ACL: `EIDFORBIDDEN`. Schreibende Aktionen lehnen IDs ohne State-Objekt mit `EIDUNKNOWN` und schreibgeschützte States mit `EREADONLY` ab (`requireExistingStates`); ein Plan mit einer solchen ID schreibt gar nichts.

```json
{ "action": "listStates", "prefix": "shelly.0", "search": "pumpe", "withMeta": true, "limit": 20 }
```

### `describeTools`

```json
{ "action": "describeTools", "format": "anthropic" }
```

Katalog aller erlaubten Actions mit JSON-Schema-Parametern. `format`: `raw` (Default), `openai`, `anthropic`. Gleicher Inhalt wie `GET /api/v1/tools`.

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

## Bestätigungen

Kritische Writes (`criticalStatePrefixes`, `op.critical: true`) brauchen eine Bestätigung.

- `confirmationMode = agent`: `confirmation: true` im Request (bisheriges Verhalten).
- `confirmationMode = human`: `confirmation: true` des Agenten zählt nicht. Die Bridge legt eine offene Bestätigung an, antwortet mit `ECONFIRMPENDING` und `details.confirmationId`, pusht `confirmation_pending` an OpenClaw. Ein Mensch schreibt die ID nach `safety.confirm` (freigeben) oder `safety.reject` (ablehnen) — aus VIS, einem Telegram-Skript oder Admin. Writes aus `confirmationDenySources` (simple-api, rest-api) werden ignoriert. Bei Freigabe werden die Regeln erneut geprüft.

### `getPendingConfirmations`

```json
{ "action": "getPendingConfirmations" }
```

### `cancelConfirmation`

```json
{ "action": "cancelConfirmation", "confirmationId": "a1b2c3d4" }
```

Zieht eine eigene offene Anfrage zurück. Freigeben kann der Agent nicht.

## Fehlercodes (Auswahl)

| Code | Bedeutung | `nextAction` |
|---|---|---|
| `EUNAUTHORIZED` | Token fehlt/falsch | `send_valid_token` |
| `EBADREQUEST` | Pflichtfeld/Typ falsch | `fix_request_payload` |
| `ETIMEOUT` | Zeit überschritten, restliche Writes übersprungen | `check_adapter_latency_or_raise_timeout` |
| `EQUEUEFULL` | Zu viele wartende Commands | `retry_later` |
| `ECONFIRMPENDING` | Operator muss freigeben | `wait_for_human_confirmation_then_check_getPendingConfirmations` |
| `EAUDIOPATH` | Audiodatei außerhalb `sttAudioDir` | `place_audio_in_configured_sttAudioDir` |
