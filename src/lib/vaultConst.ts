/**
 * Shared between the real lock screen (screens/Authentication.tsx) and the
 * dev-only fake-data seeder (lib/fakeData.ts).
 *
 * Split out to a leaf module rather than exported from Authentication.tsx
 * itself: fakeData.ts is imported by store.tsx, and Authentication.tsx
 * imports the store — so fakeData.ts importing Authentication.tsx directly
 * would have closed a cycle back through it. A small constant with no
 * dependencies of its own doesn't need to sit inside the screen that
 * happens to use it first.
 *
 * The vault's actual PIN is never a constant — see VaultLock in
 * Authentication.tsx, which has the owner choose one on first use and
 * derives everything from that. Only the dev preview's own demo PIN lives
 * as a constant, in fakeData.ts, since it never touches a real vault.
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
