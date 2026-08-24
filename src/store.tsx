import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Account,
  Category,
  Chore,
  DB,
  DocItem,
  Habit,
  ImportantDate,
  JournalPrompt,
  MoodDef,
  Loan,
  Memo,
  PlannerBlock,
  PlannerTask,
  RepeatRule,
  Settings,
  SleepQuality,
  PurchaseItem,
  StockItem,
  Supplier,
  Transaction,
  VaultCategory,
  VaultSecurity,
} from './types'
import { DEFAULT_JOURNAL_PROMPTS } from './types'
import * as store from './lib/db'
import { seedDB, uid } from './lib/seed'
import { normalizeDB } from './lib/normalize'
import { advance, parseISO } from './lib/date'
import { autoPlanTasks } from './lib/planner'
import { isEmptyOfUserData, withFakeData, withFakeVaultData } from './lib/fakeData'

interface Ctx {
  db: DB
  ready: boolean
  addTx: (t: Omit<Transaction, 'id'>) => string
  updateTx: (t: Transaction) => void
  /** Moves the entry out of sight. Nothing is destroyed — see restoreTx. */
  deleteTx: (id: string) => void
  restoreTx: (id: string) => void
  restoreMemo: (id: string) => void
  /** Puts an archived habit or job back on its screen. */
  unarchiveHabit: (id: string) => void
  unarchiveChore: (id: string) => void
  addAccount: (a: Omit<Account, 'id' | 'order'>) => void
  updateAccount: (a: Account) => void
  deleteAccount: (id: string) => void
  reorderAccounts: (ids: string[]) => void
  /** Floats an account/category to the top of its picker, or lets it back down. */
  togglePinAccount: (id: string) => void
  togglePinCategory: (id: string) => void
  addCategory: (c: Omit<Category, 'id' | 'order'> & { id?: string }) => void
  updateCategory: (c: Category) => void
  deleteCategory: (id: string, reassignTo?: string) => void
  reorderCategories: (ids: string[]) => void
  setBudget: (month: string, categoryId: string | undefined, amount: number) => void
  copyBudget: (fromMonth: string, toMonth: string) => void
  addRepeat: (r: Omit<RepeatRule, 'id'>) => void
  updateRepeat: (r: RepeatRule) => void
  deleteRepeat: (id: string) => void
  addMemo: (m: Omit<Memo, 'id'>) => void
  updateMemo: (m: Memo) => void
  deleteMemo: (id: string) => void
  /** Accepts a pre-made id so a caller that needs it right away — scheduling
   *  a new habit's reminders, for one — doesn't have to guess it back out of
   *  the freshly-saved list. */
  addHabit: (h: Omit<Habit, 'id' | 'order'> & { id?: string }) => void
  updateHabit: (h: Habit) => void
  deleteHabit: (id: string) => void
  reorderHabits: (ids: string[]) => void
  /** flips whether `habitId` is logged done on `date` (YYYY-MM-DD) */
  toggleHabitLog: (habitId: string, date: string) => void
  /** records how much was done; 0 or less clears the day */
  setHabitAmount: (habitId: string, date: string, amount: number) => void

  addChore: (c: Omit<Chore, 'id' | 'order'>) => void
  updateChore: (c: Chore) => void
  deleteChore: (id: string) => void
  /** records `choreId` as done on `date`; adding the same date twice is a no-op */
  logChore: (choreId: string, date: string, note?: string) => void
  removeChoreLog: (logId: string) => void

  /**
   * Files a night's sleep. One night per date: saving over a date that
   * already has a night replaces it rather than stacking a second one, since
   * the screen only ever shows one and a hidden duplicate would quietly skew
   * every average.
   */
  saveSleep: (date: string, start: string, end: string) => void
  removeSleep: (id: string) => void
  /** Rates a recorded night, or clears the rating with `undefined`. Only
   *  meaningful once the night has a `start`/`end`. */
  setSleepQuality: (id: string, quality: SleepQuality | undefined) => void
  /** Writes down what was remembered on waking. */
  setSleepDream: (id: string, dream: string) => void

  addImportantDate: (d: Omit<ImportantDate, 'id'>) => void
  updateImportantDate: (d: ImportantDate) => void
  /** Hides it rather than destroying it — restoreImportantDate puts it back. */
  archiveImportantDate: (id: string) => void
  restoreImportantDate: (id: string) => void

  /** Sets (or replaces) the day's mood. One entry per date — see MoodLog. */
  setMood: (date: string, level: string, note?: string) => void
  removeMood: (id: string) => void
  addMood: (m: Omit<MoodDef, 'id'> & { id?: string }) => void
  updateMood: (m: MoodDef) => void
  deleteMood: (id: string) => void

  addVaultItem: (category: VaultCategory, cipher: string) => void
  updateVaultItemCipher: (id: string, cipher: string) => void
  deleteVaultItem: (id: string) => void
  reorderVaultItems: (ids: string[]) => void
  addPasswordItem: (cipher: string) => void
  updatePasswordItemCipher: (id: string, cipher: string) => void
  deletePasswordItem: (id: string) => void
  reorderPasswordItems: (ids: string[]) => void
  addDocItem: (d: Omit<DocItem, 'id' | 'order'>) => void
  updateDocItem: (d: DocItem) => void
  deleteDocItem: (id: string) => void
  setVaultSecurity: (security: VaultSecurity) => void
  /** wipes the vault — the only recovery path when a passphrase is forgotten */
  resetVault: () => void

