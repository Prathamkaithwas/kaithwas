/**
 * Shared between the real lock screen (screens/Authentication.tsx), its
 * change-lock flow (screens/More.tsx), and the dev-only fake-data seeder
 * (lib/fakeData.ts).
 *
 * Split out to a leaf module rather than exported from Authentication.tsx
 * itself: fakeData.ts is imported by store.tsx, and Authentication.tsx
 * imports the store — so fakeData.ts importing Authentication.tsx directly
 * would have closed a cycle back through it. A small constant with no
 * dependencies of its own doesn't need to sit inside the screen that
 * happens to use it first.
 */

/** Encrypted and stored at setup time; decrypting it back correctly is how a
 *  right-vs-wrong passphrase is told apart without ever storing the passphrase. */
export const CANARY = 'pratham-ledger-vault-ok'

/**
 * The lock is a sequence of four taps on these, not four digits — a picture
 * you pick once instead of a number you type every time. Nine rather than
 * ten (a PIN's whole digit set) because there is no equivalent of "0" to
 * reach for; nine still gives a four-tap sequence more combinations than a
 * four-digit PIN has (9·8·7·6 without repeats vs. 10,000), and nine is as
 * many distinct, instantly-recognisable glyphs as fit a 3-column grid in
 * three rows with a backspace row left over — see VaultLock's icon map in
 * Authentication.tsx for which glyph each id actually draws.
 */
export const LOCK_ICON_IDS = [
  'heart',
  'star',
  'sun',
  'moon',
  'leaf',
  'anchor',
  'camera',
  'music',
  'umbrella',
] as const

export type LockIconId = (typeof LOCK_ICON_IDS)[number]

/** The tapped sequence, turned into the string that actually goes through
 *  deriveVaultKey — a plain join, since PBKDF2 doesn't care what shape its
 *  input took before it became a string. Shared so fakeData.ts's demo
 *  sequence and VaultLock's real one are guaranteed to encode the same way. */
export function sequenceToPassphrase(ids: readonly string[]): string {
  return ids.join(',')
}

/**
 * What a fresh install locks itself with, silently, the same way the
 * vault's very first version always provisioned itself with the fixed
 * digit PIN 6666 — a known default, changeable any time from More →
 * Settings → Vault lock (see ChangeVaultLock in screens/More.tsx), not a
 * secret. Anyone reading this file knows it; the owner is expected to
 * change it, the same way a router's default admin password is meant to
 * be changed rather than kept.
 */
export const DEFAULT_LOCK_SEQUENCE: LockIconId[] = ['anchor', 'anchor', 'anchor', 'anchor']

/**
 * The same taps, encoded the way the vault's *first* version encoded them.
 *
 * That version was a four-digit keypad, and a lock set on it stored a canary
 * encrypted under the typed digits — "6666" for the fixed default it shipped
 * with. When the lock became four tapped icons, the nine icons were laid out
 * so that tapping the sixth (anchor) four times reproduced that default, and
 * DEFAULT_LOCK_SEQUENCE was set to anchor x4 for exactly that reason.
 *
 * What was never carried across is the *string* the key is derived from.
 * `sequenceToPassphrase` joins icon ids with commas, so the same four taps
 * now derive a key from "anchor,anchor,anchor,anchor" rather than "6666" —
 * a completely different key, and therefore a canary that will not decrypt.
 * Every vault provisioned by the digit build was locked out by the upgrade,
 * with its contents intact but unreachable.
 *
 * This rebuilds the old string from a tapped sequence — each icon's position
 * in the grid, 1-9, joined with nothing between them — so the original
 * passphrase can be tried as a fallback and those vaults open again. It is a
 * read path for old data, not a second way to lock a vault: nothing new is
 * ever provisioned with it.
 */
export function sequenceToLegacyPin(ids: readonly string[]): string {
  return ids
    .map((id) => (LOCK_ICON_IDS as readonly string[]).indexOf(id) + 1)
    .join('')
}
