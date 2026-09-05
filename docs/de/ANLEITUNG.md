# OpenClaw-Bridge — Ausführliche Anleitung

**Adapter:** `openclaw-bridge` · **Paket:** `iobroker.openclaw-bridge` · **Version:** 0.12.1

Diese Datei liegt **im Adapter**:

- ioBroker-Admin → Instanz `openclaw-bridge.0` → Tab **Anleitung**
- Browser: `http://<iobroker-ip>:8081/adapter/openclaw-bridge/ANLEITUNG.html`
- Adapter-Info → Dokumentation (`docs/de/ANLEITUNG.md`)
- Auf dem Host: `node_modules/iobroker.openclaw-bridge/docs/de/ANLEITUNG.md`

---

## 1. Was dieser Adapter ist

Die Bridge ist die **einzige erlaubte Schnittstelle** zwischen OpenClaw und deiner Hausautomation. OpenClaw entscheidet *was sinnvoll ist*. Die Bridge erzwingt *was erlaubt ist*.

```text
Mensch  →  OpenClaw (Dialog)
              │
              │  JSON über simple-api :8087
              ▼
         openclaw-bridge.0.control.command
              │
              ├─ Prefix-ACL, Action-Whitelist
              ├─ Confirmation (kritische Prefixe)
              ├─ Regeln (AND/OR/XOR, Watt, max. Ein)
              └─ nur erlaubte Writes nach ioBroker
              │
              ▼
         Geräte, Szenen, Frigate-States, PV, …
```

OpenClaw soll **keine** Shelly-/Zigbee-States direkt schreiben. Alles läuft über `control.command`. Sonst greifen Regeln und Rahmenbedingungen nicht.

---

## 2. Installation des Adapters

Das GitHub-Repo muss `ioBroker.openclaw-bridge` heißen, sonst findet `iobroker url` den Adapter nicht.

```bash
iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge#v0.12.1
iobroker add openclaw-bridge
iobroker start openclaw-bridge.0
```

Ältere Installation ohne Versions-Tag:

```bash
iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge
```

Nach einem Update:

```bash
iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge
iobroker upload openclaw-bridge
iobroker restart openclaw-bridge.0
```

Die Instanz erscheint unter **Instanzen**. Über das Schraubenschlüssel-Symbol öffnest du die Einstellungsseite (Tabs).

---

## 3. Einstellungsseite (Tabs)

### Sicherheit

| Feld | Zweck |
|---|---|
| Erlaubte Prefixe | Nur diese Namensräume darf der Agent lesen/schreiben, z. B. `0_userdata.0`, `javascript.0`, `alexa2.0`, später `frigate.0` |
| Erlaubte Actions | Whitelist der JSON-Actions. `getConstraints` und `planWithinBounds` müssen enthalten sein, wenn der Agent planen soll |
| Kritische Prefixe | Writes brauchen `confirmation: true` (Default `system.`, `admin.0`) |
| Actions mit Bestätigung | z. B. `executePlan` |
| ack=true erlauben | Normalerweise an; Geräte-Feedback nicht vom Agenten fälschen lassen, wenn du unsicher bist |

**Tipp:** Prefixe zuerst eng (`0_userdata.0`). Erst erweitern, wenn ein konkreter State blockiert wird (`EIDFORBIDDEN`).

### Regeln (Rahmenbedingungen)

Das ist der **Spielraum** des Agenten, kein nachträglicher Riegel.

Beispiele:

- Brunnenpumpe nur, wenn mindestens ein Ventil offen ist (`OR`, Bedingungs-IDs)
- Steckdose maximal 60 Minuten ein
- Poolheizung erst ab ≥ 4000 W (`Schwellwert-State` + Op `>=` + Wert)

Schwellwerte werden **zusätzlich per AND** zur Kombinator-Logik geprüft. Ventil und Pumpe dürfen im **selben Plan** stehen — die Bridge schaltet Bedingungen zuerst.

### Geräte

Komfort-Temperatur für „mir ist kalt/heiß“, PV-Leistungs-State, Tabelle der Überschuss-Lasten (Ein ab W / Aus unter W).

### Gewohnheiten

Default-Mode `observe`: nur lernen. Wechsel nach `autonomous` nur mit `confirmation: true` und erfüllten Schwellen.

### Sprache / Erweitert

Alexa-Speak-State, lokale STT, Timeouts, Retry, Queue. Nur bei Bedarf ändern.

---

## 4. Wichtige States

Instanz-Präfix: `openclaw-bridge.0.`

