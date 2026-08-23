import type { PlannerBlock, PlannerTask } from '../types'

const BLOCKS: PlannerBlock[] = ['morning', 'afternoon', 'evening']

const PRIORITY_RANK: Record<PlannerTask['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/**
 * Buckets a day's tasks into Morning/Afternoon/Evening.
 *
 * Only touches tasks with `manualBlock: false` — anything the owner has
 * placed by hand (a drag, or the block picker) is left exactly where it is,
 * on every run. That's the whole point of the flag: Auto-plan can be tapped
 * again after adding a couple of new tasks without undoing where the owner
 * already put everything else.
 *
 * The algorithm itself is a straightforward greedy bin-pack:
 *
 * 1. Sort the eligible tasks by priority (high first), then by duration
 *    (longer first) within the same priority — a high-priority task always
 *    gets to pick its slot before a lower one, so urgent work tends to land
 *    in whichever block is emptiest at the time it's considered, which in
 *    practice skews it toward Morning.
 * 2. Walk that list, and for each task add it to whichever block currently
 *    carries the least total duration — manual tasks' durations count
 *    toward that total from the start, so an Auto-plan run fills in *around*
 *    them instead of ignoring how loaded a block already is.
 *
 * This is not scheduling in the sense of actual clock times — it's a
 * reasonable, explainable "spread the load" pass, the same job a person
 * eyeballing a list into three buckets would do by hand, just without
 * having to do it by hand.
 */
export function autoPlanTasks(tasks: PlannerTask[]): PlannerTask[] {
  const manual = tasks.filter((t) => t.manualBlock && t.block)
  const eligible = tasks.filter((t) => !(t.manualBlock && t.block))

  const load: Record<PlannerBlock, number> = { morning: 0, afternoon: 0, evening: 0 }
  // A manual task's own `order` is left untouched below — it was already
  // correctly gapless from whatever reorder or placement put it there.
  // `nextOrder` starts past those, so newly-placed tasks land after them
  // in each block rather than colliding on the same position.
  const nextOrder: Record<PlannerBlock, number> = { morning: 0, afternoon: 0, evening: 0 }
  for (const t of manual) {
    const b = t.block as PlannerBlock
    load[b] += t.durationMin
    nextOrder[b] = Math.max(nextOrder[b], t.order + 1)
  }

  const ordered = [...eligible].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    return p !== 0 ? p : b.durationMin - a.durationMin
  })

  const placedById = new Map<string, PlannerTask>()
  for (const t of ordered) {
    const block = BLOCKS.reduce((least, b) => (load[b] < load[least] ? b : least), BLOCKS[0])
    load[block] += t.durationMin
    placedById.set(t.id, { ...t, block, manualBlock: false, order: nextOrder[block]++ })
  }

  return tasks.map((t) => placedById.get(t.id) ?? t)
}
