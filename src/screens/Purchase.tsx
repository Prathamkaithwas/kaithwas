import { useEffect, useMemo, useRef, useState } from 'react'
import type { PurchaseItem } from '../types'
import { useStore } from '../store'
import { AttachmentGrid, Empty, EditLockButton, Fab, Sheet, SuggestInput } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'
import { formatMoney, toPaise } from '../lib/money'
import { isPdfDataUrl } from '../lib/photo'
import { uid } from '../lib/seed'
import { usePersistedFold } from '../lib/usePersistedFold'

/**
 * The rate book: what each item costs to buy, and per what.
 *
 * This is the number that was being carried in a diary and in memory, and
 * guessed at when several items went out in one deal. It is a lookup and
 * nothing more by design — it shows the rate and stays out of the way, rather
 * than trying to price the deal itself.
 *
 * Separate from Stock on purpose. Stock is "what is on the shelf today" and
 * goes stale hourly; a purchase rate barely moves for months. Mixing them
 * would mean either counting quantity for everything just to record a rate,
 * or leaving half the stock list blank.
 */

/** Offered as one-tap units — just the two used daily; anything else is a
 *  free-text field away, same as category/supplier. */
const UNITS = ['piece', 'meter']

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.round((Date.now() - then) / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Everything already typed into a field, for the suggestion rows. */
function existingValues(items: PurchaseItem[], pick: (p: PurchaseItem) => string): string[] {
  const seen = new Set<string>()
  for (const i of items) {
    const v = pick(i).trim()
    if (v) seen.add(v)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Every combination across a set of independent traits — colour, base,
 * shape, whatever — flattened into the same kind of plain label the
 * "Variant" field already takes. [["White","Warm White"], ["E27","B22"]]
 * becomes ["White · E27", "White · B22", "Warm White · E27", "Warm White ·
 * B22"]: a Havells bulb that comes in 2 colours × 2 bases × 2 shapes is 8
 * rows nobody wants to type out and label by hand one at a time.
 *
 * An axis with no values yet (still being typed) is skipped rather than
 * collapsing the whole product to nothing — so the preview count updates
 * sensibly while a second or third trait is still half-entered.
 */
function combinations(axes: string[][]): string[] {
  return axes
    .reduce<string[][]>((acc, values) => (values.length ? acc.flatMap((c) => values.map((v) => [...c, v])) : acc), [
      [],
    ])
    .map((c) => c.join(' · '))
}

export function PurchasePanel() {
  const { db } = useStore()
  const [editing, setEditing] = useState<PurchaseItem | 'new' | null>(null)
  const [query, setQuery] = useState('')
  /**
   * Which categories are folded shut. Collapsed rather than expanded is the
   * thing worth storing: a shop with two categories should look exactly as it
   * did before this existed, so everything starts open and folding is opt-in.
   * Persisted across app restarts — see lib/usePersistedFold.
   */
  const [collapsed, toggle] = usePersistedFold('purchase')
  const searching = query.trim().length > 0

  // Grouped under their category, because browsing by category is how you
  // find the thing whose name you cannot quite remember — which is most of
  // the reason this list exists at all.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matching = [...db.purchaseItems]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((p) =>
        !q
          ? true
          : [p.name, p.supplier, p.category, p.subcategory, p.unit, p.notes ?? '']
              .join(' ')
              .toLowerCase()
              .includes(q),
      )
    const by = new Map<string, PurchaseItem[]>()
    for (const p of matching) {
      const key = p.category.trim() || 'Uncategorised'
      const list = by.get(key)
      if (list) list.push(p)
      else by.set(key, [p])
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [db.purchaseItems, query])

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden kitee-screen">
      {/* The same galaxy photo the header sits on, carried all the way down
          the screen rather than cropped off at the header's bottom edge —
          "full, top to bottom" was explicit. Every row is still its own
          opaque card (var(--surface)), so this only actually shows through
          in the gaps: the search bar's padding, the section-label strips,
          and whatever's left over at the bottom of a short list. That was
          true of Sleep's own full-screen night before this and is exactly
          why it doesn't cost the list any legibility. */}
      <div className="kitee-bg" aria-hidden>
        <img src="/img/kitee-galaxy.jpg" alt="" />
      </div>

      {db.purchaseItems.length > 0 && (
        <div className="px-3 pt-2 pb-1 shrink-0">
          <input
            className="w-full px-4 py-2.5 rounded-full text-[14px]"
            style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
            placeholder="Search item, supplier or category"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pb-content">
        {db.purchaseItems.length === 0 && (
          <Empty text="No rates yet — tap + to note what an item costs you, and per what" />
        )}
        {db.purchaseItems.length > 0 && groups.length === 0 && (
          <Empty text="Nothing matches that search" />
        )}
        {groups.map(([category, items]) => {
          // A search always wins over a folded category. Leaving one shut
          // while its rows match would make the search look broken — you
          // typed a supplier's name, the screen went nearly empty, and the
          // one row that matched is hidden inside a heading you forgot you
          // closed. The fold is remembered either way, so it comes back as
          // you left it once the box is cleared.
          const shut = !searching && collapsed.has(category)
          return (
            <div key={category}>
              <button
                className="fold-row"
                onClick={() => toggle(category)}
                aria-expanded={!shut}
              >
                <svg
                  className="fold-chev"
                  data-shut={shut || undefined}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="flex-1 text-left">{category}</span>
                {/* The count earns its place on a folded row — it is the only
                    thing left saying how much is in there. */}
                <span className="fold-count num">{items.length}</span>
              </button>
              {!shut &&
                items.map((p) => (
                  <PurchaseRow key={p.id} item={p} onOpen={() => setEditing(p)} />
                ))}
            </div>
          )
        })}
      </div>

      <Fab onClick={() => setEditing('new')} />

      {editing && (
        <PurchaseEditor
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PurchaseRow({ item, onOpen }: { item: PurchaseItem; onOpen: () => void }) {
  const { db } = useStore()
  return (
    <button
      className="w-full text-left px-4 py-3 border-b flex items-center gap-3 kitee-row"
      style={{ borderColor: 'var(--line)' }}
      onClick={onOpen}
    >
      {item.photos?.[0] && !isPdfDataUrl(item.photos[0]) ? (
        <img src={item.photos[0]} alt="" className="w-11 h-11 rounded object-cover shrink-0" />
      ) : (
        <span
          className="w-11 h-11 rounded shrink-0 flex items-center justify-center text-[15px] font-semibold"
          style={{ background: 'var(--bg)', color: 'var(--muted)' }}
          aria-hidden
        >
          {item.name.trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}

      <span className="flex-1 min-w-0">
        <span className="block text-[15px] truncate">
          {item.name}
          {item.variant && ` ${item.variant}`}
        </span>
        <span className="block text-[12px] truncate" style={{ color: 'var(--muted)' }}>
          {[item.subcategory, item.supplier].filter(Boolean).join(' · ') || relativeTime(item.updatedAt)}
        </span>
      </span>

      {/* The whole point of the screen — big enough to read at a glance
          across a counter, with the unit right there so "45" is never
          mistaken for the wrong measure. */}
      <span className="shrink-0 text-right">
        <span className="block text-[17px] font-semibold num">
          {formatMoney(item.rate, db.settings)}
        </span>
        {item.unit.trim() && (
          <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>
            per {item.unit}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * One other row of the same product, held entirely in local state until the
 * sheet's own Save commits the whole group at once — see the big comment on
 * `variantRows` below for why this stopped writing to the store per row.
 */
type VariantRow = {
  id: string
  variant: string
  rate: string
  unit: string
  /** The PurchaseItem this row came from, or null if it only exists in this
   *  editing session so far. Save updates the first kind and creates the
   *  second; a null-original row can also just be discarded with no trace,
   *  since nothing was ever written for it. */
  original: PurchaseItem | null
}

function PurchaseEditor({
  item,
  onClose,
}: {
  item: PurchaseItem | null
  onClose: () => void
}) {
  const { db, addPurchaseItem, updatePurchaseItem, deletePurchaseItem } = useStore()
  const [name, setName] = useState(item?.name ?? '')
  const [supplier, setSupplier] = useState(item?.supplier ?? '')
  const [rate, setRate] = useState(item ? String(item.rate / 100) : '')
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [subcategory, setSubcategory] = useState(item?.subcategory ?? '')
  const [variant, setVariant] = useState(item?.variant ?? '')
  const [photos, setPhotos] = useState<string[]>(item?.photos ?? [])
  const [notes, setNotes] = useState(item?.notes ?? '')
  const variantRef = useRef<HTMLInputElement>(null)

  /**
   * The rest of this item's family — every field on every row stays local
   * until Save, which is the actual fix for two complaints about the old
   * flow: switching to a sibling to nudge its rate meant leaving this sheet
   * and losing whatever was unsaved here, and adding a variant wrote it to
   * the store immediately and closed the sheet, so entering three wattages
   * in a row meant reopening the item three times to find each one again.
   * Now every row's rate (and label) is just editable right here in the
   * list, and nothing reaches the store until the one Save at the bottom.
   *
   * `groupId` is local too, not read off `item`, because the moment you add
   * the first variant to a previously ungrouped item this screen has to
   * start looking grouped — the Variant field and this list both key off it
   * — well before anything is actually saved.
   */
  const [groupId, setGroupId] = useState(item?.groupId)
  const [variantRows, setVariantRows] = useState<VariantRow[]>([])

  // The trait builder — "Colour: White, Warm White" plus "Base: E27, B22"
  // multiplies out to every combination at once (see `combinations` above),
  // rather than typing "White E27", "White B22", "Warm White E27"… by hand
  // one row at a time. Two blank axes to start: a single axis is really just
  // the plain "Add another variant" case, so starting with room for a second
  // one is what actually invites using this for what it's for.
  const [combosOpen, setCombosOpen] = useState(false)
  const [axes, setAxes] = useState<{ id: string; name: string; values: string }[]>([
    { id: uid(), name: '', values: '' },
    { id: uid(), name: '', values: '' },
  ])
  const comboPreview = useMemo(() => {
    const parsed = axes.map((a) => a.values.split(',').map((v) => v.trim()).filter(Boolean))
    const existing = new Set(
      [variant, ...variantRows.map((r) => r.variant)].map((v) => v.trim().toLowerCase()),
    )
    return combinations(parsed).filter((label) => !existing.has(label.toLowerCase()))
  }, [axes, variant, variantRows])
  // A record you're revisiting opens read-only, same lock Sleep and Mood use
  // — one tap on the pencil to actually change something, rather than every
  // field sitting live the moment you're just checking a price. A brand-new
  // item (item === null) has nothing saved yet to protect, so it opens
  // straight into editing; so does a variant the instant it's split off
  // (rate still 0, see addVariant) — that one was built to be typed into
  // immediately, and locking it would have undone the auto-focus that gets
  // the cursor into its Variant field for exactly that reason.
  const [unlocked, setUnlocked] = useState(!item || item.rate <= 0)

  // "50 metres for ₹1000" is how a bulk buy actually arrives — the rate is
  // the thing you have to work out afterwards, not the thing on the bill.
  // Closed by default so the common case (a rate already known) stays a
  // single field; opening it doesn't touch `rate` until its own button is
  // tapped, so typing here and then changing your mind loses nothing.
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkQty, setBulkQty] = useState('')
  const [bulkTotal, setBulkTotal] = useState('')
  const bulkQtyNum = parseFloat(bulkQty)
  const bulkTotalNum = parseFloat(bulkTotal)
  const bulkRate =
    isFinite(bulkQtyNum) && bulkQtyNum > 0 && isFinite(bulkTotalNum)
      ? bulkTotalNum / bulkQtyNum
      : undefined

  /**
   * Seeds every field when a different item is opened. Watches `item?.id`
   * only, same as before — the point is this runs once per open, not on
   * every keystroke or on every store write Save makes on its way out.
   */
  useEffect(() => {
    setName(item?.name ?? '')
    setSupplier(item?.supplier ?? '')
    setRate(item ? String(item.rate / 100) : '')
    setUnit(item?.unit ?? '')
    setCategory(item?.category ?? '')
    setSubcategory(item?.subcategory ?? '')
    setVariant(item?.variant ?? '')
    setPhotos(item?.photos ?? [])
    setNotes(item?.notes ?? '')
    setBulkOpen(false)
    setBulkQty('')
    setBulkTotal('')
    setUnlocked(!item || item.rate <= 0)
    setGroupId(item?.groupId)
    setVariantRows(
      item?.groupId
        ? db.purchaseItems
            .filter((p) => p.groupId === item.groupId && p.id !== item.id)
            .sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? ''))
            .map((p) => ({ id: p.id, variant: p.variant ?? '', rate: String(p.rate / 100), unit: p.unit, original: p }))
        : [],
    )
    // A freshly split-off variant lands with an empty label — that's the one
    // thing actually worth typing next, so the field is focused rather than
    // left to just sit there looking like a read-only summary.
    if (item?.groupId && !item.variant) variantRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  const updateRow = (id: string, patch: Partial<Pick<VariantRow, 'variant' | 'rate'>>) =>
    setVariantRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  // Nothing was ever written for a row that only exists in this session —
  // dropping it from the list is the whole operation, a plain tap. An
  // already-saved row is a real delete, so it needs the same hold-to-confirm
  // gesture as the item-level delete below rather than vanishing on one tap.
  const removeRow = (row: VariantRow) => setVariantRows((rows) => rows.filter((r) => r.id !== row.id))

  const removeSavedRow = (row: VariantRow) => {
    if (row.original) deletePurchaseItem(row.original.id)
    removeRow(row)
  }

  // Suggestions come from what has already been typed rather than a fixed
  // list — the taxonomy gets built as the shop goes, which is the only way
  // it ends up matching how this particular shop actually sorts its goods.
  const categories = useMemo(() => existingValues(db.purchaseItems, (p) => p.category), [db.purchaseItems])
  const subcategories = useMemo(
    () =>
      existingValues(
        db.purchaseItems.filter((p) => !category.trim() || p.category === category),
        (p) => p.subcategory,
      ),
    [db.purchaseItems, category],
  )
  const suppliers = useMemo(() => existingValues(db.purchaseItems, (p) => p.supplier), [db.purchaseItems])

  /**
   * Commits the opened item and every variant row in one pass — the one
   * write to the store this whole sheet now makes, however many rows are in
   * it. An existing row updates in place; a row that only ever lived in this
   * session (added via the button below) gets created here for the first
   * time, still carrying whatever rate and label were typed into it.
   */
  const save = () => {
    if (!name.trim()) return
    const shared = {
      name: name.trim(),
      supplier: supplier.trim(),
      category: category.trim(),
      subcategory: subcategory.trim(),
      photos: photos.length ? photos : undefined,
      notes: notes.trim() || undefined,
    }
    const gid = groupId ?? (variantRows.length > 0 ? uid() : undefined)
    const body = {
      ...shared,
      rate: toPaise(rate || '0'),
      unit: unit.trim(),
      groupId: gid,
      variant: variant.trim() || undefined,
    }
    if (item) updatePurchaseItem({ ...item, ...body })
    else addPurchaseItem(body)

    for (const row of variantRows) {
      const rowBody = {
        ...shared,
        rate: toPaise(row.rate || '0'),
        unit: row.unit.trim(),
        groupId: gid,
        variant: row.variant.trim() || undefined,
      }
      if (row.original) updatePurchaseItem({ ...row.original, ...rowBody })
      else addPurchaseItem({ id: row.id, ...rowBody })
    }
    onClose()
  }

  /**
   * A new row of the same product, added to the local list only — nothing
   * reaches the store until Save. Used to write to the store and jump the
   * sheet straight to the new row so it could be typed into immediately;
   * now the row is just an editable line right here, so there's nothing to
   * jump to.
   *
   * Works from a brand-new, never-saved item too — `groupId` only gets set
   * the first time this is pressed, whether or not `item` itself exists
   * yet, so both cases end up looking the same: a focused item at the top
   * and one growing list of siblings underneath it.
   */
  const addVariant = () => {
    if (!name.trim()) return
    if (!groupId) setGroupId(uid())
    setVariantRows((rows) => [
      ...rows,
      { id: uid(), variant: '', rate: '0', unit: unit.trim(), original: null },
    ])
  }

  const updateAxis = (id: string, patch: Partial<{ name: string; values: string }>) =>
    setAxes((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const addAxis = () => setAxes((a) => [...a, { id: uid(), name: '', values: '' }])
  const removeAxis = (id: string) => setAxes((a) => (a.length > 1 ? a.filter((x) => x.id !== id) : a))

  /**
   * Turns the trait builder into rows, same local-only rules as a single
   * `addVariant` — nothing reaches the store until Save. The very first
   * combination becomes the focused row up top rather than one more entry
   * in the list below, so a brand-new item doesn't end up with an
   * "(unlabelled)" row sitting right next to eight properly-labelled ones —
   * only happens when the focused row doesn't already carry a label of its
   * own, so generating a second batch of combinations onto an
   * already-labelled item just adds rows without touching it.
   */
  const generateCombos = () => {
    if (!name.trim() || comboPreview.length === 0) return
    if (!groupId) setGroupId(uid())
    let toAdd = comboPreview
    if (!variant.trim()) {
      setVariant(toAdd[0])
      toAdd = toAdd.slice(1)
    }
    setVariantRows((rows) => [
      ...rows,
      ...toAdd.map((label) => ({ id: uid(), variant: label, rate: '0', unit: unit.trim(), original: null })),
    ])
    setCombosOpen(false)
    setAxes([
      { id: uid(), name: '', values: '' },
      { id: uid(), name: '', values: '' },
    ])
  }

  const chips = (values: string[], onPick: (v: string) => void, current: string) =>
    values.length > 0 && (
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {values.map((v) => (
          <button
            key={v}
            className="px-2.5 py-1 rounded-full text-[11px]"
            style={{
              background: v === current ? 'var(--accent)' : 'var(--bg)',
              color: v === current ? '#fff' : 'var(--text)',
            }}
            onClick={() => onPick(v)}
          >
            {v}
          </button>
        ))}
      </div>
    )

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <div className="text-[11px] mb-1" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      {node}
    </div>
  )

  const input = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <input
      className="w-full border-b pb-2 text-[15px]"
      style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...extra}
    />
  )

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit item' : 'New item'} full>
      <div className="p-4 space-y-4">
        {/* Only a saved item has anything to protect — a brand-new one opens
            straight into editing, same as Sleep and Mood. */}
        {item && (
          <div className="flex justify-end -mb-2">
            <EditLockButton unlocked={unlocked} onClick={() => setUnlocked((u) => !u)} />
          </div>
        )}

        {input(name, setName, 'Item name (e.g. Copper wire)', { autoFocus: !item, disabled: !unlocked })}

        <AttachmentGrid files={photos} onChange={setPhotos} label="Photos" disabled={!unlocked} />

        {/* Rate and unit belong together — a rate without its measure is the
            exact ambiguity this screen exists to remove. Variant joins them
            once this item actually has siblings — it's the third thing that
            varies row to row, same as rate and unit do. */}
        <div className="flex gap-3">
          {groupId && (
            <div className="flex-1">
              {field(
                'Variant (e.g. 12W)',
                <input
                  ref={variantRef}
                  className="w-full border-b pb-2 text-[15px]"
                  style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                  placeholder="e.g. 12W"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  disabled={!unlocked}
                />,
              )}
            </div>
          )}
          <div className="flex-1">
            {field(
              'Purchase rate',
              input(rate, setRate, '0', {
                inputMode: 'decimal',
                className: 'w-full border-b pb-2 text-[15px] num',
                disabled: !unlocked,
              }),
            )}
          </div>
          <div className="flex-1">
            {field('Per unit', input(unit, setUnit, 'e.g. meter', { disabled: !unlocked }))}
          </div>
        </div>
        {unlocked && chips(UNITS, setUnit, unit)}

        {/* Other rows of the same product — same name/supplier/category,
            differing only in wattage/size/etc. Every rate and label here is
            editable right in the list, and none of it reaches the store
            until the Save button at the bottom — see the comment on
            `variantRows` above. Shown for any item that's already grouped,
            saved or not; a plain, ungrouped item gets the single link below
            instead — one of the two is always on screen, never neither. */}
        {(variantRows.length > 0 || groupId) && (
          <div>
            <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
              Other variants of {name.trim() || 'this item'}
            </div>
            <div className="space-y-1.5">
              {variantRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg text-[13px]"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <input
                    className="flex-1 min-w-0 bg-transparent"
                    placeholder="(unlabelled)"
                    value={row.variant}
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus={!row.original}
                    disabled={!unlocked}
                    onChange={(e) => updateRow(row.id, { variant: e.target.value })}
                  />
                  <input
                    className="w-16 shrink-0 bg-transparent text-right num"
                    inputMode="decimal"
                    placeholder="0"
                    value={row.rate}
                    disabled={!unlocked}
                    onChange={(e) => updateRow(row.id, { rate: e.target.value })}
                  />
                  {row.unit.trim() && (
                    <span className="shrink-0 text-[11px]" style={{ color: 'var(--muted)' }}>
                      /{row.unit}
                    </span>
                  )}
                  {unlocked && row.original && (
                    <HoldConfirm label={`Delete variant ${row.variant || '(unlabelled)'}`} onConfirm={() => removeSavedRow(row)} />
                  )}
                  {unlocked && !row.original && (
                    <button
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[13px]"
                      style={{ color: 'var(--muted)' }}
                      onClick={() => removeRow(row)}
                      aria-label={`Remove variant ${row.variant || '(unlabelled)'}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {unlocked && (
                <button
                  className="w-full py-2.5 rounded-lg text-[13px]"
                  style={{ border: '1.5px dashed var(--accent)', color: 'var(--accent)' }}
                  onClick={addVariant}
                  disabled={!name.trim()}
                >
                  + Add another variant
                </button>
              )}
            </div>
          </div>
        )}
        {unlocked && !groupId && variantRows.length === 0 && (
          <button
            className="text-[13px]"
            style={{ color: 'var(--accent)' }}
            onClick={addVariant}
            disabled={!name.trim()}
          >
            + This comes in more than one variant (e.g. wattage)
          </button>
        )}

        {/* For a product that varies along more than one trait at once —
            colour, base, shape — rather than typing every combination's
            label out by hand. Offered whether or not this item is grouped
            yet; the first batch of combinations is what actually groups it. */}
        {unlocked && (combosOpen ? (
          <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
                Generate every combination
              </div>
              <button
                className="text-[12px]"
                style={{ color: 'var(--muted)' }}
                onClick={() => setCombosOpen(false)}
              >
                Close
              </button>
            </div>
            {axes.map((axis) => (
              <div key={axis.id} className="flex gap-2 items-end">
                <div className="w-[86px] shrink-0">
                  {field(
                    'Trait',
                    <input
                      className="w-full border-b pb-2 text-[13px]"
                      style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                      placeholder="e.g. Colour"
                      value={axis.name}
                      onChange={(e) => updateAxis(axis.id, { name: e.target.value })}
                    />,
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {field(
                    axis.name.trim() ? `${axis.name.trim()} values` : 'Values, comma separated',
                    <input
                      className="w-full border-b pb-2 text-[13px]"
                      style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
                      placeholder="e.g. White, Warm White"
                      value={axis.values}
                      onChange={(e) => updateAxis(axis.id, { values: e.target.value })}
                    />,
                  )}
                </div>
                {axes.length > 1 && (
                  <button
                    className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[13px]"
                    style={{ color: 'var(--muted)' }}
                    onClick={() => removeAxis(axis.id)}
                    aria-label={`Remove trait ${axis.name || 'unnamed'}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button className="text-[12px]" style={{ color: 'var(--accent)' }} onClick={addAxis}>
              + Add another trait
            </button>
            <button
              className="w-full py-2 rounded-lg text-[13px] font-semibold"
              style={{
                background: comboPreview.length ? 'var(--accent)' : 'var(--bg)',
                color: comboPreview.length ? '#fff' : 'var(--muted)',
              }}
              disabled={!name.trim() || comboPreview.length === 0}
              onClick={generateCombos}
            >
              {comboPreview.length
                ? `Create ${comboPreview.length} variant${comboPreview.length === 1 ? '' : 's'}`
                : 'Add values to at least one trait'}
            </button>
          </div>
        ) : (
          <button className="text-[13px]" style={{ color: 'var(--accent)' }} onClick={() => setCombosOpen(true)}>
            + It comes in a few combinations (e.g. colour × base × shape)
          </button>
        ))}

        {/* A bulk buy hands you a total, not a rate — "50 metres for ₹1000"
            — so this works the division out instead of making it mental
            arithmetic before the rate field can even be filled in. Only
            offered while unlocked — it exists to change the rate. */}
        {unlocked && (bulkOpen ? (
          <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
                Work it out from a bulk buy
              </div>
              <button
                className="text-[12px]"
                style={{ color: 'var(--muted)' }}
                onClick={() => {
                  setBulkOpen(false)
                  setBulkQty('')
                  setBulkTotal('')
                }}
              >
                Close
              </button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                {field(
                  `Quantity${unit.trim() ? ` (${unit.trim()})` : ''}`,
                  input(bulkQty, setBulkQty, 'e.g. 50', { inputMode: 'decimal', className: 'w-full border-b pb-2 text-[15px] num' }),
                )}
              </div>
              <div className="flex-1">
                {field(
                  'Total paid',
                  input(bulkTotal, setBulkTotal, 'e.g. 1000', { inputMode: 'decimal', className: 'w-full border-b pb-2 text-[15px] num' }),
                )}
              </div>
            </div>
            {bulkRate !== undefined && (
              <button
                className="w-full py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: 'var(--accent)', color: '#fff' }}
                onClick={() => setRate(String(Number(bulkRate.toFixed(4))))}
              >
                Use {formatMoney(toPaise(bulkRate), db.settings)}
                {unit.trim() ? ` per ${unit.trim()}` : ' per unit'}
              </button>
            )}
          </div>
        ) : (
          <button className="text-[13px]" style={{ color: 'var(--accent)' }} onClick={() => setBulkOpen(true)}>
            Work it out from a bulk buy instead
          </button>
        ))}

        {field(
          'Supplier',
          <SuggestInput
            value={supplier}
            onChange={setSupplier}
            options={suppliers}
            placeholder="Who you buy it from"
            disabled={!unlocked}
          />,
        )}

        {field(
          'Category',
          <SuggestInput
            value={category}
            onChange={setCategory}
            options={categories}
            placeholder="e.g. Wiring"
            disabled={!unlocked}
          />,
        )}

        {field(
          'Subcategory',
          <SuggestInput
            value={subcategory}
            onChange={setSubcategory}
            options={subcategories}
            placeholder="e.g. Copper"
            disabled={!unlocked}
          />,
        )}

        {field(
          'Notes',
          <textarea
            className="w-full text-[14px] resize-none border-b pb-2"
            style={{ borderColor: 'var(--line)', background: 'transparent', color: 'var(--text)' }}
            rows={2}
            placeholder="Anything worth remembering about this rate"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!unlocked}
          />,
        )}

        {item && (
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Updated {relativeTime(item.updatedAt)}
          </div>
        )}

        {/* Hidden rather than disabled while locked — Delete moved behind
            the same lock as everything else it can undo, and there's
            nothing for Save to commit until something's actually been
            unlocked and changed. */}
        {unlocked && (
          <div className="flex items-center gap-2 pt-2">
            {item && (
              <>
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  hold to delete
                </span>
                <HoldConfirm label="Delete item" onConfirm={() => { deletePurchaseItem(item.id); onClose() }} />
              </>
            )}
            <span className="flex-1" />
            <button
              className="flex-1 py-3 rounded-lg text-white text-[14px] font-semibold"
              style={{ background: 'var(--accent)' }}
              disabled={!name.trim()}
              onClick={save}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
