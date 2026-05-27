# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A WhatsApp bot (Baileys, single account, **one group**) that drives the messaging
for the **Amsterdam group trip** (30/05 prep → 03/06 return flight, 2026, ~15
people). Italian-language messages. It is an adaptation of the original "Miglio
d'Oro" pub-crawl bot — the git history and `amsterdam_plan_draft.md` (in the parent
dir) are the domain source.

### Key differences from the Miglio bot

- **Multi-day, not single-day**: events span 5 calendar days. Each stop carries an
  explicit `day` (`YYYY-MM-DD`) + `time` (`HH:MM`); globals carry a full ISO
  `datetime`. All Dates are absolute.
- **Selective reminders, no cascade**: a stop generates a reminder **only** if
  `notify: true`, and exactly **one** reminder, `leadTime` minutes before. There is
  no `[5,2]` lead-time cascade, no `arrival`/`departure`, no per-stop games.
- **One group**, not five. No `re_regina`/mention logic, no `afterMiglio`.
- **`run` is continuous**: one process started on 30/05 schedules *all* future
  events of the trip in one go (`setTimeout`; 5-day delays are well under Node's
  ~24.8-day limit). `state.json` is **not** wiped at midnight.
- **Inbound command router**: the bot answers `/oggi`, `/domani`, `/prossimo`,
  `/dove`, `/help` in the configured group or in DM from the admin.

## Architecture

`index.js` is just the CLI entrypoint + command orchestration. Logic lives in `lib/`:

- `lib/config.js` — `loadConfig()` reads `schedule.json`, validates the new schema
  (trip/group/stops/globals, date+time formats, unique ids), and sets
  `process.env.TZ = trip.timezone` (`Europe/Amsterdam`) so all Date math is correct
  regardless of host TZ. `hasPlaceholderGroup()` flags the `REPLACE_WITH` JID.
- `lib/time.js` — date/time helpers: `parseDayTime(day,time)`, `parseISO(datetime)`
  (both build **local** Dates = trip TZ), `dayKey`, `fmtDateTime`, `dayLabel`
  (Italian weekday), `resolveFilterDate()` (reads `EVENT_DATE`), `sleep`.
- `lib/events.js` — `buildEvents(cfg, filterDay?)` expands the config into a
  time-sorted list. Produces **only**: a `reminder` per `notify:true` stop
  (`when = day+time − leadTime`) and a `global` per `globalAnnouncements`. Event ids
  are deterministic: `pre:<stop.id>`, `global:<ann.id>` — the idempotency key.
  `reminderText()` builds the message (custom `tplArrival` or a default template);
  `effectiveGroupId()` resolves `TEST_JID || group.whatsappId`.
- `lib/state.js` — `loadState`/`markSent`/`clearState`. `state.json` is the
  sent-event ledger that makes `run` safe to restart.
- `lib/whatsapp.js` — `createSession()` (Baileys connection lifecycle, unchanged
  from the Miglio bot + an `onMessages` hook re-attached on every reconnect),
  `makeSender(session,cfg)` → `{ sendThrottled, notifyAdmin, waitForSocket }`
  (throttle = `minDelayMs` + jitter up to `maxDelayMs`), and
  `makeInboundRouter({cfg,sender,ctxFactory})`.
- `lib/scheduler.js` — `planTrip({cfg,sender,state,filterDay})` schedules every
  future event via `setTimeout`, skipping past (>30s) and already-sent events, and
  appends the id to `state.json` on fire.
- `lib/context.js` — `makeCtx(cfg, nowOverride?)` builds the `ctx` for command
  handlers (`today`, `tomorrow`, `stopsForDay`, `stopDateTime`, `dayLabel`).
- `lib/commands/` — one file per command (`oggi`, `domani`, `prossimo`, `dove`,
  `help`), each `module.exports = { desc, handler:async(args,ctx)=>string }`.
  `_registry.js` maps name→command and exposes `dispatch(text, ctx)`.

