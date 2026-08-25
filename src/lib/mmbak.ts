/**
 * Convert a Money Manager (realbyteapps) `.mmbak` backup into our DB shape.
 *
 * The backup is a plain SQLite database. Relevant tables:
 *   ASSETGROUP  account groups (uid → name)
 *   ASSETS      accounts        (uid, NIC_NAME, groupUid, ZDATA = opening balance)
 *   ZCATEGORY   categories      (uid, NAME with emoji prefix, TYPE 0=income 1=expense, pUid)
 *   INOUTCOME   transactions    (DO_TYPE 0=income 1=expense else transfer, ZMONEY,
 *                                WDATE=YYYY-MM-DD, ZDATE=epoch ms, ZCONTENT=note, ZDATA=description)
 *   MEMO        notes           (title, content, memoDate)
 *   CURRENCY    main currency + symbol position + decimals
 *   ZETC        preferences, keyed by dataTypeKey
 */

import type { Account, AccountGroup, Budget, Category, DB, Memo, Transaction } from '../types'
import { openSqlite, type SqlRow, type SqlValue } from './sqlite'
import { seedDB, uid, CHART_COLORS } from './seed'
import { pad } from './date'

export interface ImportReport {
  accounts: number
  categories: number
  transactions: number
  memos: number
  skipped: number
  photosDropped: number
  range: string
}

const str = (v: SqlValue): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: SqlValue): number => {
  if (typeof v === 'number') return v
  const n = parseFloat(str(v))
  return isFinite(n) ? n : 0
}

const GROUP_MAP: Record<string, AccountGroup> = {
  Cash: 'Cash',
  Accounts: 'Accounts',
  Card: 'Card',
  'Debit Card': 'Debit Card',
  Savings: 'Savings',
  Investments: 'Investments',
}

/** Money Manager stores the icon as an emoji prefix inside the category name. */
function splitIcon(name: string): { icon: string; label: string } {
  const trimmed = name.trim()
  const spaced = trimmed.match(/^(\S+)\s+(.*)$/)
  if (spaced && !/[A-Za-z0-9]/.test(spaced[1])) {
    return { icon: spaced[1], label: spaced[2].trim() }
  }
  // some names glue the emoji straight onto the text, e.g. "🫆Customer"
  const glued = trimmed.match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)(.+)$/u)
  if (glued) return { icon: glued[1], label: glued[2].trim() }
  return { icon: '', label: trimmed }
}

