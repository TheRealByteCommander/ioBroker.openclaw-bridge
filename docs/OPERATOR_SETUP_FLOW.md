# Operator Setup Flow (ioBroker OpenClaw Bridge)

Stand: **0.12.0**. Feldliste: [CONFIGURATION.md](CONFIGURATION.md). Agent-Vertrag: [OPENCLAW_AGENT.md](OPENCLAW_AGENT.md).

## Ziel

Schneller, sicherer Start über die **ioBroker-Einstellungsseite** (Tabs), ohne Native-JSON von Hand zu editieren.

## 1) 5-Minuten-Setup

1. Adapter starten (`openclaw-bridge.0`).
2. Instanz öffnen:
   - **Sicherheit:** nur benötigte Prefixe und Actions.
   - **Regeln:** Interlocks und Schwellwerte (Pumpe/Ventil, Pool ab 4000 W, Steckdose max. 1 h).
   - **Geräte:** Komfort-Temperatur, `pvPowerStateId`, PV-Lasten-Tabelle.
   - **Gewohnheiten:** Mode `observe` lassen, bis genug Daten da sind.
   - **Sprache / Erweitert:** nur bei Bedarf.
3. Speichern, Instanz läuft.
4. Smoke-Commands nach `control.command`:

```json
{ "action": "ping" }
```

```json
{ "action": "help" }
```

```json
{ "action": "getConstraints" }
```

5. Lernen: `{ "action": "getLearningStatus" }` und Beobachtungen via `recordObservation` oder normale Writes.

## 2) Sichere Reihenfolge

1. `getConstraints` — was ist *jetzt* erlaubt?
2. `validatePlan` oder `planWithinBounds` — Dry-Run
3. `executePlan` / `handleIntent` mit `execute: true` nur für `allowed`
4. Kritische Prefixe immer mit `confirmation: true`

## 3) Fehlerszenario-Entscheidung

| Code | Nächster Schritt |
|---|---|
| `EACTIONFORBIDDEN` | Action korrigieren oder `allowedActions` |
| `EIDFORBIDDEN` | State-ID/Prefix |
| `ECONFIRMREQUIRED` | Mit `confirmation: true` erneut |
| `EGUARDFAILED` | Bedingungen erfüllen oder Companion aus `hint.companions` in denselben Plan |
| `ETHRESHOLD` | Warten (`hint.deficit`) oder Schwellwert prüfen |
| `EDURATIONLIMIT` | Ausschalten oder `Max. Ein` erhöhen |
| `ECOOLDOWN` | `Min. Aus` abwarten |
| `ENOTREADY` | Weiter beobachten, `getLearningStatus` |
| `EHABITNOTFOUND` | Namen aus `getHabits` oder Szene setzen |
| `EQUEUEFULL` | Später retry |
| `EBATCHLIMIT` | Batch verkleinern |
| `ETIMEOUT` | Last / `commandTimeoutMs` |

Vollständig: [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## 4) Operator-Kurzbefehle

- Readiness: `ping`
- Schema: `help`
- Envelope: `getConstraints`
- Dry-Run Regeln: `checkGuards` / `planWithinBounds`
- Dry-Run Plan: `validatePlan`
