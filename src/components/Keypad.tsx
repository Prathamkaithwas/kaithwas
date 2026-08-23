import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { evalExpression, formatAmount, openBrackets } from '../lib/money'
import { useCountUp } from '../lib/useCountUp'
import { useStore } from '../store'
import { burst } from '../lib/fx'

export interface KeypadField {
  key: string
  label: string
  /** integer paise */
  value: number
  /** allow a negative result — used by Profit so a loss can be entered */
  signed?: boolean
}

/* Two wave layers tiling every 300 units across a 1200-wide viewBox, giving
   the divider its double crest where the paper display meets the keypad slab.
   The crests are deliberately tall — this is a feature of the calculator, not
   a seam between two panels. Both still tile every 300 units, so the -50%
   drift in wave-drift loops with no visible join. */
const WAVE_BACK =
  'M0,20 C100,-8 200,44 300,20 C400,-8 500,44 600,20 C700,-8 800,44 900,20 C1000,-8 1100,44 1200,20 L1200,60 L0,60 Z'
const WAVE_FRONT =
  'M0,36 C100,10 200,60 300,36 C400,10 500,60 600,36 C700,10 800,60 900,36 C1000,10 1100,60 1200,36 L1200,60 L0,60 Z'

/**
 * An action offered in place of "Done" on the last field. Used to let a new
 * entry pick what it is at the same moment the amount is confirmed, instead
 * of committing and then reaching back up to the type selector.
 */
export interface KeypadAction {
  key: string
  label: string
  color: string
}

/**
 * Camera-autofocus corner brackets, borrowed from react-bits' TrueFocus —
 * that component slides one set of corners between words in a sentence;
 * there's only ever one target here; so this keeps just the bracket visual
 * and its in/out transition, dropping the multi-word tracking logic.
 */
function FocusCorners({ active }: { active: boolean }) {
  return (
    <motion.span
      className="calc-focus-frame"
      aria-hidden
      initial={false}
      animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 0.82 }}
      transition={{ duration: 0.28, ease: [0.34, 1.4, 0.64, 1] }}
    >
      <span className="calc-corner tl" />
      <span className="calc-corner tr" />
      <span className="calc-corner bl" />
      <span className="calc-corner br" />
    </motion.span>
  )
}

/**
 * One key on the purple slab. Chunky and evenly weighted - the previous
 * pass made every glyph hairline-thin, which on a phone held at arm's
 * length reads as washed out rather than clean.
 *
 * The pressed look is driven by pointer events rather than CSS `:active` —
 * `:active` doesn't reliably paint on a fast tap in the Android WebView this
 * runs in, which is why the key looked dead under a thumb even though the
 * tap itself worked. Same fix the habit tiles already use for their own
 * held state.
 */
function CalcKey({
  label,
  onClick,
  soft,
  warm,
  disabled,
  size,
  lit,
}: {
  label: React.ReactNode
  onClick: () => void
  soft?: boolean
  warm?: boolean
  disabled?: boolean
  size?: number
  /** Focus brackets snap onto the key while this is true — see FocusCorners. */
  lit?: boolean
}) {
  const [held, setHeld] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      className="calc-key fx-emit"
      data-held={held || undefined}
      data-lit={lit || undefined}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={(e) => {
        // The expression display keeps a real (invisible) input focused so
        // native cursor/selection/typing keeps working — a key press must
        // not steal that focus. preventDefault on pointerdown suppresses the
        // browser's own focus-on-click for this button without touching the
        // click event that actually fires onClick.
        e.preventDefault()
        setHeld(true)
        // The galaxy button's stars, but sized to an actual tap: that
        // component's orbit runs 6-20s per loop, meant for a mouse
        // sitting on :hover — invisible within the ~150ms a real press
        // lasts. A burst is the same "stars on interaction" idea, timed
        // to finish inside the gesture that triggered it.
        if (ref.current) burst(ref.current, '#fff', 6)
      }}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      style={{
        fontSize: size ?? 22,
        fontWeight: 600,
        color: warm
          ? 'var(--calc-warm)'
          : soft
            ? 'var(--calc-key-soft)'
            : 'var(--calc-key)',
        // A key that cannot apply is hidden rather than dimmed - a greyed
        // glyph at this contrast just looks like a rendering fault.
        visibility: disabled ? 'hidden' : undefined,
      }}
    >
      {label}
      {lit !== undefined && <FocusCorners active={!!lit} />}
    </button>
  )
}

