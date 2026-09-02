# Conversational Home Automation Architecture (OpenClaw ↔ ioBroker)

Stand: Adapter **0.12.0**. Operator-Einstieg: [../README.md](../README.md). Agent-Vertrag: [OPENCLAW_AGENT.md](OPENCLAW_AGENT.md).

## Zielbild

Die Bridge ist eine sichere Übersetzungsschicht zwischen natürlicher Sprache (OpenClaw) und deterministischen ioBroker-Writes. Der Operator setzt die **Rahmenbedingungen**; der Agent plant und steuert nur in diesem Korridor.

## Komponenten

1. **OpenClaw** — Dialog, Intents, periodische Optimierung
2. **openclaw-bridge** — JSON-Commands, ACL, Guards, Envelope, Habit-Mining
3. **ioBroker** — States, bestehende Adapter (Zigbee, Shelly, Alexa, …)

```text
User-Sprache
    → OpenClaw
        → control.command (JSON)
            → BridgeRuntime
                → Prefix-ACL / Action-Whitelist
                → Confirmation (kritische Prefixe)
                → Guards (AND/OR/XOR, Schwellwert, max-on)
                → allowed Writes
            → ioBroker States
        ← responses.<requestId> + hint bei Sperre
```

## Datenflüsse

### A) Lesen / Schreiben

`getState`, `getStates`, `listStates`, `setState`, `batchSetStates`, `syncSnapshot` — hart begrenzt durch `allowedPrefixes`.

### B) Conversational Intent

`handleIntent` erzeugt einen Plan (`operations[]`, `contextEvents[]`) und splittet ihn über die Envelope. `execute: true` schreibt nur `allowed`. Gelernte Habit-Ziele ersetzen Szenen-Templates, sobald genug Beobachtungen da sind.

### C) Safety-Gate

Jede Write-Operation durchläuft:

1. erlaubter Prefix?
2. kritisches Prefix → `confirmation: true` sonst `ECONFIRMREQUIRED` / `safety.pendingConfirmation`
3. Objekt-Regeln (AND/OR/XOR, Schwellwert, Dauer) → sonst `EGUARDFAILED` / `ETHRESHOLD` / `EDURATIONLIMIT` / `ECOOLDOWN` plus `hint`
4. Ack-Policy

`validatePlan` und `checkGuards` sind Dry-Runs desselben Pfads.

### D) Rahmenbedingungen (Envelope)

- `getConstraints` — aktuelle Envelope, `currentlyAllowsTurnOn`, PV-Lasten
- `planWithinBounds` — `allowed` / `blocked` + Handlungs-Hints
- `optimizeHome` / `applyHabit` / `handleIntent` führen ausschließlich `allowed` aus

Der Agent bekommt z. B. `wait_for_threshold` (Poolheizung, Defizit in Watt) oder `satisfy_any` plus `companions` (Ventil öffnen).

### E) PV-Überschuss

- Tabelle `surplusLoads`: Ein ab Watt, Aus unter Watt (Hysterese)
- `handlePvSurplus` / `optimizeHome` schalten diese Lasten
- Leere Tabelle: Fallback `pvSurplusLoadStateId` + `pvSurplusMinWatts`
- Ist-Leistung: Payload `watts` oder State `pvPowerStateId`
- Schwellwert-Regeln blockieren manuelles Einschalten unter der Grenze unabhängig vom Surplus-Scheduler

### F) Habit Learning

1. **Observe:** `recordObservation`, Command-Writes, optionale `habitWatchPrefixes`
2. **Mine:** zeitliche Cluster und benannte Habits (`bedtime`, `morning`, `arrive_home`, …)
3. **Gate:** `observe` → `suggest` (optional auto) → `autonomous` nur mit Confirmation und Schwellen
4. **Act:** `optimizeHome` schreibt gelernte Ziele, PV-Overlay, Cooldown gegen manuelle Overrides — immer Envelope-gefiltert

## Intent-Beispiele

### Komfort

- User: „Mir ist kalt.“
- Bridge: `comfortTemperatureStateId + comfortTempStep`, Event `user_feels_cold`

### Interlock

- User: „Brunnenpumpe an.“
- Ohne offenes Ventil: `blocked` / `EGUARDFAILED`, Hint `satisfy_any` mit Companion-Ventil
- Ventil und Pumpe im selben Plan: Reihenfolge wird so sortiert, dass die Bedingung zuerst wahr wird

### PV

- 1200 W: Poolheizung bleibt aus (`wait_for_threshold`, `deficit`)
- 4100 W: `handlePvSurplus` / `optimizeHome` dürfen die Last einschalten, sofern keine andere Regel greift

### Kritisch

- Ziel unter `system.` / `admin.0`: `ECONFIRMREQUIRED`, OpenClaw fragt nach

## Response-Modell

- `ok`, `requestId`, `action`
- `data` oder `error` (`code`, `message`, `details`, `nextAction`, `hint`)
- `durationMs`

## Betriebsreife

- Korrelierte Antworten, Timeouts, Retry/Backoff, Queue-High-Watermark
- Audit `info.*`, Telemetrie-Action `getTelemetry`
- Policy über Native/jsonConfig, nicht über Code-Änderungen
- Tests: ACL, Intents, Habits, Guards, Schwellwerte, Envelope (`npm test`)

## Roadmap (nicht in 0.12.0)

- Rollen-/Benutzer-Freigaben
- 2-Faktor Confirmation Tokens
- Zeitfenster-Policies (z. B. nachts keine lauten Geräte)
- Persistente Telemetrie über Adapter-Neustart