### Inbound security

`makeInboundRouter` answers **only** if the message comes from the configured group
(`group.whatsappId` or the `TEST_JID` override) **or** is a DM from `adminChatId`.
Everything else is ignored silently (no leak that a bot exists).

## Commands

```
npm install
node index.js setup                  # one-time QR pairing; writes ./auth
node index.js groups [names…]        # list joined groups + JIDs (optional exact-name filter)
node index.js validate               # validate schedule.json + show event counts
node index.js schedule               # dry-run: print every message, in order
node index.js next                   # the next 10 scheduled things
node index.js run                    # production: connect + schedule the whole trip
```

### Test commands (no WhatsApp send unless noted)

- `node index.js test-command "/oggi"` — run a command handler locally, print the
  reply. Works with any command. Honors `EVENT_DATE` to simulate another day.
- `node index.js test-send <jid> <msg>` — send an arbitrary message to a JID
  (throttled). Sanity check before the event.
- `node index.js test-day <YYYY-MM-DD> [<jid>]` — send NOW, in sequence, every
  message that day would produce. `<jid>` optional = a test group; otherwise the
  configured group (or `TEST_JID`). Simulates a whole day in ~1 minute.
- `node index.js test-stop <stop_id> [<jid>]` — send NOW the reminder of a single
  stop, to test its template.

> Note: on **git-bash (MSYS)** a leading `/` in an argument is rewritten to a
> Windows path, so `test-command "/oggi"` mis-parses. Use **PowerShell or cmd**
> (and npm scripts run under cmd, so `npm run test:commands` is fine).

### npm scripts

`validate`, `dry-run` (alias of `schedule`), `next`, `test:commands` (runs the five
handlers; fails if any throws), `start` (= `run`), `setup`, `groups`.

## Environment variables

- `EVENT_DATE=YYYY-MM-DD` — in `schedule`/`next`/`test-command`, filters to that
  single day. In `run` (continuous) it's optional; if set, only that day is
  scheduled.
- `TEST_JID=<jid>` — overrides `group.whatsappId` for `run`/`test-day`/`test-stop`,
  so you can point the bot at a throwaway test group without editing `schedule.json`.

## schedule.json shape

- `trip` — `name`, `timezone` (IANA, applied process-wide), `days` (array of
  `YYYY-MM-DD`; every `stop.day` must be in it).
- `group` — `{ whatsappId, name }`. One group only.
- `adminChatId` — receives startup ping + per-event error notifications.
  `REPLACE_WITH…` placeholders block `run`.
- `throttle` — `minDelayMs` / `maxDelayMs`.
- `defaults.leadTime` — fallback minutes-before for reminders (per-stop `leadTime`
  overrides; final fallback 20).
- `stops[]` — `id` (unique), `day`, `time`, `title`, optional `location{name,maps}`,
  `notify` (default false), `leadTime`, `tplArrival` (template with tokens
  `{maps} {name} {title} {time} {lead}`). Stops with `notify:false` still appear in
  `/oggi`/`/dove` — they're info, not reminders.
- `globalAnnouncements[]` — `id`, `datetime` (ISO `YYYY-MM-DDTHH:MM[:SS]`), `text`.

**TBD reservations** (e.g. cena Barracuda, cena G3) live as `notify:false` stops
with a `__…_DA_CONFERMARE__` marker in the title. When the time is confirmed, set
the real `time` and flip `notify:true`.

## Files

- `auth/` — Baileys multi-file auth state. **Never commit.** Wipe to re-pair.
- `state.json` — sent-event ledger (idempotency). Safe to delete to re-send.
- `schedule.json` — the entire trip timetable. Edit this, not the code.
- `logs/` — daily `bot-YYYY-MM-DD.log`.

## Workflow after editing schedule.json

`npm run validate` → `node index.js schedule` (or per-day with `EVENT_DATE`) →
`node index.js test-day <date> <test_jid>` for a live dry-run → `node index.js run`.