  addLoan: (l: Omit<Loan, 'id' | 'order'>) => void
  updateLoan: (l: Loan) => void
  deleteLoan: (id: string) => void
  reorderLoans: (ids: string[]) => void

  addStockItem: (s: Omit<StockItem, 'id' | 'order' | 'updatedAt'>) => void
  updateStockItem: (s: StockItem) => void
  deleteStockItem: (id: string) => void
  addPurchaseItem: (p: Omit<PurchaseItem, 'id' | 'order' | 'updatedAt'> & { id?: string }) => void
  updatePurchaseItem: (p: PurchaseItem) => void
  deletePurchaseItem: (id: string) => void
  reorderStockItems: (ids: string[]) => void
  addSupplier: (s: Omit<Supplier, 'id' | 'order'>) => void
  updateSupplier: (s: Supplier) => void
  deleteSupplier: (id: string) => void
  reorderSuppliers: (ids: string[]) => void

  /** Records one reflection answer on a day, creating the day's entry if the
   *  mood itself hasn't been set yet. An empty string clears the answer. */
  setMoodAnswer: (date: string, promptId: string, text: string) => void
  addJournalPrompt: (question: string) => void
  updateJournalPrompt: (p: JournalPrompt) => void
  /** Drops the question. Answers already given keep sitting in their
   *  MoodLogs — see the note on MoodLog.answers. */
  deleteJournalPrompt: (id: string) => void
  reorderJournalPrompts: (ids: string[]) => void
  /** Puts the three starting questions back, keeping any the owner added. */
  restoreDefaultJournalPrompts: () => void

  addPlannerTask: (t: Omit<PlannerTask, 'id' | 'order'>) => void
  updatePlannerTask: (t: PlannerTask) => void
  deletePlannerTask: (id: string) => void
  togglePlannerTask: (id: string) => void
  /** Renumbers `order` within one date+block bucket to match `ids` — the
   *  same "hand it the ids in the order they should read, get every order
   *  field back in sync" shape as reorderCategories/reorderStockItems. */
  reorderPlannerTasks: (date: string, block: PlannerBlock | null, ids: string[]) => void
  /** Places a task in a block (or takes it out, with `block: null`) and
   *  marks it manual — see the note on PlannerTask.manualBlock for why that
   *  flag exists and what it protects the task from on the next Auto-plan. */
  movePlannerTask: (id: string, block: PlannerBlock | null) => void
  /** Buckets every non-manual task on `date` into Morning/Afternoon/Evening
   *  by priority and duration — see autoPlanTasks in lib/planner.ts for the
   *  actual algorithm. */
  autoPlanDay: (date: string) => void

  updateSettings: (patch: Partial<Settings>) => void
  replaceAll: (db: DB) => void
  mergeIn: (db: DB) => void
  reset: () => void
}

const StoreContext = createContext<Ctx | null>(null)

/** Materialise any repeat-rule occurrences that came due since we last ran. */
function runRepeats(db: DB): DB {
  const now = new Date()
  const created: Transaction[] = []
  const repeats = db.repeats.map((r) => {
    let cursor = r.lastRunDate ? advance(r.lastRunDate, r.freq, r.interval) : r.startDate
    let last = r.lastRunDate
    let guard = 0
    while (parseISO(cursor) <= now && guard++ < 500) {
      if (r.endDate && cursor.slice(0, 10) > r.endDate.slice(0, 10)) break
      created.push({ ...r.template, id: uid(), date: cursor, repeatId: r.id })
      last = cursor
      cursor = advance(cursor, r.freq, r.interval)
    }
    return last === r.lastRunDate ? r : { ...r, lastRunDate: last }
  })
  if (!created.length) return db
  return { ...db, repeats, transactions: [...db.transactions, ...created] }
}

/** Folds the attachment-heavy collections (see lib/db.ts's AttachPayload)
 *  into a DB that was rendered without them, by id rather than by
 *  overwriting outright — the same union `mergeIn` already uses for
 *  restoring a backup, needed here for the same reason: whatever the owner
 *  added to one of these four lists in the gap between `ready` firing and
 *  this resolving has to survive, not get replaced by the on-disk copy that
 *  predates it. */
