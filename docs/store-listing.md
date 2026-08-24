# Store listing copy

Copy-paste-ready text for submitting Kaithwas to the Google Play Console or App Store Connect. Nothing here is final — swap in real screenshots (see `docs/screenshots/`) and adjust wording as the app changes, but the facts (offline, no account, what's encrypted, what isn't) should stay accurate to the code.

---

## App name

**Kaithwas**

## Subtitle / short description

*(Apple: 30 characters · Google Play short description: 80 characters)*

> Offline ledger, journal & vault

## Promotional text

*(Apple only, 170 characters — the one field you can update without a new review)*

> A shop's books, notes, habits and locked documents — all on the phone, nothing on a server. No account, no subscription, no internet required.

## Full description

*(Apple description / Google Play full description — both allow up to 4000 characters)*

> **Kaithwas is a single-owner business and life tracker that never leaves your phone.**
>
> Built for running a small shop day to day — the books, the notes, the habits, the sleep, the loans, and the one drawer that stays locked — without an account, a subscription, or a network connection. Every transaction, photo, and document is stored in a single file on the device, and nothing is ever sent anywhere unless you export it yourself.
>
> **Daily ledger**
> Quick-add income and expense entries through a purpose-built calculator keypad — not a form full of fields. Categories and subcategories, split payments across accounts, deal ratings, and a draft that survives the app being backgrounded mid-entry.
>
> **Journal & daily planner**
> A running notebook of dated notes, with a Morning/Afternoon/Evening task planner behind its own header icon. Auto-plan buckets your tasks by priority and duration in one tap, and respects anything you've already placed by hand.
>
> **Habits & mood**
> Streaks for both plain tap-to-log habits and metered ones you build up through the day. Nine hand-picked moods that carry forward until you log a new one — no pretending yesterday's feelings reset at midnight — and eight different animated card surfaces to pick from per habit.
>
> **Sleep**
> A night-by-night bedtime/wake dial with a rolling 7-night average and a full activity calendar.
>
> **A private, locked vault**
> Bank accounts, cards, passwords, and documents — photo or PDF, rendered right in the app — behind a lock of four tapped icons instead of a typed PIN, changeable any time from Settings to a sequence only you know. AES-256-GCM encryption, derived on-device; the sequence itself is never stored anywhere, not even by the app.
>
> **Loans**
> EMI tracking, a prepayment-effect calculator, and reminders ahead of each due date.
>
> **Purchases & stock**
> A supplier rate book with per-item variants — colour, size, base, whatever the product actually varies by — so "what did I pay for this last time" is a search, not a memory.
>
> **Backup that means it**
> One export captures the entire database, every photo and PDF included, so a restore brings back everything — not just the numbers. Runs automatically once a day on-device; nothing is ever silently deleted to save space.
>
> No ads. No analytics. No account to create or lose access to. Your data is yours, on your phone, in one file you control.

## Keywords

*(Apple: 100 characters, comma-separated, no spaces after commas needed)*

```
expense tracker,ledger,shop accounting,budget,offline,journal,habit tracker,vault,password manager,loan EMI
```

## Category

- **Primary:** Finance
- **Secondary:** Productivity

## What's new (template for release notes)

```
- [Feature/fix summary here]
```

## Privacy / data safety

Accurate as of this write-up — re-verify against the code before submitting, since a false answer here can get an app rejected or removed.

- **No data collected.** Kaithwas makes no network requests for app functionality. There is no analytics SDK, no crash reporter, no ad network.
- **No account.** There is no sign-up, no login, no server-side user record.
- **All storage is local**, in the device's IndexedDB. Nothing syncs unless the owner manually exports a backup file and moves it themselves (e.g. via the OS share sheet).
- **Vault encryption is on-device**: AES-256-GCM, key derived via PBKDF2 from a passphrase (a tapped icon sequence) that is never itself stored or transmitted.
- **Permissions used:** camera/photo library (attaching receipts and documents), file storage (writing backup files), vibration (haptic feedback). No location, no contacts, no microphone.

## Support URL / contact

*(Fill in before submitting — both stores require a working support link.)*

- Support email / page: `TODO`
- Privacy policy URL: `TODO` — required by both stores even for a no-data-collection app; a one-page static statement covering the points above is enough.
