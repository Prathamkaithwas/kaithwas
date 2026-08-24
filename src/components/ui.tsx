import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FIELD_LABEL, TYPE_LABEL } from '../types'
import { useStore } from '../store'
import { formatMoney } from '../lib/money'
import { MONTHS_SHORT } from '../lib/date'
import { useCountUp } from '../lib/useCountUp'
import { useSwipe } from '../lib/useSwipe'
import { useBackHandler } from '../lib/back'
import { hapticHeavy, hapticMedium } from '../lib/haptics'
import { fileToAttachment, isPdfDataUrl } from '../lib/photo'
import { sharePhotos } from '../lib/share'

/** Resolve the income/expense colours, honouring the A/B colour set. */
export function useKindColor() {
  const { db } = useStore()
  const swap = db.settings.colorSet === 'B'
  return (kind?: string) => {
    if (kind === 'income') return swap ? 'var(--expense)' : 'var(--income)'
    if (kind === 'expense') return swap ? 'var(--income)' : 'var(--expense)'
    if (kind === 'transfer') return 'var(--transfer)'
    return undefined
  }
}

export function Money({
  value,
  kind,
  signed,
  className = '',
  hideSymbol,
  abs,
}: {
  value: number
  kind?: 'income' | 'expense' | 'transfer' | 'auto' | 'plain'
  signed?: boolean
  className?: string
  hideSymbol?: boolean
  /** show the magnitude and colour by sign — how the Accounts screen reads */
  abs?: boolean
}) {
  const { db } = useStore()
  const kindColor = useKindColor()

  let color: string | undefined
  if (kind === 'auto') color = value < 0 ? kindColor('expense') : kindColor('income')
  else color = kindColor(kind)

  return (
    <span className={`num ${className}`} style={color ? { color } : undefined}>
      {formatMoney(abs ? Math.abs(value) : value, db.settings, { signed, hideSymbol })}
    </span>
  )
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />
}

/**
 * Bottom sheet. Springs up with a little overshoot, and the grabber can be
 * dragged down to dismiss — the panel tracks the finger directly (no React
 * render per frame) and either follows through or snaps back.
 */
