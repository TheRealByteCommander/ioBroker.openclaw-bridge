# Changelog

Alle nennenswerten Änderungen an `iobroker.openclaw-bridge`.

## 0.12.1 — 2026-09-05

Ausführliche Operator-Anleitung liegt **im Adapter**: Tab **Anleitung**, `admin/ANLEITUNG.html`, `docs/de/ANLEITUNG.md` (ioBroker `common.docs`). Enthält Installation, Tests ohne OpenClaw, simple-api :8087 und OpenClaw-Skill.

## 0.12.0 — 2026-09-02

Erstes gebündeltes Release nach 0.8.0: Gewohnheitslernen, Admin-UI, Objekt-Regeln und Operating Envelope.

### Rahmenbedingungen (Envelope)

- Regeln, Schwellwerte und Einschaltdauer sind der **Spielraum** für OpenClaw, nicht nur ein nachträglicher Riegel.
- Neu: `getConstraints` (aktuelle Grenzen, was jetzt erlaubt ist) und `planWithinBounds` (Plan in `allowed` / `blocked` teilen).
- `optimizeHome`, `applyHabit` und `handleIntent` führen nur Operationen **innerhalb** der Grenzen aus.
- Blockierte Writes liefern Handlungs-Hints (`wait_for_threshold`, `satisfy_any`, Ventil öffnen, auf PV warten).

### Dokumentation

- README, Doku-Index, Action-Referenz, Native-Feldliste, Agent-Vertrag und Operator-Guides auf den Release-Stand 0.12.0 gezogen.
- Drift-Test: Actions und Native-Keys müssen in der Doku vorkommen.

### Schwellwerte und PV-Lasten (0.11.0)

- Zahlen-Schwellwerte je Objektregel (z. B. Poolheizung erst ab ≥ 4000 W).
- Tabelle **PV-Überschuss-Lasten** mit Ein-ab-Watt und Hysterese (Aus unter Watt).

### Objekt-Regeln (0.10.0)

- AND / OR / XOR-Bedingungen pro Zielobjekt (z. B. Brunnenpumpe nur bei offenem Ventil).
- Maximale Einschaltdauer und Mindest-Auszeit (z. B. Steckdose max. 1 h).
- Prefix-Expansion und optionale JSON-Vergleiche.

### Admin-UI und Lernen (0.9.x)

- Typische ioBroker-Einstellungsseite (`jsonConfig`) für alle Native-Optionen.
- Gewohnheitslernen: `observe` → `suggest` → `autonomous`.
- Nach der Lernphase: `optimizeHome` steuert gelernte Zielzustände, inkl. PV-Overlay.

## 0.8.0

- Alexa `speak`, lokale STT `transcribe` und `voiceCommand` mit Guardrails.

## 0.6.0

- `batchSetStates`, `syncSnapshot`, Telemetrie, Retry/Backoff, Queue-High-Watermark.

## 0.5.0

- `help`-Action, `nextAction`-Fehlerhinweise, Setup-/Troubleshooting-Dokumentation.

## 0.4.0

- `validatePlan` Dry-Run und begrenzte Kontext-Event-Historie (`getContextEvents`).

## 0.3.0

- Conversational Intent-Handling, Kontext-Events, Bestätigung für kritische Aktionen, PV-Überschuss-Trigger.

## 0.2.0

- Request-Korrelation, strukturierte Fehler, Action-Whitelist, ACL, Timeouts, Audit-Metriken, `getStates`.

## 0.1.0

- MVP-Bridge: JSON-Commands von OpenClaw nach ioBroker States.
