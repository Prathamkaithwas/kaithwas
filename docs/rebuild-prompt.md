# Rebuilding Kaithwas from scratch with an AI agent

This is a set of prompts for rebuilding this app in a fresh agent session —
Antigravity, Claude Code, Cursor, whatever you're using — and getting
something that matches what's in this repo rather than a generic expense
tracker with the same screen names.

Two ways to use it:

- **Cloning the real thing.** Prompt 0 alone is enough. The repo is the spec;
  everything else here is for when you don't want the agent reading it.
- **Rebuilding it as an exercise**, or building your own version of it. Skip
  prompt 0 and work through 1 → 9 in order. Each one is a session's worth of
  work and leaves the app in a state you can actually open and use.

The prompts are deliberately wordy about *why* each decision was made. That's
the part that matters — an agent given "build a ledger app" produces the
generic version of this on the first try, and every prompt below exists to
rule out a specific wrong turn that was actually taken and undone during the
original build.

---

## Prompt 0 — clone this repo exactly

> Clone `https://github.com/Prathamkaithwas/kaithwas` and get it running.
>
> ```bash
> git clone https://github.com/Prathamkaithwas/kaithwas
> cd kaithwas
> npm install
> npm run dev
> ```
>
> It should open at `http://localhost:5180` with realistic sample data
> already seeded (dev only — a production build never seeds). The demo vault
> unlocks with four taps of the anchor.
>
> Read `README.md` first, then `src/store.tsx` and `src/types.ts` — those two
> files are the whole data model and every mutation the app can make.
> The code carries long comments explaining *why* things are the way they
> are; several of them exist because the obvious alternative was tried and
> was worse. Read them before changing the thing they're attached to.
>
> To build the Android APK you need JDK 21 and the Android SDK:
>
> ```bash
> npm run build
> npx cap sync android
> cd android && ./gradlew assembleDebug
> ```

**One thing that will bite you:** the Android package id is
`com.prathamadarsh.ledger` and must never change. Android treats a different
id as a different app, so changing it installs a second copy alongside the
first with an empty database instead of updating it.

---

## Prompt 1 — the shell and the data model

> Build an offline-first personal + small-business tracker as a React 19 +
> TypeScript + Vite app, styled with Tailwind CSS v4, that will later be
> wrapped with Capacitor 8 as an Android APK.
>
> Hard constraints, all of them deliberate:
>
> - **No backend, no accounts, no network calls.** Ever. The entire database
>   is one JSON object persisted to IndexedDB. Nothing leaves the device
>   except through an explicit user-initiated export.
> - **One store**, a single React context in `src/store.tsx`, exposing `db`
>   plus a flat list of named mutation functions (`addTx`, `updateHabit`,
>   `setMoodAnswer`, …). No reducers, no action constants, no Redux. Every
>   mutation goes through one `mut(fn)` helper that does `setDb(d => fn(d))`.
> - **Every type in one file**, `src/types.ts`, with a single `DB` interface
>   listing every collection.
> - **Dark-first, dense, flat.** No `backdrop-filter`, no glassmorphism, no
>   idle or looping animation. Motion is only ever for a real state change.
>
> Persistence rule that matters more than it looks: the app must open on a
> database written by an *older* version of itself. Write a `normalizeDB`
> function that every load and every restore passes through, which fills in
> missing collections with defaults and migrates renamed or reshaped fields.
> The user's real data lives in old shapes; crashing on one is not an option.
>
> Bottom navigation with three tabs, and a top bar whose row is a fixed
> height on every screen so moving between tabs never shifts the page under
> your thumb.

## Prompt 2 — the daily ledger

> Build the Daily ledger tab: income/expense/transfer entries against
> accounts and nested categories.
>
> Entry is through a **purpose-built calculator keypad**, not a scrolling
> form — amount first, then category and account. This is the single most
> used screen in the app and it should be enterable one-handed without
> looking.
>
> - Amounts are stored as **integer paise** everywhere. Never floats — a
>   ledger that disagrees with itself by a rounding cent is worthless.
> - A row swipes open to Edit / Duplicate / delete. Delete is
>   **press-and-hold for 800ms with a ring closing around the icon**, not a
>   confirm dialog. A dialog after the tenth time is just two taps; a hold
>   can't happen by accident and the ring says how much longer.
> - **Deleting hides, it does not destroy.** Deleted entries move to a
>   `hiddenTransactions` collection so they leave every list and every total
>   at once, and can still be restored.
> - If the app is backgrounded mid-entry, the in-progress draft must survive
>   — write it to durable storage on every change, not just React state, and
>   restore it when the editor reopens.

