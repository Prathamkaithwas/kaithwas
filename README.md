<div align="center">

<img src="public/icon.svg" width="88" height="88" alt="Kaithwas icon" />

# Kaithwas

**An offline-first ledger, journal and vault for running a small shop — built for one, not for a market.**

No account. No server. No subscription. Every entry, photo and document lives on the device it was typed on.

[![Platform](https://img.shields.io/badge/platform-Android-3ddc84?logo=android&logoColor=white)](#)
[![Built with React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](#)
[![Capacitor](https://img.shields.io/badge/Capacitor-8-119eff?logo=capacitor&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## Screenshots

<!--
  Drop real device screenshots in `docs/screenshots/` and reference them
  here — e.g. docs/screenshots/daily.png, habits.png, vault.png, sleep.png.
  A 2–4 column table reads well on GitHub:

  | Daily | Habits | Vault | Sleep |
  |:---:|:---:|:---:|:---:|
  | <img src="docs/screenshots/daily.png" width="200"> | <img src="docs/screenshots/habits.png" width="200"> | <img src="docs/screenshots/vault.png" width="200"> | <img src="docs/screenshots/sleep.png" width="200"> |
-->

*Screenshots coming soon.*

## What this is

Kaithwas is a single-owner business and life tracker, built to run entirely on one Android phone with nothing on the other end of a network call. It started as an expense ledger for a shop and grew into the one place its owner actually opens every day — the books, the notes, the habits, the sleep, the loans, and the one drawer that stays locked.

Every screen was designed for a specific, real complaint from actual use, not a feature checklist. The calculator remembers what you typed if the phone gets backgrounded mid-entry. Categories stay collapsed the way you left them, even after a full restart. The daily mood carries forward until you log a new one, instead of pretending yesterday's feelings reset at midnight. None of it is hypothetical — it's the record of fixing what was actually annoying to use.

## Features

**Daily ledger** — quick-add income/expense entries through a purpose-built calculator keypad (not a form), categories and subcategories, split payments across accounts, deal ratings, and hold-to-delete instead of a confirm dialog for anything you're about to remove.

**Niba (journal)** — a running notebook of dated notes, with **Today's Plan** living behind its own header icon: a Morning/Afternoon/Evening task planner with an auto-plan pass (priority + duration, respects anything you've placed by hand) and drag-to-reorder.

**Habits & mood** — streaks, both plain tap-to-log habits and metered ones (build up a number through the day rather than one checkbox), nine hand-picked moods that carry forward day to day, and eight different animated card surfaces you can pick per habit.

**Sleep** — a night-by-night bedtime/wake dial with a rolling 7-night average and a full activity calendar.

**Vault** — bank accounts, cards (with real network marks — Visa, Mastercard, RuPay), passwords, and documents (photo or PDF, rendered in-app), all behind a PIN you choose on first use and AES-256-GCM encryption (PBKDF2, 150k iterations) — the passphrase itself is never stored, only a salt and an encrypted canary used to tell a right PIN from a wrong one.

**Loans** — EMI tracking, a prepayment-effect calculator, and reminders ahead of each due date.

**Purchases & stock** — a supplier rate book with per-item variants (colour, size, base — whatever the product actually varies by), so "what did I pay for this last time" is a search, not a memory.

**Backup that means it** — one JSON export captures the entire database, attachments included, so a restore brings back everything, not just the numbers. Runs automatically once a day on-device; nothing is ever silently pruned.

## Under the hood

- **React 19 + TypeScript + Vite**, wrapped as a native Android app with **Capacitor 8** — the same codebase runs in a browser for development and ships as a real APK.
- **No backend.** The whole database is one JSON object, persisted through IndexedDB. There is no account system and nothing ever leaves the device unless you export it yourself.
- **Fast cold start on real data.** The database splits into a small "core" (transactions, habits, notes — everything the first screen needs) and a separate "attach" bucket (loans, documents, vault items, purchase items — wherever photos and PDFs pile up). Core loads first and unblocks the UI immediately; the heavier bucket loads in the background right after, so opening the app doesn't get slower just because you've attached more scans over time.
- **Tailwind CSS v4** for a dense, flat, dark-first design system — no backdrop-filter, no idle/looping animation, nothing spent on decoration that isn't communicating a state change.
- **Web Crypto API** (AES-256-GCM + PBKDF2) for the Vault, entirely client-side.

## Getting started

```bash
npm install
npm run dev
```

Opens at `http://localhost:5180` — the app runs fully in the browser for development, IndexedDB and all.

### Build the Android app

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Requires the Android SDK and a JDK 21 on `JAVA_HOME`. The resulting APK is at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Project structure

```
src/
  screens/     One file per tab/section — Trans (Daily/Niba), Habits, Sleep,
               Authentication (Vault), Loans, Purchase, More, ...
  components/  Shared UI: the calculator keypad, hold-to-delete, toasts, pickers
  lib/         Storage (db.ts), crypto, date math, backup/restore, PDF
               rendering, the auto-planner algorithm
  store.tsx    The single app-wide store — one context, one reducer-shaped API
android/       Capacitor's native Android project
```

## License

MIT — see [LICENSE](LICENSE).