/** Local-time YYYY-MM-DDTHH:mm from the epoch-ms timestamp, kept on the book date. */
function combineDate(wdate: string, epochMs: number): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(wdate) ? wdate : null
  const d = epochMs > 0 ? new Date(epochMs) : null
  const time = d && !isNaN(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '12:00'
  if (date) return `${date}T${time}`
  if (d && !isNaN(d.getTime())) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}`
  }
  return ''
}

export function importMmbak(bytes: Uint8Array): { db: DB; report: ImportReport } {
  const sqlite = openSqlite(bytes)
  const base = seedDB()

  const rows = (t: string): SqlRow[] => sqlite.all(t)
  const alive = (r: SqlRow, key: string) => num(r[key]) !== 1

  /* ---------------- accounts ---------------- */

  const groupNames = new Map<string, string>()
  for (const g of rows('ASSETGROUP')) {
    groupNames.set(str(g.uid), str(g.ACC_GROUP_NAME))
  }

  const accounts: Account[] = []
  for (const a of rows('ASSETS')) {
    const id = str(a.uid)
    if (!id) continue
    const groupName = groupNames.get(str(a.groupUid)) ?? 'Others'
    accounts.push({
      id,
      name: str(a.NIC_NAME) || 'Account',
      group: GROUP_MAP[groupName] ?? 'Others',
      initialBalance: Math.round(num(a.ZDATA) * 100),
      excludeFromTotal: false,
      order: num(a.ORDERSEQ),
    })
  }

  /* --------------- categories --------------- */

  const usedCategories = new Set<string>()
  const inoutcome = rows('INOUTCOME')
  for (const t of inoutcome) {
    if (alive(t, 'IS_DEL')) usedCategories.add(str(t.ctgUid))
  }

  const categories: Category[] = []
  let colorIndex = 0
  for (const c of rows('ZCATEGORY')) {
    const id = str(c.uid)
    if (!id) continue
    // keep deleted categories only when history still points at them
    if (num(c.C_IS_DEL) === 1 && !usedCategories.has(id)) continue

    const { icon, label } = splitIcon(str(c.NAME))
    const parent = str(c.pUid)
    categories.push({
      id,
      name: label || 'Category',
      type: num(c.TYPE) === 0 ? 'income' : 'expense',
      parentId: parent && parent !== '0' ? parent : undefined,
      icon,
      color: CHART_COLORS[colorIndex++ % CHART_COLORS.length],
      order: num(c.ORDERSEQ),
    })
  }

  // Money Manager writes balance corrections against pseudo-categories that have
  // no ZCATEGORY row (ctgUid "-4"). Synthesise one so the entry stays visible.
  const declared = new Set(categories.map((c) => c.id))
  for (const t of inoutcome) {
    if (!alive(t, 'IS_DEL')) continue
    const cid = str(t.ctgUid)
    if (!cid || declared.has(cid)) continue
    declared.add(cid)
    categories.push({
      id: cid,
      name: str(t.CATEGORY_NAME) || (cid === '-4' ? 'Difference' : 'Other'),
      type: str(t.DO_TYPE) === '0' ? 'income' : 'expense',
      icon: '',
      color: CHART_COLORS[colorIndex++ % CHART_COLORS.length],
      order: 900,
    })
  }
  // a parent that got filtered out would orphan its children — promote them
  const categoryIds = new Set(categories.map((c) => c.id))
  for (const c of categories) {
    if (c.parentId && !categoryIds.has(c.parentId)) c.parentId = undefined
  }
  // subcategories inherit their parent's colour, so the pie reads as one slice
  const colorOf = new Map(categories.map((c) => [c.id, c.color]))
  for (const c of categories) {
    if (c.parentId) c.color = colorOf.get(c.parentId) ?? c.color
  }

  /* -------------- transactions -------------- */

  const accountIds = new Set(accounts.map((a) => a.id))
  const transactions: Transaction[] = []
  const seenTransferPair = new Set<string>()
  let skipped = 0

  for (const t of inoutcome) {
    if (!alive(t, 'IS_DEL')) {
      skipped++
      continue
    }

    const doType = str(t.DO_TYPE)
    const amount = Math.round(num(t.ZMONEY) * 100)
    const date = combineDate(str(t.WDATE), num(t.ZDATE))
    if (!date || amount <= 0) {
      skipped++
      continue
    }

    const type: Transaction['type'] =
      doType === '0' ? 'income' : doType === '1' ? 'expense' : 'transfer'

    if (type === 'transfer') {
      // a transfer is stored as a linked pair — import it once
      const pair = str(t.txUidTrans)
      if (pair) {
        if (seenTransferPair.has(pair)) {
          skipped++
          continue
        }
        seenTransferPair.add(pair)
      }
      const from = str(t.assetUid)
      const to = str(t.toAssetUid)
      if (!accountIds.has(from) || !accountIds.has(to)) {
        skipped++
        continue
      }
      transactions.push({
        id: str(t.uid) || uid(),
        type: 'transfer',
        date,
        amount,
        fromAccountId: from,
        toAccountId: to,
        note: str(t.ZCONTENT),
        description: str(t.ZDATA),
      })
      continue
    }

    const accountId = str(t.assetUid)
    const categoryId = str(t.ctgUid)
    transactions.push({
      id: str(t.uid) || uid(),
      type,
      date,
      amount,
      categoryId: categoryIds.has(categoryId) ? categoryId : undefined,
      accountId: accountIds.has(accountId) ? accountId : accounts[0]?.id,
      note: str(t.ZCONTENT),
      description: str(t.ZDATA),
    })
  }

  transactions.sort((a, b) => (a.date < b.date ? -1 : 1))

  /* ----------------- budgets ----------------- */

  // BUDGET rows carry the target (total or category); BUDGET_AMOUNT carries one
  // amount per period, keyed YYYYMM. Monthly budgets only — other period types
  // have no equivalent here and are left out.
  const budgets: Budget[] = []
  const budgetTargets = new Map<string, { categoryId?: string; isTotal: boolean }>()
  for (const b of rows('BUDGET')) {
    if (!alive(b, 'IS_DEL')) continue
    budgetTargets.set(str(b.uid), {
      categoryId: num(b.IS_TOTAL) === 1 ? undefined : str(b.targetUid) || undefined,
      isTotal: num(b.IS_TOTAL) === 1,
    })
  }
  for (const a of rows('BUDGET_AMOUNT')) {
    if (!alive(a, 'IS_DEL')) continue
    const target = budgetTargets.get(str(a.budgetUid))
    if (!target) continue
    const period = str(a.BUDGET_PERIOD)
    if (!/^\d{6}$/.test(period)) continue
    const amount = Math.round(num(a.AMOUNT) * 100)
    if (amount <= 0) continue
    if (!target.isTotal && (!target.categoryId || !categoryIds.has(target.categoryId))) continue
    budgets.push({
      id: str(a.uid) || uid(),
      month: `${period.slice(0, 4)}-${period.slice(4, 6)}`,
      categoryId: target.isTotal ? undefined : target.categoryId,
      amount,
    })
  }

  /* ------------------ memos ------------------ */

  const memos: Memo[] = []
  for (const m of rows('MEMO')) {
    if (!alive(m, 'isDel')) continue
    const body = str(m.content).replace(/\s+$/, '')
    const title = str(m.title).trim()
    if (!body && !title) continue
    memos.push({
      id: str(m.uid) || uid(),
      date: str(m.memoDate).slice(0, 10) || transactions[0]?.date.slice(0, 10) || '',
      title,
      body,
    })
  }

  /* ---------------- settings ---------------- */

  const settings = { ...base.settings }

  const main = rows('CURRENCY').find((c) => num(c.IS_MAIN_CURRENCY) === 1)
  if (main) {
    settings.currencySymbol = str(main.SYMBOL) || settings.currencySymbol
    settings.symbolBefore = str(main.SYMBOL_POSITION) !== 'S'
    settings.decimals = num(main.DECIMAL_POINT) === 0 ? 0 : 2
  }

  const etc = new Map<string, string>()
  for (const e of rows('ZETC')) {
    const key = str(e.dataTypeKey)
    if (key) etc.set(key, str(e.ZDATA))
  }
  const flag = (key: string) => etc.get(key) === '1'
  if (etc.has('start_day')) settings.monthStartDay = Math.min(28, Math.max(1, Number(etc.get('start_day')) || 1))
  if (etc.has('week_start_day')) settings.firstDayOfWeek = etc.get('week_start_day') === '1' ? 1 : 0
  if (etc.has('carry_over')) settings.carryOver = flag('carry_over')
  if (etc.has('use_sub_category')) settings.subcategory = flag('use_sub_category')
  if (etc.has('use_auto_complete')) settings.autocomplete = flag('use_auto_complete')
  if (etc.has('show_tx_memo_on_day_list')) settings.showDescription = flag('show_tx_memo_on_day_list')
  if (etc.has('memo_btn_on_daily')) settings.noteButton = flag('memo_btn_on_daily')
  if (etc.has('money_color')) settings.colorSet = etc.get('money_color') === '1' ? 'B' : 'A'
  if (etc.has('input_form_order')) settings.inputOrder = etc.get('input_form_order') === '1' ? 'amount' : 'category'
  if (etc.has('main_tab_first_view')) settings.startScreen = etc.get('main_tab_first_view') === '1' ? 'Total' : 'Daily'

  /* ----------------- report ----------------- */

  const dates = transactions.map((t) => t.date.slice(0, 10))
  const photosDropped = rows('PHOTO').filter((p) => alive(p, 'IS_DEL')).length

  return {
    db: {
      version: base.version,
      accounts,
      categories,
      transactions,
      budgets,
      repeats: [],
      memos,
      habits: [],
      habitLogs: [],
      // Habits, Last Done and Sleep have no Money Manager equivalent, so an
      // import never carries any — mergeIn leaves whatever is already recorded.
      chores: [],
      choreLogs: [],
      sleepLogs: [],
      importantDates: [],
      moodLogs: [],
      moods: [],
      hiddenTransactions: [],
      hiddenMemos: [],
      vaultItems: [],
      partnerItems: [],
      passwordItems: [],
      docItems: [],
      loans: [],
      // Money Manager has no stock or rate-book concept, so an import never
      // brings any in — mergeIn keeps whatever is already recorded here.
      stockItems: [],
      purchaseItems: [],
      suppliers: [],
      balances: [],
      journalPrompts: [],
      plannerTasks: [],
      settings,
    },
    report: {
      accounts: accounts.length,
      categories: categories.length,
      transactions: transactions.length,
      memos: memos.length,
      skipped,
      photosDropped,
      range: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : '—',
    },
  }
}
