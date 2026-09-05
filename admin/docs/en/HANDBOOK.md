# OpenClaw-Bridge — Operator handbook

**Adapter:** `openclaw-bridge` · **Package:** `iobroker.openclaw-bridge` · **Version:** 0.12.5

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

1. Confirm object `ping` works.
2. simple-api online, note **Port** (instance settings).
3. From the OpenClaw host, repeat the curl test against `http://<iobroker-ip>:8087`.
4. Add a skill that only writes `control.command` and always starts with `getConstraints`.

Full German step-by-step including skill text, envelope loop, actions and error codes: **Anleitung** tab / `ANLEITUNG.html`.
