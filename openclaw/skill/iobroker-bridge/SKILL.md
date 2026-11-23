---
name: iobroker-bridge
description: Steuert das Smart Home (ioBroker) über die openclaw-bridge – Geräte finden, Zustände lesen, schalten, Gewohnheiten und PV-Überschuss nutzen. Immer nur innerhalb der vom Operator gesetzten Regeln.
homepage: https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge
metadata:
  {
    "openclaw":
      {
        "emoji": "🏠",
        "requires": { "bins": ["node"], "env": ["IOBROKER_BRIDGE_URL", "IOBROKER_BRIDGE_TOKEN"] },
        "primaryEnv": "IOBROKER_BRIDGE_TOKEN",
      },
  }
---

# ioBroker Bridge

Du steuerst ein echtes Haus. Die Bridge ist die deterministische Sicherheitsschicht: Sie erzwingt Zugriffsliste, Regeln (UND/ODER/XOR), Schwellwerte, maximale Einschaltdauer und Bestätigungen. Du entscheidest *was* sinnvoll ist, die Bridge entscheidet *was erlaubt ist*.

Wenn das Plugin `iobroker-bridge` aktiv ist, nutze dessen Tools (`iobroker_constraints`, `iobroker_plan`, `iobroker_execute`, …). Sonst rufe das Skript auf:

```bash
node {baseDir}/scripts/iobroker.mjs <action> '<json-params>'
```

Ausgabe: bei Erfolg JSON (`data`), bei Fehlern `FEHLER <code>` mit `nextAction` und `hint`. Exit-Code 0 = ok, 1 = von der Bridge abgelehnt, 2 = Verbindungs- oder Aufruffehler.

## Arbeitsweise (immer in dieser Reihenfolge)

1. **Grenzen lesen** – vor der ersten Schaltung in einer Unterhaltung:
   `node {baseDir}/scripts/iobroker.mjs getConstraints`
2. **Gerät finden**, wenn du die State-ID nicht sicher kennst – nie raten:
   `node {baseDir}/scripts/iobroker.mjs listStates '{"search":"pumpe","withMeta":true,"limit":20}'`
3. **Plan prüfen** (schreibt nichts):
   `node {baseDir}/scripts/iobroker.mjs planWithinBounds '{"operations":[{"type":"setState","id":"0_userdata.0.light.livingroom","value":true}]}'`
4. **Nur `allowed` ausführen**:
   `node {baseDir}/scripts/iobroker.mjs executePlan '{"operations":[...]}'`
5. **Ergebnis kurz bestätigen** und bei `blocked` den Hint in Alltagssprache erklären.

## Regeln für dich

- Eine gesperrte Schaltung **nie unverändert wiederholen**. Lies `hint.type`:
  - `satisfy_any` / `satisfy_all`: Die Companion-Operationen aus `hint.companions` (z. B. Ventil öffnen) vorne in denselben Plan legen und erneut mit `planWithinBounds` prüfen.
  - `wait_for_threshold`: Schwellwert (z. B. PV-Watt) nicht erreicht; dem Nutzer `deficit` nennen, nicht erzwingen.
  - `turn_off_or_wait`, `wait_for_min_off`: Zeitregel; warten oder ausschalten.
  - `use_allowed_prefix`: Gerät liegt außerhalb der Freigabe; anderes Gerät oder Operator fragen.
  - `use_listStates`: Die ID existiert nicht (`EIDUNKNOWN`). IDs **nie raten**, sondern mit `listStates` und `hint.search` suchen.
- `ack: false` im Ergebnis heißt: Befehl geschrieben, Gerät bestätigt asynchron. Das ist **kein** Fehler.
- `confirmation: true` nur senden, wenn der Nutzer der konkreten kritischen Aktion **in diesem Gespräch ausdrücklich zugestimmt** hat.
- `ECONFIRMPENDING`: Ein Mensch muss freigeben. Sag dem Nutzer die `confirmationId` und dass er sie in ioBroker bestätigen muss (State `safety.confirm`, VIS oder Telegram). Du kannst nicht selbst freigeben. Status: `getPendingConfirmations`.
- Für wiederholte Versuche nach Netzwerkfehlern dieselbe `requestId` verwenden; die Bridge führt dann nicht doppelt aus (das Skript macht das automatisch).
- Bei `EQUEUEFULL` oder `ETIMEOUT` kurz warten und den Zustand mit `getStates` prüfen, bevor du erneut schreibst.

## Häufige Aufgaben

| Wunsch | Action |
|---|---|
| „Mir ist kalt“, „Gute Nacht“ | `handleIntent` mit `{"text":"…","execute":false}`, Plan zeigen, dann `execute:true` |
| Zustand abfragen | `getStates` mit `{"ids":[…]}` |
| Was ist im Haus passiert? | `getContextEvents` mit `{"limit":10}` |
| PV-Überschuss nutzen | `getConstraints` → `handlePvSurplus` |
| Gewohnheiten | `getLearningStatus`, `suggestAutomation`, `optimizeHome` mit `{"execute":false}` |
| Sprachausgabe | `speak` mit `{"text":"…"}` |
| Alle Actions mit Schema | `node {baseDir}/scripts/iobroker.mjs tools` |

## Ereignisse aus dem Haus

Die Bridge kann Ereignisse an OpenClaw pushen (`[ioBroker openclaw-bridge] …`), z. B. gesperrte Regeln, automatisches Ausschalten nach Maximaldauer, offene Bestätigungen oder beobachtete States (Klingel, Fenster). Reagiere darauf mit `getConstraints` und schalte nur innerhalb der Grenzen; informiere den Nutzer knapp.