export function Sheet({
  open,
  onClose,
  children,
  title,
  full,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  full?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const drag = useRef<{ from: number; dy: number } | null>(null)
  // The entrance animation would otherwise keep overriding the inline
  // transform we set while dragging, so it is dropped once it has played.
  const [settled, setSettled] = useState(false)

  /**
   * Every sheet closes itself on back, registered here rather than by each
   * caller.
   *
   * Sheets opened by a *screen* — a Last Done card's detail, a habit editor,
   * a quick-add prompt — used to register nothing, because only the shell
   * knew about the handful it owned. Back then fell straight past them to the
   * next rule down, which is "leave this sub-tab": one press closed the sheet
   * *and* threw you out to Daily. Two levels for one press, and it got worse
   * the deeper you were.
   *
   * Registering here covers every sheet in the app at once, and nests
   * correctly on its own — a sheet opened on top of another mounts later, so
   * it sits higher on the stack. Where the shell also registers a handler for
   * the same thing the inner one simply wins, closes it, and the outer one is
   * torn down unused.
   */
  useBackHandler(open, onClose)

  // `onClose` is an inline arrow at nearly every call site, so a new one
  // arrives on every parent re-render — including the ones a dragging Meter
  // fires continuously as its value changes. Depending on it here reset
  // `settled` and replayed the entrance animation on every single one of
  // those, which is what made the sheet visibly slide out and back while
  // you were mid-drag. `open` is the only transition this effect actually
  // needs to react to; the escape handler below still reads whatever
  // `onClose` closed over, which is fine since none of these callers close
  // over anything that changes the *behaviour* of closing.
  useEffect(() => {
    if (!open) return
    setSettled(false)
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const onDown = (e: React.PointerEvent) => {
    if (!settled) return
    drag.current = { from: e.clientY, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (panel.current) panel.current.style.transition = 'none'
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !panel.current) return
    d.dy = Math.max(0, e.clientY - d.from)
    panel.current.style.transform = `translateY(${d.dy}px)`
    if (scrim.current) scrim.current.style.opacity = `${Math.max(0, 1 - d.dy / 320)}`
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !panel.current) return
    if (d.dy > 96) return onClose()
    panel.current.style.transition = 'transform 380ms var(--ease-out)'
    panel.current.style.transform = 'translateY(0)'
    if (scrim.current) {
      scrim.current.style.transition = 'opacity 280ms ease'
      scrim.current.style.opacity = '1'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        ref={scrim}
        className="absolute inset-0 animate-fade"
        style={{ background: 'var(--scrim)' }}
        onClick={onClose}
      />
      <div
        ref={panel}
        onAnimationEnd={() => setSettled(true)}
        className={`sheet-glass relative overflow-hidden flex flex-col ${settled ? '' : 'animate-sheet'} ${
          full ? 'h-[92%]' : 'max-h-[85%]'
        }`}
        style={{
          // Translucent rather than solid --surface, so GlassBg's blur below
          // has something to bend.
          background: 'color-mix(in srgb, var(--surface) 82%, transparent)',
          borderTop: '1.5px solid var(--line)',
          borderTopLeftRadius: 'var(--r-lg)',
          borderTopRightRadius: 'var(--r-lg)',
          paddingBottom: 'var(--sab)',
        }}
      >
        <SheetBody title={title} onDown={onDown} onMove={onMove} onUp={onUp}>
          {children}
        </SheetBody>
      </div>
    </div>
  )
}

/** The grabber, title, and scrollable body shared by both the glass and
 *  reduced-transparency renderings of the sheet above. */
function SheetBody({
  title,
  onDown,
  onMove,
  onUp,
  children,
}: {
  title?: string
  onDown: (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: () => void
  children: ReactNode
}) {
  return (
    <>
      {/* grabber — also the drag target */}
      <div
        className="shrink-0 pt-2.5 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <span
          className="w-10 h-[5px] rounded-full"
          style={{ background: 'var(--line-strong)' }}
        />
      </div>
      {title && <div className="px-5 pt-1 pb-3 t-h2 shrink-0">{title}</div>}
      {/* Padded by --kbh so a field near the bottom of a sheet — the note
          editor's textarea, a vault entry — can still scroll clear of the
          keyboard. Zero unless a keyboard is actually up. */}
      <div
        className="overflow-y-auto no-scrollbar flex-1 overscroll-contain"
        style={{ paddingBottom: 'var(--kbh)' }}
      >
        {children}
      </div>
    </>
  )
}

/** "‹ Jul 2026 ›" — or "‹ 2026 ›" in year mode. */
export function PeriodStepper({
  label,
  onPrev,
  onNext,
  onPick,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
  onPick?: () => void
}) {
  const arrow = (d: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
  return (
    <div className="flex items-center gap-0.5">
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center press"
        style={{ color: 'var(--muted)' }}
        onClick={onPrev}
        aria-label="Previous"
      >
        {arrow('M15 6l-6 6 6 6')}
      </button>
      {/* keyed by the caller so a month change replays this */}
      <button className="t-h1 px-1.5 py-1 rounded-lg press animate-fade" onClick={onPick}>
        {label}
      </button>
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center press"
        style={{ color: 'var(--muted)' }}
        onClick={onNext}
        aria-label="Next"
      >
        {arrow('M9 6l6 6-6 6')}
      </button>
    </div>
  )
}

export function MonthPicker({
  open,
  month,
  onClose,
  onSelect,
}: {
  open: boolean
  month: string
  onClose: () => void
  onSelect: (m: string) => void
}) {
  const year = Number(month.slice(0, 4))
  return (
    <Sheet open={open} onClose={onClose} title="Select month">
      <div className="px-5 pb-6">
        <div className="flex items-center justify-between mb-4">
          <button
            className="w-10 h-10 rounded-full press flex items-center justify-center text-lg"
            style={{ background: 'var(--surface-2)' }}
            onClick={() => onSelect(`${year - 1}-${month.slice(5)}`)}
          >
            ‹
          </button>
          <span className="t-title num">{year}</span>
          <button
            className="w-10 h-10 rounded-full press flex items-center justify-center text-lg"
            style={{ background: 'var(--surface-2)' }}
            onClick={() => onSelect(`${year + 1}-${month.slice(5)}`)}
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {MONTHS_SHORT.map((label, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}`
            const active = key === month
            return (
              <button
                key={key}
                className="py-3.5 rounded-[var(--r-md)] text-[13px] press animate-fade"
                style={{
                  animationDelay: `${i * 18}ms`,
                  background: active
                    ? 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 92%, #fff), var(--accent))'
                    : 'var(--surface-2)',
                  color: active ? '#fff' : 'var(--text)',
                  border: `1.5px solid ${active ? 'transparent' : 'var(--line)'}`,
                  boxShadow: active
                    ? '0 6px 18px -6px color-mix(in srgb, var(--accent) 70%, var(--surface))'
                    : 'none',
                  fontWeight: active ? 600 : 400,
                }}
                onClick={() => {
                  onSelect(key)
                  onClose()
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </Sheet>
  )
}

/**
 * Top tab strip with a single pill that slides between items rather than a
 * bar that cuts on and off.
 */
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  labels,
}: {
  tabs: readonly T[]
  value: T
  onChange: (t: T) => void
  /** Display text per tab, where it differs from the tab's own value — the
   *  value is what's persisted (settings order, routing checks) and stays
   *  stable; this only swaps what's drawn on the strip, e.g. a shorter word
   *  than the value for a narrow column. Tabs not listed just show `t`. */
  labels?: Partial<Record<T, string>>
}) {
  const index = Math.max(0, tabs.indexOf(value))

  // Swiping the strip itself steps through the sub-tabs, so moving between
  // Daily and Total never needs an accurate tap on a small target.
  const swipe = useSwipe(
    () => index < tabs.length - 1 && onChange(tabs[index + 1]),
    () => index > 0 && onChange(tabs[index - 1]),
  )

  return (
    <div
      className="relative flex border-b shrink-0 px-2 pt-1 pb-1.5"
      {...swipe}
      style={{ borderColor: 'var(--line)', ...swipe.style }}
    >
      {/* The travelling pill.
          It used to animate `left`, which lays the strip out again on every
          frame; this slides on `transform`, which the compositor handles on
          its own. The pill is always sized to the *column*, never to the
          label — sizing it to the text made it grow and shrink as it moved
          between "Daily" and "Last Done", which is the jump you were seeing.
          One column across is the pill's own width plus the 8px of gap it
          leaves either side, hence the `100% + 8px` step. */}
      <span
        className="absolute top-1.5 bottom-2 rounded-[var(--r-sm)] pointer-events-none"
        style={{
          left: 4,
          width: `calc(${100 / tabs.length}% - 8px)`,
          transform: `translateX(calc(${index} * (100% + 8px)))`,
          // Tinted by whichever tab is open — see TAB_THEME. Mixed with
          // transparent rather than a surface colour so it sits on the
          // header's own ground, which is itself changing underneath.
          background: 'color-mix(in srgb, var(--tab-tint, var(--accent)) 22%, transparent)',
          border: '1.5px solid color-mix(in srgb, var(--tab-tint, var(--accent)) 45%, transparent)',
          transition:
            'transform 260ms cubic-bezier(0.34, 1.4, 0.64, 1), background-color 420ms var(--ease-out), border-color 420ms var(--ease-out)',
        }}
      />
      {tabs.map((t) => {
        const active = t === value
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            // min-w-0 so a long label like "Last Done" cannot push its cell
            // wider than the others — equal columns are what keep the pill
            // and the label agreeing with each other.
            className="flex-1 min-w-0 py-2 text-[13px] relative whitespace-nowrap truncate press"
            style={{
              color: active ? 'var(--tab-tint, var(--accent))' : 'var(--muted)',
              fontWeight: active ? 700 : 500,
              transition: 'color 420ms var(--ease-out)',
            }}
          >
            {labels?.[t] ?? t}
          </button>
        )
      })}
    </div>
  )
}

/** Reusable pill row — the Overview/Calendar/Monthly and Expenses/Income switches. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  labels,
  className = '',
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labels?: Record<string, string>
  className?: string
}) {
  const index = Math.max(0, options.indexOf(value))
  return (
    <div
      className={`relative flex p-1 rounded-full shrink-0 ${className}`}
      style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)' }}
    >
      <span
        className="absolute top-1 bottom-1 rounded-full pointer-events-none"
        style={{
          left: `calc(${(index * 100) / options.length}% + 4px)`,
          width: `calc(${100 / options.length}% - 8px)`,
          background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 92%, #fff), var(--accent))',
          boxShadow: 'none',
          transition: 'left 420ms var(--ease-out)',
        }}
      />
      {options.map((o) => {
        const active = o === value
        return (
          <button
            key={o}
            className="relative flex-1 px-4 py-1.5 text-[13px] whitespace-nowrap press"
            style={{
              color: active ? '#fff' : 'var(--muted)',
              fontWeight: active ? 600 : 400,
              transition: 'color 260ms var(--ease-out)',
            }}
            onClick={() => onChange(o)}
          >
            {labels?.[o] ?? o}
          </button>
        )
      })}
    </div>
  )
}

/** Income / Expenses / Profit strip — amounts shown without the currency symbol. */
export function SummaryBar({
  income,
  expense,
  profit,
}: {
  income: number
  expense: number
  /** margin noted on the entries themselves, not income minus expenses */
  profit: number
}) {
  // Count up/down to the new totals instead of jumping straight to them —
  // most noticeable when switching days or categories.
  const animIncome = useCountUp(income)
  const animExpense = useCountUp(expense)
  const animProfit = useCountUp(profit)

  /**
   * A zero is drawn quiet.
   *
   * All three figures used to render at full strength, so a day with one sale
   * showed a bright green number flanked by two equally bright zeros and the
   * eye had to read all three to find the one that meant anything. Zeros keep
   * their place in the layout — the strip must not reflow as the day fills up —
   * but they step back to muted and drop their colour dot.
   */
  const cell = (label: string, node: ReactNode, zero: boolean, dot?: string) => (
    <div className="flex-1 px-2 py-3 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        {dot && !zero && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
        )}
        <span className="text-[11px] tracking-wide" style={{ color: 'var(--muted)' }}>
          {label}
        </span>
      </div>
      <span style={zero ? { opacity: 0.45 } : undefined}>{node}</span>
    </div>
  )

  return (
    <div className="px-3 pt-2 pb-1 shrink-0">
      <div
        className="flex rounded-[var(--r-lg)] border overflow-hidden"
        style={{ borderColor: 'var(--line)', boxShadow: 'none' }}
      >
        {cell(
          TYPE_LABEL.income,
          <Money value={animIncome} kind="income" hideSymbol className="text-[17px] font-semibold" />,
          income === 0,
          'var(--income)',
        )}
        <span className="w-px my-3" style={{ background: 'var(--line)' }} />
        {cell(
          TYPE_LABEL.expense,
          <Money value={animExpense} kind="expense" hideSymbol className="text-[17px] font-semibold" />,
          expense === 0,
          'var(--expense)',
        )}
        <span className="w-px my-3" style={{ background: 'var(--line)' }} />
        {cell(
          animProfit < 0 ? FIELD_LABEL.loss : FIELD_LABEL.profit,
          <Money
            value={Math.abs(animProfit)}
            kind={animProfit < 0 ? 'expense' : animProfit > 0 ? 'income' : 'plain'}
            hideSymbol
            className="text-[17px] font-semibold"
          />,
          profit === 0,
          animProfit < 0 ? 'var(--expense)' : animProfit > 0 ? 'var(--income)' : undefined,
        )}
      </div>

      {/* Margin on sales — profit ÷ income.
          Outside the box rather than inside it: in the cell it sat right up
          against the figure and the two competed for the same glance. Out
          here it is an aside, which is what it is. Only drawn when both
          halves of the fraction exist, since "profit on no sales" is not a
          percentage of anything. */}
      {income > 0 && profit !== 0 && (
        <div className="flex justify-end pr-1 pt-1">
          <span className="text-[10px] num tracking-wide" style={{ color: 'var(--muted)' }}>
            {Math.round((profit / income) * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}

export function Row({
  label,
  value,
  onClick,
  right,
  danger,
  sub,
}: {
  label: ReactNode
  value?: ReactNode
  onClick?: () => void
  right?: ReactNode
  danger?: boolean
  sub?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="relative w-full flex items-center gap-3 px-4 py-3.5 text-left border-b text-[15px] disabled:cursor-default press"
      style={{
        borderColor: 'var(--line)',
        background: 'var(--surface)',
        color: danger ? 'var(--expense)' : 'var(--text)',
      }}
    >
      <span className="flex-1">
        {label}
        {sub && (
          <span className="block text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {sub}
          </span>
        )}
      </span>
      {value !== undefined && (
        <span style={{ color: 'var(--accent)' }} className="text-[14px]">
          {value}
        </span>
      )}
      {right}
    </button>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 pt-6 pb-2 t-cap">{children}</div>
  )
}

export function Bar({ pct, color }: { pct: number; color: string }) {
  const width = Math.min(100, Math.max(0, pct))
  return (
    <div
      className="h-[7px] rounded-full overflow-hidden w-full"
      style={{ background: 'var(--line)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)' }}
    >
      <div
        className="h-full rounded-full "
        style={{
          width: `${width}%`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, #fff), ${color})`,
          boxShadow: `0 0 10px -2px ${color}`,
          transition: 'width 620ms var(--ease-out)',
        }}
      />
    </div>
  )
}

export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return (
    <div className="py-20 flex flex-col items-center gap-3 animate-fade">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center text-[22px]"
        style={{ background: 'var(--surface-2)', border: '1.5px solid var(--line)', color: 'var(--muted)' }}
      >
        {icon ?? '✦'}
      </div>
      <div className="text-[13px] text-center px-10" style={{ color: 'var(--muted)' }}>
        {text}
      </div>
    </div>
  )
}

/**
 * The default plus is drawn rather than typed.
 *
 * As a text glyph it sat visibly high in the circle: a "+" is centred on the
 * font's maths axis, which is above the middle of the em box, and no amount
 * of flex centring moves it because the box itself is centred correctly. Two
 * lines through the middle of a square viewBox are exact by construction.
 */
function PlusIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden
    >
      {/* Arms run 4→20 of the 24-unit box, so the drawn cross fills about
          42% of the 64px circle — roughly the proportion Material uses, and
          much closer to a real button than the old text glyph managed. */}
      <path d="M12 4v16M4 12h16" />
    </svg>
  )
}

/**
 * A multi-file attachment strip — pictures or PDFs, thumbnails in a
 * wrapping row, tap to view. An image opens full-screen; a PDF goes through
 * the share sheet instead, since Android's WebView has no built-in PDF
 * viewer to embed one in — sharing lets the user pick whatever PDF reader
 * they already have. Used wherever an entry can carry more than one file:
 * a loan's paperwork, a vault entry's attachments.
 */
export function AttachmentGrid({
  files,
  onChange,
  label = 'Attachments',
  disabled,
}: {
  files: string[]
  onChange: (next: string[]) => void
  label?: string
  /** View-only — thumbnails stay tappable (opening one is reading it, not
   *  editing it), but adding and removing are hidden rather than merely
   *  greyed out. A dashed "+" tile with nothing behind it reads as broken,
   *  not as locked. */
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!picked.length) return
    setBusy(true)
    try {
      const added: string[] = []
      for (const f of picked) {
        try {
          added.push(await fileToAttachment(f))
        } catch {
          /* one unreadable file shouldn't lose the others */
        }
      }
      if (added.length) onChange([...files, ...added])
    } finally {
      setBusy(false)
    }
  }

  const open = async (i: number) => {
    if (isPdfDataUrl(files[i])) {
      await sharePhotos([{ title: `${label} ${i + 1}`, dataUrl: files[i] }])
      return
    }
    setViewing(i)
  }

  // Locked and empty has nothing to show and nothing to add — the label
  // alone over a blank row would just be dead space.
  if (disabled && files.length === 0) return null

  return (
    <div>
      <div className="text-[11px] mb-1.5" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {files.map((src, i) =>
          isPdfDataUrl(src) ? (
            <span key={i} className="relative">
              <button
                className="w-14 h-14 rounded flex flex-col items-center justify-center gap-0.5"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                onClick={() => open(i)}
                aria-label={`Open ${label.toLowerCase()} ${i + 1} (PDF)`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2h9l5 5v15H6z" />
                  <path d="M15 2v5h5" />
                </svg>
                <span className="text-[8px] font-semibold" style={{ color: 'var(--muted)' }}>
                  PDF
                </span>
              </button>
              {!disabled && (
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[11px] leading-none flex items-center justify-center"
                  style={{ background: 'var(--surface-3)', border: '1.5px solid var(--line-strong)' }}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </span>
          ) : (
            <span key={i} className="relative">
              <img
                src={src}
                alt={`${label} ${i + 1}`}
                className="w-14 h-14 object-cover rounded"
                onClick={() => open(i)}
              />
              {!disabled && (
                <button
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[11px] leading-none flex items-center justify-center"
                  style={{ background: 'var(--surface-3)', border: '1.5px solid var(--line-strong)' }}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </span>
          ),
        )}
        {!disabled && (
          <button
            className="w-14 h-14 rounded flex items-center justify-center text-[22px]"
            style={{ color: 'var(--accent)', border: '1.5px dashed var(--accent)' }}
            onClick={() => fileRef.current?.click()}
            aria-label={`Add a photo or PDF to ${label.toLowerCase()}`}
            disabled={busy}
          >
            {busy ? '…' : '+'}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={pick}
      />

      {viewing !== null && files[viewing] && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.9)' }}
          onClick={() => setViewing(null)}
        >
          <img src={files[viewing]} alt="" className="max-w-full max-h-full object-contain" />
          <button
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-[16px]"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
            onClick={() => setViewing(null)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * How well `query`'s characters line up against `target`, in order but not
 * necessarily touching — the way a hashtag search works, not a plain
 * substring match. Returns null when some character isn't found at all.
 * Lower score is a better match: every character that has to skip ahead to
 * be found costs one point per character skipped, and starting the match
 * later in the word costs a little too — so "om" scores better against
 * "Mom" than against "Grandmom", and a run of consecutive letters beats the
 * same letters scattered apart.
 */
function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const t = target.toLowerCase()
  const indices: number[] = []
  let cursor = 0
  let score = 0
  for (const ch of q) {
    const idx = t.indexOf(ch, cursor)
    if (idx === -1) return null
    score += idx - cursor
    indices.push(idx)
    cursor = idx + 1
  }
  score += indices[0]
  return { score, indices }
}

/** Bolds the characters `fuzzyMatch` actually matched, in the app's accent
 *  colour — the same "why this suggestion" cue a hashtag search gives. */
function highlightMatch(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text
  const parts: ReactNode[] = []
  let last = 0
  indices.forEach((idx, i) => {
    if (idx > last) parts.push(text.slice(last, idx))
    parts.push(
      <span key={i} style={{ color: 'var(--accent)', fontWeight: 700 }}>
        {text[idx]}
      </span>,
    )
    last = idx + 1
  })
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/**
 * A free-text field with live, ranked suggestions instead of the browser's
 * own `<datalist>` — which on Android renders as a plain system panel with
 * none of the app's styling, and only matches a literal prefix, or a static
 * row of chips, which shows every option regardless of relevance to what's
 * already typed. This drops a suggestion list right under the field as you
 * type, ranked and highlighted by `fuzzyMatch`, and closes on a pick or a
 * tap outside — first used for the vault's "Who is this for?" field, now
 * shared wherever a value should be picked from what's already been typed
 * elsewhere (Purchase's supplier/category/subcategory).
 */
export function SuggestInput({
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    return options
      .map((o) => ({ o, m: fuzzyMatch(value, o) }))
      .filter((x): x is { o: string; m: { score: number; indices: number[] } } => x.m !== null)
      .sort((a, b) => a.m.score - b.m.score)
      .slice(0, 6)
  }, [options, value])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <input
        className="w-full border-b pb-2 text-[16px]"
        style={{ borderColor: 'var(--line)' }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // Picking a suggestion deliberately keeps focus on the field (see
        // the suggestion button's onMouseDown below) so a re-tap doesn't
        // always fire a fresh focus event — onClick catches that case too.
        onClick={() => setOpen(true)}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div
          className="absolute left-0 right-0 z-10 mt-1 rounded-lg overflow-hidden"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          {matches.map(({ o, m }) => (
            <button
              key={o}
              className="w-full text-left px-4 py-2.5 text-[14px] border-b last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
              // A click on this button blurs the input first, which would
              // otherwise close the list (via the outside-click handler
              // above) before the click itself ever registers.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
            >
              {highlightMatch(o, m.indices)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Fab({ onClick, icon }: { onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="fixed z-30 w-[64px] h-[64px] rounded-full text-white leading-none flex items-center justify-center press animate-fade"
      style={{
        right: 'calc(var(--sar) + 18px)',
        // Was +18px — raised for more headroom above the nav bar so its own
        // shadow (below) doesn't wash into the bar's icons on a phone where
        // the bar renders a touch taller than --nav-h assumes.
        bottom: 'calc(var(--sab) + var(--nav-h) + 26px)',
        background:
          'linear-gradient(155deg, color-mix(in srgb, var(--accent) 82%, #fff) 0%, var(--accent) 52%, color-mix(in srgb, var(--accent) 82%, #000) 100%)',
        boxShadow:
          '0 10px 30px -6px color-mix(in srgb, var(--accent) 70%, var(--surface)), 0 4px 12px rgba(0,0,0,0.22)',
        fontSize: 26,
      }}
      aria-label="Add"
    >
      {icon ?? <PlusIcon />}
    </button>
  )
}

/**
 * The lock toggle a saved night or a logged day shows in its corner — a
 * pencil while it's protected, a check once you've tapped in to change it.
 * Text labels ("Edit" / "Done") read as a whole extra control sitting next
 * to the real content; a small mark that only changes which icon it shows
 * says the same thing without competing for attention the way a pill with
 * a word in it does.
 */
export function EditLockButton({
  unlocked,
  onClick,
}: {
  unlocked: boolean
  onClick: () => void
}) {
  return (
    <button
      className="lock-edit-btn"
      data-unlocked={unlocked || undefined}
      onClick={onClick}
      aria-label={unlocked ? 'Done editing' : 'Edit'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {unlocked ? (
          <path d="M4 12l5 5L20 6" />
        ) : (
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        )}
      </svg>
    </button>
  )
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'OK',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  // A confirmation is the innermost thing on screen whenever it is up, so
  // back must dismiss it rather than whatever is behind it.
  useBackHandler(open, onClose)

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-8">
      <div
        className="absolute inset-0 animate-fade"
        style={{ background: 'var(--scrim)' }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[320px] p-5 animate-fade"
        style={{
          background: 'var(--surface)',
          border: '1.5px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'none',
        }}
      >
        <div className="t-h2 mb-1">{title}</div>
        {body && (
          <div className="text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {body}
          </div>
        )}
        <div className="flex justify-end gap-1 mt-5">
          <button className="px-4 py-2 text-[14px] rounded-[var(--r-md)] press" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-4 py-2 text-[14px] font-semibold rounded-[var(--r-md)] press"
            style={{
              color: danger ? 'var(--expense)' : 'var(--accent)',
              background: `color-mix(in srgb, ${danger ? 'var(--expense)' : 'var(--accent)'} 12%, var(--surface))`,
            }}
            onClick={() => {
              // Wired here rather than at the couple of dozen call sites that
              // open one of these — nearly every delete in the app (a rate, a
              // loan, a vault entry, a password, a mood, a habit) ends at this
              // one button, so this is the single place that can tell them all
              // apart from an ordinary tap. `danger` already distinguishes a
              // real delete from a benign "OK", so the intensity follows it.
              if (danger) hapticHeavy()
              else hapticMedium()
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Screen({
  title,
  onBack,
  children,
  action,
}: {
  title: string
  onBack: () => void
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col animate-slide" style={{ background: 'var(--bg)' }}>
      <div
        className="flex items-center gap-1 px-2 pb-3 shrink-0 border-b"
        style={{ borderColor: 'var(--line)', paddingTop: 'calc(var(--sat) + 12px)' }}
      >
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center press"
          onClick={onBack}
          aria-label="Back"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="flex-1 t-h1">{title}</div>
        {action}
      </div>
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ paddingBottom: 'calc(var(--sab) + 24px)' }}
      >
        {children}
      </div>
    </div>
  )
}
