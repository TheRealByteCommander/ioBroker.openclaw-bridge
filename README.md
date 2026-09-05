# ioBroker OpenClaw Bridge

**Version 0.12.4** — JSON-Bridge zwischen OpenClaw und ioBroker. OpenClaw lernt Gewohnheiten und steuert die Hausautomation **nur innerhalb der vom Operator gesetzten Rahmenbedingungen**.

GitHub-Installation zeigt in Admin oft **verfügbar 0.9.0** (Repo-Cache, Adapter ist nicht im offiziellen Store). Nach 0.12.4 überschreibt die Instanz diesen Cache beim Start. Optional eigenes Repo: [sources-dist.json](sources-dist.json).

**Anleitung im Adapter:** Instanz öffnen → Tab **Anleitung** (iframe + Volltext). Zusätzlich `/adapter/openclaw-bridge/ANLEITUNG.html` und [docs/de/ANLEITUNG.md](docs/de/ANLEITUNG.md).

Release: [v0.12.1](https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge/releases/tag/v0.12.1) · Changelog: [CHANGELOG.md](CHANGELOG.md) · Doku-Index: [docs/README.md](docs/README.md)

## Was der Adapter tut

1. OpenClaw schreibt JSON-Commands nach `control.command`.
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
| Basis | `ping`, `help`, `getState`, `getStates`, `listStates`, `setState` |
| Pläne | `handleIntent`, `validatePlan`, `executePlan`, `batchSetStates` |
| Envelope | `getConstraints`, `planWithinBounds`, `checkGuards` |
| Lernen | `recordObservation`, `getHabits`, `getLearningStatus`, `setHabitMode`, `evaluateHabits`, `suggestAutomation`, `applyHabit`, `optimizeHome` |
| Energie | `handlePvSurplus` |
| Kontext | `emitContextEvent`, `getContextEvents` |
| Sync / Telemetrie | `syncSnapshot`, `getTelemetry` |
| Sprache | `speak`, `transcribe`, `voiceCommand` |

## Kommunikations-States

| State | Richtung | Zweck |
|---|---|---|
| `control.command` | write | JSON-Request |
| `control.lastResult` | read | letzte Response |
| `responses.<requestId>` | read | korrelierte Response |
| `intents.lastPlan` | read | letzter Intent-Plan |
| `events.context.last` / `events.context.history` | read | Kontext-Events |
| `safety.pendingConfirmation` | read | kritische Aktion wartet auf `confirmation: true` |
| `safety.lastGuardBlock` | read | letzte Regel-Sperre |
| `guards.runtime` | read | Ein-/Aus-Zeitstempel für Dauerregeln |
| `habits.mode` / `habits.learningStatus` / `habits.profiles` | read | Lernphase |
| `info.*` | read | Audit (Counts, Queue, Dauer, Fehler) |

## Admin-Einstellungsseite

Alle Native-Optionen liegen in `admin/jsonConfig.json` und sind in der Instanz konfigurierbar:

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

Häufig: `EACTIONFORBIDDEN`, `EIDFORBIDDEN`, `ECONFIRMREQUIRED`, `EGUARDFAILED`, `ETHRESHOLD`, `EDURATIONLIMIT`, `ECOOLDOWN`, `ENOTREADY`, `EQUEUEFULL`.

Operator-Hilfe: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Stack

- Node.js (CommonJS), `@iobroker/adapter-core`, `node --test`
- `main.js` — Adapter-Lifecycle
- `lib/bridge.js` — Command-Runtime, ACL, Envelope, Intents
- `lib/habits.js` — Beobachtungen, Profile, Optimization
- `lib/guards.js` — Regeln, Schwellwerte, PV-Lasten, Hints

```bash
npm test
```

## OpenClaw-Tooling

```json
{
  "tool": "iobroker_bridge_command",
  "input": {
    "requestId": "uuid",
    "action": "getConstraints"
  }
}
```

Pflichttools für den Agenten: `getConstraints`, `planWithinBounds`, `recordObservation`, `getLearningStatus`, `optimizeHome`, `handleIntent`.
