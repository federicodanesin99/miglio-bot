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
  `/dove`, `/meteo`, `/presente`, `/bici`, `/valigia`, `/casa`, `/mezzi`,
  `/sos`, `/mvp`, `/classifica`, `/help` in the configured group or in DM from the admin.
- **MVP point-voting**: `/mvp @nome punti [motivo]` lets participants award points to
  others during the trip (`lib/mvp.js`, persisted to `votes.json`). Each voter has a
  daily budget (`mvp.dailyBudget`, default 10), no self-voting; the budget is the
  fairness mechanism (no statistical normalisation). `/classifica` shows the live
  standings; a scheduled `mvp:reveal` event reveals the final leaderboard at
  `mvp.reveal`.
- **Morning "Buongiorno" message**: one automatic message each Amsterdam day
  (`lib/morning.js`) merging the day's program + weather brief. The on-demand
  `/meteo` command shows today+tomorrow. See `lib/weather.js`.
- **Roll-call**: `/presente` opens a 👍-reaction head-count (`lib/rollcall.js`),
  aggregated silently as people react; `/presente stop` closes it with a tally.

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
  time-sorted list. Produces: a `reminder` per `notify:true` stop
  (`when = day+time − leadTime`), a `global` per `globalAnnouncements`, and (if a
  `weather` block exists) a `morning` event per weather day at `weather.time`. Event
  ids are deterministic: `pre:<stop.id>`, `global:<ann.id>`, `morning:<day>` — the
  idempotency key. Dynamic events (`morning`) carry an async `build()` instead of a
  fixed `text`: the scheduler/`test-day` call `ev.build ?? ev.text` at fire-time so
  the forecast is fresh; the static `text` is only an offline preview for
  `schedule`/`next`. `reminderText()` builds a reminder message (custom `tplArrival`
  or a default template); `effectiveGroupId()` resolves `TEST_JID || group.whatsappId`.
- `lib/morning.js` — `morningText(cfg, day)` (async): the "Buongiorno" message =
  greeting + the day's program (`lib/format.js`) + the weather brief (when
  `weather.enabled`). Drives the `morning` event.
- `lib/format.js` — `formatDayStops(stops)`: the shared 🔔/📍 stop-line renderer used
  by `/oggi`, `/domani`, and the morning message.
- `lib/weather.js` — open-meteo brief (no API key). `weatherRangeText(wx,start,end,tz)`
  / `weatherBriefText(wx,day,tz)` fetch the daily forecast and format an Italian
  brief (WMO code → emoji, temp range, precip %, wind, a practical advice line).
  Never throws — on network error returns a fallback with a search link, so the
  scheduler still marks the event sent (no retry storm).
- `lib/rollcall.js` — `makeRollCall({getGroupSize})`: in-memory (ephemeral) head-count
  state machine. `start(msgKey)` ties the roll-call to the appello message; the
  router calls `matchesKey()`+`record(jid,emoji)` on each reaction; `statusText()` /
  `close()` report the tally. No persistence — a roll-call is for the moment.
- `lib/mvp.js` — `makeMvp({dailyBudget, names})`: **persistent** MVP point-voting
  store (`votes.json`). Keeps raw vote records so it can recompute daily budgets.
  `castVote()` enforces the rules (no self-vote, recipient ∈ roster, daily budget).
  `setParticipants()` is fed from the group roster in `run`. The text builders
  (`leaderboardText()`/`revealText()`/`statusText()`) return **`{ text, mentions }`**:
  each participant is rendered via `nameToken(jid)` — a config `mvp.names` nickname is
  shown as plain text, otherwise the person is **@-mentioned** (jid pushed into
  `mentions`) so WhatsApp shows their contact name + pings them. `sendThrottled` and
  the reply protocol carry the `mentions` array through.
- `lib/state.js` — `loadState`/`markSent`/`clearState`. `state.json` is the
  sent-event ledger that makes `run` safe to restart (separate from `votes.json`).
- `lib/whatsapp.js` — `createSession()` (Baileys connection lifecycle, unchanged
  from the Miglio bot + an `onMessages` hook re-attached on every reconnect),
  `makeSender(session,cfg)` → `{ sendThrottled, notifyAdmin, waitForSocket }`
  (throttle = `minDelayMs` + jitter up to `maxDelayMs`; `sendThrottled` **returns**
  the Baileys send result, whose `.key` lets `/presente` attach reactions), and
  `makeInboundRouter({cfg,sender,ctxFactory,rollcall})`. The router also handles
  `reactionMessage` upserts (feeding `rollcall`) and command replies that return
  `{ text, after(sent) }` instead of a plain string. It calls `ctxFactory(meta)` with
  per-message `{ voter, mentions, pushName, ts }` (the voter JID + `mentionedJid`)
  so `/mvp` knows who votes for whom.
