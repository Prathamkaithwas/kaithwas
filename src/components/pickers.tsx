import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, Split } from '../types'
import { formatAmount, toPaise } from '../lib/money'
import { AlphaIndex, indexLetter } from './AlphaIndex'
import { Sheet } from './ui'
import { useStore } from '../store'
import { accountsByGroup, categoryLabel } from '../lib/calc'
import { ACCOUNT_GROUPS, type AccountGroup } from '../types'
import { CHART_COLORS, uid } from '../lib/seed'
import { WEEKDAYS, calendarCells, dateToKey, parseISO, pad } from '../lib/date'
import { useBackHandler } from '../lib/back'

/** Tiny "name it and done" prompt — the whole point is that adding a category
 *  takes one tap, a name, and one more tap. No icon grid, no colour picker. */
function QuickAddPrompt({
  title,
  onCancel,
  onAdd,
}: {
  title: string
  onCancel: () => void
  onAdd: (name: string) => void
}) {
  const [name, setName] = useState('')
  const submit = () => {
    if (name.trim()) onAdd(name.trim())
  }
  // Not a Sheet, so it has to say so itself — without this, back dismissed the
  // picker underneath and left the prompt as the only thing that had been on
  // screen, two levels gone for one press.
  useBackHandler(true, onCancel)
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-8">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative w-full max-w-[300px] rounded-[var(--r-md)] p-5" style={{ background: 'var(--surface)' }}>
        <div className="font-semibold text-[15px] mb-3">{title}</div>
        <input
          className="w-full border-b pb-2 text-[16px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-5">
          <button className="px-4 py-2 text-[14px]" style={{ color: 'var(--muted)' }} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="px-4 py-2 text-[14px] font-semibold"
            style={{ color: 'var(--accent)' }}
            disabled={!name.trim()}
            onClick={submit}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

export function CategoryPicker({
  open,
  type,
  current,
  onClose,
  onSelect,
  onManage,
}: {
  open: boolean
  type: 'income' | 'expense'
  /** currently-selected category id, so the picker opens on the right parent */
  current?: string
  onClose: () => void
  onSelect: (id: string) => void
  onManage?: () => void
}) {
  const { db, addCategory, togglePinCategory } = useStore()
  const [activeParent, setActiveParent] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState<'top' | 'sub' | null>(null)
  const subPane = useRef<HTMLDivElement>(null)
  /** first row of each letter, so the rail knows where to scroll to */
  const letterRow = useRef<Record<string, HTMLElement | null>>({})
  /**
   * A–Z only for as long as this picker is open. Touching the letter rail
   * turns it on; closing the picker turns it off again. Nothing is written to
   * the database either way — the frequency order is the real one.
   */
  const [alphaMode, setAlphaMode] = useState(false)
  const pendingLetter = useRef<string | null>(null)
  /** null = closed. '' = open and empty. */
  /**
   * One field does both jobs.
   *
   * There used to be a "+ Add" button and a "Search" button side by side at
   * the end of the list, which asked you to decide up front whether the thing
   * you wanted exists — the one question you cannot answer until you have
   * looked. Typing now filters what is there, and if nothing matches, the
   * same text becomes the name of a new subcategory under the open parent.
   */
  const [search, setSearch] = useState('')

  /**
   * How often each category is actually used, counted straight off the
   * entries. A subcategory's uses also count towards its parent, so a parent
   * rises because of the work done under it.
   *
   * Recomputed only when the entries change, not on every keystroke.
   */
  const uses = useMemo(() => {
    const m = new Map<string, number>()
    const bump = (id: string | undefined) => id && m.set(id, (m.get(id) ?? 0) + 1)
    for (const t of db.transactions) {
      if (!t.categoryId) continue
      bump(t.categoryId)
      const c = db.categories.find((x) => x.id === t.categoryId)
      if (c?.parentId) bump(c.parentId)
    }
    return m
  }, [db.transactions, db.categories])

  /**
   * Pinned first, then most-used, then the order you arranged them in.
   *
   * Usage alone is usually right, but it cannot know that a category you have
   * only just started using is the one you will reach for all week. Pinning
   * is the manual override for exactly that.
   */
  const byUse = (a: Category, b: Category) =>
    Number(!!b.pinned) - Number(!!a.pinned) ||
    (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) ||
    a.order - b.order
  const byName = (a: Category, b: Category) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  const tops = db.categories
    .filter((c) => c.type === type && !c.parentId)
    .sort(alphaMode ? byName : byUse)

  // Open on whichever parent the current selection belongs to (or its own
  // parent if it's already a subcategory), falling back to the first category.
  useEffect(() => {
    if (!open) return
    const cur = current ? db.categories.find((c) => c.id === current) : undefined
    const startParent = cur ? (cur.parentId ?? cur.id) : (tops[0]?.id ?? null)
    setActiveParent(startParent)
    setQuickAdd(null)
    setAlphaMode(false)
    setSearch('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The first touch on the rail re-sorts the list; the jump has to wait for
  // that render, because until it happens there are no letter anchors to
  // scroll to. Later touches in the same drag jump straight away.
  useEffect(() => {
    if (!alphaMode || !pendingLetter.current) return
    const letter = pendingLetter.current
    pendingLetter.current = null
    jumpTo(letter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alphaMode])

  if (!open) return null

  const activeCat = db.categories.find((c) => c.id === activeParent)

  /**
   * Ordering, in two modes.
   *
   * Normally the list is by how much you use it — the things you reach for all
   * day float to the top on their own, which beats any order you could arrange
   * by hand and keeps arranging itself as the shop changes.
   *
   * Touching the letter rail switches that list to A–Z for as long as the
   * picker is open, because a rail that jumps to "M" is meaningless against a
   * list that is not alphabetical. Close the picker and it is back to
   * frequency. Nothing is written to `order` in either mode.
   *
   * The rail itself only appears past ten subcategories; below that the whole
   * list is on screen and there is nothing to jump to.
   */
  const subs = activeParent
    ? db.categories.filter((c) => c.parentId === activeParent).sort(alphaMode ? byName : byUse)
    : []
  const alpha = subs.length > 10
  const shown = subs
  const letters =
    alpha && alphaMode ? [...new Set(shown.map((c) => indexLetter(c.name)))] : alpha
      ? [...new Set([...subs].sort(byName).map((c) => indexLetter(c.name)))]
      : []

  /**
   * Searching looks through *every* subcategory of this type, not only the
   * open parent. Hunting for "Sugar" means finding it wherever it lives —
   * having to guess which parent it was filed under first is the problem the
   * search is there to solve. Results carry their parent's name so the answer
   * is unambiguous.
   */
  const query = search.trim().toLowerCase()
  const results = query
    ? db.categories
        .filter(
          (c) =>
            c.type === type &&
            c.name.toLowerCase().includes(query),
        )
        .sort(byUse)
        .slice(0, 60)
    : []

  /**
   * Whether the typed name already exists *where it would be created* — under
   * the open parent, or as a top-level category. A "Sugar" under Food does
   * not stop you making a "Sugar" under Supplier, so this is deliberately
   * narrower than the search above it.
   */
  const exactMatch = query
    ? db.categories.find(
        (c) =>
          c.type === type &&
          c.name.trim().toLowerCase() === query &&
          (activeCat ? c.parentId === activeCat.id : !c.parentId),
      )
    : undefined

  /** Creates the typed name under the open parent and picks it immediately. */
  const createTyped = () => {
    const name = search.trim()
    if (!name) return
    if (exactMatch) return choose(exactMatch.id)
    const id = uid()
    addCategory({
      id,
      name,
      type,
      icon: '',
      color: activeCat ? activeCat.color : CHART_COLORS[tops.length % CHART_COLORS.length],
      parentId: activeCat?.id,
    })
    choose(id)
  }

  const CreateRow = () => (
    <button
      className="w-full px-4 py-3.5 text-left border-b"
      style={{ borderColor: 'var(--line)', color: 'var(--accent)' }}
      onClick={createTyped}
    >
      <span className="text-[15px]">+ Create “{search.trim()}”</span>
      <span className="block text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
        {activeCat ? `as a subcategory of ${activeCat.name}` : 'as a new category'}
      </span>
    </button>
  )

  const onRailPick = (letter: string) => {
    if (!alphaMode) {
      setAlphaMode(true)
      pendingLetter.current = letter
      return
    }
    jumpTo(letter)
  }

  const jumpTo = (letter: string) => {
    const row = letterRow.current[letter]
    const pane = subPane.current
    if (!row || !pane) return
    // offsetTop would be measured against whichever ancestor happens to be
    // positioned; the difference of two viewport rects is the honest answer.
    pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top
  }

  const choose = (id: string) => {
    onSelect(id)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Category" full>
      {/* Always there, never a mode you have to enter. Empty, the two panes
          browse as normal; typing turns the same field into the search, and
          the same text into the name of whatever is missing. */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
      >
        <span style={{ color: 'var(--muted)' }}>⌕</span>
        <input
          className="flex-1 min-w-0 text-[15px]"
          style={{ background: 'transparent', color: 'var(--text)' }}
          placeholder="Find, or type a new name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="px-2 text-[13px]"
            style={{ color: 'var(--muted)' }}
            onClick={() => setSearch('')}
          >
            Clear
          </button>
        )}
      </div>

      {query ? (
        <div className="h-full overflow-y-auto no-scrollbar">
          {/* The create row comes first when nothing matches at all, and last
              when there are results to consider — either way it is the answer
              to "it isn't here", without a second button to find. */}
          {results.length === 0 && <CreateRow />}
          {results.map((c) => {
            const parent = c.parentId ? db.categories.find((x) => x.id === c.parentId) : undefined
            return (
              <button
                key={c.id}
                className="w-full px-4 py-3 text-left border-b"
                style={{ borderColor: 'var(--line)' }}
                onClick={() => choose(c.id)}
              >
                <span className="block text-[15px]">{categoryLabel(c)}</span>
                {parent && (
                  <span className="block text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
                    in {parent.name}
                  </span>
                )}
              </button>
            )
          })}
          {results.length > 0 && !exactMatch && <CreateRow />}
        </div>
      ) : (
      <div className="flex h-full">
        {/* left: top-level categories */}
        <div className="w-[38%] shrink-0 overflow-y-auto no-scrollbar border-r" style={{ borderColor: 'var(--line)' }}>
          {tops.map((c) => {
            const active = c.id === activeParent
            const hasSubs = db.categories.some((x) => x.parentId === c.id)
            return (
              <button
                key={c.id}
                className="w-full flex items-center gap-1 px-3 py-4 text-left text-[14px] border-b"
                style={{
                  borderColor: 'var(--line)',
                  background: active ? c.color + '33' : 'transparent',
                  color: active ? c.color : 'var(--text)',
                }}
                onClick={() => (hasSubs ? setActiveParent(c.id) : choose(c.id))}
              >
                <span className="flex-1 truncate">{categoryLabel(c)}</span>
                {hasSubs && <span style={{ color: 'var(--muted)' }}>›</span>}
              </button>
            )
          })}
          <button
            className="w-full py-4 text-[13px] text-center"
            style={{ color: 'var(--accent)' }}
            onClick={() => setQuickAdd('top')}
          >
            + Add
          </button>
        </div>

        {/* right: subcategories of the active parent.

            The rail has to sit outside the scroller — absolutely positioned
            inside it, it would scroll away with the rows. */}
        <div className="relative flex-1 min-w-0">
          <div
            ref={subPane}
            className="h-full overflow-y-auto no-scrollbar"
            style={{ paddingRight: alpha ? 28 : 0 }}
          >
            {activeCat && subs.length > 0 && (
              <button
                className="w-full px-4 py-3.5 text-left text-[14px] border-b"
                style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
                onClick={() => choose(activeCat.id)}
              >
                {categoryLabel(activeCat)} (general)
              </button>
            )}
            {shown.map((c, i) => {
              // No letter dividers in the list — the rows stay exactly the rows
              // they were. The rail scrolls to the first row of a letter
              // instead, so the anchor is the row itself.
              const letter = indexLetter(c.name)
              const first =
                alpha && alphaMode && (i === 0 || indexLetter(shown[i - 1].name) !== letter)
              return (
                <div
                  key={c.id}
                  ref={
                    first
                      ? (n) => {
                          letterRow.current[letter] = n
                        }
                      : undefined
                  }
                  className="flex items-center border-b"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <button
                    className="flex-1 min-w-0 px-4 py-3.5 text-left text-[15px] truncate"
                    onClick={() => choose(c.id)}
                  >
                    {categoryLabel(c)}
                  </button>
                  <button
                    className="px-3 py-3.5 text-[15px] shrink-0"
                    style={{ color: c.pinned ? 'var(--accent)' : 'var(--muted)' }}
                    aria-label={c.pinned ? `Unpin ${c.name}` : `Pin ${c.name} to the top`}
                    onClick={() => togglePinCategory(c.id)}
                  >
                    {c.pinned ? '★' : '☆'}
                  </button>
                </div>
              )
            })}
            {/* The "+ Add" and "Search" pair that used to close this list is
                gone — both jobs are the one field at the top of the sheet.
                A subcategory still needs its own quick add though: typing in
                the top search field makes one under whichever parent happens
                to be open, which isn't obvious from here. */}
            {activeCat && (
              <button
                className="w-full py-3.5 text-[13px] text-center"
                style={{ color: 'var(--accent)' }}
                onClick={() => setQuickAdd('sub')}
              >
                + Add subcategory
              </button>
            )}
            {onManage && (
              <button
                className="w-full py-3.5 text-[13px] text-center"
                style={{ color: 'var(--muted)' }}
                onClick={onManage}
              >
                Manage categories
              </button>
            )}
          </div>

          {alpha && <AlphaIndex letters={letters} onPick={onRailPick} />}
        </div>
      </div>
      )}

      {quickAdd === 'top' && (
        <QuickAddPrompt
          title="New category"
          onCancel={() => setQuickAdd(null)}
          onAdd={(name) => {
            const id = uid()
            const color = CHART_COLORS[tops.length % CHART_COLORS.length]
            addCategory({ id, name, type, icon: '', color })
            setQuickAdd(null)
            choose(id)
          }}
        />
      )}
      {quickAdd === 'sub' && activeCat && (
        <QuickAddPrompt
          title={`New subcategory of ${categoryLabel(activeCat)}`}
          onCancel={() => setQuickAdd(null)}
          onAdd={(name) => {
            // Typing a name that already exists under this parent picks the
            // existing one rather than making a second. Load-time merging
            // would fold them together anyway; refusing to create the pair is
            // the version where nothing surprising happens later.
            const existing = db.categories.find(
              (c) =>
                c.parentId === activeCat.id &&
                c.name.trim().toLowerCase() === name.trim().toLowerCase(),
            )
            if (existing) {
              setQuickAdd(null)
              choose(existing.id)
              return
            }
            const id = uid()
            addCategory({ id, name, type, icon: '', color: activeCat.color, parentId: activeCat.id })
            setQuickAdd(null)
            choose(id)
          }}
        />
      )}
    </Sheet>
  )
}

export function AccountPicker({
  open,
  title = 'Account',
  onClose,
  onSelect,
  onSplit,
}: {
  open: boolean
  title?: string
  onClose: () => void
  onSelect: (id: string) => void
  onSplit?: () => void
}) {
  const { db, addAccount, togglePinAccount } = useStore()
  const [adding, setAdding] = useState<AccountGroup | null>(null)
  /** name of an account just created here, picked up once the store re-renders */
  const [justAdded, setJustAdded] = useState<string | null>(null)

  useEffect(() => {
    if (!justAdded) return
    const made = db.accounts.find((a) => a.name === justAdded)
    if (!made) return
    setJustAdded(null)
    onSelect(made.id)
    onClose()
    // onSelect/onClose are fresh closures every render; the trigger is the name
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justAdded, db.accounts])

  const pinned = [...db.accounts].filter((a) => a.pinned).sort((a, b) => a.order - b.order)
  // Pinned accounts come out of their groups entirely. A group left empty
  // simply stops rendering, and the "no accounts yet" chips at the foot of
  // the sheet still offer a way to add one back into it.
  const grouped = accountsByGroup(db)
    .map(([group, accounts]) => [group, accounts.filter((a) => !a.pinned)] as const)
    .filter(([, accounts]) => accounts.length > 0)

  /** One account row: the name selects, the star pins. */
  const AccountRow = ({ account }: { account: (typeof db.accounts)[number] }) => (
    <div
      className="flex items-center border-b"
      style={{ borderColor: 'var(--line)' }}
    >
      <button
        className="flex-1 text-left px-4 py-3 text-[14px]"
        onClick={() => {
          onSelect(account.id)
          onClose()
        }}
      >
        {account.name}
      </button>
      <button
        className="px-4 py-3 text-[15px]"
        style={{ color: account.pinned ? 'var(--accent)' : 'var(--muted)' }}
        aria-label={account.pinned ? `Unpin ${account.name}` : `Pin ${account.name} to the top`}
        onClick={() => togglePinAccount(account.id)}
      >
        {account.pinned ? '★' : '☆'}
      </button>
    </div>
  )

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {onSplit && (
        <button
          className="w-full text-left px-4 py-3.5 border-b text-[15px]"
          style={{ borderColor: 'var(--line)', color: 'var(--accent)' }}
          onClick={() => {
            onClose()
            onSplit()
          }}
        >
          Split across accounts…
          <span className="block text-[12px]" style={{ color: 'var(--muted)' }}>
            e.g. part online, part cash
          </span>
        </button>
      )}
      {/* The two or three you actually use, above the groups. Pinned accounts
          are lifted out of their group rather than repeated in it — seeing
          "Gpay" twice in one list is worse than the group looking short. */}
      {pinned.length > 0 && (
        <div>
          <div
            className="px-4 py-1.5 text-[11px] uppercase tracking-wide"
            style={{ background: 'var(--bg)', color: 'var(--accent)' }}
          >
            Pinned
          </div>
          {pinned.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </div>
      )}

      {grouped.map(([group, accounts]) => (
        <div key={group}>
          <div
            className="px-4 py-1.5 text-[11px] uppercase tracking-wide"
            style={{ background: 'var(--bg)', color: 'var(--muted)' }}
          >
            {group}
          </div>
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
          {/* Adding an account used to mean backing out of the entry you were
              part-way through, going to More, finding the accounts screen and
              coming back. It is one tap from here now, in the group you were
              already looking at, and the new account is selected straight
              away — the same shape as the category picker's quick-add. */}
          <button
            className="w-full text-left px-4 py-2.5 border-b text-[13px]"
            style={{ borderColor: 'var(--line)', color: 'var(--accent)' }}
            onClick={() => setAdding(group as AccountGroup)}
          >
            + New in {group}
          </button>
        </div>
      ))}

      {/* Groups with nothing in them yet do not appear above, so they get one
          row down here — otherwise a group could never receive its first
          account from this screen. */}
      {ACCOUNT_GROUPS.filter((g) => !db.accounts.some((a) => a.group === g)).length > 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {ACCOUNT_GROUPS.filter((g) => !db.accounts.some((a) => a.group === g)).map((g) => (
            <button
              key={g}
              className="px-3 py-1.5 rounded-full text-[12px]"
              style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}
              onClick={() => setAdding(g)}
            >
              + {g}
            </button>
          ))}
        </div>
      )}

      {adding && (
        <QuickAddPrompt
          title={`New ${adding} account`}
          onCancel={() => setAdding(null)}
          onAdd={(name) => {
            // addAccount mints the id and the order itself, so the new account
            // has to be found by name afterwards rather than by an id we chose.
            addAccount({ name, group: adding, initialBalance: 0, excludeFromTotal: false })
            setAdding(null)
            setJustAdded(name)
          }}
        />
      )}
    </Sheet>
  )
}

/**
 * Split one payment across several accounts. The parts must add up to the
 * transaction amount before it can be saved.
 */
export function SplitEditor({
  open,
  amount,
  value,
  onClose,
  onDone,
}: {
  open: boolean
  /** total to divide, in paise */
  amount: number
  value: Split[]
  onClose: () => void
  onDone: (splits: Split[]) => void
}) {
  const { db } = useStore()
  const [rows, setRows] = useState<{ accountId: string; text: string }[]>([])

  useEffect(() => {
    if (!open) return
    if (value.length) {
      setRows(value.map((s) => ({ accountId: s.accountId, text: formatAmount(s.amount, db.settings) })))
    } else {
      // seed with two rows so the common case is one tap away
      setRows([
        { accountId: db.accounts[0]?.id ?? '', text: formatAmount(amount, db.settings) },
        { accountId: db.accounts[1]?.id ?? '', text: '' },
      ])
    }
    // re-seed whenever the sheet opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const parsed = rows.map((r) => ({
    accountId: r.accountId,
    amount: toPaise(r.text.replace(/,/g, '') || '0'),
  }))
  const assigned = parsed.reduce((a, r) => a + r.amount, 0)
  const remaining = amount - assigned
  const duplicate = new Set(parsed.map((p) => p.accountId)).size !== parsed.length
  const valid =
    remaining === 0 &&
    parsed.every((p) => p.accountId && p.amount > 0) &&
    parsed.length >= 2 &&
    !duplicate

  const setRow = (i: number, patch: Partial<{ accountId: string; text: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <Sheet open onClose={onClose} title="Split payment">
      <div className="p-4 space-y-3">
        <div className="flex justify-between text-[13px]" style={{ color: 'var(--muted)' }}>
          <span>Total</span>
          <span>
            {db.settings.currencySymbol} {formatAmount(amount, db.settings)}
          </span>
        </div>

        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className="flex-1 border-b pb-1.5 text-[15px]"
              style={{ borderColor: 'var(--line)' }}
              value={r.accountId}
              onChange={(e) => setRow(i, { accountId: e.target.value })}
            >
              <option value="">Select account</option>
              {db.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              className="w-28 text-right tabular-nums border-b pb-1.5 text-[15px]"
              style={{ borderColor: 'var(--line)' }}
              inputMode="decimal"
              placeholder="0.00"
              value={r.text}
              onChange={(e) => setRow(i, { text: e.target.value })}
            />
            {rows.length > 2 && (
              <button
                className="px-1 text-[13px]"
                style={{ color: 'var(--expense)' }}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <div className="flex gap-3">
          <button
            className="text-[14px]"
            style={{ color: 'var(--accent)' }}
            onClick={() => setRows((rs) => [...rs, { accountId: '', text: '' }])}
          >
            + Add account
          </button>
          {remaining !== 0 && (
            <button
              className="text-[14px]"
              style={{ color: 'var(--accent)' }}
              onClick={() =>
                setRows((rs) => {
                  const last = rs.length - 1
                  const cur = toPaise((rs[last].text || '0').replace(/,/g, ''))
                  return rs.map((r, j) =>
                    j === last ? { ...r, text: formatAmount(cur + remaining, db.settings) } : r,
                  )
                })
              }
            >
              Put remainder on last
            </button>
          )}
        </div>

        <div
          className="flex justify-between text-[13px] pt-2 border-t"
          style={{
            borderColor: 'var(--line)',
            color: remaining === 0 ? 'var(--muted)' : 'var(--expense)',
          }}
        >
          <span>{remaining === 0 ? 'Fully assigned' : 'Unassigned'}</span>
          <span>
            {db.settings.currencySymbol} {formatAmount(remaining, db.settings)}
          </span>
        </div>
        {duplicate && (
          <div className="text-[12px]" style={{ color: 'var(--expense)' }}>
            Each account can only appear once.
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            className="flex-1 py-3 rounded-lg text-[15px]"
            style={{ background: 'var(--bg)' }}
            onClick={() => {
              onDone([])
              onClose()
            }}
          >
            Clear split
          </button>
          <button
            className="flex-1 py-3 rounded-lg text-white text-[15px] font-semibold"
            style={{ background: 'var(--accent)' }}
            disabled={!valid}
            onClick={() => {
              onDone(parsed)
              onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </Sheet>
  )
}

export function DateTimePicker({
  open,
  value,
  onClose,
  onSelect,
}: {
  open: boolean
  /** local ISO */
  value: string
  onClose: () => void
  onSelect: (iso: string) => void
}) {
  const { db } = useStore()
  const d = parseISO(value)
  const [month, setMonth] = useState(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  const [time, setTime] = useState(value.slice(11, 16) || '00:00')
  const selectedKey = value.slice(0, 10)
  const cells = calendarCells(month, db.settings.firstDayOfWeek)
  const order = db.settings.firstDayOfWeek === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const n = new Date(y, m - 1 + delta, 1)
    setMonth(`${n.getFullYear()}-${pad(n.getMonth() + 1)}`)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Date">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <button className="px-4 py-1 text-lg" onClick={() => shift(-1)}>
            ‹
          </button>
          <span className="font-semibold text-[15px]">{month.replace('-', '.')}</span>
          <button className="px-4 py-1 text-lg" onClick={() => shift(1)}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
          {order.map((i) => (
            <div key={i}>{WEEKDAYS[i]}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((cell) => {
            const key = dateToKey(cell)
            const inMonth = key.slice(0, 7) === month
            const active = key === selectedKey
            return (
              <button
                key={key}
                className="h-9 flex items-center justify-center text-[13px] rounded-full mx-auto w-9"
                style={{
                  opacity: inMonth ? 1 : 0.3,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--text)',
                }}
                onClick={() => onSelect(`${key}T${time}`)}
              >
                {cell.getDate()}
              </button>
            )
          })}
        </div>
        <div
          className="flex items-center justify-between mt-4 pt-3 border-t"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="text-[14px]">Time</span>
          <input
            type="time"
            value={time}
            className="text-[14px]"
            onChange={(e) => {
              setTime(e.target.value)
              onSelect(`${selectedKey}T${e.target.value}`)
            }}
          />
        </div>
        <button
          className="w-full mt-4 py-3 rounded-lg text-white font-semibold text-[15px]"
          style={{ background: 'var(--accent)' }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Sheet>
  )
}
