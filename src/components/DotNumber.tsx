/**
 * Numbers drawn as a dot matrix, the way a station board or a bedside clock
 * draws them.
 *
 * The unlit dots are drawn too, faintly. That is the whole trick: a grid with
 * only the lit dots showing reads as a decorative font, whereas leaving the
 * dark ones in place reads as a panel that *could* light them — which is what
 * makes it look like hardware rather than a typeface.
 */

/** 3 wide, 5 tall. Small enough to stay legible at a glance, big enough to read. */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  // "never done" — a dash rather than a zero, which would be a lie.
  '—': ['000', '000', '111', '000', '000'],
  '-': ['000', '000', '111', '000', '000'],
}

const ROWS = 5
const COLS = 3

export function DotNumber({
  value,
  cell = 7,
  color = 'currentColor',
  className,
}: {
  value: string | number
  /** Pixel pitch of one dot cell. The dot itself is a little smaller. */
  cell?: number
  color?: string
  className?: string
}) {
  const chars = String(value).split('').filter((c) => c in GLYPHS)
  if (!chars.length) return null

  // A gap of one and a half cells, not one. At one cell the columns of
  // adjacent digits sat as close as the columns *within* a digit, and "186"
  // came out as one field of dots rather than three numbers.
  const gap = cell * 1.5
  const width = chars.length * COLS * cell + (chars.length - 1) * gap
  const height = ROWS * cell
  // Lit dots are drawn fuller than dark ones. Equal sizes made the unlit grid
  // compete with the number written on it.
  const rOn = cell * 0.4
  const rOff = cell * 0.22

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={String(value)}
    >
      {chars.map((ch, i) => {
        const originX = i * (COLS * cell + gap)
        return GLYPHS[ch].map((row, y) =>
          row.split('').map((bit, x) => (
            <circle
              key={`${i}-${y}-${x}`}
              cx={originX + x * cell + cell / 2}
              cy={y * cell + cell / 2}
              r={bit === '1' ? rOn : rOff}
              fill={color}
              opacity={bit === '1' ? 1 : 0.13}
            />
          )),
        )
      })}
    </svg>
  )
}