- `lib/scheduler.js` — `planTrip({cfg,sender,state,filterDay,deps})` schedules every
  future event via `setTimeout`, skipping past (>30s) and already-sent events, and
  appends the id to `state.json` on fire. `deps` (e.g. `{mvp}`) is forwarded to
  `buildEvents` for dynamic events like the `mvp:reveal` leaderboard.
- `lib/context.js` — `makeCtx(cfg, nowOverride?)` builds the `ctx` for command
  handlers (`today`, `tomorrow`, `stopsForDay`, `stopDateTime`, `dayLabel`). In `run`
  the ctx is spread with `rollcall`, `mvp` and the per-message `meta` (`voter`,
  `mentions`, …) so `/presente`/`/mvp` can reach them (test paths omit them).
- `lib/commands/` — one file per command (`oggi`, `domani`, `prossimo`, `dove`,
  `meteo`, `presente`, `bici`, `valigia`, `casa`, `mezzi`, `sos`, `mvp`,
  `classifica`, `help`),
  each `module.exports = { desc, handler:async(args,ctx)=>string|{text,after} }`. The
  static info commands (`bici`/`valigia`/`casa`/`mezzi`/`sos`) are built by
  the `_info.js` factory and just return `cfg.info.<key>`. `_registry.js` maps
  name→command and exposes `dispatch(text, ctx)`.

### Inbound security

`makeInboundRouter` answers **only** if the message comes from the configured group
(`group.whatsappId` or the `TEST_JID` override) **or** is a DM from `adminChatId`.
Everything else is ignored silently (no leak that a bot exists). The same gate
applies to reactions: only 👍 on the *active* roll-call message (matched by key) are
counted, and nothing is echoed back per-reaction.

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
- `node index.js test-all [<jid>]` — send NOW, in sequence, **every** message of the
  whole trip (intro, globals, mornings, reminders, MVP reveal). `<jid>` optional;
  otherwise the configured group (or `TEST_JID`). **Point it at a throwaway group** —
  it floods the target with the entire trip's messages in one go.
- `node index.js test-stop <stop_id> [<jid>]` — send NOW the reminder of a single
  stop, to test its template.

> Note: on **git-bash (MSYS)** a leading `/` in an argument is rewritten to a
> Windows path, so `test-command "/oggi"` mis-parses. Use **PowerShell or cmd**
> (and npm scripts run under cmd, so `npm run test:commands` is fine).

### npm scripts

`validate`, `dry-run` (alias of `schedule`), `next`, `test:commands` (runs every
command handler; fails if any throws), `start` (= `run`), `setup`, `groups`.

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
- `weather` (optional) — `enabled`, `time` (`HH:MM`, default `08:00`), `lat`/`lon`
  (numbers, required when `enabled`), `place` (label, default `Amsterdam`), optional
  `days[]` (subset of `trip.days`; default = all trip days), optional `timezone`
  (default `trip.timezone`). The block's `time`/`days` drive the morning "Buongiorno"
  event even when `enabled:false` (then the message just omits the weather section);
  `/meteo` needs `enabled`.
- `info` (optional) — free-form `{ <key>: <text> }` map powering the static commands
  `/bici`, `/valigia`, `/casa`, `/mezzi`, `/sos`. Edit text here, not code.
- `intro` (optional) — `datetime` (ISO) for a one-off **bot presentation** message
  that introduces itself and lists the commands (built live from the command
  registry via `events.js` → `introText()`, so it stays in sync). Placed on the
  departure morning so `/mvp` isn't advertised before the trip starts.
- `mvp` (optional) — MVP point-voting. `dailyBudget` (number > 0, default 10),
  `reveal` (ISO datetime for the final-leaderboard event), `names` (`{ jid: label }`
  map to make the leaderboard readable; learned pushNames fill the rest).

**TBD reservations** (e.g. cena Barracuda, cena G3) live as `notify:false` stops
with a `__…_DA_CONFERMARE__` marker in the title. When the time is confirmed, set
the real `time` and flip `notify:true`.

## Files

- `auth/` — Baileys multi-file auth state. **Never commit.** Wipe to re-pair.
- `state.json` — sent-event ledger (idempotency). Safe to delete to re-send.
- `votes.json` — MVP vote ledger (raw vote records + learned names). Delete to reset
  the standings.
- `schedule.json` — the entire trip timetable. Edit this, not the code.
- `logs/` — daily `bot-YYYY-MM-DD.log`.

## Workflow after editing schedule.json

`npm run validate` → `node index.js schedule` (or per-day with `EVENT_DATE`) →
`node index.js test-day <date> <test_jid>` for a live dry-run → `node index.js run`.