## Prompt 3 — notes and a daily planner

> A dated notebook tab. Notes are listed newest-first grouped by day, and are
> **never filtered by the month the ledger happens to be showing** — a note
> belongs to the day it was written, not to the period you're browsing. This
> was the single most-complained-about behaviour of the first version.
>
> Behind its own header icon, a full-screen **Today's Plan**: tasks bucketed
> into Morning / Afternoon / Evening, a priority dot each, drag to reorder
> within a bucket, and an **Auto-plan** button that distributes unplaced
> tasks across the three buckets by priority and duration — while leaving
> anything the user placed by hand exactly where they put it.
>
> Keep the planner as its own panel behind a button. An inline version on the
> notes page was tried and explicitly rejected.

## Prompt 4 — habits, mood, and a written journal

> A habits tab with two kinds of habit: a plain tap-to-complete, and a
> **metered** one that accumulates through the day toward a target (pages,
> minutes, glasses) and gets its own extra stats row — best session, longest
> run, last-30-days.
>
> Above them, the day's **mood**, from a vocabulary of nine named moods
> rather than a 1–5 scale. Moods are *words*, not points on a line: there's
> nothing to average two of them into, so the weekly summary is the mode, not
> a mean. The mood tile **carries forward** — it shows the most recent logged
> mood until a new one is logged, instead of resetting to an empty prompt at
> midnight, because nothing about how you feel actually resets at midnight.
>
> Picking a mood opens a set of **reflection questions** ("what is worth
> remembering about today?", "what could have gone better?"). Both the
> questions and how many there are must be editable in Settings — store them
> as data, not as constants in the source. Key each answer by the question's
> **id**, never by its position, so reordering or deleting a question can
> never re-attach an old answer to a different question. A deleted question
> keeps its answers on file; restoring it brings them back.
>
> Habits can also carry **daily reminders** as a list of clock times. A list,
> not a count-plus-interval: "three doses five minutes apart" is just three
> times that happen to be close together, and a plain list also handles three
> doses that *aren't* evenly spaced. Use `@capacitor/local-notifications`,
> and degrade silently to nothing in the browser rather than throwing.

## Prompt 5 — sleep

> A sleep tab built around a **24-hour dial**, not a 12-hour one — on a
> half-day face bedtime and wake time can land on the same point and the two
> handles become ambiguous to drag.
>
> A night is filed under the evening it began: Tuesday 23:30 → Wednesday
> 07:00 is Tuesday night. Handle the awkward half of that rule, where a
> bedtime past midnight still belongs to the evening before. Use local time
> throughout — `toISOString()` is UTC and will put the whole screen on the
> wrong night for half of every evening outside GMT.
>
> Each night also takes a **quality rating** and a **dream note**, and the
> rated/written nights collect into a journal below the year calendar.
>
> Make the rating slider genuinely good: draw it as a moon that waxes
> **continuously** as you drag — not five fixed pictures it snaps between —
> with the sky behind it warming toward sunrise as the rating climbs. Drive
> it with springs on one `requestAnimationFrame` loop, writing transforms
> straight onto the nodes, and only involve React when the *level* changes.
> Give the thumb a stiff spring and the moon a looser one so the sky keeps
> moving for a beat after your finger stops — that follow-through is most of
> what makes it feel alive rather than wired to a slider.

## Prompt 6 — the locked vault

> A private section holding bank accounts, cards, passwords and document
> scans, behind a lock screen.
>
> The lock is **four icons tapped in order out of nine**, not a typed PIN — a
> picture can't be read off your screen mid-type the way digits can.
> Encrypt with **AES-256-GCM**, keyed by **PBKDF2 at 150,000 iterations**
> over the tapped sequence, using the Web Crypto API entirely client-side.
>
> Never store the sequence. Store only a salt and an encrypted "canary"
> string; a sequence is correct exactly when it decrypts the canary back to
> the expected value.
>
> A fresh install provisions itself **silently with a known default
> sequence** and offers a change-lock flow in Settings — the same trade-off a
> router ships with a default admin password. Do **not** build an interactive
> "choose your sequence on first run" screen, and do **not** add a "forgot
> it?" reset. Both were built and explicitly removed; there is no recovery,
> by design.

## Prompt 7 — money, stock, and stats

> Add loans with EMI tracking and a **prepayment-effect calculator** (what
> does an extra ₹10,000 today actually save in interest?), a stock list, and
> a supplier **rate book** — what each item costs to buy, and per what.
>
> Keep the rate book separate from stock. Stock is "what's on the shelf
> today" and goes stale hourly; a purchase rate barely moves for months.
> Merging them means either counting quantity for everything just to record a
> price, or leaving half the list blank.
>
> Items carry **variants** — same product, different wattage/colour/size —
> generated from a trait builder that multiplies the axes out, rather than
> typed one combination at a time. Suppliers get a directory of their own
> with a tap-to-call number and free-form notes.
>
> Stats: a category pie with drill-down into subcategories and one level
> below that. Offer weekly / monthly / annually / all-time **and a custom
> date range** with one-tap presets — real questions ("the festival week",
> "since we reopened") don't line up with calendar months. Hide the month
> stepper for the periods it has no say in; a control that visibly does
> nothing reads as broken rather than inert.

## Prompt 8 — backup that actually restores

> One JSON export capturing the **entire** database — every transaction,
> note, habit, loan, and every photo and PDF attached to any of them — so a
> restore brings back everything, not just the numbers. Run it automatically
> once a day on-device and never prune old snapshots.
>
> Two rules learned the hard way:
>
> 1. **Restore must go through the same `normalizeDB` as a normal load.** A
>    separate restore path will skip migrations and bring data back in a
>    shape the current UI can't render.
> 2. **A merge-import must list every collection explicitly.** Any collection
>    left off the merge is silently ignored — the backup file contains it and
>    nothing reads it back out. This bug has now happened twice in this
>    codebase, to different collections. Write a test, or at minimum re-read
>    the merge function against the `DB` interface every time you add a
>    collection.

## Prompt 9 — ship it as an Android app

> Wrap it with **Capacitor 8**. Package id `com.prathamadarsh.ledger`.
>
> Handle system-bar insets **natively**, in `MainActivity`, by giving the
> WebView margins equal to the window insets and consuming them. Do not push
> insets into CSS variables — insets are dispatched during activity startup,
> before the WebView has finished loading, so the injected values land on a
> document that's about to be replaced, and you get a bottom inset of zero.
> Under gesture navigation that's easy to miss; under 3-button navigation the
> system bar sits directly on top of the app's own bottom nav and swallows
> every tap.
>
> Do **not** resize the WebView for the keyboard. Resizing a WebView's bounds
> while the keyboard animates in hits a long-standing Android compositor bug
> where the newly laid-out region never gets painted — the screen goes black
> below the fold while typing still works. Let Chrome shrink its own layout
> viewport (`interactive-widget=resizes-content`) and measure the keyboard
> from `visualViewport` as a fallback.
>
> Disable **algorithmic darkening** on the WebView. The app ships its own
> dark theme; Android's auto-darkening pass runs on top of colours that are
> already correct and gets them wrong — a transparent-background input gets
> read as a light surface and its text forced dark, so typing produces black
> text on a near-black sheet.
>
> Tear the service worker down on the native build. The APK already ships
> every asset, and a cache-first worker just serves a stale version after
> every update.

---

## Things to tell the agent *not* to do

Every one of these was built and then removed. They're the expensive
mistakes, and an agent left to its own judgement will make most of them:

| Don't | Why |
|---|---|
| Glassmorphism, `backdrop-filter`, blur panels | Tried across the whole app; slow on a real mid-range phone and unreadable over photos. |
| A `three.js` / WebGL animated background | Cost startup time and battery for decoration. |
| Filter notes by the ledger's current month | A note belongs to the day it was written. Made months of notes look deleted. |
| An interactive "set your vault sequence" first-run screen | Built, then explicitly reverted to a silent default plus a Settings change flow. |
| A "forgot your sequence?" vault reset | Added, then explicitly removed. The vault has no recovery, by design. |
| Inline the planner into the notes page | Flip-flopped once; it lives behind a header button as its own panel. |
| Store money as floats | Integer paise everywhere. |
| Prune old backups on a retention rule | A rule that can one day delete your last good copy. |
| A settings row for a flag nothing reads | Two of these shipped (`startScreen`, `carryOver`). A switch reporting a state it doesn't have is worse than no switch. |

## What's genuinely hard

If you're rebuilding this, budget most of your time for these — they're
where the original build actually went wrong, repeatedly:

1. **Android insets and the keyboard.** See prompt 9. Three different
   approaches failed before the native-margins one worked.
2. **Cold start with lots of attachments.** Splitting the database into a
   fast "core" and a heavier "attach" bucket, loading core first to unblock
   the UI, then folding attach in **by id** so anything added in the gap
   isn't clobbered.
3. **Migrations you can't undo.** Anything that rewrites stored data on load
   runs on the user's only copy. One migration in this codebase ran
   *backwards* for several releases and had to be reversed. Gate them on a
   stored schema version, make them idempotent, and never guess at a value
   you could instead leave alone.