function mergeAttach(db: DB, attach: store.AttachPayload | null): DB {
  if (!attach) return db
  const union = <T extends { id: string }>(current: T[], incoming: T[]): T[] => {
    const ids = new Set(current.map((x) => x.id))
    return [...current, ...incoming.filter((x) => !ids.has(x.id))]
  }
  return {
    ...db,
    loans: union(db.loans, attach.loans),
    docItems: union(db.docItems, attach.docItems),
    vaultItems: union(db.vaultItems, attach.vaultItems),
    passwordItems: union(db.passwordItems, attach.passwordItems),
    purchaseItems: union(db.purchaseItems, attach.purchaseItems),
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => seedDB())
  const [ready, setReady] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // Two-phase load. `loadCore()` skips loans, documents, vault items and
      // purchase items entirely — none of Daily, Niba, Habits or Sleep ever
      // touch those, so a cold start does not need to wait on however many
      // photos and PDFs have piled up across them before it can show
      // anything. They load separately, in the background, right after
      // `ready` fires — see loadAttachAndMerge below. `full` means this
      // install has not been split into core+attach yet and the one read
      // already carried everything; there is nothing left to fetch.
      const { data: core, full } = await store.loadCore()
      if (!alive) return
      let next = normalizeDB(core)

      // Dev preview only, and only on a database with nothing real in it yet
      // — a built APK never has import.meta.env.DEV set, and a database he
      // has actually started using never gets touched. Needs loans/vault/
      // documents/purchase items in view to judge "empty" and to seed every
      // screen, so — unlike the real path below — it waits for the
      // attachment bucket up front rather than deferring it.
      if (import.meta.env.DEV) {
        if (!full) {
          const attach = await store.loadAttach()
          if (!alive) return
          next = mergeAttach(next, attach)
        }
        if (isEmptyOfUserData(next)) {
          next = withFakeData(next)
          // Separate step: encrypting the vault/password samples is async,
          // where the rest of the fake data is a synchronous object build.
          next = await withFakeVaultData(next)
          if (!alive) return
        }
        setDb(runRepeats(next))
        loaded.current = true
        setReady(true)
        return
      }

      setDb(runRepeats(next))
      loaded.current = true
      setReady(true)

      if (!full) {
        const attach = await store.loadAttach()
        if (!alive) return
        // Functional update, not `next` — mut() calls the user made in the
        // gap between `ready` and this resolving (adding a loan, say) are
        // folded in by id rather than clobbered; see mergeAttach.
        setDb((d) => mergeAttach(d, attach))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (loaded.current) store.save(db)
  }, [db])

  const api = useMemo<Ctx>(() => {
    const mut = (fn: (d: DB) => DB) => setDb((d) => fn(d))

    return {
      db,
      ready,

      addTx(t) {
        const id = uid()
        mut((d) => ({ ...d, transactions: [...d.transactions, { ...t, id }] }))
        return id
      },
      updateTx(t) {
        mut((d) => ({
          ...d,
          transactions: d.transactions.map((x) => (x.id === t.id ? t : x)),
        }))
      },
      /**
       * Delete hides; it does not destroy.
       *
       * The entry moves to `hiddenTransactions`, so it leaves every list and
       * every total at once — no screen has to learn about a flag — and it is
       * still there to put back. A ledger is the wrong place for an action
       * that cannot be undone, and the hold-to-confirm on the row guards
       * against the accident, not against changing your mind later.
       */
      deleteTx(id) {
        mut((d) => {
          const tx = d.transactions.find((x) => x.id === id)
          if (!tx) return d
          return {
            ...d,
            transactions: d.transactions.filter((x) => x.id !== id),
            hiddenTransactions: [...d.hiddenTransactions, tx],
          }
        })
      },
      restoreTx(id) {
        mut((d) => {
          const tx = d.hiddenTransactions.find((x) => x.id === id)
          if (!tx) return d
          return {
            ...d,
            transactions: [...d.transactions, tx],
            hiddenTransactions: d.hiddenTransactions.filter((x) => x.id !== id),
          }
        })
      },
      restoreMemo(id) {
        mut((d) => {
          const m = d.hiddenMemos.find((x) => x.id === id)
          if (!m) return d
          return {
            ...d,
            memos: [...d.memos, m],
            hiddenMemos: d.hiddenMemos.filter((x) => x.id !== id),
          }
        })
      },

      addAccount(a) {
        mut((d) => ({
          ...d,
          accounts: [...d.accounts, { ...a, id: uid(), order: d.accounts.length }],
        }))
      },
      updateAccount(a) {
        mut((d) => ({
          ...d,
          accounts: d.accounts.map((x) => (x.id === a.id ? a : x)),
        }))
      },
      /**
       * Removing an account used to take every entry that touched it with it,
       * which is the largest destructive action in the app hidden behind the
       * smallest-sounding one. Those entries are hidden now, not erased, so a
       * mistaken account delete is recoverable.
       */
      deleteAccount(id) {
        mut((d) => {
          const touched = (t: Transaction) =>
            t.accountId === id || t.fromAccountId === id || t.toAccountId === id
          return {
            ...d,
            accounts: d.accounts.filter((x) => x.id !== id),
            transactions: d.transactions.filter((t) => !touched(t)),
            hiddenTransactions: [...d.hiddenTransactions, ...d.transactions.filter(touched)],
          }
        })
      },
      reorderAccounts(ids) {
        mut((d) => ({
          ...d,
          accounts: d.accounts.map((a) => ({
            ...a,
            order: ids.indexOf(a.id) === -1 ? a.order : ids.indexOf(a.id),
          })),
        }))
      },
      togglePinAccount(id) {
        mut((d) => ({
          ...d,
          accounts: d.accounts.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)),
        }))
      },
      togglePinCategory(id) {
        mut((d) => ({
          ...d,
          categories: d.categories.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
        }))
      },

      addCategory(c) {
        mut((d) => ({
          ...d,
          categories: [
            ...d.categories,
            { ...c, id: c.id ?? uid(), order: d.categories.length },
          ],
        }))
      },
      updateCategory(c) {
        mut((d) => ({
          ...d,
          categories: d.categories.map((x) => (x.id === c.id ? c : x)),
        }))
      },
      deleteCategory(id, reassignTo) {
        mut((d) => {
          const doomed = new Set([
            id,
            ...d.categories.filter((c) => c.parentId === id).map((c) => c.id),
          ])
          return {
            ...d,
            categories: d.categories.filter((c) => !doomed.has(c.id)),
            transactions: reassignTo
              ? d.transactions.map((t) =>
                  t.categoryId && doomed.has(t.categoryId)
                    ? { ...t, categoryId: reassignTo }
                    : t,
                )
              : d.transactions.filter(
                  (t) => !t.categoryId || !doomed.has(t.categoryId),
                ),
            // With no category to reassign to, the entries filed under it are
            // hidden rather than dropped — same rule as everywhere else.
            hiddenTransactions: reassignTo
              ? d.hiddenTransactions
              : [
                  ...d.hiddenTransactions,
                  ...d.transactions.filter((t) => t.categoryId && doomed.has(t.categoryId)),
                ],
            budgets: d.budgets.filter((b) => !b.categoryId || !doomed.has(b.categoryId)),
          }
        })
      },
      reorderCategories(ids) {
        mut((d) => ({
          ...d,
          categories: d.categories.map((c) => ({
            ...c,
            order: ids.indexOf(c.id) === -1 ? c.order : ids.indexOf(c.id),
          })),
        }))
      },

      setBudget(month, categoryId, amount) {
        mut((d) => {
          const existing = d.budgets.find(
            (b) => b.month === month && b.categoryId === categoryId,
          )
          if (amount <= 0) {
            return {
              ...d,
              budgets: d.budgets.filter((b) => b !== existing),
            }
          }
          if (existing) {
            return {
              ...d,
              budgets: d.budgets.map((b) =>
                b === existing ? { ...b, amount } : b,
              ),
            }
          }
          return {
            ...d,
            budgets: [...d.budgets, { id: uid(), month, categoryId, amount }],
          }
        })
      },
      copyBudget(fromMonth, toMonth) {
        mut((d) => {
          const src = d.budgets.filter((b) => b.month === fromMonth)
          const kept = d.budgets.filter((b) => b.month !== toMonth)
          return {
            ...d,
            budgets: [
              ...kept,
              ...src.map((b) => ({ ...b, id: uid(), month: toMonth })),
            ],
          }
        })
      },

      addRepeat(r) {
        mut((d) => {
          const rule: RepeatRule = { ...r, id: uid() }
          return runRepeats({ ...d, repeats: [...d.repeats, rule] })
        })
      },
      updateRepeat(r) {
        mut((d) => ({
          ...d,
          repeats: d.repeats.map((x) => (x.id === r.id ? r : x)),
        }))
      },
      deleteRepeat(id) {
        mut((d) => ({ ...d, repeats: d.repeats.filter((x) => x.id !== id) }))
      },

      addMemo(m) {
        mut((d) => ({ ...d, memos: [...d.memos, { ...m, id: uid() }] }))
      },
      updateMemo(m) {
        mut((d) => ({ ...d, memos: d.memos.map((x) => (x.id === m.id ? m : x)) }))
      },
      deleteMemo(id) {
        mut((d) => {
          const m = d.memos.find((x) => x.id === id)
          if (!m) return d
          return {
            ...d,
            memos: d.memos.filter((x) => x.id !== id),
            hiddenMemos: [...d.hiddenMemos, m],
          }
        })
      },

      addHabit(h) {
        mut((d) => ({
          ...d,
          habits: [...d.habits, { ...h, id: h.id ?? uid(), order: d.habits.length }],
        }))
      },
      updateHabit(h) {
        mut((d) => ({ ...d, habits: d.habits.map((x) => (x.id === h.id ? h : x)) }))
      },
      /**
       * Archived, not deleted — and the logs stay with it. Dropping the logs
       * was the destructive half: a habit can be recreated by typing its name
       * again, but a year of ticks cannot.
       */
      deleteHabit(id) {
        mut((d) => ({
          ...d,
          habits: d.habits.map((x) => (x.id === id ? { ...x, archived: true } : x)),
        }))
      },
      unarchiveHabit(id) {
        mut((d) => ({
          ...d,
          habits: d.habits.map((x) => (x.id === id ? { ...x, archived: false } : x)),
        }))
      },
      reorderHabits(ids) {
        mut((d) => ({
          ...d,
          habits: d.habits.map((h) => ({
            ...h,
            order: ids.indexOf(h.id) === -1 ? h.order : ids.indexOf(h.id),
          })),
        }))
      },
      toggleHabitLog(habitId, date) {
        mut((d) => {
          const existing = d.habitLogs.find((l) => l.habitId === habitId && l.date === date)
          return {
            ...d,
            habitLogs: existing
              ? d.habitLogs.filter((l) => l !== existing)
              : [...d.habitLogs, { id: uid(), habitId, date }],
          }
        })
      },

      addChore(c) {
        mut((d) => ({
          ...d,
          chores: [...d.chores, { ...c, id: uid(), order: d.chores.length }],
        }))
      },
      updateChore(c) {
        mut((d) => ({ ...d, chores: d.chores.map((x) => (x.id === c.id ? c : x)) }))
      },
      deleteChore(id) {
        mut((d) => ({
          ...d,
          chores: d.chores.map((x) => (x.id === id ? { ...x, archived: true } : x)),
        }))
      },
      unarchiveChore(id) {
        mut((d) => ({
          ...d,
          chores: d.chores.map((x) => (x.id === id ? { ...x, archived: false } : x)),
        }))
      },
      logChore(choreId, date, note) {
        mut((d) => {
          // Doing the same job twice in one day is one occurrence, not two —
          // and a double tap on the button should not create a duplicate.
          if (d.choreLogs.some((l) => l.choreId === choreId && l.date === date)) return d
          return { ...d, choreLogs: [...d.choreLogs, { id: uid(), choreId, date, note }] }
        })
      },
      removeChoreLog(logId) {
        mut((d) => ({ ...d, choreLogs: d.choreLogs.filter((l) => l.id !== logId) }))
      },

      saveSleep(date, start, end) {
        mut((d) => {
          const existing = d.sleepLogs.find((s) => s.date === date)
          return {
            ...d,
            sleepLogs: existing
              ? d.sleepLogs.map((s) => (s === existing ? { ...s, start, end } : s))
              : [...d.sleepLogs, { id: uid(), date, start, end }],
          }
        })
      },
      removeSleep(id) {
        mut((d) => ({ ...d, sleepLogs: d.sleepLogs.filter((s) => s.id !== id) }))
      },
      setSleepQuality(id, quality) {
        mut((d) => ({
          ...d,
          sleepLogs: d.sleepLogs.map((s) => (s.id === id ? { ...s, quality } : s)),
        }))
      },
      setSleepDream(id, dream) {
        mut((d) => ({
          ...d,
          sleepLogs: d.sleepLogs.map((s) => (s.id === id ? { ...s, dream: dream || undefined } : s)),
        }))
      },

      addImportantDate(date) {
        mut((d) => ({ ...d, importantDates: [...d.importantDates, { ...date, id: uid() }] }))
      },
      updateImportantDate(date) {
        mut((d) => ({
          ...d,
          importantDates: d.importantDates.map((x) => (x.id === date.id ? date : x)),
        }))
      },
      archiveImportantDate(id) {
        mut((d) => ({
          ...d,
          importantDates: d.importantDates.map((x) =>
            x.id === id ? { ...x, archived: true } : x,
          ),
        }))
      },
      restoreImportantDate(id) {
        mut((d) => ({
          ...d,
          importantDates: d.importantDates.map((x) =>
            x.id === id ? { ...x, archived: false } : x,
          ),
        }))
      },

      setMood(date, level, note) {
        mut((d) => {
          const existing = d.moodLogs.find((m) => m.date === date)
          return {
            ...d,
            moodLogs: existing
              ? d.moodLogs.map((m) => (m === existing ? { ...m, level, note } : m))
              : [...d.moodLogs, { id: uid(), date, level, note }],
          }
        })
      },
      removeMood(id) {
        mut((d) => ({ ...d, moodLogs: d.moodLogs.filter((m) => m.id !== id) }))
      },

      addMood(m) {
        mut((d) => ({ ...d, moods: [...d.moods, { ...m, id: m.id ?? uid() }] }))
      },
      updateMood(m) {
        mut((d) => ({ ...d, moods: d.moods.map((x) => (x.id === m.id ? m : x)) }))
      },
      // A day already logged under the deleted mood keeps that id on its
      // MoodLog — same rule as everywhere else that doesn't reach back into
      // history to rewrite it. The grid falls back to a plain dot for
      // whatever id no longer matches anything, rather than crashing on it.
      deleteMood(id) {
        mut((d) => ({ ...d, moods: d.moods.filter((m) => m.id !== id) }))
      },

      /**
       * Counted habits write the amount onto the day's log rather than a
       * second list, so a counted habit and a ticked one are the same record
       * and every streak calculation already written keeps working.
       */
      setHabitAmount(habitId, date, amount) {
        mut((d) => {
          const existing = d.habitLogs.find((l) => l.habitId === habitId && l.date === date)
          if (amount <= 0) {
            return { ...d, habitLogs: d.habitLogs.filter((l) => l !== existing) }
          }
          return {
            ...d,
            habitLogs: existing
              ? d.habitLogs.map((l) => (l === existing ? { ...l, amount } : l))
              : [...d.habitLogs, { id: uid(), habitId, date, amount }],
          }
        })
      },

      addVaultItem(category, cipher) {
        mut((d) => ({
          ...d,
          vaultItems: [...d.vaultItems, { id: uid(), category, order: d.vaultItems.length, cipher }],
        }))
      },
      updateVaultItemCipher(id, cipher) {
        mut((d) => ({
          ...d,
          vaultItems: d.vaultItems.map((x) => (x.id === id ? { ...x, cipher } : x)),
        }))
      },
      deleteVaultItem(id) {
        mut((d) => ({ ...d, vaultItems: d.vaultItems.filter((x) => x.id !== id) }))
      },
      reorderVaultItems(ids) {
        mut((d) => ({
          ...d,
          vaultItems: d.vaultItems.map((v) => ({
            ...v,
            order: ids.indexOf(v.id) === -1 ? v.order : ids.indexOf(v.id),
          })),
        }))
      },

      addPasswordItem(cipher) {
        mut((d) => ({
          ...d,
          passwordItems: [...d.passwordItems, { id: uid(), order: d.passwordItems.length, cipher }],
        }))
      },
      updatePasswordItemCipher(id, cipher) {
        mut((d) => ({
          ...d,
          passwordItems: d.passwordItems.map((x) => (x.id === id ? { ...x, cipher } : x)),
        }))
      },
      deletePasswordItem(id) {
        mut((d) => ({ ...d, passwordItems: d.passwordItems.filter((x) => x.id !== id) }))
      },
      reorderPasswordItems(ids) {
        mut((d) => ({
          ...d,
          passwordItems: d.passwordItems.map((p) => ({
            ...p,
            order: ids.indexOf(p.id) === -1 ? p.order : ids.indexOf(p.id),
          })),
        }))
      },
      addDocItem(d) {
        mut((db) => ({
          ...db,
          docItems: [...db.docItems, { ...d, id: uid(), order: db.docItems.length }],
        }))
      },
      updateDocItem(d) {
        mut((db) => ({
          ...db,
          docItems: db.docItems.map((x) => (x.id === d.id ? d : x)),
        }))
      },
      deleteDocItem(id) {
        mut((d) => ({ ...d, docItems: d.docItems.filter((x) => x.id !== id) }))
      },

      setVaultSecurity(security) {
        mut((d) => ({ ...d, vaultSecurity: security }))
      },
      resetVault() {
        mut((d) => ({
          ...d,
          vaultSecurity: undefined,
          vaultItems: [],
          passwordItems: [],
        }))
      },

      addLoan(l) {
        mut((d) => ({ ...d, loans: [...d.loans, { ...l, id: uid(), order: d.loans.length }] }))
      },
      updateLoan(l) {
        mut((d) => ({ ...d, loans: d.loans.map((x) => (x.id === l.id ? l : x)) }))
      },
      deleteLoan(id) {
        mut((d) => ({ ...d, loans: d.loans.filter((x) => x.id !== id) }))
      },
      reorderLoans(ids) {
        mut((d) => ({
          ...d,
          loans: d.loans.map((l) => ({
            ...l,
            order: ids.indexOf(l.id) === -1 ? l.order : ids.indexOf(l.id),
          })),
        }))
      },

      addStockItem(s) {
        mut((d) => ({
          ...d,
          stockItems: [
            ...d.stockItems,
            { ...s, id: uid(), order: d.stockItems.length, updatedAt: new Date().toISOString() },
          ],
        }))
      },
      updateStockItem(s) {
        mut((d) => ({
          ...d,
          stockItems: d.stockItems.map((x) =>
            x.id === s.id ? { ...s, updatedAt: new Date().toISOString() } : x,
          ),
        }))
      },
      deleteStockItem(id) {
        mut((d) => ({ ...d, stockItems: d.stockItems.filter((x) => x.id !== id) }))
      },

      addPurchaseItem(p) {
        mut((d) => ({
          ...d,
          purchaseItems: [
            ...d.purchaseItems,
            { ...p, id: p.id ?? uid(), order: d.purchaseItems.length, updatedAt: new Date().toISOString() },
          ],
        }))
      },
      updatePurchaseItem(p) {
        mut((d) => ({
          ...d,
          purchaseItems: d.purchaseItems.map((x) => {
            if (x.id === p.id) return { ...p, updatedAt: new Date().toISOString() }
            // Siblings in the same variant group (same product, same
            // supplier — "LED bulb" in 9W/12W/15W) share everything except
            // what actually varies row to row (rate, unit, the variant
            // label itself). Editing the shared part on any one of them
            // keeps the rest in step, so the name/supplier/category/photos
            // never have to be retyped per wattage.
            if (p.groupId && x.groupId === p.groupId) {
              return {
                ...x,
                name: p.name,
                supplier: p.supplier,
                category: p.category,
                subcategory: p.subcategory,
                photos: p.photos,
                notes: p.notes,
              }
            }
            return x
          }),
        }))
      },
      deletePurchaseItem(id) {
        mut((d) => ({ ...d, purchaseItems: d.purchaseItems.filter((x) => x.id !== id) }))
      },
      reorderStockItems(ids) {
        mut((d) => ({
          ...d,
          stockItems: d.stockItems.map((s) => ({
            ...s,
            order: ids.indexOf(s.id) === -1 ? s.order : ids.indexOf(s.id),
          })),
        }))
      },

      addSupplier(s) {
        mut((d) => ({
          ...d,
          suppliers: [...d.suppliers, { ...s, id: uid(), order: d.suppliers.length }],
        }))
      },
      updateSupplier(s) {
        mut((d) => ({ ...d, suppliers: d.suppliers.map((x) => (x.id === s.id ? s : x)) }))
      },
      deleteSupplier(id) {
        mut((d) => ({ ...d, suppliers: d.suppliers.filter((x) => x.id !== id) }))
      },
      reorderSuppliers(ids) {
        mut((d) => ({
          ...d,
          suppliers: d.suppliers.map((s) => ({
            ...s,
            order: ids.indexOf(s.id) === -1 ? s.order : ids.indexOf(s.id),
          })),
        }))
      },

      setMoodAnswer(date, promptId, text) {
        mut((d) => {
          const existing = d.moodLogs.find((m) => m.date === date)
          const write = (answers?: Record<string, string>) => {
            const next = { ...(answers ?? {}) }
            // Deleted rather than stored as '' so a cleared box leaves no
            // trace — an empty-string answer would still count as "answered"
            // everywhere that tests for one.
            if (text.trim()) next[promptId] = text
            else delete next[promptId]
            return Object.keys(next).length ? next : undefined
          }
          if (existing) {
            return {
              ...d,
              moodLogs: d.moodLogs.map((m) =>
                m === existing ? { ...m, answers: write(m.answers) } : m,
              ),
            }
          }
          // Answering before picking a mood is allowed — the questions are
          // the point of the sheet for some days, and refusing to save until
          // a chip is tapped would lose what was typed. `level: ''` is a day
          // with writing but no mood; moodDef falls back for an unknown id.
          return {
            ...d,
            moodLogs: [...d.moodLogs, { id: uid(), date, level: '', answers: write(undefined) }],
          }
        })
      },
      addJournalPrompt(question) {
        mut((d) => ({
          ...d,
          journalPrompts: [
            ...d.journalPrompts,
            { id: uid(), question, order: d.journalPrompts.length },
          ],
        }))
      },
      updateJournalPrompt(p) {
        mut((d) => ({
          ...d,
          journalPrompts: d.journalPrompts.map((x) => (x.id === p.id ? p : x)),
        }))
      },
      deleteJournalPrompt(id) {
        mut((d) => ({ ...d, journalPrompts: d.journalPrompts.filter((x) => x.id !== id) }))
      },
      reorderJournalPrompts(ids) {
        mut((d) => ({
          ...d,
          journalPrompts: d.journalPrompts.map((p) => ({
            ...p,
            order: ids.indexOf(p.id) === -1 ? p.order : ids.indexOf(p.id),
          })),
        }))
      },
      restoreDefaultJournalPrompts() {
        mut((d) => {
          const have = new Set(d.journalPrompts.map((p) => p.id))
          const missing = DEFAULT_JOURNAL_PROMPTS.filter((p) => !have.has(p.id))
          if (!missing.length) return d
          return {
            ...d,
            journalPrompts: [
              ...d.journalPrompts,
              ...missing.map((p, i) => ({ ...p, order: d.journalPrompts.length + i })),
            ],
          }
        })
      },

      addPlannerTask(t) {
        mut((d) => {
          const inBlock = t.block
            ? d.plannerTasks.filter((x) => x.date === t.date && x.block === t.block)
            : []
          return {
            ...d,
            plannerTasks: [...d.plannerTasks, { ...t, id: uid(), order: inBlock.length }],
          }
        })
      },
      updatePlannerTask(t) {
        mut((d) => ({
          ...d,
          plannerTasks: d.plannerTasks.map((x) => (x.id === t.id ? t : x)),
        }))
      },
      deletePlannerTask(id) {
        mut((d) => ({ ...d, plannerTasks: d.plannerTasks.filter((x) => x.id !== id) }))
      },
      togglePlannerTask(id) {
        mut((d) => ({
          ...d,
          plannerTasks: d.plannerTasks.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
        }))
      },
      reorderPlannerTasks(date, block, ids) {
        mut((d) => ({
          ...d,
          plannerTasks: d.plannerTasks.map((x) => {
            if (x.date !== date || x.block !== block) return x
            const i = ids.indexOf(x.id)
            return i === -1 ? x : { ...x, order: i }
          }),
        }))
      },
      movePlannerTask(id, block) {
        mut((d) => {
          const task = d.plannerTasks.find((x) => x.id === id)
          if (!task) return d
          const inBlock = block
            ? d.plannerTasks.filter((x) => x.date === task.date && x.block === block && x.id !== id)
            : []
          return {
            ...d,
            plannerTasks: d.plannerTasks.map((x) =>
              x.id === id ? { ...x, block, manualBlock: !!block, order: inBlock.length } : x,
            ),
          }
        })
      },
      autoPlanDay(date) {
        mut((d) => {
          const forDay = d.plannerTasks.filter((t) => t.date === date)
          const rest = d.plannerTasks.filter((t) => t.date !== date)
          return { ...d, plannerTasks: [...rest, ...autoPlanTasks(forDay)] }
        })
      },

      updateSettings(patch) {
        mut((d) => ({ ...d, settings: { ...d.settings, ...patch } }))
      },

      replaceAll(next) {
        setDb(normalizeDB(next))
      },
      mergeIn(incoming) {
        mut((d) => {
          const has = (arr: { id: string }[], id: string) =>
            arr.some((x) => x.id === id)
          return {
            ...d,
            accounts: [
              ...d.accounts,
              ...incoming.accounts.filter((a) => !has(d.accounts, a.id)),
            ],
            categories: [
              ...d.categories,
              ...incoming.categories.filter((c) => !has(d.categories, c.id)),
            ],
            transactions: [
              ...d.transactions,
              ...incoming.transactions.filter((t) => !has(d.transactions, t.id)),
            ],
            budgets: [
              ...d.budgets,
              ...incoming.budgets.filter((b) => !has(d.budgets, b.id)),
            ],
            repeats: [
              ...d.repeats,
              ...incoming.repeats.filter((r) => !has(d.repeats, r.id)),
            ],
            memos: [
              ...d.memos,
              ...(incoming.memos ?? []).filter((m) => !has(d.memos, m.id)),
            ],
            habits: [
              ...d.habits,
              ...(incoming.habits ?? []).filter((h) => !has(d.habits, h.id)),
            ],
            habitLogs: [
              ...d.habitLogs,
              ...(incoming.habitLogs ?? []).filter((l) => !has(d.habitLogs, l.id)),
            ],
            // Last Done and Sleep were missing from this merge entirely, so a
            // restore or a merge-import silently dropped every job, its whole
            // history, and every night on record — the backup contained them,
            // nothing read them back out.
            chores: [
              ...d.chores,
              ...(incoming.chores ?? []).filter((c) => !has(d.chores, c.id)),
            ],
            choreLogs: [
              ...d.choreLogs,
              ...(incoming.choreLogs ?? []).filter((l) => !has(d.choreLogs, l.id)),
            ],
            sleepLogs: [
              ...d.sleepLogs,
              ...(incoming.sleepLogs ?? []).filter((s) => !has(d.sleepLogs, s.id)),
            ],
            importantDates: [
              ...d.importantDates,
              ...(incoming.importantDates ?? []).filter((x) => !has(d.importantDates, x.id)),
            ],
            moodLogs: [
              ...d.moodLogs,
              ...(incoming.moodLogs ?? []).filter((m) => !has(d.moodLogs, m.id)),
            ],
            moods: [
              ...d.moods,
              ...(incoming.moods ?? []).filter((m) => !has(d.moods, m.id)),
            ],
            // If this database has no vault of its own yet, adopt the incoming
            // salt+canary. Without it the encrypted items below merge in as
            // permanently undecryptable blobs — there is no key to derive.
            // When both sides have a vault the local one wins, and items from
            // the other key stay unreadable until re-entered by hand.
            vaultSecurity: d.vaultSecurity ?? incoming.vaultSecurity,
            // vault items merge by id only — they stay encrypted under whatever
            // passphrase this DB's vaultSecurity already uses, so items from a
            // differently-keyed backup won't decrypt until re-entered by hand.
            vaultItems: [
              ...d.vaultItems,
              ...(incoming.vaultItems ?? []).filter((v) => !has(d.vaultItems, v.id)),
            ],
            passwordItems: [
              ...d.passwordItems,
              ...(incoming.passwordItems ?? []).filter((p) => !has(d.passwordItems, p.id)),
            ],
            docItems: [
              ...d.docItems,
              ...(incoming.docItems ?? []).filter((doc) => !has(d.docItems, doc.id)),
            ],
            loans: [...d.loans, ...(incoming.loans ?? []).filter((l) => !has(d.loans, l.id))],
            stockItems: [
              ...d.stockItems,
              ...(incoming.stockItems ?? []).filter((s) => !has(d.stockItems, s.id)),
            ],
            purchaseItems: [
              ...d.purchaseItems,
              ...(incoming.purchaseItems ?? []).filter((p) => !has(d.purchaseItems, p.id)),
            ],
            // Same omission as the Last Done / Sleep one noted above, found
            // again three collections later: a collection left off this list
            // isn't merged at all, so a backup's planner, suppliers and
            // journal questions were written to the file and then quietly
            // ignored on the way back in. Anything added to DB from here on
            // needs a line here too.
            suppliers: [
              ...d.suppliers,
              ...(incoming.suppliers ?? []).filter((s) => !has(d.suppliers, s.id)),
            ],
            journalPrompts: [
              ...d.journalPrompts,
              ...(incoming.journalPrompts ?? []).filter((p) => !has(d.journalPrompts, p.id)),
            ],
            plannerTasks: [
              ...d.plannerTasks,
              ...(incoming.plannerTasks ?? []).filter((t) => !has(d.plannerTasks, t.id)),
            ],
          }
        })
      },
      reset() {
        store.wipe().then(() => setDb(seedDB()))
      },
    }
  }, [db, ready])

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}
