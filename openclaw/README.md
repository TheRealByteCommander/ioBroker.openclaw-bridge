# OpenClaw-Integration

Dieser Ordner enthält alles, was auf der **OpenClaw-Seite** gebraucht wird. Die ioBroker-Seite ist der Adapter selbst.

```text
OpenClaw-Agent
  ├─ Plugin  openclaw/plugin          13 native Tools (iobroker_*), Schreib-Tools optional
  └─ Skill   openclaw/skill/…         SKILL.md + CLI (node, ohne Abhängigkeiten)
        │
        │  HTTPS/HTTP  POST /api/v1/command   Authorization: Bearer <authToken>
        ▼
ioBroker  openclaw-bridge.0  (REST-API :8097)
        │  ACL · Regeln · Schwellwerte · Bestätigung · serielle Queue
        ▼
Geräte-States

ioBroker  ──POST /hooks/agent  Bearer <hooks.token>──▶  OpenClaw-Gateway :18789
          (guard_block, max_on_elapsed, confirmation_pending, …)
```

## 1. Bridge (ioBroker)

Instanz `openclaw-bridge.0` → Tab **OpenClaw**:

| Feld | Wert |
|---|---|
| API-Token | langer Zufallswert, z. B. `openssl rand -hex 32` |
| REST-API aktivieren | an |
| Bind-Adresse | `0.0.0.0`, wenn OpenClaw auf einem anderen Rechner läuft, sonst `127.0.0.1` |
| Port | `8097` |

Test vom OpenClaw-Rechner:

```bash
curl -sS http://<iobroker-ip>:8097/api/v1/health
curl -sS -H "Authorization: Bearer <token>" http://<iobroker-ip>:8097/api/v1/tools | head
```

Port 8097 nur im LAN oder per VPN freigeben.

## 2a. Skill (schnellster Weg)

```bash
cp -r openclaw/skill/iobroker-bridge ~/.openclaw/workspace/skills/
```

`~/.openclaw/openclaw.json`:

```json5
{
  skills: {
    entries: {
      "iobroker-bridge": {
        enabled: true,
        env: { IOBROKER_BRIDGE_URL: "http://<iobroker-ip>:8097" },
        apiKey: "<token>", // → IOBROKER_BRIDGE_TOKEN (primaryEnv)
      },
    },
  },
}
```

Die Skill ruft `node {baseDir}/scripts/iobroker.mjs <action> '<json>'` auf. Manuell testen:

```bash
IOBROKER_BRIDGE_URL=http://<iobroker-ip>:8097 IOBROKER_BRIDGE_TOKEN=<token> \
  node ~/.openclaw/workspace/skills/iobroker-bridge/scripts/iobroker.mjs getConstraints
```

## 2b. Plugin (native Tools)

```bash
openclaw plugins install ./openclaw/plugin
openclaw plugins enable iobroker-bridge
openclaw plugins inspect iobroker-bridge --runtime --json
```

```json5
{
  plugins: {
    entries: {
      "iobroker-bridge": {
        enabled: true,
        config: { baseUrl: "http://<iobroker-ip>:8097", token: "<token>", timeoutMs: 15000 },
      },
    },
  },
  // Schreibende Tools sind optional und müssen bewusst freigegeben werden:
  tools: { allow: ["iobroker_execute", "iobroker_set_state", "iobroker_intent", "iobroker_optimize", "iobroker_speak"] },
}
```

| Tool | Bridge-Action | schreibt |
|---|---|---|
| `iobroker_constraints` | `getConstraints` | nein |
| `iobroker_list_states` | `listStates` | nein |
| `iobroker_get_states` | `getStates` | nein |
| `iobroker_plan` | `planWithinBounds` | nein |
| `iobroker_events` | `getContextEvents` | nein |
| `iobroker_learning` | `getLearningStatus` | nein |
| `iobroker_suggest` | `suggestAutomation` | nein |
| `iobroker_pending_confirmations` | `getPendingConfirmations` | nein |
| `iobroker_execute` | `executePlan` | ja (optional) |
| `iobroker_set_state` | `setState` | ja (optional) |
| `iobroker_intent` | `handleIntent` | ja (optional) |
| `iobroker_optimize` | `optimizeHome` | ja (optional) |
| `iobroker_speak` | `speak` | ja (optional) |

Hinweis: Die Plugin-SDK von OpenClaw ist als experimentell dokumentiert. Das Plugin ist gegen die dokumentierte API (`definePluginEntry`, `api.registerTool`, `openclaw.plugin.json`) geschrieben und mit einer Test-Attrappe der API geprüft, aber noch nicht gegen ein laufendes Gateway. Falls es mit deiner OpenClaw-Version nicht lädt, nutze die Skill; beide sprechen dieselbe API.

## 3. Ereignisse von ioBroker an OpenClaw

`openclaw.json`:

```json5
{ hooks: { enabled: true, token: "<hook-token>", path: "/hooks", allowedAgentIds: ["main"] } }
```

Tab **OpenClaw** im Adapter:

| Feld | Wert |
|---|---|
| OpenClaw-Webhook-URL | `http://<openclaw-ip>:18789/hooks/agent` |
| Webhook-Token | `<hook-token>` (nicht das Gateway-Token) |
| Webhook-Modus | `agent` (Agent reagiert) oder `wake` (nur Systemereignis) |
| Agent-ID | z. B. `main` |
| Ereignisse | `guard_block`, `max_on_elapsed`, `confirmation_pending`, `confirmation_resolved`, `habit_mode_changed`, `state_changed` |
| Beobachtete States | z. B. Türklingel, Fensterkontakte (für `state_changed`) |

Knopf **Testereignis senden** prüft URL und Token.

Alternativ (z. B. für eigene Dienste) liefert `GET /api/v1/events` dieselben Ereignisse als Server-Sent-Events-Stream.

## 4. REST-API

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| GET | `/api/v1/health` | nein | Lebenszeichen, Version |
| GET | `/api/v1/tools?format=raw\|openai\|anthropic` | ja | Tool-Katalog mit JSON-Schema |
| GET | `/api/v1/constraints` | ja | Kurzform für `getConstraints` |
| POST | `/api/v1/command` | ja | `{ "action": "…", …params }` |
| POST | `/api/v1/actions/<action>` | ja | Parameter als Body |
| GET | `/api/v1/events` | ja | SSE-Stream der Bridge-Ereignisse |

- Auth: `Authorization: Bearer <token>` (alternativ `X-Bridge-Token`).
- `Idempotency-Key`-Header oder `requestId`: Wiederholung liefert die gespeicherte Antwort (`replayed: true`) statt erneut zu schalten.
- HTTP-Status: 200 auch für fachliche Fehler (`ok: false`), 400 kaputtes JSON, 401 Token, 413 Body > 256 KiB, 429 Queue voll, 504 Timeout.

Antwortformat:

```json
{ "ok": false, "requestId": "…", "action": "setState",
  "error": { "code": "EGUARDFAILED", "message": "…", "nextAction": "…",
             "hint": { "type": "satisfy_any", "companions": [ { "type": "setState", "id": "…", "value": true } ] } },
  "durationMs": 12 }
```
