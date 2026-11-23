# ioBroker OpenClaw Bridge

**Version 0.13.2** — JSON-Bridge zwischen OpenClaw und ioBroker. OpenClaw lernt Gewohnheiten und steuert die Hausautomation **nur innerhalb der vom Operator gesetzten Rahmenbedingungen**.

**Anleitung im Adapter:** Instanz öffnen → Tab **Anleitung** (iframe + Volltext). Zusätzlich `/adapter/openclaw-bridge/ANLEITUNG.html` und [docs/de/ANLEITUNG.md](docs/de/ANLEITUNG.md).

Release: [v0.13.0](https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge/releases/tag/v0.13.0) · Changelog: [CHANGELOG.md](CHANGELOG.md) · Doku-Index: [docs/README.md](docs/README.md)

## OpenClaw-Schnittstelle (neu in 0.13.0)

| Weg | Beschreibung |
|---|---|
| **REST-API** `:8097/api/v1` | Bearer-Token, synchrone Antwort, Tool-Katalog (`/tools`), Ereignis-Stream (`/events`) |
| **Plugin** [`openclaw/plugin`](openclaw/plugin) | 13 native OpenClaw-Tools `iobroker_*`; schreibende Tools optional |
| **Skill** [`openclaw/skill/iobroker-bridge`](openclaw/skill/iobroker-bridge) | SKILL.md + CLI ohne Abhängigkeiten |
| **Ereignis-Push** | Bridge → OpenClaw-Gateway `/hooks/agent`: gesperrte Regeln, Auto-Aus, offene Bestätigungen, beobachtete States |
| `sendTo` / `control.command` | für ioBroker-Skripte und den bisherigen Weg über simple-api |

Einrichtung Schritt für Schritt: [openclaw/README.md](openclaw/README.md).

Sicherheit: API-Token, strikt serielle Ausführung (Regeln können nicht durch parallele Commands umgangen werden), Abbruch restlicher Writes bei Timeout, idempotente `requestId`, optional **menschliche Bestätigung** (der Agent kann kritische Writes nicht selbst freigeben).

## Was der Adapter tut

1. OpenClaw sendet JSON-Commands (REST-API, `sendTo` oder `control.command`).
2. Die Bridge prüft ACL, Bestätigung, Objekt-Regeln, Schwellwerte und Einschaltdauer.
3. Erlaubte Writes gehen nach ioBroker. Alles außerhalb der Grenzen wird abgelehnt – mit einem **Hinweis**, wie der Agent innerhalb der Grenzen weitermachen kann (Ventil öffnen, auf PV warten).

Der Adapter ist die deterministische Ausführungsschicht. OpenClaw entscheidet *was* sinnvoll ist; die Bridge erzwingt *was erlaubt ist*.

## Schnellstart

1. Adapter installieren, Instanz `openclaw-bridge.0` öffnen.
2. Tabs **Sicherheit**, **Regeln**, **Geräte**, **Gewohnheiten**, **Sprache**, **Erweitert** setzen und speichern.
3. Smoke-Test:

```json
{ "action": "ping" }
```

```json
{ "action": "help" }
```

```json
{ "action": "getConstraints" }
```

Details: [docs/OPERATOR_SETUP_FLOW.md](docs/OPERATOR_SETUP_FLOW.md)

## Rahmenbedingungen (Operating Envelope)

Die Regeln im Tab **Regeln** sind der Spielraum, nicht nur ein Riegel hinterher. Der Agent darf darin intelligent steuern und optimieren, nicht darüber hinaus.

| Action | Rolle |
|---|---|
| `getConstraints` | Aktuelle Grenzen, Schwellwerte, was *jetzt* einschaltbar ist |
| `planWithinBounds` | Wunschplan in `allowed` / `blocked` teilen, inkl. Handlungs-Hints |
| `optimizeHome` / `applyHabit` / `handleIntent` | Führen nur `allowed` aus; Gesperrtes steht in `blocked[]` |

Beispiele:

- Brunnenpumpe nur, wenn mindestens ein Ventil offen ist (`OR`)
- Steckdose maximal 1 Stunde ein
- Poolheizung erst ab ≥ 4000 W PV-Überschuss

Agent-Vertrag und Beispiele: [docs/OPENCLAW_AGENT.md](docs/OPENCLAW_AGENT.md)

## Gewohnheitslernen

| Mode | Bedeutung |
|---|---|
| `observe` (Default) | Nur lernen, keine autonomen Writes |
| `suggest` | Vorschläge, Ausführung nur mit `execute: true` |
| `autonomous` | Nach Lernphase steuern und optimieren (braucht `confirmation: true` und erfüllte Schwellen) |

Typischer Loop: `recordObservation` → `getLearningStatus` → `setHabitMode` → `optimizeHome`. Mit `habitAutoPromote` wechselt der Adapter selbstständig nur bis `suggest`, nie nach `autonomous`.

## Actions (Überblick)

Vollständige Referenz: [docs/ACTIONS.md](docs/ACTIONS.md)