/** The tall "=" key — its own component since it carries the corner
 *  decoration CalcKey doesn't, but it wants the same pointer-driven press. */
function EqualsKey({ onClick }: { onClick: () => void }) {
  const [held, setHeld] = useState(false)
  return (
    <button
      className="calc-key relative overflow-hidden"
      data-held={held || undefined}
      style={{
        gridColumn: 4,
        gridRow: 'span 2',
        fontSize: 26,
        fontWeight: 600,
        background: 'var(--calc-key-tall)',
        color: 'var(--calc-key)',
      }}
      onClick={onClick}
      onPointerDown={(e) => {
        e.preventDefault() // see CalcKey's onPointerDown — keeps the hidden input focused
        setHeld(true)
      }}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)}
      aria-label="Equals"
    >
      <span
        className="absolute top-0 left-0 w-7 h-7 pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, var(--calc-panel) 0 50%, var(--calc-panel-soft) 50% 54%, transparent 54%)',
        }}
        aria-hidden
      />
      =
    </button>
  )
}

/**
 * Calculator keypad. Drives one or more amount fields — tap a field to aim the
 * keys at it. Values in and out are integer paise.
 */
export function Keypad({
  open,
  fields,
  chipOrder,
  accent,
  actions,
  onClose,
  onDone,
}: {
  open: boolean
  /**
   * Tap-priority order: whichever field the caller wants active first comes
   * first, since `fields[0]` seeds the initial `active` field and the walk
   * ("Amount → Profit" or "Profit → Amount") reads the array in this order.
   * The caller re-sorts this on every open depending on which row was
   * tapped (see TxEditor). That also used to double as the *display* order
   * for the chip strip up top, so tapping the Profit row made the chips
   * read "Profit, Amount" instead of always "Amount, Profit" — see
   * `chipOrder` below for the fix.
   */
  fields: KeypadField[]
  /**
   * Fixed left-to-right order for the field chips, independent of which one
   * is active or was tapped first — e.g. `['amount', 'profit']`, always in
   * that order whichever field opened the keypad. Falls back to `fields`'
   * own order when omitted (the single-field Fee keypad has nothing to
   * reorder).
   */
  chipOrder?: string[]
  accent: string
  /** Replaces the single Done button once the last field is reached. */
  actions?: KeypadAction[]
  onClose: () => void
  onDone: (values: Record<string, number>, actionKey?: string) => void
}) {
  const { db } = useStore()
  const [exprs, setExprs] = useState<Record<string, string>>({})
  const [active, setActive] = useState(fields[0]?.key ?? '')
  /**
   * What the difference key last produced, so it can stay lit while that
   * value is still the one on screen.
   *
   * The expression is recorded, not a bare flag: the key un-lights by simply
   * no longer matching once anything else is typed — a digit, AC, backspace,
   * a field switch — so no other handler has to remember to reset it.
   */
  const [diffMark, setDiffMark] = useState<{ key: string; expr: string } | null>(null)

  /**
   * Cursor/selection into the *active* field's expression, in plain string
   * indices — start === end is a bare caret, start !== end is a selection.
   * This mirrors a real text input's selectionStart/selectionEnd because it
   * is driven by one: see `hiddenInput` below.
   */
  const [caret, setCaret] = useState<{ start: number; end: number }>({ start: 0, end: 0 })

  /**
   * The real editable surface. It is never seen — opacity 0, 1x1px — but it
   * is a genuine <input>, so arrow keys, hold-to-repeat, Home/End,
   * Backspace/Delete, typing, drag-selection and Ctrl/Cmd+A/C/V/X are the
   * browser's own behaviour rather than anything reimplemented here. The
   * on-screen tape below is purely a styled *paint* of this input's value
   * and selection — every calculator button writes into the input and lets
   * the paint follow, rather than the other way round.
   */
  const hiddenInput = useRef<HTMLInputElement>(null)
  // One span per character of the active field's expression, rebuilt every
  // render, so a tap on the tape can find which two characters it landed
  // between. Rebuilding a plain array each render is fine — it is at most a
  // few dozen entries for any sum a person actually types.
  const charRefs = useRef<(HTMLSpanElement | null)[]>([])
  // Set by a button/programmatic edit; consumed by the layout effect below
  // once the new expression has painted, so the real input's selection (and
  // therefore the visible caret) lands in the right place *after* the value
  // it's relative to has actually changed.
  const pendingCursor = useRef<number | null>(null)

  const focusHiddenInput = (pos: number) => {
    const el = hiddenInput.current
    if (!el) return
    el.focus()
    el.setSelectionRange(pos, pos)
  }

  useEffect(() => {
    if (!open) return
    const seeded: Record<string, string> = {}
    for (const f of fields) seeded[f.key] = f.value ? String(f.value / 100) : ''
    setExprs(seeded)
    const firstKey = fields[0]?.key ?? ''
    setActive(firstKey)
    setDiffMark(null)
    const len = (seeded[firstKey] ?? '').length
    setCaret({ start: len, end: len })
    requestAnimationFrame(() => focusHiddenInput(len))
    // fields is rebuilt each render; the open flag is what should re-seed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const expr = exprs[active] ?? ''
  const preview = evalExpression(expr)
  /**
   * The running total rolls to its new value instead of snapping.
   *
   * This was lost by accident when the term tape was rebuilt, not removed for
   * a reason. It is back, at 150ms rather than the original 380ms: the roll is
   * what makes the total feel like it is being computed, but at 380ms a fast
   * run of keys spends its whole time chasing a number that is already stale,
   * which reads as the keypad lagging behind the thumb. Short enough to keep
   * up, long enough to see.
   *
   * It costs nothing per keystroke — a rAF loop that restarts and always has
   * a current target, never a queue.
   */
  const animPreview = useCountUp(preview, 150)

  // One line, scrolling sideways to follow the caret rather than stacking
  // upward — edits in the middle of a long sum need the *cursor* pulled
  // into view, not just whatever was typed most recently.
  const tape = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = tape.current
    const pos = Math.max(caret.start, caret.end)
    const charEl = charRefs.current[pos] ?? charRefs.current[pos - 1]
    if (charEl) charEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    else if (el) el.scrollLeft = el.scrollWidth
  }, [expr, caret])

  // Any button-driven edit stashes where the caret should end up in
  // `pendingCursor`; once the expression that cursor is relative to has
  // actually rendered, push it into the real input (which drives the visible
  // caret) and refocus — a button press must never leave the hidden input
  // blurred, or the next keystroke would go nowhere.
  useLayoutEffect(() => {
    const pos = pendingCursor.current
    if (pos == null) return
    pendingCursor.current = null
    focusHiddenInput(pos)
    setCaret({ start: pos, end: pos })
    // expr is exprs[active] — this only needs to fire once the text the
    // pending cursor was computed against has actually landed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr])

  if (!open) return null

  const activeField = fields.find((f) => f.key === active)
  // With more than one field in play, the primary key walks to the next one
  // (Amount → Profit, or Profit → Amount) and only commits on the last.
  const activeIndex = fields.findIndex((f) => f.key === active)
  const nextField = activeIndex >= 0 ? fields[activeIndex + 1] : undefined
  // The field the difference key reads against. Not fields[0] — which field
  // opens first depends on which one was tapped (Love first from the Love
  // row, Wow first from the Wow row), so fields[0] was sometimes Wow itself.
  // That mislabelled the key "Wow−" and diffed the field against itself.
  // "Whichever field isn't the active one" is right regardless of tap order.
  const otherField = fields.find((f) => f.key !== active)
  const selStart = Math.min(caret.start, caret.end)
  const selEnd = Math.max(caret.start, caret.end)

  /**
   * Every edit — typed, pasted, or from a calculator key — goes through
   * here. `compute` sees the *whole* current expression plus it split at the
   * selection (`head` = before the selection, `tail` = after it, selection
   * itself already gone) and returns the new full text and where the caret
   * should land in it. Returning null leaves everything untouched — used
   * when a key has nothing sensible to do (e.g. backspace on an empty,
   * unselected field).
   *
   * Using the functional form of setExprs (reading `all[active]` inside the
   * updater, not the `exprs` from render scope) is what the original
   * append-only `push` did too — it keeps two fast taps in a row from ever
   * computing off a stale expression.
   */
  const editActive = (
    compute: (e: string, head: string, tail: string) => { text: string; cursor: number } | null,
  ) => {
    setExprs((all) => {
      const e = all[active] ?? ''
      const result = compute(e, e.slice(0, selStart), e.slice(selEnd))
      if (!result) return all
      pendingCursor.current = result.cursor
      return { ...all, [active]: result.text }
    })
  }

  const push = (k: string) => {
    editActive((e, head, tail) => {
      if (k === '=') {
        const next = String(evalExpression(e) / 100)
        return { text: next, cursor: next.length }
      }
      // The current operand is whatever follows the last operator *or
      // bracket* — without the brackets in this split, "(1.5" looked like the
      // operand "(1.5" and the two-decimal guard counted the paren as a digit.
      const last = head.split(/[+\-*/()]/).pop() ?? ''
      let newHead: string
      if (k === '(') {
        // "3(" means 3×(, the way it reads on paper
        newHead = /[\d.)]$/.test(head) ? `${head}*(` : `${head}(`
      } else if (k === ')') {
        // only closable if something is open (before this point) and the
        // bracket would not be empty
        newHead = openBrackets(head) > 0 && /[\d.)]$/.test(head) ? `${head})` : head
      } else if (/[+\-*/]/.test(k)) {
        if (!head || /\($/.test(head)) newHead = k === '-' ? `${head}-` : head
        else if (/[+\-*/]$/.test(head)) newHead = head.slice(0, -1) + k
        else newHead = head + k
      } else if (k === '.') {
        newHead = last.includes('.') ? head : head + (last === '' ? '0.' : '.')
      } else {
        newHead = last.includes('.') && last.split('.')[1].length >= 2 ? head : head + k
      }
      return { text: newHead + tail, cursor: newHead.length }
    })
  }

  /**
   * One key for both brackets.
   *
   * The keypad is a full 4x5 grid with no spare slot, and giving brackets two
   * of them would have meant moving digits — the one thing that must not move,
   * because it is typed by muscle memory several times a day. So the key emits
   * whichever bracket the sum can actually accept: a closer when something is
   * open and there is a number to close before the cursor, an opener otherwise.
   */
  const bracket = () => {
    const head = (exprs[active] ?? '').slice(0, selStart)
    push(openBrackets(head) > 0 && /[\d.)]$/.test(head) ? ')' : '(')
  }

  /**
   * Percent, the way a shop calculator does it rather than the way a maths
   * textbook does.
   *
   *   500 − 10 %  →  500 − 50   (a ten percent discount, = 450)
   *   500 + 18 %  →  500 + 90   (adding eighteen percent GST, = 590)
   *   500 × 10 %  →  500 × 0.1  (ten percent *of* five hundred)
   *   10 %        →  0.1
   *
   * With + and − the percentage is taken *of the running total so far*, which
   * is what "give them ten percent off" means at a counter. With × and ÷, and
   * with nothing in front, it is just a plain division by a hundred.
   *
   * Reads against whatever is immediately before the cursor, same as every
   * other key here — tap % after "500-10" wherever the cursor sits and it
   * behaves as if that were the whole sum typed so far.
   */
  const percent = () => {
    editActive((_e, head, tail) => {
      const m = /^(.*?)([+\-*/])?(\d*\.?\d*)$/.exec(head)
      if (!m) return null
      const [, hh, op, operandText] = m
      if (!operandText) return null

      const operand = parseFloat(operandText)
      if (!isFinite(operand)) return null

      // For + and −, scale against everything to the left of the operator.
      const base = op === '+' || op === '-' ? evalExpression(hh) / 100 : 1
      const scaled = (operand / 100) * (base || 1)

      // Trim floating-point noise; the value re-enters as expression text.
      const text = String(Number(scaled.toFixed(4)))
      const newHead = `${hh}${op ?? ''}${text}`
      return { text: newHead + tail, cursor: newHead.length }
    })
  }

  /**
   * Append two zeros in one keystroke.
   *
   * Written as a single update rather than push('0') twice so the two digits
   * land together — and so the two-decimal guard is applied to the pair. On a
   * value already carrying a decimal point this correctly adds nothing once
   * the hundredths place is full, exactly as tapping 0 twice would.
   */
  const doubleZero = () => {
    editActive((_e, head, tail) => {
      let newHead = head
      for (let i = 0; i < 2; i++) {
        const last = newHead.split(/[+\-*/]/).pop() ?? ''
        if (last.includes('.') && (last.split('.')[1]?.length ?? 0) >= 2) break
        newHead += '0'
      }
      return { text: newHead + tail, cursor: newHead.length }
    })
  }

  /**
   * Deletes the selection if there is one, otherwise the character just
   * before the cursor — a plain backspace. The on-screen ⌫ key needs this
   * spelled out because, unlike typing, it isn't a real keystroke the hidden
   * input's own backspace handling would already catch.
   */
  const backspace = () => {
    editActive((e) => {
      if (selStart !== selEnd) return { text: e.slice(0, selStart) + e.slice(selEnd), cursor: selStart }
      if (selStart === 0) return null
      return { text: e.slice(0, selStart - 1) + e.slice(selStart), cursor: selStart - 1 }
    })
  }

  const clearActive = () => editActive(() => ({ text: '', cursor: 0 }))

  /**
   * Take the difference between this field and the other one — Love minus
   * whatever was just typed as cost.
   *
   * On the profit field this is the arithmetic actually done at a counter:
   * type what the goods cost, tap the key, and it becomes what was made —
   * sale price minus cost. It replaced the sign toggle, which asked the
   * question the wrong way round: entering a loss meant working out the
   * margin in your head first and then telling the app it was negative.
   *
   * Signed, not a magnitude: cost more than the sale price and the result is
   * negative, showing the loss outright rather than a positive number that
   * still needs a manual minus typed in front of it.
   */
  const diffFromFirst = () => {
    if (!otherField) return
    // Already applied and untouched since — a second tap here has nothing
    // left to diff against but its own answer, which produces a number that
    // means nothing. The lit state is the only warning of that, so once it's
    // lit the tap does nothing rather than silently overwriting a correct
    // result with a wrong one.
    if (diffMark && diffMark.key === active && diffMark.expr === expr) return
    const base = evalExpression(exprs[otherField.key] ?? '')
    const cur = evalExpression(exprs[active] ?? '')
    // The literal subtraction, not just its answer — the point of the key
    // is showing the work (sale price, a minus sign, the cost that was just
    // typed) on the tape, the same as if all of it had been typed by hand,
    // rather than the cost vanishing the instant the key is tapped.
    //
    // Bigger first, always: which side is "base" and which is "current"
    // depends on which field was open when this was tapped, and putting the
    // smaller number first would type a subtraction whose typed-out answer
    // is negative — right arithmetically, but this key's whole job is
    // reporting the size of the gap, not its direction.
    const [big, small] = base >= cur ? [base, cur] : [cur, base]
    const next = `${String(big / 100)}-${String(small / 100)}`
    editActive(() => ({ text: next, cursor: next.length }))
    setDiffMark({ key: active, expr: next })
  }

  /** The difference key stays lit while its own result is still on screen. */
  const diffLit = !!diffMark && diffMark.key === active && diffMark.expr === expr

  const commit = (actionKey?: string) => {
    const out: Record<string, number> = {}
    for (const f of fields) {
      const v = evalExpression(exprs[f.key] ?? '')
      out[f.key] = f.signed ? v : Math.abs(v)
    }
    onDone(out, actionKey)
    onClose()
  }

  const glyph = (ch: string) => (ch === '*' ? '×' : ch === '/' ? '÷' : ch === '-' ? '−' : ch)

  /**
   * Only letting through what the expression grammar actually understands.
   * Applied on every change to the real input — typing, IME, paste, cut —
   * so nothing but digits/operators/brackets/decimal ever reaches `exprs`,
   * and a pasted "abc123" quietly becomes "123" instead of ever producing a
   * string `evalExpression` has to error-guard against.
   */
  const ALLOWED = /[0-9.+\-*/()]/
  const handleHiddenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const raw = input.value
    const rawCursor = input.selectionStart ?? raw.length
    let cleaned = ''
    let cursor = 0
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (ALLOWED.test(ch)) {
        cleaned += ch
        if (i < rawCursor) cursor++
      }
    }
    // Correct the real input immediately — without this, a disallowed
    // character (or a stale cursor past a character that just got stripped)
    // would sit visible in the live DOM for one frame before React's
    // controlled `value` caught up.
    input.value = cleaned
    input.setSelectionRange(cursor, cursor)
    setExprs((all) => ({ ...all, [active]: cleaned }))
    setCaret({ start: cursor, end: cursor })
  }

  /** Any selection/cursor-only change (arrows, Home/End, click, shift-select,
   *  Ctrl+A) fires this without touching `exprs` at all. */
  const handleHiddenSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    setCaret({ start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 })
  }

  /** Tap/click anywhere in the tape places the caret at the nearest
   *  character boundary — the boundary whose character's midpoint the
   *  pointer landed left of, or the very end if it's past everything. */
  const placeCaretFromPointer = (clientX: number) => {
    const e = exprs[active] ?? ''
    let pos = e.length
    for (let i = 0; i < e.length; i++) {
      const el = charRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientX < r.left + r.width / 2) {
        pos = i
        break
      }
    }
    focusHiddenInput(pos)
    setCaret({ start: pos, end: pos })
  }

  return (
    // Above the editor (z-40) but below sheets (z-50). It used to be 55, which
    // put it over every picker: tapping Category with the keypad up opened a
    // sheet you could not see. 45 is free — the FAB menu that also uses it
    // only exists on the main screen, where there is no keypad.
    <div className="fixed inset-0 z-[45] flex flex-col justify-end">
      {/* commit(), not onClose() — a tap on the scrim is easy to land by
          accident (the Date row, anywhere on the dimmed background), and
          discarding whatever had just been typed with no confirmation was
          the actual cause of "I typed a number and it vanished." Closing
          the keypad should never lose an in-progress number; only AC and
          backspace should. commit() both saves the current values into the
          field(s) and closes, the same as tapping Done outright would. */}
      <div className="absolute inset-0" style={{ background: 'var(--scrim)' }} onClick={() => commit()} />

      <div
        className="relative animate-sheet select-none overflow-hidden flex flex-col"
        style={{
          borderTopLeftRadius: 'var(--r-lg)',
          borderTopRightRadius: 'var(--r-lg)',
          paddingBottom: 'var(--sab)',
          background: 'var(--calc-panel)',
          // A flex item will not shrink below its content unless told it may.
          // Without this the panel keeps its full natural height, the parent
          // clamps the *box* to the screen, and overflow:hidden then cuts the
          // difference off the bottom — which is exactly how the primary key
          // disappeared on a short screen.
          minHeight: 0,
        }}
      >
        {/* ---------- display: the pale paper half ---------- */}
        <div
          className="px-4 pt-3 pb-1 flex flex-col"
          style={{ background: 'var(--calc-paper)', minHeight: 0 }}
        >
          {/* Where the reference puts its "mode" pill. Here it does real work:
              it aims the keys at Amount or Profit. Rendered in `chipOrder`
              (falling back to `fields`' own order), not `fields` itself —
              `fields` is sorted by tap priority and reorders on every open,
              which used to reorder these chips right along with it. */}
          <div className="flex flex-wrap gap-2">
            {(chipOrder
              ? chipOrder.map((k) => fields.find((f) => f.key === k)).filter((f): f is KeypadField => !!f)
              : fields
            ).map((f) => {
              const isActive = f.key === active
              const v = evalExpression(exprs[f.key] ?? '')
              return (
                <button
                  key={f.key}
                  onClick={() => {
                    setActive(f.key)
                    const len = (exprs[f.key] ?? '').length
                    setCaret({ start: len, end: len })
                    requestAnimationFrame(() => focusHiddenInput(len))
                  }}
                  className="px-5 py-2.5 rounded-full text-[15px] font-bold"
                  style={{
                    border: `1.5px solid ${isActive ? 'var(--calc-ink)' : 'var(--calc-ink-soft)'}`,
                    background: isActive ? 'var(--calc-ink)' : 'transparent',
                    color: isActive ? 'var(--calc-paper)' : 'var(--calc-ink-soft)',
                    transition:
                      'background var(--dur) var(--ease-out), color var(--dur) var(--ease-out)',
                  }}
                >
                  {f.label}
                  {!isActive && !!v && (
                    <span className="ml-1.5 num">{formatAmount(v, db.settings)}</span>
                  )}
                </button>
              )
            })}

            {/* Percent sits up here beside the field it acts on; the keypad
                slot it used to hold now carries the sign toggle. */}
            <button
              onClick={percent}
              className="px-5 py-2.5 rounded-full text-[15px] font-bold"
              style={{
                border: '1.5px solid var(--calc-ink-soft)',
                color: 'var(--calc-ink)',
              }}
              aria-label="Percent"
            >
              %
            </button>

            {/* Swapped with the bracket key, which moved down into the main
                grid (see the "." slot there) — this pill used to hold "()",
                now it's the decimal point. */}
            <button
              onClick={() => push('.')}
              className="px-5 py-2.5 rounded-full text-[15px] font-bold"
              style={{
                border: '1.5px solid var(--calc-ink-soft)',
                color: 'var(--calc-ink)',
              }}
              aria-label="Decimal point"
            >
              .
            </button>
          </div>

          {/* The sum written out on one line, growing rightward as you type —
              a normal calculator's tape, not the receipt-style stack this
              used to be. The view scrolls sideways to keep the caret in
              view rather than the terms stacking upward.

              Every character is its own span (not one span per token) so a
              tap can be resolved to an exact character boundary and the
              caret can be painted between any two of them. A real, invisible
              <input> is what actually owns focus/selection/typing — this is
              only ever a *rendering* of its value and selectionStart/End. */}
          <div
            ref={tape}
            className="mt-2 overflow-x-auto no-scrollbar relative"
            style={{
              height: 32,
              color: 'var(--calc-ink)',
            }}
            onPointerDown={(e) => {
              // Only the tape itself claims the tap — a drag-select inside
              // the real input still needs its own pointer events to reach
              // it, so this must not swallow the input's own interaction.
              if (e.target === hiddenInput.current) return
              e.preventDefault()
              placeCaretFromPointer(e.clientX)
            }}
          >
            <input
              ref={hiddenInput}
              value={expr}
              onChange={handleHiddenChange}
              onSelect={handleHiddenSelect}
              onKeyDown={(e) => {
                // Enter has no default single-line behaviour worth keeping;
                // mapping it to "=" gives a physical/Bluetooth keyboard the
                // same commit gesture the on-screen key has.
                if (e.key === 'Enter') {
                  e.preventDefault()
                  push('=')
                }
              }}
              // No on-screen keyboard: the calculator's own keypad is the
              // primary mobile input, and a native keyboard would pop up
              // over it. A physical/Bluetooth keyboard is unaffected —
              // inputMode only hints the *virtual* keyboard.
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Expression"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 1,
                height: 1,
                opacity: 0,
                border: 'none',
                padding: 0,
                background: 'transparent',
                caretColor: 'transparent',
              }}
            />
            <div className="h-full flex items-center justify-end flex-nowrap">
              {expr.length === 0 && (
                <>
                  {caret.start === 0 && <span key="caret-0" className="calc-caret" />}
                  <span className="text-[22px] num" style={{ color: 'var(--calc-ink-soft)' }}>
                    0
                  </span>
                </>
              )}
              {Array.from(expr).map((ch, i) => {
                const isOp = /[+\-*/]/.test(ch)
                const isBracket = ch === '(' || ch === ')'
                const selected = selStart !== selEnd && i >= selStart && i < selEnd
                return (
                  <span key={`slot-${i}`} className="flex items-center shrink-0">
                    {i === caret.start && selStart === selEnd && (
                      <span key={`caret-${i}`} className="calc-caret" />
                    )}
                    <span
                      ref={(el) => {
                        charRefs.current[i] = el
                      }}
                      className="num shrink-0"
                      style={{
                        fontSize: isOp || isBracket ? 17 : 22,
                        fontWeight: isOp || isBracket ? 400 : 600,
                        color: isOp || isBracket ? 'var(--calc-ink-soft)' : 'var(--calc-ink)',
                        marginLeft: isOp ? 4 : 0,
                        marginRight: isOp ? 4 : 0,
                        whiteSpace: 'pre',
                        background: selected
                          ? 'color-mix(in srgb, var(--calc-ink) 22%, transparent)'
                          : 'transparent',
                        borderRadius: 3,
                      }}
                    >
                      {glyph(ch)}
                    </span>
                  </span>
                )
              })}
              {expr.length > 0 && caret.start === expr.length && selStart === selEnd && (
                <span key={`caret-${expr.length}`} className="calc-caret" />
              )}
            </div>
          </div>

          {/* The result, ruled off like a sum. It snaps rather than counting
              up: the count-up ran a 380ms animation frame loop that re-rendered
              this whole panel ~20 times per keystroke, and on a real phone that
              was enough to swallow taps during fast entry. Summary figures
              elsewhere still roll — there, nobody is typing. */}
          <div className="flex justify-end pb-1">
            <span
              className="pt-1 text-[32px] font-semibold num"
              style={{
                borderTop: '2px solid var(--calc-ink-soft)',
                color: preview < 0 ? 'var(--expense)' : 'var(--calc-ink)',
              }}
            >
              <span style={{ color: 'var(--calc-ink-soft)' }}>=</span>{' '}
              {db.settings.currencySymbol}
              {formatAmount(animPreview, db.settings)}
            </span>
          </div>
        </div>

        {/* ---------- the wave where paper meets slab ----------
            Two layers drifting at different speeds so it reads as liquid with
            depth rather than one sliding shape. Each path tiles every 300
            units and the track is twice as wide as the strip, so translating
            exactly -50% loops with no visible seam. Transform-only, so it
            stays on the compositor and costs nothing per frame. */}
        <div
          className="relative w-full overflow-hidden"
          style={{ height: 56, background: 'var(--calc-paper)', marginBottom: -1 }}
          aria-hidden
        >
          <div className="wave-track wave-back">
            <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full h-full">
              <path d={WAVE_BACK} fill="var(--calc-panel-soft)" />
            </svg>
          </div>
          <div className="wave-track wave-front">
            <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full h-full">
              <path d={WAVE_FRONT} fill="var(--calc-panel)" />
            </svg>
          </div>
        </div>

        {/* ---------- keypad ---------- */}
        <div className="px-3 pb-2">
          <div
            className="grid grid-cols-4 gap-2"
            // The 54px floor used to bite before the panel had run out of
            // room, so on a short screen the keys stayed comfortable while
            // the primary button below them went off the bottom. 48px is
            // still a solid target and only applies below ~560px of height.
            style={{ gridTemplateRows: 'repeat(5, clamp(48px, 8.6vh, 68px))' }}
          >
            <CalcKey label="AC" onClick={clearActive} warm />
            <CalcKey
              label={
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5h10a2 2 0 012 2v10a2 2 0 01-2 2H9l-6-7z" />
                  <path d="M13 10l4 4M17 10l-4 4" />
                </svg>
              }
              onClick={backspace}
              soft
            />
            <CalcKey label="÷" onClick={() => push('/')} soft size={24} />
            <CalcKey label="×" onClick={() => push('*')} soft size={24} />

            <CalcKey label="7" onClick={() => push('7')} />
            <CalcKey label="8" onClick={() => push('8')} />
            <CalcKey label="9" onClick={() => push('9')} />
            <CalcKey label="−" onClick={() => push('-')} soft size={24} />

            <CalcKey label="4" onClick={() => push('4')} />
            <CalcKey label="5" onClick={() => push('5')} />
            <CalcKey label="6" onClick={() => push('6')} />
            <CalcKey label="+" onClick={() => push('+')} soft size={24} />

            <CalcKey label="1" onClick={() => push('1')} />
            <CalcKey label="2" onClick={() => push('2')} />
            <CalcKey label="3" onClick={() => push('3')} />

            {/* the tall equals, with the corner turned up off the slab. Its
                own pressed state for the same reason CalcKey has one —
                :active alone doesn't reliably paint in the WebView. */}
            <EqualsKey onClick={() => push('=')} />

            {/* Two different keys share this slot depending on the field.
                On the profit field it is the difference key — type the cost,
                tap it, and the margin appears. Everywhere else it is a double
                zero, which is what a shop counter actually wants: prices here
                are round hundreds far more often than not. */}
            {activeField?.signed && otherField ? (
              <CalcKey
                label={`${otherField.label}−`}
                onClick={diffFromFirst}
                soft
                size={15}
                lit={diffLit}
              />
            ) : (
              <CalcKey label="00" onClick={doubleZero} soft size={20} />
            )}
            <CalcKey label="0" onClick={() => push('0')} />
            {/* Swapped with the decimal point, which moved up to the pill row
                where this used to live (see the field-chips row above) — the
                grid keeps 16 slots and none of the digits had to move. */}
            <CalcKey
              label={
                <span className="flex items-center justify-center gap-px">
                  <span style={{ opacity: openBrackets(expr) > 0 ? 0.35 : 1 }}>(</span>
                  <span style={{ opacity: openBrackets(expr) > 0 ? 1 : 0.35 }}>)</span>
                </span>
              }
              onClick={bracket}
              soft
              size={19}
            />
          </div>

          {/* Walks Love -> Wow, then commits. On the last field, when the
              caller offers actions, the single Done button becomes one button
              per action so the entry is filed and typed in the same tap. */}
          {nextField ? (
            <button
              className="w-full mt-2.5 h-[52px] rounded-[var(--r-md)] text-[16px] font-bold press"
              style={{ background: accent, color: '#fff' }}
              onClick={() => setActive(nextField.key)}
            >
              <span className="flex items-center justify-center gap-2">
                {nextField.label}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          ) : actions?.length ? (
            <div className="mt-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${actions.length}, 1fr)` }}>
              {actions.map((a) => (
                <button
                  key={a.key}
                  className="h-[52px] rounded-[var(--r-md)] text-[16px] font-bold press"
                  style={{ background: a.color, color: '#fff' }}
                  onClick={() => commit(a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ) : (
            <button
              className="w-full mt-2.5 h-[52px] rounded-[var(--r-md)] text-[16px] font-bold press"
              style={{ background: accent, color: '#fff' }}
              onClick={() => commit()}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
