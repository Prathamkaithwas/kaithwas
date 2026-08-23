import { useState } from 'react'
import { Reorder } from 'motion/react'
import type { PlannerBlock, PlannerPriority, PlannerTask } from '../types'
import { useStore } from '../store'
import { Bar, Sheet } from '../components/ui'
import { HoldConfirm } from '../components/HoldConfirm'
import { MONTHS_SHORT, WEEKDAYS, parseISO, todayKey } from '../lib/date'
import { hapticLight, hapticMedium } from '../lib/haptics'

/**
 * Today's tasks, bucketed into Morning/Afternoon/Evening — opened from its
 * own icon in Niba's header as a full-screen sheet, not laid out inline on
 * the page. An inline foldable version was tried first; the explicit call
 * afterward was that a separate panel behind a button reads better than
 * folding it into the notes list.
 *
 * Deliberately fixed to today rather than following whatever day the rest
 * of the app is browsing: a plan is a thing you act on now, not a record
 * you look back through, so there is nothing here for a date stepper to do.
 * Yesterday's unfinished tasks simply stay on yesterday.
 */

const BLOCKS: PlannerBlock[] = ['morning', 'afternoon', 'evening']

const BLOCK_META: Record<PlannerBlock, { label: string; sub: string; glyph: string }> = {
  morning: { label: 'Morning', sub: 'Before noon', glyph: '☀️' },
  afternoon: { label: 'Afternoon', sub: 'Noon – 5 PM', glyph: '☁️' },
  evening: { label: 'Evening', sub: 'After 5 PM', glyph: '🌙' },
}

const PRIORITY_COLOR: Record<PlannerPriority, string> = {
  high: 'var(--expense)',
  medium: 'var(--income)',
  // Not one of the app's own design tokens — neither --expense (red) nor
  // --income (blue) reads as "low priority", and every other palette in the
  // app is scoped to its own screen the same way (--slp-*, --pw-a). Lifted
  // straight from CHART_COLORS (lib/seed.ts) rather than invented, so it
  // still belongs to the app's existing palette.
  low: '#3fc77f',
}

const PRIORITY_LABEL: Record<PlannerPriority, string> = {
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
}

