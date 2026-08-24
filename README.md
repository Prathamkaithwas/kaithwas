<div align="center">

<img src="docs/icon.png" width="88" height="88" alt="Kaithwas icon" />

# Kaithwas

**An offline-first ledger, journal and vault for running a small shop — built for one, not for a market.**

No account. No server. No subscription. Every entry, photo and document lives on the device it was typed on.

[![Platform](https://img.shields.io/badge/platform-Android-3ddc84?logo=android&logoColor=white)](#download)
[![Built with React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](#under-the-hood)
[![Capacitor](https://img.shields.io/badge/Capacitor-8-119eff?logo=capacitor&logoColor=white)](#under-the-hood)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[⬇ Download the latest APK](../../releases/latest)**

</div>

---

## Screenshots

<!--
  Drop real device screenshots in `docs/screenshots/` and reference them here.
  A 2–4 column table reads well on GitHub, e.g.:

  | Daily | Habits | Shafali | Sleep |
  |:---:|:---:|:---:|:---:|
  | <img src="docs/screenshots/daily.png" width="200"> | <img src="docs/screenshots/habits.png" width="200"> | <img src="docs/screenshots/vault.png" width="200"> | <img src="docs/screenshots/sleep.png" width="200"> |

  Good candidates, one per screen: the Daily ledger, Niba with Today's Plan
  open, Habits (mood tile + a couple of habit cards), Sleep's dial, the
  Shafali lock screen, an unlocked bank/card view, and Documents.
-->

*Screenshots aren't in this repo yet — this build environment can't export image files to disk. If you're reading this and have the app open on a phone, five or six screenshots dropped into `docs/screenshots/` (see that folder's own README) is all this section needs.*

## Download

The latest signed debug APK is attached to **[the newest GitHub Release](../../releases/latest)** — no build step required, just download and install (you'll need to allow "install from unknown sources" once, since this isn't distributed through a store). Every release is built from the exact commit it's tagged on.

Want to build it yourself instead? See [Getting started](#getting-started) below.

## What this is

Kaithwas is a single-owner business and life tracker, built to run entirely on one Android phone with nothing on the other end of a network call. It started as an expense ledger for a shop and grew into the one place its owner actually opens every day — the books, the notes, the habits, the sleep, the loans, and the one drawer that stays locked.

Every screen was designed for a specific, real complaint from actual use, not a feature checklist. The calculator remembers what you typed if the phone gets backgrounded mid-entry. Categories stay collapsed the way you left them, even after a full restart. The daily mood carries forward until you log a new one, instead of pretending yesterday's feelings reset at midnight. The vault locks with four icons you tap in your own order, not a PIN anyone could read off your screen. None of it is hypothetical — it's the record of fixing what was actually annoying to use.

## Features, in detail

### Daily ledger
Quick-add income and expense entries through a purpose-built calculator keypad rather than a scrolling form: type the amount, pick a category and account, done. Categories nest into subcategories, one entry can split across several accounts, and every entry can carry a photo. A "deal rating" records how a sale actually went, separate from the number. Swipe a row open for Edit, Duplicate, or a **hold-to-delete** button — deleting is a deliberate 800ms press with a closing ring, never a stray tap. If the phone gets backgrounded mid-entry (a call, a notification, switching apps), the draft is written to storage on every change and restored the moment you come back — nothing typed is ever silently lost.

### Niba — journal & daily planner
A running notebook of dated notes, newest first, that never disappears just because you're not browsing "this month" any more — a note belongs to the day it was written, not to whatever period the ledger happens to be showing. Each note can wear its own **skin** — ten gradients (blossom, orchid, iris, dusk, sunset, ocean, forest, ember, gold, ink) or a photo from the gallery, each with a corner sheen and a fine weave over it so a card reads as a surface catching light rather than a flat rectangle of colour. Left on Auto a note takes one by its position in the list, the way it always did.

**Today's Plan** lives behind its own header icon as a full-screen panel: tasks bucketed into Morning / Afternoon / Evening, a priority dot on each, drag-to-reorder within a block, and an **Auto-plan** pass that buckets everything by priority and duration in one tap — respecting anything you've already placed by hand.

### Habits & mood
Two kinds of habit: a plain tap-to-mark-done, and a **metered** one you build up through the day (pages read, glasses of water) with its own extra row of stats — best run, last-30-days average — instead of just a streak. Nine hand-picked moods replace a generic 1–5 scale, and the mood shown on the Habits tab **carries forward** day to day until you log a new one, rather than resetting to a blank "tap to log" prompt every midnight. Every day's mood and its optional note also read as a **journal** — newest first, straight down the page — not just a calendar of coloured squares. Each habit can pick from eight animated card surfaces (dither, lenticular, specular, foil, metaball, moiré, aurora, grid) — press and hold a card to see it move — or a **custom photo** from the gallery instead, for whoever gets bored of the eight built-in ones.

Any habit can also carry **daily reminders** — a list of clock times, not a single one, so something like medicine taken three times a few minutes apart is just three reminders rather than a special repeat rule nobody can edit later. These are real scheduled Android notifications and fire whether or not the app is open.

Picking the day's mood then opens a short **written reflection** — "what is worth remembering about today?", "what could have gone better?", "what are you thankful for?". Both the questions and how many there are are yours: **More → Configuration → Journal questions** edits the list in place, and deleting one keeps every answer already written against it, so putting the question back brings its history back too. Answers are filed with the day and read back in the Journal, which defaults to showing only days something was actually written on — a month of bare mood taps is a chart, not something anyone re-reads.

### Sleep
A 24-hour dial, not a 12-hour one — bedtime and wake time can't land on the same point the way they would on a half-day face, so the two handles are never ambiguous to drag. A rolling 7-night average sits above it, with a full year-of-squares activity calendar below.

Each night also takes a **quality rating** and a **dream note**. The rating is a slider you drag or tap, drawn as a moon that actually waxes under your thumb — clouded over and dark at "Rough", a clear full moon with the stars out at "Great" — with the sky behind it warming toward sunrise as the rating climbs. It's driven by three springs on one animation frame (thumb, label, moon phase), so the moon keeps moving for a beat after your finger stops instead of snapping between five fixed pictures. Anything remembered on waking goes in a note underneath, and every rated or written-up night collects into a **dream journal** below the calendar — newest first, read straight down, rather than tapped open one square at a time.

### Shafali — the private vault
Bank accounts (with real network marks — Visa, Mastercard, RuPay — not generic rings), cards, passwords, and documents, behind a lock of four tapped icons instead of a typed PIN. A fresh install opens with a known default (four taps of the same icon — see `DEFAULT_LOCK_SEQUENCE` in `src/lib/vaultConst.ts`, the same way the very first version shipped with a fixed digit PIN); **More → Configuration → Vault lock** changes it to a sequence only the owner knows, in one sheet — enter the current one, pick a new one, confirm it. AES-256-GCM encryption, keyed by a PBKDF2-derived key from whatever sequence is active (150,000 iterations); the sequence itself is never stored anywhere, only a salt and an encrypted "canary" string used to tell a right sequence from a wrong one without ever knowing the right one in plain form. Documents (photo or PDF scans, rendered right in the app with a real PDF preview) sit behind the same screen but aren't encrypted the same way, since they're not the kind of thing that needs it — bank details and passwords are.

### Loans
EMI tracking against real loan terms, a prepayment-effect calculator (what does paying an extra ₹10,000 today actually save in interest?), and reminders that fire ahead of each due date.

### Balance — the shop's udhaar khata
Who owes the shop money, and how long it has been that way. The mirror of Loans, which tracks money going the other way on fixed terms; this has no terms at all, because a customer takes goods on Tuesday and squares up whenever they can.

Each person is a running account rather than a stored total — every take and every settlement is its own dated line, and the balance is derived from them. A stored number answers "how much" and nothing else; what actually gets argued about across a counter is *which* items and *what* was paid against them.

Settlements can be **cash or in kind**. Half of them in a real shop are not money — someone squares up with a day's labour or by handing back stock. Those count against the debt but stay marked as goods, so they never read as cash that came through the till.

The list sorts by how overdue a debt is rather than by size: a small amount owed since March is the one worth a phone call, a large one from yesterday is just business. Anything past a month colours itself. One button opens WhatsApp with "₹2,400 pending since 12 August" already written — you still pick the chat and press send.

### Purchases & stock
A supplier rate book, not just a shopping list: each item can carry variants — colour, size, base, whatever it actually varies by — generated from a trait builder rather than typed out combination by combination. Categories fold shut and **stay** shut across app restarts, so a long list doesn't have to be re-collapsed every time the app opens. A bulk buy ("50 metres for ₹1,000") is entered as what the bill actually says and divided down into a rate for you.

Suppliers get a directory of their own behind the header's phone icon — a number you can tap to call straight from the list, plus room for terms, delivery days, who to ask for. Kept separate from the plain supplier *name* typed on each rate: most items only ever need the name, and a rate is filed under a name rather than under a phone number.

### Stats
Where the money actually went, as a pie by category with a drill-down into subcategories — and a second level below that, so "how much on family" and "how much to one specific person" are both one tap away. Weekly, monthly, annually, all-time, or a **custom date range** with one-tap presets (last 7 / 30 / 90 days, last year) for the spans that don't line up with a calendar month — a festival week straddling two months, one supplier's billing cycle, everything since the shop reopened.

### Backup that means it
One JSON export captures the *entire* database — every transaction, habit, note, loan, and every photo and PDF attached to any of them — so a restore brings back everything, not just the numbers. Runs automatically once a day on-device, and old snapshots are never pruned: disk is cheap, and a retention rule is a rule that could one day delete the last good copy.

## Under the hood

- **React 19 + TypeScript + Vite**, wrapped as a native Android app with **Capacitor 8** — the same codebase runs in a browser for development and ships as a real APK.
- **No backend, ever.** The whole database is one JSON object, persisted through IndexedDB. There is no account system and nothing leaves the device unless exported by hand.
- **Fast cold start, independent of how much you've attached.** The database splits into a small "core" (transactions, habits, notes — everything the first screen needs) and a separate "attach" bucket (loans, documents, vault items, purchase items — wherever photos and PDFs pile up). Core loads first and unblocks the UI immediately; the heavier bucket loads in the background right after, folded in by id so nothing added during that gap is lost.
- **Tailwind CSS v4** for a dense, flat, dark-first design system — no `backdrop-filter`, no idle or looping animation, nothing spent on decoration that isn't communicating a real state change.
- **Web Crypto API** (AES-256-GCM + PBKDF2) for the vault, entirely client-side — see `src/lib/crypto.ts`.
- A **service worker** caches the app shell for the browser/PWA path only; it's explicitly torn down on the native Android build, where the APK already ships every asset and a cache-first worker would just serve a stale version after every update.

## Getting started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5180` — the app runs fully in the browser for development, IndexedDB and all. A first run seeds realistic sample data automatically in dev mode (never in a production build), including a demo vault unlockable with **four taps of the anchor** — the same `DEFAULT_LOCK_SEQUENCE` a fresh install provisions itself with, so the demo data and a real first run open the same way.

### Build the Android app

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Requires the Android SDK and JDK 21 on `JAVA_HOME`. The resulting APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

### Rebuilding it with an AI agent

[`docs/rebuild-prompt.md`](docs/rebuild-prompt.md) is a staged set of prompts for recreating this app from scratch in a fresh agent session (Antigravity, Claude Code, Cursor — whichever), including the list of things to explicitly tell the agent *not* to do. Every entry on that list was built during the original development and then removed, so it's the shortest path to the version that actually works rather than the generic one an agent reaches for first.

### Publishing to an app store

[`docs/store-listing.md`](docs/store-listing.md) has copy-paste-ready text for Google Play Console / App Store Connect — name, description, keywords, category, and an honest data-safety statement (this app collects nothing, so that part's easy) — so a future store submission is mostly filling in a form, not writing marketing copy from scratch.

## Project structure

```
src/
  screens/     One file per tab/section — Trans (Daily/Niba), Habits, Sleep,
               Authentication (the vault), Loans, Purchase, More, ...
  components/  Shared UI: the calculator keypad, the drag-based time ruler,
               hold-to-delete, toasts, pickers
  lib/         Storage (db.ts — the core/attach split), crypto, date math,
               backup/restore, PDF rendering, the auto-planner algorithm
  store.tsx    The single app-wide store — one context, one reducer-shaped API
android/       Capacitor's native Android project
docs/
  rebuild-prompt.md   Staged prompts for rebuilding this app with an AI agent
  store-listing.md    Copy-paste-ready app store submission text
  screenshots/        Drop real device screenshots here
```

## License

MIT — see [LICENSE](LICENSE).