| Gruppe | Actions |
|---|---|
| Basis | `ping`, `help`, `describeTools`, `getState`, `getStates`, `listStates`, `setState` |
| Pläne | `handleIntent`, `validatePlan`, `executePlan`, `batchSetStates` |
| Envelope | `getConstraints`, `planWithinBounds`, `checkGuards` |
| Lernen | `recordObservation`, `getHabits`, `getLearningStatus`, `setHabitMode`, `evaluateHabits`, `suggestAutomation`, `applyHabit`, `optimizeHome` |
| Energie | `handlePvSurplus` |
| Kontext | `emitContextEvent`, `getContextEvents` |
| Sync / Telemetrie | `syncSnapshot`, `getTelemetry` |
| Sprache | `speak`, `transcribe`, `voiceCommand` |
| Bestätigung | `getPendingConfirmations`, `cancelConfirmation` |

## Kommunikations-States

| State | Richtung | Zweck |
|---|---|---|
| `control.command` | write | JSON-Request |
| `control.lastResult` | read | letzte Response |
| `responses.<requestId>` | read | korrelierte Response |
| `intents.lastPlan` | read | letzter Intent-Plan |
| `events.context.last` / `events.context.history` | read | Kontext-Events |
| `safety.pendingConfirmation(s)` | read | kritische Aktion wartet auf Bestätigung |
| `safety.confirm` / `safety.reject` | write | Operator gibt eine `confirmationId` frei bzw. lehnt ab |
| `info.connection` | read | Agent war innerhalb des Heartbeat-Fensters aktiv |
| `safety.lastGuardBlock` | read | letzte Regel-Sperre |
| `guards.runtime` | read | Ein-/Aus-Zeitstempel für Dauerregeln |
| `habits.mode` / `habits.learningStatus` / `habits.profiles` | read | Lernphase |
| `info.*` | read | Audit (Counts, Queue, Dauer, Fehler) |

## Admin-Einstellungsseite

Alle Native-Optionen liegen in `admin/jsonConfig.json` und sind in der Instanz konfigurierbar:

- **OpenClaw** — API-Token, REST-API, Webhook, Bestätigungsmodus, Aufräumen
- **Sicherheit** — Prefixe, Actions, Timeouts, kritische IDs
- **Regeln** — AND/OR/XOR, Schwellwerte, max. Ein, min. Aus
- **Geräte** — Komfort-Temperatur, PV-Leistung, Überschuss-Lasten
- **Gewohnheiten** — Mode, Schwellen, Szenen
- **Sprache** — Alexa TTS, lokale STT
- **Erweitert** — Retry, Batch-Limit, Queue

Feldliste: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

## Beispiel-Dialog

1. User: **„Mir ist kalt.“**
2. OpenClaw: `getConstraints`, dann `handleIntent` mit `text: "mir ist kalt"`.
3. Bridge plant `comfortTemperatureStateId + comfortTempStep` und prüft die Envelope.
4. Bei `execute: true` nur erlaubte Schritte; Response unter `responses.<requestId>`.

## Fehler

Jede Response hat `ok`, `requestId`, `action`, `data` oder `error` (`code`, `message`, `details`, `nextAction`, optional `hint`) und `durationMs`.

Häufig: `EUNAUTHORIZED`, `ECONFIRMPENDING`, `EACTIONFORBIDDEN`, `EIDFORBIDDEN`, `ECONFIRMREQUIRED`, `EGUARDFAILED`, `ETHRESHOLD`, `EDURATIONLIMIT`, `ECOOLDOWN`, `ENOTREADY`, `EQUEUEFULL`.

Operator-Hilfe: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Stack

- Node.js ≥ 20 (CommonJS), `@iobroker/adapter-core`, `node --test`, ESLint
- `main.js` — Adapter-Lifecycle, `sendTo`, HTTP-Server, Wartungstimer
- `lib/bridge.js` — Runtime: Pipeline (Queue, Timeout, Idempotenz, Auth), Envelope, Writes
- `lib/actions/` — Handler je Action
- `lib/catalog.js` — Action-Katalog mit JSON-Schema (Validierung, Tools)
- `lib/httpServer.js`, `lib/notifier.js` — REST-API, SSE, Webhook-Push
- `lib/queue.js`, `lib/confirmations.js`, `lib/config.js`, `lib/errors.js`, `lib/util.js`
- `lib/habits.js`, `lib/guards.js` — Lernen, Regeln, Schwellwerte, Hints
- `openclaw/` — Plugin und Skill für OpenClaw

```bash
npm run lint
npm test
```

## OpenClaw-Tooling

Plugin-Tools: `iobroker_constraints`, `iobroker_list_states`, `iobroker_get_states`, `iobroker_plan`, `iobroker_execute`, `iobroker_set_state`, `iobroker_intent`, `iobroker_optimize`, … – siehe [openclaw/README.md](openclaw/README.md). Den vollständigen Katalog als JSON-Schema liefert `GET /api/v1/tools`.

## English summary

ioBroker adapter that lets the OpenClaw AI agent control a home **only inside an operator-defined envelope** (state ACL, AND/OR/XOR interlocks, numeric thresholds, max-on durations, confirmations). OpenClaw connects via a token-protected REST API (`/api/v1`), a bundled OpenClaw plugin or skill, `sendTo`, or the `control.command` state. The bridge pushes events (blocked rules, auto-off, pending confirmations) to the OpenClaw gateway webhook. Commands run strictly serialized, are idempotent per `requestId`, and critical writes can require a human operator's approval. Setup: [openclaw/README.md](openclaw/README.md), handbook: [docs/en/HANDBOOK.md](docs/en/HANDBOOK.md).
