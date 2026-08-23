import type { DB } from '../types'

const DB_NAME = 'pratham-ledger'
const STORE = 'kv'
/** The old single-blob key. Only ever read now, as a one-time migration
 *  source for an install that predates the split below. */
const LEGACY_KEY = 'db'
const CORE_KEY = 'db-core'
const ATTACH_KEY = 'db-attach'

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function getKey(key: string): Promise<unknown> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      }),
  )
}

function putKey(key: string, value: unknown): Promise<void> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(value, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }),
  )
}

/**
 * The four collections that exist almost entirely to carry photo/PDF
 * attachments — loan sanction letters and EMI schedules, document scans,
 * vault card/ID photos, purchase catalog shots. None of them are needed to
 * open the app and add a Daily entry, and every photo or PDF anyone attaches
 * to any of the four grows the one thing a cold start used to have to read
 * and deserialise in full before showing anything at all.
 *
 * Kept out of the "core" blob loadCore() reads and put in this "attach"
 * bucket instead, fetched separately by loadAttach() *after* the app has
 * already become interactive — see the two-phase load in
 * StoreProvider (store.tsx). Round-trips exactly: mergeSplit(...splitForSave(db))
 * reproduces the original shape.
 */
export interface AttachPayload {
  loans: DB['loans']
  docItems: DB['docItems']
  vaultItems: DB['vaultItems']
  passwordItems: DB['passwordItems']
  purchaseItems: DB['purchaseItems']
}

function splitForSave(data: DB): { core: Record<string, unknown>; attach: AttachPayload } {
  const { loans, docItems, vaultItems, passwordItems, purchaseItems, ...core } = data
  return { core, attach: { loans, docItems, vaultItems, passwordItems, purchaseItems } }
}

/**
 * The small, fast read a cold start actually waits on — everything except
 * the four attachment-heavy collections above.
 *
 * `full: true` means this came from an install that has not been split yet
 * (an old single `db` blob, with everything still inline) — loadAttach()
 * has nothing further to add in that case, since this already carries it
 * all. A background write below reshapes storage into core+attach so every
 * open after this one is fast; there is no way to make the migration open
 * itself any faster; the read-and-deserialise cost has already happened by
 * the time there is anything to strip.
 */
export async function loadCore(): Promise<{ data: Partial<DB> | null; full: boolean }> {
  try {
    const core = await getKey(CORE_KEY)
    if (core) return { data: core as Partial<DB>, full: false }

    const legacy = await getKey(LEGACY_KEY)
    if (!legacy) return { data: null, full: false }

    const { core: splitCore, attach } = splitForSave(legacy as DB)
    void putKey(CORE_KEY, splitCore)
    void putKey(ATTACH_KEY, attach)
    return { data: legacy as Partial<DB>, full: true }
  } catch {
    // Private mode / IndexedDB unavailable — fall back to localStorage,
    // which never had the split applied, so this is always "full".
    const raw = localStorage.getItem(DB_NAME)
    return { data: raw ? (JSON.parse(raw) as DB) : null, full: true }
  }
}

/** The heavier bucket. Loaded in the background, after `ready` fires, not
 *  before — see StoreProvider. */
export async function loadAttach(): Promise<AttachPayload | null> {
  try {
    return ((await getKey(ATTACH_KEY)) as AttachPayload) ?? null
  } catch {
    return null
  }
}

let saveTimer: number | undefined

/** Debounced background write. UI never waits on this. Splits the same way
 *  loadCore/loadAttach expect to read it back. */
export function save(data: DB): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const { core, attach } = splitForSave(data)
    try {
      await putKey(CORE_KEY, core)
      await putKey(ATTACH_KEY, attach)
    } catch {
      try {
        localStorage.setItem(DB_NAME, JSON.stringify(data))
      } catch {
        /* out of quota — nothing sensible to do */
      }
    }
  }, 150) as unknown as number
}

export async function wipe(): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const s = tx.objectStore(STORE)
      s.delete(CORE_KEY)
      s.delete(ATTACH_KEY)
      s.delete(LEGACY_KEY)
      tx.oncomplete = () => resolve()
    })
  } catch {
    /* ignore */
  }
  localStorage.removeItem(DB_NAME)
}