| State | Richtung | Bedeutung |
|---|---|---|
| `control.command` | **schreiben** | JSON-Command von OpenClaw oder Test |
| `control.lastResult` | lesen | letzte Antwort |
| `responses.<requestId>` | lesen | Antwort zu genau diesem Request |
| `intents.lastPlan` | lesen | letzter Intent-Plan |
| `safety.pendingConfirmation` | lesen | kritische Aktion wartet |
| `safety.lastGuardBlock` | lesen | letzte Regel-Sperre inkl. Hint |
| `guards.runtime` | lesen | Ein-/Aus-Zeiten für Dauerregeln |
| `habits.mode` | lesen | `observe` / `suggest` / `autonomous` |
| `habits.learningStatus` | lesen | Lernfortschritt |
| `info.successCount` / `info.lastError` | lesen | Audit |

`control.command` immer mit **ack = false** schreiben. Der Adapter verarbeitet nur unbestätigte Commands.

---

## 5. Test ohne OpenClaw (im ioBroker)

Damit prüfst du die Bridge, bevor der Agent verbunden wird.

### 5.1 Über Objekte

1. **Objekte** → `openclaw-bridge.0.control.command`
2. Diesen Wert setzen (ack aus):

```json
{"action":"ping","requestId":"test-1"}
```

3. Lesen: `openclaw-bridge.0.responses.test-1` oder `control.lastResult`

Erwartet: `"ok": true`, `"data": { "pong": true, ... }`.

Weitere Tests:

```json
{"action":"help","requestId":"test-2"}
```

```json
{"action":"getConstraints","requestId":"test-3"}
```

```json
{"action":"handleIntent","text":"mir ist kalt","execute":false,"requestId":"test-4"}
```

`execute: false` schreibt **keine** Geräte.

### 5.2 Über simple-api (wie OpenClaw)

simple-api muss laufen. Port: Instanz **simple-api.0** → Schraubenschlüssel → Feld **Port** (bei dir **8087**).

Vom ioBroker-Host:

```bash
curl -sS -G "http://127.0.0.1:8087/set/openclaw-bridge.0.control.command" \
  --data-urlencode 'value={"action":"ping","requestId":"test-1"}'

curl -sS "http://127.0.0.1:8087/get/openclaw-bridge.0.responses.test-1"
```

Von einem anderen Rechner im LAN `127.0.0.1` durch die ioBroker-IP ersetzen.  
simple-api darf nicht nur auf `127.0.0.1` gebunden sein, wenn OpenClaw auf einem anderen Host läuft.

---

## 6. OpenClaw anbinden

Die Bridge hat **kein eigenes HTTP**. OpenClaw erreicht sie nur so:

```text
OpenClaw  --HTTP GET-->  simple-api :8087  -->  control.command
OpenClaw  <--HTTP GET--  simple-api :8087  <--  responses.<requestId>
```

### 6.1 Voraussetzungen

1. `openclaw-bridge.0` läuft, `ping` über Objekte ist grün.
2. `simple-api.0` läuft, Port **8087**.
3. OpenClaw kann `http://<iobroker-ip>:8087` erreichen (gleiche Maschine: `127.0.0.1`).
4. simple-api nicht ins Internet öffnen. Nur LAN oder VPN.

### 6.2 Verbindungstest von der OpenClaw-Maschine

```bash
curl -sS -G "http://<iobroker-ip>:8087/set/openclaw-bridge.0.control.command" \
  --data-urlencode 'value={"action":"ping","requestId":"oc-1"}'

curl -sS "http://<iobroker-ip>:8087/get/openclaw-bridge.0.responses.oc-1"
```

Kommt `pong`, ist der Kanal offen.

### 6.3 OpenClaw-Skill

Lege im OpenClaw-Workspace eine Skill an, z. B.

`~/.openclaw/workspace/skills/iobroker-bridge/SKILL.md`

```markdown
---
name: iobroker-bridge
description: Steuert das Haus nur über die ioBroker OpenClaw-Bridge.
---

# ioBroker OpenClaw-Bridge

Base-URL: http://<iobroker-ip>:8087

Schreibe ausschließlich nach:
  openclaw-bridge.0.control.command

Lies die Antwort aus:
  openclaw-bridge.0.responses.<requestId>
Fallback:
  openclaw-bridge.0.control.lastResult

Niemals Shelly-, Zigbee- oder system.-States direkt setzen.

Ablauf jedes Steuerwunsches:
1. requestId erzeugen (z. B. UUID)
2. GET /set/openclaw-bridge.0.control.command?value=<JSON>
3. kurz warten, dann GET /get/openclaw-bridge.0.responses.<requestId>
4. Bei ok:false die Felder error.code, error.nextAction, error.hint befolgen

Pflicht-Reihenfolge:
- Zuerst {"action":"getConstraints"}
- Dann planWithinBounds oder handleIntent mit execute=false
- Nur Operationen aus allowed ausführen
- Kritische Writes nur mit "confirmation": true

Beispiele:
{"action":"ping"}
{"action":"help"}
{"action":"getConstraints"}
{"action":"handleIntent","text":"gute nacht","execute":false}
{"action":"handleIntent","text":"gute nacht","execute":true,"confirmation":true}
```

