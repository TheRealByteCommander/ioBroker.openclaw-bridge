# Changelog

Alle nennenswerten Änderungen an `iobroker.openclaw-bridge`.

## 0.12.3 — 2026-09-05

- **Steuerkanal fehlt nach Upgrade:** `io-package.json` hatte die API-States unter `objects` statt `instanceObjects`. js-controller legt sie dann nicht unter `openclaw-bridge.0.*` an. `ensureRuntimeStates()` erzeugte nur `habits.*` / `guards` / `safety.lastGuardBlock`.
- Beim Start werden jetzt alle Instanz-Objekte angelegt, inkl. `control.command` (schreibbar), `control.lastResult`, `responses`, `info.*`. Restart allein ohne dieses Update reicht nicht.

## 0.12.2 — 2026-09-05

- **Anleitung in der Instanz:** Tab **Anleitung** zeigt die Handbuchseite (`ANLEITUNG.html` im iframe) plus denselben Inhalt als Text. Kein separates Browser-URL-Rätsel mehr. Admin-Doku liegt zusätzlich unter `admin/docs/`.
- **Verfügbare Version:** `common.news` enthält nur noch 0.10.0–0.12.2. Keys wie `0.9.0` sortieren als String *über* `0.12.x`, deshalb zeigte Admin „verfügbar 0.9.0“.

## 0.12.1 — 2026-09-05

Ausführliche Operator-Anleitung liegt **im Adapter**: Tab **Anleitung**, `admin/ANLEITUNG.html`, `docs/de/ANLEITUNG.md` (ioBroker `common.docs`). Enthält Installation, Tests ohne OpenClaw, simple-api :8087 und OpenClaw-Skill. `common.news` ist semver-absteigend (0.12.1 … 0.1.0), damit Admin nicht 0.9.0 als „verfügbar“ anzeigt.

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
