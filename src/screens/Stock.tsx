import { useMemo, useState } from 'react'
import type { StockItem } from '../types'
import { useStore } from '../store'
import { Confirm, Empty, Fab, Sheet } from '../components/ui'

/** The four things always recorded; everything else is a custom field. */
const CORE = [
  { key: 'name', label: 'Item name', placeholder: 'e.g. Copper wire' },
  { key: 'variety', label: 'Variety', placeholder: 'e.g. 2.5 sq mm' },
  { key: 'quantity', label: 'Quantity', placeholder: 'e.g. 12 rolls' },
  { key: 'location', label: 'Location', placeholder: 'e.g. Godown shelf B' },
] as const

/** Offered as one-tap additions so a custom field is usually just a tap. */
const SUGGESTED = ['Brand', 'Supplier', 'Rate', 'Batch', 'Expiry', 'Rack', 'Min. level']

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function StockPanel() {
  const { db } = useStore()
  const [editing, setEditing] = useState<StockItem | 'new' | null>(null)
  const [query, setQuery] = useState('')

  const items = useMemo(() => {
    const sorted = [...db.stockItems].sort((a, b) => a.order - b.order)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((s) =>
      [s.name, s.variety, s.location, s.quantity, ...s.fields.map((f) => `${f.label} ${f.value}`)]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [db.stockItems, query])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {db.stockItems.length > 0 && (
        <div className="px-3 pt-2 pb-1 shrink-0">
          <input
            className="w-full px-4 py-2.5 rounded-full text-[14px]"
            style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
            placeholder="Search stock"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pb-content px-3 pt-2">
        {items.length === 0 && (
          <Empty
            icon="📦"
            text={
              db.stockItems.length === 0
                ? 'No stock recorded yet. Tap + to add your first item.'
                : 'Nothing matches that search'
            }
          />
        )}

        {items.map((s, i) => (
          <StockCard key={s.id} item={s} index={i} onOpen={() => setEditing(s)} />
        ))}
      </div>

      <Fab onClick={() => setEditing('new')} />

      {editing && (
        <StockEditor
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function StockCard({
  item,
  index,
  onOpen,
}: {
  item: StockItem
  index: number
  onOpen: () => void
}) {
  const extras = item.fields.filter((f) => f.label.trim() && f.value.trim())

  return (
    <button
      onClick={onOpen}
      className="relative card w-full text-left px-4 py-3.5 mb-2.5 lift animate-fade"
      style={{ animationDelay: `${Math.min(index, 12) * 26}ms` }}
    >
      <span className="flex items-start gap-3">
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[16px] font-semibold truncate">{item.name || 'Untitled'}</span>
            {item.variety && (
              <span className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>
                {item.variety}
              </span>
            )}
          </span>
          {item.location && (
            <span className="flex items-center gap-1 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
              {item.location}
            </span>
          )}
        </span>

        {item.quantity && (
          <span
            className="shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold num"
            style={{
              background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
              border: '1.5px solid color-mix(in srgb, var(--accent) 28%, var(--surface))',
              color: 'var(--accent)',
            }}
          >
            {item.quantity}
          </span>
        )}
      </span>

      {extras.length > 0 && (
        <span className="flex flex-wrap gap-1.5 mt-2.5">
          {extras.map((f, i) => (
            <span
              key={i}
              className="px-2 py-1 rounded-lg text-[11px]"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
            >
              <span style={{ color: 'var(--muted)' }}>{f.label}</span>{' '}
              <span style={{ color: 'var(--text)' }}>{f.value}</span>
            </span>
          ))}
        </span>
      )}

      <span className="block mt-2 text-[10px]" style={{ color: 'var(--muted)', opacity: 0.75 }}>
        updated {relativeTime(item.updatedAt)}
      </span>
    </button>
  )
}

function StockEditor({ item, onClose }: { item: StockItem | null; onClose: () => void }) {
  const { addStockItem, updateStockItem, deleteStockItem } = useStore()
  const [name, setName] = useState(item?.name ?? '')
  const [variety, setVariety] = useState(item?.variety ?? '')
  const [quantity, setQuantity] = useState(item?.quantity ?? '')
  const [location, setLocation] = useState(item?.location ?? '')
  const [fields, setFields] = useState(item?.fields ?? [])
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [confirmDel, setConfirmDel] = useState(false)

  const core: Record<string, [string, (v: string) => void]> = {
    name: [name, setName],
    variety: [variety, setVariety],
    quantity: [quantity, setQuantity],
    location: [location, setLocation],
  }

  const save = () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      variety: variety.trim(),
      quantity: quantity.trim(),
      location: location.trim(),
      fields: fields.filter((f) => f.label.trim()),
      notes: notes.trim() || undefined,
    }
    if (item) updateStockItem({ ...item, ...payload })
    else addStockItem(payload)
    onClose()
  }

  const addField = (label = '') =>
    setFields((fs) => [...fs, { label, value: '' }])

  const unusedSuggestions = SUGGESTED.filter(
    (s) => !fields.some((f) => f.label.toLowerCase() === s.toLowerCase()),
  )

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit stock item' : 'New stock item'} full>
      <div className="px-4 pb-6 space-y-5">
        {/* the four always-there fields */}
        <div className="group-list">
          {CORE.map((c) => (
            <div key={c.key} className="flex items-center gap-3 px-4 py-3">
              <span className="w-[86px] shrink-0 text-[13px]" style={{ color: 'var(--muted)' }}>
                {c.label}
              </span>
              <input
                className="flex-1 min-w-0 text-[15px]"
                placeholder={c.placeholder}
                value={core[c.key][0]}
                onChange={(e) => core[c.key][1](e.target.value)}
                autoFocus={c.key === 'name' && !item}
              />
            </div>
          ))}
        </div>

        {/* anything else this item happens to need */}
        {fields.length > 0 && (
          <div className="group-list">
            {fields.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                <input
                  className="w-[86px] shrink-0 text-[12px]"
                  style={{ color: 'var(--muted)' }}
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <input
                  className="flex-1 min-w-0 text-[15px]"
                  placeholder="Value"
                  value={f.value}
                  onChange={(e) =>
                    setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center press"
                  style={{ color: 'var(--expense)' }}
                  aria-label={`Remove ${f.label || 'field'}`}
                  onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className="px-3.5 py-1.5 rounded-full text-[13px] font-medium press"
            style={{
              background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
              border: '1.5px solid color-mix(in srgb, var(--accent) 30%, var(--surface))',
              color: 'var(--accent)',
            }}
            onClick={() => addField()}
          >
            + Add field
          </button>
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              className="px-3 py-1.5 rounded-full text-[12px] press"
              style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)', color: 'var(--muted)' }}
              onClick={() => addField(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <textarea
          className="w-full text-[14px] resize-none rounded-[var(--r-md)] px-4 py-3"
          style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
          rows={2}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex gap-2">
          {item && (
            <button
              className="flex-1 py-3.5 rounded-[var(--r-md)] text-[15px] press"
              style={{
                color: 'var(--expense)',
                background: 'color-mix(in srgb, var(--expense) 12%, var(--surface))',
                border: '1.5px solid color-mix(in srgb, var(--expense) 26%, var(--surface))',
              }}
              onClick={() => setConfirmDel(true)}
            >
              Delete
            </button>
          )}
          <button
            className="flex-1 py-3.5 rounded-[var(--r-md)] text-white text-[15px] font-semibold press"
            style={{
              background: 'var(--accent)',
              boxShadow: '0 8px 22px -8px var(--accent)',
            }}
            disabled={!name.trim()}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>

      <Confirm
        open={confirmDel}
        title="Delete this item?"
        body={item?.name}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (item) deleteStockItem(item.id)
          onClose()
        }}
        onClose={() => setConfirmDel(false)}
      />
    </Sheet>
  )
}