Skill laden, OpenClaw neu starten. Im Chat testen: „Schick einen ping an die ioBroker-Bridge.“

### 6.4 Empfohlener Agent-Loop

| Schritt | Action | Zweck |
|---|---|---|
| 1 | `ping` / `help` | Verbindung und erlaubte Actions |
| 2 | `getConstraints` | Was *jetzt* erlaubt ist (Envelope) |
| 3 | `planWithinBounds` oder `handleIntent` (`execute: false`) | Plan in allowed/blocked teilen |
| 4 | Ausführen | nur `allowed`; Hints bei `blocked` (Ventil öffnen, auf PV warten) |
| 5 | `recordObservation` | Lernen |
| 6 | `getLearningStatus` | Reife prüfen |
| 7 | `optimizeHome` | nach der Lernphase, weiter nur innerhalb der Grenzen |

---

## 7. Actions (Kurzüberblick)

Vollständige Liste: `docs/ACTIONS.md` im Adapterpaket.

| Gruppe | Actions |
|---|---|
| Leben | `ping`, `help` |
| Lesen | `getState`, `getStates`, `listStates`, `syncSnapshot` |
| Schreiben | `setState`, `executePlan`, `batchSetStates` |
| Dialog | `handleIntent`, `validatePlan` |
| Envelope | `getConstraints`, `planWithinBounds`, `checkGuards` |
| Lernen | `recordObservation`, `getHabits`, `getLearningStatus`, `setHabitMode`, `evaluateHabits`, `suggestAutomation`, `applyHabit`, `optimizeHome` |
| Energie | `handlePvSurplus` |
| Kontext | `emitContextEvent`, `getContextEvents` |
| Telemetrie | `getTelemetry` |
| Sprache | `speak`, `transcribe`, `voiceCommand` |

Jede Action muss in **Erlaubte Actions** stehen.

---

## 8. Fehlercodes

Die Antwort hat immer `ok`, `requestId`, `action`, `data` oder `error` (`code`, `message`, `details`, `nextAction`, oft `hint`).

| Code | Bedeutung | Nächster Schritt |
|---|---|---|
| `EACTIONFORBIDDEN` | Action nicht auf der Whitelist | Action oder Tab Sicherheit |
| `EIDFORBIDDEN` | State außerhalb der Prefixe | Prefix erweitern oder andere ID |
| `ECONFIRMREQUIRED` | kritische Aktion | mit `confirmation: true` wiederholen |
| `EGUARDFAILED` | AND/OR/XOR nicht erfüllt | `hint.companions` in denselben Plan |
| `ETHRESHOLD` | Watt/Zahl zu niedrig | warten, `hint.deficit` |
| `EDURATIONLIMIT` | zu lange ein | aus oder Limit erhöhen |
| `ECOOLDOWN` | Mindest-Aus läuft | warten |
| `ENOTREADY` | noch nicht gelernt | weiter beobachten |
| `EHABITNOTFOUND` | unbekannter Habit-Name | `getHabits` |
| `EQUEUEFULL` | zu viele Commands | später retry |
| `ETIMEOUT` | Adapter zu langsam | Last / Timeout |
| `EBADJSON` | kein gültiges JSON | Payload prüfen |

---

## 9. Sicherheit

- simple-api nur im LAN oder hinter Authentifizierung.
- Prefixe und Actions eng halten.
- `system.` und `admin.0` kritisch lassen.
- OpenClaw bekommt keinen direkten Schreibweg an Geräte-Adapter.
- Kameras (Frigate): Erkennung bleibt in Frigate. Die Bridge liest nur States, wenn `frigate.0` in den erlaubten Prefixen steht.

---

## 10. Checkliste „OpenClaw ist verbunden“

1. `openclaw-bridge.0` läuft  
2. Objekte-`ping` → `ok`  
3. simple-api Port 8087, von der OpenClaw-Maschine erreichbar  
4. `curl`-`ping` über :8087 → `pong`  
5. Skill mit Base-URL und „nur control.command“  
6. Chat: „ping die Bridge“ → `ok`  
7. Chat: „was sind die aktuellen Rahmenbedingungen?“ → `getConstraints`

Wenn Schritt 2 scheitert, liegt es an der Bridge. Wenn 2 geht und 4 nicht, liegt es an simple-api/Netz. Wenn 4 geht und 6 nicht, liegt es an der Skill.
