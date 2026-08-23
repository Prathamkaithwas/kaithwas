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
