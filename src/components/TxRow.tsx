import { useRef, useState } from 'react'
import type { Transaction } from '../types'
import { useStore } from '../store'
import { accountLabel, accountName } from '../lib/calc'
import { DEAL_COLORS, FIELD_LABEL, TYPE_LABEL } from '../types'
import { Money } from './ui'
import { hapticLight } from '../lib/haptics'
import { photosOf } from '../lib/photo'
import { HoldConfirm } from './HoldConfirm'

export function TxRow({
  tx,
  onEdit,
  showDate,
}: {
  tx: Transaction
  onEdit: (tx: Transaction) => void
  showDate?: boolean
}) {
  const { db, addTx, deleteTx } = useStore()
  const [menu, setMenu] = useState(false)
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const shots = photosOf(tx)
  const isTransfer = tx.type === 'transfer'
  const kind = tx.type === 'income' ? 'income' : tx.type === 'expense' ? 'expense' : 'transfer'

  // Plain names, no glyphs — a subcategory shows its parent above it and
  // borrows the parent's colour for the rail.
  const cat = db.categories.find((c) => c.id === tx.categoryId)
  const parent = cat?.parentId ? db.categories.find((c) => c.id === cat.parentId) : undefined
  const main = isTransfer ? TYPE_LABEL.transfer : (parent?.name ?? cat?.name ?? '')
  const sub = !isTransfer && parent && db.settings.subcategory ? (cat?.name ?? '') : ''
  const rail = isTransfer ? 'var(--transfer)' : ((parent ?? cat)?.color ?? 'var(--muted)')

  /**
   * The headline of a row is whatever you actually wrote on it. With no note
   * and no description that line came out blank, which left a hole where the
   * eye expects the name of the thing — so the subcategory moves up into it,
   * and then is not repeated below in the rail column.
   */
  const typed = isTransfer ? accountName(db, tx.fromAccountId) : tx.note || tx.description
  const subAsTitle = !isTransfer && !typed && !!sub
  const title = typed || (subAsTitle ? sub : '')
  const subShown = subAsTitle ? '' : sub

  /**
   * Long-press opens the row menu — but only if the thumb actually stayed put.
   *
   * The timer used to be cancelled on pointerup and pointerleave alone, which
   * meant a slow scroll opened the menu under your thumb: a finger dragging
   * the list never leaves the row it started on, so nothing cancelled it. The
   * movement threshold is what separates "holding this row" from "scrolling
   * past it", and pointercancel covers the browser taking the gesture over.
   */
  const origin = useRef<{ x: number; y: number } | null>(null)

  const startPress = (e: React.PointerEvent) => {
    origin.current = { x: e.clientX, y: e.clientY }
    press.current = setTimeout(() => {
      hapticLight()
      setMenu(true)
    }, 500)
  }

  const movePress = (e: React.PointerEvent) => {
    const o = origin.current
    if (!o) return
    // 10px is comfortably inside the slop of a deliberate press and well
    // under the distance a scroll covers before the timer would fire.
    if (Math.abs(e.clientX - o.x) > 10 || Math.abs(e.clientY - o.y) > 10) endPress()
  }

  const endPress = () => {
    clearTimeout(press.current)
    origin.current = null
  }

  return (
    <>
      {/* Roomier than it was: the four things that matter — category, note,
          account and amount — each get their own space instead of being
          packed edge to edge. Still lands ~10 rows on a phone screen. */}
      <button
        className="relative w-full flex items-start gap-3 pl-3.5 pr-3.5 py-2 text-left press"
        style={{ background: 'transparent' }}
        onClick={() => (menu ? setMenu(false) : onEdit(tx))}
        onPointerDown={startPress}
        onPointerMove={movePress}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu(true)
        }}
      >
        {/* the category's own colour, as a slim rail rather than an icon */}
        <span
          className="absolute left-0 top-2.5 bottom-2.5 w-[4px] rounded-r-full"
          style={{ background: rail }}
          aria-hidden
        />

        {/* category over subcategory */}
        <span className="w-[84px] shrink-0" style={{ lineHeight: 1.3 }}>
          <span
            className="block text-[13px] font-semibold line-clamp-2"
            style={{
              // pulled toward the text colour so it stays legible on dark
              // without losing which category it is
              color: `color-mix(in srgb, ${rail} 72%, var(--text))`,
            }}
          >
            {main}
          </span>
          {subShown && (
            <span className="block text-[12px] truncate mt-0.5" style={{ color: 'var(--muted)' }}>
              {subShown}
            </span>
          )}
        </span>

        <span className="flex-1 min-w-0" style={{ lineHeight: 1.35 }}>
          {/* the note gets the whole first line; everything else sits under it.
              With nothing to put there at all the line is dropped rather than
              held open empty, so the account rises to meet the amount. */}
          {title && <span className="block text-[15px] font-semibold truncate">{title}</span>}
          <span className={`flex items-center gap-2 min-w-0 ${title ? 'mt-1' : ''}`}>
            <span className="text-[13px] truncate" style={{ color: 'var(--muted)' }}>
              {isTransfer ? `→ ${accountName(db, tx.toAccountId)}` : accountLabel(db, tx)}
              {db.settings.showDescription && tx.description && ` · ${tx.description}`}
            </span>
            {/* 'okay' is the neutral middle of the scale, so it earns no
                mark — a dot on every entry says nothing. The value is still
                stored and still shown on the slider when you reopen the
                entry; it just stops shouting from the list. */}
            {tx.deal && tx.deal !== 'okay' && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: DEAL_COLORS[tx.deal] }}
              />
            )}
            {shots.length > 0 && (
              <span className="text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>
                IMG{shots.length > 1 ? ` ×${shots.length}` : ''}
              </span>
            )}
            {showDate && (
              <span className="text-[12px] shrink-0 num" style={{ color: 'var(--muted)' }}>
                {tx.date.slice(0, 10)}
              </span>
            )}
            {menu && (
              <svg
                className="tx-chev"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: 'var(--muted)' }}
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </span>
        </span>

        <span className="text-right shrink-0 pl-1" style={{ lineHeight: 1.35 }}>
          <Money value={tx.amount} kind={kind} className="text-[16px] font-semibold" />
          {!!tx.profit && (
            <span
              className="block text-[12px] mt-0.5"
              style={{ color: tx.profit < 0 ? 'var(--expense)' : 'var(--muted)' }}
            >
              {tx.profit < 0 ? `${FIELD_LABEL.loss.toLowerCase()} ` : `${FIELD_LABEL.profit.toLowerCase()} `}
              <Money value={Math.abs(tx.profit)} kind="plain" hideSymbol />
            </span>
          )}
          {isTransfer && !!tx.fee && (
            <span className="block text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
              fee <Money value={tx.fee} kind="plain" />
            </span>
          )}
        </span>
      </button>

      {/* The row's own actions, revealed in place.
          This used to be a bottom sheet, which meant a long-press threw a
          panel over the whole screen to offer three buttons — you lost sight
          of the row you were acting on. It unfolds under the row instead:
          max-height from 0 to the panel's height, and the chevron on the row
          turns over as it goes. */}
      <div className={`tx-fold${menu ? ' open' : ''}`}>
        <div className="tx-fold-inner">
          <button
            className="tx-act"
            onClick={() => {
              setMenu(false)
              onEdit(tx)
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4l10-10-4-4L4 16zM14 6l4 4" />
            </svg>
            Edit
          </button>
          <button
            className="tx-act"
            onClick={() => {
              setMenu(false)
              const { id: _id, ...rest } = tx
              void _id
              addTx(rest)
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 8h11v11H8zM5 16H4V4h12v1" />
            </svg>
            Duplicate
          </button>
          <span className="flex-1" />
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            hold to delete
          </span>
          <HoldConfirm label="Delete entry" onConfirm={() => deleteTx(tx.id)} />
        </div>
      </div>
    </>
  )
}
