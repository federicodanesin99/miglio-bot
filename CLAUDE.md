# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-file Node.js bot (Baileys/WhatsApp Web) that drives the messaging for the "Miglio d'Oro" pub-crawl event. One account, multiple groups, a fixed timetable per group across ~13 stops. Italian-language messages.

## Commands

```
npm install
node index.js setup            # one-time QR pairing; writes ./auth
node index.js groups [names…]  # list joined WhatsApp groups + JIDs (optional exact-name filter)
node index.js validate         # validate schedule.json + show event counts
node index.js schedule         # dry-run: print every message that would be sent, in order
node index.js run              # production: connect + schedule timers for the day
```

There is no test suite, no linter, no build step. `validate` and `schedule` are the only "tests" — run them after editing `schedule.json`.

`EVENT_DATE=YYYY-MM-DD` overrides the event day (default: today). Useful when previewing or rehearsing on a non-event day.

## Architecture

Everything lives in `index.js`. The pipeline is:

1. **`loadConfig()`** reads `schedule.json` and sets `process.env.TZ` from `event.timezone` so all `Date` math runs in Europe/Rome regardless of host TZ.
2. **`buildEvents(cfg, eventDate)`** expands the config into a flat, time-sorted list of events. Each `stop × group` produces up to 4 events:
   - `arrival` (skipped when `stop.isStart` — handled by `globalAnnouncements` instead)
   - `prenotify` for each value in `event.leadTimes` (default `[5, 2]` minutes before departure)
   - `departure` (skipped on the last stop, i.e. when there is no `stop.number + 1`)
   - Plus one `global` broadcast per `globalAnnouncements` entry (sent to every group).
   Event IDs are deterministic (`arr:s2:g3`, `pre:s2:g3:l5`, `dep:s2:g3`, `global:16:30`) — this is the idempotency key.
3. **`cmdRun()`** schedules each future event via `setTimeout` (not `node-cron` — cron only drives the 10-minute heartbeat). Past events (>30s late) are skipped. On fire, sends via `sendThrottled` which enforces `throttle.minDelayMs` + random jitter up to `maxDelayMs` to avoid WhatsApp rate-limits, then appends the event id to `state.json`.
4. **`state.json`** is the sent-event ledger — the only thing that makes `run` safe to restart mid-event. Delete it to re-send everything; keep it to resume.

### Connection lifecycle (`connect()`)

Baileys quirks worth knowing before touching this:
- `setup` triggers a `DisconnectReason.restartRequired` right after pairing — the code auto-reconnects, then sleeps 15s to let initial sync (chats/groups/contacts) finish before exiting. Without that wait, `groups` returns an empty list.
- On `loggedOut` the auth dir must be wiped manually (`rm -rf auth`) and `setup` re-run.
- Other disconnects auto-reconnect after 5s if the socket was previously open; otherwise the promise rejects.
- `printQRInTerminal` is disabled in Baileys options — QR rendering is done manually via `qrcode-terminal` so it only shows during `setup`.

## schedule.json shape

- `event.timezone` — IANA TZ, applied process-wide.
- `event.leadTimes` — minutes-before-departure for prenotify messages. Each value gets its own templated message in `tplPrenotify` (5 and 2 have custom copy; others fall through to a generic line).
- `groups[].id` is a small integer used inside `stops[].groupSchedule[].group`; `whatsappId` is the real JID (`…@g.us`). `loadConfig` cross-checks that every `groupSchedule.group` resolves to a known group id.
- `stops[]` ordered by `number`. `isStart: true` suppresses the arrival message (the global 16:30 announcement covers it). `isFinish: true` swaps the arrival template for the finish-line copy.
- `adminChatId` receives a startup ping and per-event error notifications. Placeholder strings matching `/REPLACE_WITH/` are detected and block `run`.

## Files

- `auth/` — Baileys multi-file auth state. **Never commit.** Wipe to re-pair.
- `state.json` — sent-event ledger for idempotency. Safe to delete between events.
- `schedule.json` — the entire event timetable + group JIDs + admin chat. Edit this, not `index.js`, to change timings or copy.
