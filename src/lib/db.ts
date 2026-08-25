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
  partnerItems: DB['partnerItems']
  purchaseItems: DB['purchaseItems']
  /**
   * Photos belonging to records that must stay in core (see PhotoSidecar).
   * Optional: a database written before this existed simply has none, and
   * its photos are still sitting inline in core where the merge below finds
   * them anyway.
   */
  photoSidecar?: PhotoSidecar
}

/**
 * The photos that could not be moved out of core by moving a whole
 * collection.
 *
 * The four collections above exist *mostly* to carry attachments, so keeping
 * the whole list out of core was enough. Three others carry photos on records
 * that core genuinely needs at once: a Daily entry's receipt photos, a note's
 * skin, a habit card's background. Those lists cannot move — Daily, Niba and
 * Habits are the first things drawn — but the images on them are never needed
 * to draw a row, only to open one.
 *
 * So the records stay in core and their image fields are lifted out to here.
 * Measured on a dev build: three habit cards and four note skins took core
 * from 26KB to 825KB, and core is rewritten *in full* on every change —
 * every meter drag, every tick, every keystroke — as well as read in full on
 * every cold start. Receipt photos on transactions are the same problem and
 * grow without limit.
 *
 * Keyed by record id, so a photo can find its way home even if the record
 * moved, and so a record deleted while this was on disk simply leaves an
 * orphan entry that the next save drops.
 */
export interface PhotoSidecar {
  /** transaction id -> its `photo` / `photos` fields */
  transactions: Record<string, { photo?: string; photos?: string[] }>
  /** memo id -> customSkinImage */
  memos: Record<string, string>
  /** habit id -> customSurfaceImage */
  habits: Record<string, string>
}

function splitForSave(data: DB): { core: Record<string, unknown>; attach: AttachPayload } {
  const { loans, docItems, vaultItems, passwordItems, partnerItems, purchaseItems, ...rest } = data

  const photoSidecar: PhotoSidecar = { transactions: {}, memos: {}, habits: {} }

  // Only the records that actually carry an image are copied; the rest are
  // passed through by reference, so this costs nothing on a database with no
  // photos in it.
  const transactions = rest.transactions.map((t) => {
    if (!t.photo && !t.photos?.length) return t
    const { photo, photos, ...lean } = t
    photoSidecar.transactions[t.id] = { photo, photos }
    return lean as typeof t
  })
  const memos = rest.memos.map((m) => {
    if (!m.customSkinImage) return m
    const { customSkinImage, ...lean } = m
    photoSidecar.memos[m.id] = customSkinImage
    return lean as typeof m
  })
  const habits = rest.habits.map((h) => {
    if (!h.customSurfaceImage) return h
    const { customSurfaceImage, ...lean } = h
    photoSidecar.habits[h.id] = customSurfaceImage
    return lean as typeof h
  })

  return {
    core: { ...rest, transactions, memos, habits },
    attach: { loans, docItems, vaultItems, passwordItems, partnerItems, purchaseItems, photoSidecar },
  }
}

/**
 * Puts the sidecar's photos back on their records.
 *
 * Only ever *adds*: a record that already carries an image keeps it, so a
 * photo attached in the gap between the app becoming interactive and the
 * attachment bucket arriving is never overwritten by the older copy on disk.
 * Same rule, and same reason, as the id-union in mergeAttach.
 */
export function applyPhotoSidecar(data: DB, sidecar: PhotoSidecar | undefined): DB {
  if (!sidecar) return data
  const hasAny =
    Object.keys(sidecar.transactions).length ||
    Object.keys(sidecar.memos).length ||
    Object.keys(sidecar.habits).length
  if (!hasAny) return data

  return {
    ...data,
    transactions: data.transactions.map((t) => {
      const p = sidecar.transactions[t.id]
      if (!p || t.photo || t.photos?.length) return t
      return { ...t, ...(p.photo ? { photo: p.photo } : null), ...(p.photos ? { photos: p.photos } : null) }
    }),
    memos: data.memos.map((m) => {
      const img = sidecar.memos[m.id]
      return !img || m.customSkinImage ? m : { ...m, customSkinImage: img }
    }),
    habits: data.habits.map((h) => {
      const img = sidecar.habits[h.id]
      return !img || h.customSurfaceImage ? h : { ...h, customSurfaceImage: img }
    }),
  }
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
