import { useState } from 'react'
import { MONTHS, WEEKDAYS, calendarCells, dateToKey, parseISO, todayKey } from '../lib/date'
import { useStore } from '../store'
import { hapticLight } from '../lib/haptics'

/** The seven days whose week contains `key`, honouring the first-day setting. */
function weekOf(key: string, firstDay: 0 | 1): string[] {
  const d = parseISO(`${key}T12:00`)
  const shift = (d.getDay() - firstDay + 7) % 7
  d.setDate(d.getDate() - shift)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d)
    x.setDate(x.getDate() + i)
    return dateToKey(x)
  })
}

/**
 * Picking a day, as a week you can walk rather than a month you have to read.
 *
 * The native `<input type="date">` this replaces was correct and joyless: it
 * handed the whole job to whatever dialog the phone felt like showing, which
 * on Android is a full modal calendar for the common case of "yesterday" or
 * "the day before". A week strip puts the six days either side of where you
 * are within a thumb's reach, and the month grid is still one tap away for
 * the rarer jump.
 *
 * The strip steps a week at a time and the heading follows the *selected*
 * day, not the week — so stepping back and forth reads as moving a cursor
 * through the year rather than paging through a document.
 */
export function WeekPicker({
  value,
  onPick,
  onClose,
}: {
  value: string
  onPick: (key: string) => void
  onClose: () => void
}) {
  const { db } = useStore()
  const firstDay = db.settings.firstDayOfWeek
  const [view, setView] = useState<'Weekly' | 'Monthly'>('Weekly')
  const [anchor, setAnchor] = useState(value)

  const sel = parseISO(`${value}T12:00`)
  const today = todayKey()
  const days = weekOf(anchor, firstDay)
  const month = anchor.slice(0, 7)

  const stepWeek = (delta: number) => {
    const d = parseISO(`${anchor}T12:00`)
    d.setDate(d.getDate() + delta * 7)
    setAnchor(dateToKey(d))
    hapticLight()
  }

  const stepMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    setAnchor(dateToKey(new Date(y, m - 1 + delta, 1)))
    hapticLight()
  }

  const take = (key: string) => {
    hapticLight()
    onPick(key)
    onClose()
  }

  const cells = calendarCells(month, firstDay)
  const order = firstDay === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="wk">
      {/* Weekly | Monthly, plus a jump home. The pill is sized to the column,
          never to the label, so it does not resize as it slides. */}
      <div className="wk-seg">
        {(['Weekly', 'Monthly'] as const).map((v, i) => (
          <button key={v} data-on={view === v || undefined} onClick={() => setView(v)}>
            {v}
            {i === 0 && <span className="wk-pill" data-at={view === 'Monthly' ? 1 : 0} aria-hidden />}
          </button>
        ))}
      </div>

      <div className="wk-head">
        <span className="wk-month">{MONTHS[sel.getMonth()]}</span>
        <span className="wk-day">{sel.getDate()}</span>
      </div>

      {view === 'Weekly' ? (
        <>
          <div className="wk-row">
            <button className="wk-arrow" onClick={() => stepWeek(-1)} aria-label="Previous week">
              ‹
            </button>
            <div className="wk-days">
              {days.map((k) => {
                const d = parseISO(`${k}T12:00`)
                return (
                  <button
                    key={k}
                    className="wk-cell"
                    data-on={k === value || undefined}
                    data-today={k === today || undefined}
                    onClick={() => take(k)}
                  >
                    <span className="wk-name">{WEEKDAYS[d.getDay()]}</span>
                    <span className="wk-num">{d.getDate()}</span>
                  </button>
                )
              })}
            </div>
            <button className="wk-arrow" onClick={() => stepWeek(1)} aria-label="Next week">
              ›
            </button>
          </div>
        </>
      ) : (
        <div className="wk-month-view">
          <div className="wk-row">
            <button className="wk-arrow" onClick={() => stepMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <span className="flex-1 text-center text-[14px] font-semibold">
              {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
            </span>
            <button className="wk-arrow" onClick={() => stepMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="wk-grid-head">
            {order.map((i) => (
              <span key={i}>{WEEKDAYS[i]}</span>
            ))}
          </div>
          <div className="wk-grid">
            {cells.map((cell) => {
              const k = dateToKey(cell)
              return (
                <button
                  key={k}
                  className="wk-gcell"
                  data-on={k === value || undefined}
                  data-today={k === today || undefined}
                  data-out={k.slice(0, 7) !== month || undefined}
                  onClick={() => take(k)}
                >
                  {cell.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <button className="wk-today" onClick={() => take(today)}>
        Jump to today
      </button>
    </div>
  )
}
