# OpenClaw-Bridge — Operator handbook

**Adapter:** `openclaw-bridge` · **Package:** `iobroker.openclaw-bridge` · **Version:** 0.13.0

The German original shipped in the adapter is `docs/de/ANLEITUNG.md` and `admin/ANLEITUNG.html`.

Open the instance wrench → **Guide / Anleitung** tab (iframe + full text), or `http://<host>:8081/adapter/openclaw-bridge/ANLEITUNG.html`.

## Role

OpenClaw talks to home automation **only** through this bridge. Write JSON to `openclaw-bridge.0.control.command`. Read `responses.<requestId>` or `control.lastResult`. Never write device states directly.

## Install

```bash
iobroker url https://github.com/TheRealByteCommander/ioBroker.openclaw-bridge
iobroker add openclaw-bridge
iobroker start openclaw-bridge.0
```

The GitHub repo name must be `ioBroker.openclaw-bridge` so `iobroker url` can detect the adapter.

Admin **Available version 0.9.0** was a stale repository cache. The instance only overwrites *older* cache entries; a *newer* custom-repo version stays so Admin can show an update. Add `sources-dist.json` as a custom repository to see new releases in the adapter tile.

## Test without OpenClaw

Set `openclaw-bridge.0.control.command` (ack = false):

```json
{"action":"ping","requestId":"test-1"}
```

Read `openclaw-bridge.0.responses.test-1`.

Via simple-api (default port 8087):

```bash
curl -sS -G "http://127.0.0.1:8087/set/openclaw-bridge.0.control.command" \
  --data-urlencode 'value={"action":"ping","requestId":"test-1"}'
curl -sS "http://127.0.0.1:8087/get/openclaw-bridge.0.responses.test-1"
```

## Connect OpenClaw

Since 0.13.0 the recommended path is the built-in REST API:

1. Tab **OpenClaw**: set an **API token** (e.g. `openssl rand -hex 32`), enable the **REST API** (bind `0.0.0.0` if OpenClaw runs on another host, port `8097`), save, press **Test bridge (ping)**.
2. From the OpenClaw host: `curl -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"action":"getConstraints"}' http://<iobroker-ip>:8097/api/v1/command`.
3. Install the bundled **skill** (`openclaw/skill/iobroker-bridge`, set `IOBROKER_BRIDGE_URL` and the token as `apiKey`) or the **plugin** (`openclaw plugins install <adapter>/openclaw/plugin`, config `baseUrl` + `token`). Enable the plugin tools with `tools.alsoAllow: ["iobroker-bridge"]` (with a tool profile such as `messaging`, a plugin-only `tools.allow` is ignored). The skill needs the `exec` tool.
4. Optional: enable `hooks` in `openclaw.json` and set the webhook URL `http://<openclaw-ip>:18789/hooks/agent` + hook token in the OpenClaw tab to receive events (blocked rules, auto-off, pending confirmations).
5. Optional: confirmation mode **human** – the agent cannot approve critical writes; an operator writes the confirmation id to `safety.confirm`.

The legacy path via simple-api (port 8087, `control.command`, `responses.<requestId>`) still works; add `"token"` to the JSON when a token is set.

Full details: `openclaw/README.md` and the German **Anleitung** tab / `ANLEITUNG.html`.
