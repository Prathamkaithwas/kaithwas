import type { SVGProps } from 'react'

/**
 * A small, hand-drawn icon set for habits — the same stroke language as
 * every other icon in the app (24×24 viewBox, 2.2 stroke, round caps and
 * joins, no fill) rather than a component library with its own look.
 *
 * `Habit.icon` has existed on the type since the beginning but was never
 * actually rendered anywhere — every habit was saved with `icon: ''`. This
 * is what finally gives it somewhere to go: a picker in the editor, and the
 * glyph shown on the tile.
 */
export type HabitIconId =
  | 'dumbbell'
  | 'run'
  | 'lotus'
  | 'book'
  | 'droplet'
  | 'moon'
  | 'apple'
  | 'pen'
  | 'palette'
  | 'music'
  | 'pill'
  | 'coin'
  | 'briefcase'
  | 'leaf'
  | 'sun'
  | 'target'

export const HABIT_ICON_IDS: HabitIconId[] = [
  'dumbbell',
  'run',
  'lotus',
  'book',
  'droplet',
  'moon',
  'apple',
  'pen',
  'palette',
  'music',
  'pill',
  'coin',
  'briefcase',
  'leaf',
  'sun',
  'target',
]

export const HABIT_ICON_LABEL: Record<HabitIconId, string> = {
  dumbbell: 'Exercise',
  run: 'Run',
  lotus: 'Meditate',
  book: 'Read',
  droplet: 'Water',
  moon: 'Sleep',
  apple: 'Food',
  pen: 'Journal',
  palette: 'Art',
  music: 'Music',
  pill: 'Health',
  coin: 'Save',
  briefcase: 'Work',
  leaf: 'Nature',
  sun: 'Wake early',
  target: 'Goal',
}

const PATHS: Record<HabitIconId, React.ReactNode> = {
  dumbbell: (
    <>
      <path d="M7 6v12" />
      <path d="M17 6v12" />
      <path d="M4 8.5v7" />
      <path d="M20 8.5v7" />
      <path d="M7 12h10" />
    </>
  ),
  run: (
    <>
      <circle cx="14" cy="4.5" r="2" />
      <path d="M12 8l-3 3 2 2-1 5" />
      <path d="M12 8l4 1 2 3" />
      <path d="M9 13l-3 2" />
      <path d="M13 18l4 2" />
    </>
  ),
  // Two petals rather than the full brand mark (see LotusMark) — this only
  // has to read as "meditation" at 18px next to a habit name, not carry the
  // app's identity the way the launcher icon does.
  lotus: (
    <>
      <path d="M12 20c-4-1-6-4-6-8 2 1 4 3 6 6 2-3 4-5 6-6 0 4-2 7-6 8Z" />
      <path d="M12 12c-1.5-2-1.5-5 0-8 1.5 3 1.5 6 0 8Z" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    </>
  ),
  droplet: <path d="M12 3c3 4 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 3-7 6-11Z" />,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />,
  apple: (
    <>
      <path d="M12 8c-3.5 0-6 2.7-6 6.3C6 18 8.4 21 11 21c.7 0 1.3-.2 1.9-.5.4-.2.8-.2 1.2 0 .6.3 1.2.5 1.9.5 2.6 0 5-3 5-6.7C21 10.7 18.5 8 15 8c-1.1 0-1.9.4-3 1.1C11 8.4 10.1 8 9 8Z" />
      <path d="M13 7.5c0-1.5.8-2.7 2-3.5-.2 1.6-1 2.8-2 3.5Z" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l1-4.2L15.6 5.2a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4L8.2 19 4 20Z" />
      <path d="M14 7l3 3" />
    </>
  ),
  palette: (
    <>
      <path d="M12 4C7 4 3 7.8 3 12.4 3 16 5.7 18 9 18h.3c.9 0 1.5-.7 1.4-1.6-.1-.6-.5-1.1-.5-1.7 0-1 .8-1.7 1.8-1.7H15c3.3 0 6-2 6-5.3C21 4.9 16.6 4 12 4Z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  music: (
    <>
      <circle cx="7" cy="18" r="2.3" />
      <circle cx="16.5" cy="16" r="2.3" />
      <path d="M9.3 18V6.5L18.8 4v11.5" />
      <path d="M9.3 9.5l9.5-2.5" />
    </>
  ),
  // A rounded rect rather than two hand-rotated arcs — the arc version read
  // as a plain circle-with-slash (a "banned" glyph, the opposite of what a
  // health habit needs) because the straight run between the two curves was
  // too short relative to their radius to look elongated. A capsule this
  // shape is trivial to get right by construction: full end-caps (rx = half
  // the height) and a dividing line down the middle.
  pill: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="3" />
      <path d="M12 9v6" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.3 9.6c0-1.2 1.2-2.1 2.7-2.1s2.7.9 2.7 2c0 2.6-5.4 1.4-5.4 4 0 1.1 1.2 2 2.7 2s2.7-.9 2.7-2.1" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="8" width="18" height="11" rx="2" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </>
  ),
  leaf: (
    <>
      <path d="M6 20C4 12 9 5 19 4c1 10-6 15-13 16Z" />
      <path d="M6 20c2-4 5-7 10-10" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.4 19.6 6 18M18 6l1.6-1.6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
}

function isHabitIconId(v: string): v is HabitIconId {
  return Object.hasOwn(PATHS, v)
}

/** Renders nothing for an empty or unrecognised id — an unknown name from an
 *  older/newer build just means the tile shows no icon, not a broken one. */
export function HabitIcon({
  id,
  size = 18,
  ...rest
}: { id?: string; size?: number } & SVGProps<SVGSVGElement>) {
  if (!id || !isHabitIconId(id)) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {PATHS[id]}
    </svg>
  )
}
