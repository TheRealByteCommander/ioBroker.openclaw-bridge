# Changelog

Alle nennenswerten Änderungen an `iobroker.openclaw-bridge`.

## 0.13.2 — 2026-11-23

Chat-Test mit OpenClaw 2026.3.2 und lokalem Modell (Ollama `qwen3:8b`):

- Schreibende Aktionen lehnen IDs ohne State-Objekt mit `EIDUNKNOWN` (Hint `use_listStates` mit Suchbegriff) und schreibgeschützte States mit `EREADONLY` ab. Vorher legte ioBroker bei einer vom Agenten geratenen ID einen objektlosen Phantom-State an und die Bridge meldete Erfolg. Neue Option `requireExistingStates` (Standard an).
- `executePlan` prüft alle Operationen vor dem ersten Schreiben; ein Plan mit einer ungültigen ID schreibt nichts mehr.
- OpenClaw-Plugin/Skill: Ergebnisse beginnen mit `ERFOLG`, `ERGEBNIS … blockiert` oder `FEHLER`. Bei Schreibaktionen erklärt ein Hinweis, dass `ack: false` kein Fehler ist (kleine Modelle hatten das als Fehlschlag gemeldet).
- Tool-Beschreibungen und SKILL.md: IDs nie raten, sondern per `listStates` ermitteln.

## 0.13.1 — 2026-11-23

Ergebnisse des Praxistests (ioBroker js-controller 7.2.5 in Docker, OpenClaw 2026.3.2), Details in [docs/ROADMAP_1.0.md](docs/ROADMAP_1.0.md):

- OpenClaw-Plugin: kein Import von `openclaw/plugin-sdk/plugin-entry` mehr (fehlt in 2026.3.x); einfacher Default-Export mit `register(api)`.
- OpenClaw-Plugin: `baseUrl` ist im Config-Schema nicht mehr Pflicht. `openclaw plugins install` legt den Eintrag zuerst leer an und scheiterte daran.
- Paketname des Plugins passt zur Manifest-ID (keine „id mismatch“-Warnung).
- Doku: Plugin-Tools über `tools.alsoAllow` freigeben. Mit gesetztem `tools.profile` ignoriert OpenClaw eine reine Plugin-`allow`-Liste. Die Skill braucht das Tool `exec`.
- Beispieladressen in Kommentaren neutralisiert.

## 0.13.0 — 2026-11-23

**OpenClaw-Schnittstelle**

- REST-API `/api/v1` (Bearer-Token): `health`, `tools`, `constraints`, `command`, `actions/<action>`, `events` (Server-Sent Events). Antwort synchron, kein Polling mehr.
- Ereignis-Push an das OpenClaw-Gateway (`/hooks/agent` oder `/hooks/wake`): gesperrte Regeln, Auto-Aus nach Maximaldauer, offene/entschiedene Bestätigungen, Moduswechsel, beobachtete States. Gedrosselt je Ereignis.
- `sendTo`-Schnittstelle (`command`, `confirm`, `reject`, `tools`) und Testknöpfe im neuen Admin-Tab **OpenClaw**.
- Tool-Katalog mit JSON-Schema (`describeTools`, `GET /api/v1/tools`; Formate raw/openai/anthropic) als einzige Quelle für Validierung und Agent-Tools.
- Im Repo: OpenClaw-Skill (`openclaw/skill/iobroker-bridge`, CLI ohne Abhängigkeiten) und OpenClaw-Plugin (`openclaw/plugin`, 13 Tools, Schreib-Tools optional).
- `listStates` mit `prefix`, `search`, `withMeta`, `limit` für die Geräteerkennung.

**Sicherheit und Korrektheit**

- Commands laufen strikt seriell. Zwei gleichzeitige Commands können eine Regel nicht mehr gemeinsam umgehen.
- Timeout bricht die restlichen Writes eines Plans ab.
- Idempotenz: wiederholte `requestId` bzw. `Idempotency-Key` führt nicht doppelt aus.
- `authToken` (verschlüsselt) für alle Transportwege; REST-API startet auf öffentlicher Adresse nur mit Token.
- `confirmationMode = human`: Der Agent kann kritische Writes nicht selbst bestätigen; Freigabe über `safety.confirm`.
- `transcribe`/`voiceCommand` lesen nur Dateien in `sttAudioDir`.
- `responses.<requestId>` werden nach `responseRetentionMinutes` gelöscht; HTTP/sendTo legen keine an.
- `info.connection` zeigt, ob der Agent aktiv ist.

**Code-Qualität**

- `lib/bridge.js` aufgeteilt (`config`, `errors`, `util`, `queue`, `catalog`, `confirmations`, `notifier`, `httpServer`, `actions/`). Payload-Validierung je Action.
- ESLint, GitHub-Actions-Workflow (Node 20/22), `package-lock.json`, `engines`, `files`.
- 112 Tests (vorher 73), inkl. End-to-End Plugin → HTTP → Bridge.

## 0.12.5 — 2026-09-05

- Admin-Update-Hinweis: eine **neuere** Version im Repository bleibt stehen (Update sichtbar). Nur älterer Cache (z. B. 0.9.0) wird auf die installierte Version gezogen.

## 0.12.4 — 2026-09-05

- **Verfügbare Version 0.9.0:** Admin liest „verfügbar“ aus `system.repositories`, nicht aus dem GitHub-Paket. Der Adapter ist nicht im offiziellen ioBroker-Repo und nicht auf npm — ein alter Cache-Eintrag 0.9.0 bleibt stehen. Beim Start wird dieser Eintrag auf die installierte Version gesetzt. Zusätzlich liegt `sources-dist.json` im Repo (eigenes Admin-Repository).

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