function plannerDateLabel(key: string): string {
  const d = parseISO(key + 'T12:00')
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

export function PlannerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, togglePlannerTask, reorderPlannerTasks, autoPlanDay } = useStore()
  const date = todayKey()
  const [editing, setEditing] = useState<PlannerTask | 'new' | null>(null)
  // Which block "+ Add task" was tapped from — the new task's starting
  // point in the editor, not a commitment; the editor's own block chooser
  // can still send it to Unplanned instead.
  const [addBlock, setAddBlock] = useState<PlannerBlock>('morning')

  const tasks = db.plannerTasks.filter((t) => t.date === date)
  const doneCount = tasks.filter((t) => t.done).length
  const unplanned = tasks.filter((t) => !t.block).sort((a, b) => a.order - b.order)

  const openAdd = (block: PlannerBlock) => {
    setAddBlock(block)
    setEditing('new')
  }

  return (
    <Sheet open={open} onClose={onClose} title="Today's Plan" full>
      <div className="pb-2">
        <div className="planner-inline-head">
          <span className="planner-date">{plannerDateLabel(date)}</span>
          <button
            className="planner-autoplan"
            disabled={tasks.length === 0}
            onClick={() => {
              hapticMedium()
              autoPlanDay(date)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M13 2L3 14h7l-1 8 11-14h-8z" />
            </svg>
            Auto-plan
          </button>
        </div>

        {tasks.length > 0 && (
          <div className="planner-summary">
            <div className="flex items-center justify-between text-[13px]">
              <span>
                {tasks.length} task{tasks.length === 1 ? '' : 's'} planned today
              </span>
              <span style={{ color: 'var(--muted)' }}>
                {doneCount} of {tasks.length} done
              </span>
            </div>
            <div className="mt-2">
              <Bar pct={tasks.length ? (doneCount / tasks.length) * 100 : 0} color="var(--accent)" />
            </div>
          </div>
        )}

        {unplanned.length > 0 && (
          <PlannerBlockSection
            label="Unplanned"
            sub="Auto-plan will place these"
            glyph="✦"
            tasks={unplanned}
            onReorder={(ids) => reorderPlannerTasks(date, null, ids)}
            onToggle={togglePlannerTask}
            onOpen={setEditing}
          />
        )}

        {BLOCKS.map((block) => {
          const meta = BLOCK_META[block]
          const list = tasks.filter((t) => t.block === block).sort((a, b) => a.order - b.order)
          return (
            <PlannerBlockSection
              key={block}
              label={meta.label}
              sub={meta.sub}
              glyph={meta.glyph}
              tasks={list}
              onReorder={(ids) => reorderPlannerTasks(date, block, ids)}
              onToggle={togglePlannerTask}
              onOpen={setEditing}
              onAdd={() => openAdd(block)}
            />
          )
        })}
      </div>

      {editing && (
        <PlannerTaskEditor
          date={date}
          defaultBlock={addBlock}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  )
}

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PlannerBlockSection({
  label,
  sub,
  glyph,
  tasks,
  onReorder,
  onToggle,
  onOpen,
  onAdd,
}: {
  label: string
  sub: string
  glyph: string
  tasks: PlannerTask[]
  onReorder: (ids: string[]) => void
  onToggle: (id: string) => void
  onOpen: (t: PlannerTask) => void
  /** Absent on the Unplanned section — there is nothing to "add into" it
   *  specifically, since a task lands there by being left unassigned, not
   *  by being asked for. */
  onAdd?: () => void
}) {
  return (
    <div className="planner-block">
      <div className="planner-block-head">
        <span className="planner-block-glyph" aria-hidden>
          {glyph}
        </span>
        <div className="flex-1 min-w-0">
          <div className="planner-block-label">{label}</div>
          <div className="planner-block-sub">{sub}</div>
        </div>
        {tasks.length > 0 && <span className="planner-block-count num">{tasks.length}</span>}
      </div>

      {tasks.length > 0 && (
        <Reorder.Group
          axis="y"
          values={tasks.map((t) => t.id)}
          onReorder={onReorder}
          className="planner-rows"
        >
          {tasks.map((t) => (
            <Reorder.Item
              key={t.id}
              value={t.id}
              className="planner-row"
              onPointerDown={() => hapticLight()}
            >
              <button
                className="planner-check"
                data-done={t.done || undefined}
                aria-label={t.done ? 'Mark not done' : 'Mark done'}
                onClick={(e) => {
                  e.stopPropagation()
                  hapticLight()
                  onToggle(t.id)
                }}
              >
                {t.done && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span
                className="planner-dot"
                style={{ background: PRIORITY_COLOR[t.priority] }}
                aria-label={PRIORITY_LABEL[t.priority]}
              />
              <button className="planner-row-body" onClick={() => onOpen(t)}>
                <div className="planner-row-title" data-done={t.done || undefined}>
                  {t.title}
                </div>
                {t.subtitle && <div className="planner-row-sub">{t.subtitle}</div>}
              </button>
              <span className="planner-drag" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
                </svg>
              </span>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      {onAdd && (
        <button className="planner-add" onClick={onAdd}>
          <PlusGlyph /> Add task
        </button>
      )}
    </div>
  )
}

const DURATION_PRESETS = [15, 30, 60, 90]

function PlannerTaskEditor({
  date,
  defaultBlock,
  item,
  onClose,
}: {
  date: string
  defaultBlock: PlannerBlock
  item: PlannerTask | null
  onClose: () => void
}) {
  const { addPlannerTask, updatePlannerTask, deletePlannerTask } = useStore()
  const [title, setTitle] = useState(item?.title ?? '')
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? '')
  const [priority, setPriority] = useState<PlannerPriority>(item?.priority ?? 'medium')
  const [duration, setDuration] = useState(item?.durationMin ?? 30)
  const [block, setBlock] = useState<PlannerBlock | null>(item ? item.block : defaultBlock)

  const save = () => {
    if (!title.trim()) return
    if (item) {
      updatePlannerTask({
        ...item,
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        priority,
        durationMin: duration,
        // A block picked here is a deliberate choice, same as a drag would
        // be — Unplanned specifically means "let Auto-plan decide", so only
        // that choice clears the manual flag.
        block,
        manualBlock: block !== null,
      })
    } else {
      addPlannerTask({
        date,
        title: title.trim(),
        subtitle: subtitle.trim() || undefined,
        priority,
        durationMin: duration,
        block,
        manualBlock: block !== null,
        done: false,
      })
    }
    onClose()
  }

  return (
    <Sheet open onClose={onClose} title={item ? 'Edit task' : 'New task'}>
      <div className="p-4 space-y-4">
        <input
          className="w-full border-b pb-2 text-[15px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!item}
        />
        <input
          className="w-full border-b pb-2 text-[14px]"
          style={{ borderColor: 'var(--line)' }}
          placeholder="Details (optional)"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
        />

        <div>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            Priority
          </div>
          <div className="flex gap-2">
            {(['high', 'medium', 'low'] as PlannerPriority[]).map((p) => {
              const on = priority === p
              return (
                <button
                  key={p}
                  className="flex-1 py-2 rounded-[var(--r-sm)] text-[13px] font-semibold flex items-center justify-center gap-1.5"
                  style={{
                    background: 'var(--bg)',
                    border: `1.5px solid ${on ? PRIORITY_COLOR[p] : 'var(--line)'}`,
                    color: on ? PRIORITY_COLOR[p] : 'var(--text)',
                  }}
                  onClick={() => setPriority(p)}
                >
                  <span
                    className="planner-dot"
                    style={{ background: PRIORITY_COLOR[p] }}
                    aria-hidden
                  />
                  {p[0].toUpperCase() + p.slice(1)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            Duration — only used by Auto-plan
          </div>
          <div className="flex gap-2">
            {DURATION_PRESETS.map((m) => (
              <button
                key={m}
                className="flex-1 py-2 rounded-[var(--r-sm)] text-[13px] font-semibold"
                style={{
                  background: duration === m ? 'var(--accent)' : 'var(--bg)',
                  color: duration === m ? '#fff' : 'var(--text)',
                  border: `1.5px solid ${duration === m ? 'var(--accent)' : 'var(--line)'}`,
                }}
                onClick={() => setDuration(m)}
              >
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            When
          </div>
          <div className="flex gap-2 flex-wrap">
            {BLOCKS.map((b) => (
              <button
                key={b}
                className="px-3 py-1.5 rounded-full text-[12px]"
                style={{
                  background: block === b ? 'var(--accent)' : 'var(--bg)',
                  color: block === b ? '#fff' : 'var(--text)',
                  border: `1.5px solid ${block === b ? 'var(--accent)' : 'var(--line)'}`,
                }}
                onClick={() => setBlock(b)}
              >
                {BLOCK_META[b].label}
              </button>
            ))}
            <button
              className="px-3 py-1.5 rounded-full text-[12px]"
              style={{
                background: block === null ? 'var(--accent)' : 'var(--bg)',
                color: block === null ? '#fff' : 'var(--text)',
                border: `1.5px solid ${block === null ? 'var(--accent)' : 'var(--line)'}`,
              }}
              onClick={() => setBlock(null)}
            >
              Unplanned
            </button>
          </div>
        </div>

        <button
          className="w-full py-3 rounded-lg text-white text-[15px] font-semibold"
          style={{ background: 'var(--accent)' }}
          disabled={!title.trim()}
          onClick={save}
        >
          Save
        </button>

        {item && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              hold to delete
            </span>
            <HoldConfirm label="Delete task" onConfirm={() => { deletePlannerTask(item.id); onClose() }} />
          </div>
        )}
      </div>
    </Sheet>
  )
}
