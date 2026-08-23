/**
 * Pixel-art tab icons.
 *
 * Drawn as a grid of 1×1 rects with crispEdges rather than as smooth paths,
 * so they keep hard pixel corners at any size instead of being antialiased
 * into mush. The grids are deliberately coarse — at 26px in a tab bar a 16×16
 * sprite gives you under two device pixels per cell, and the shape stops
 * reading. Twelve rows is about the limit for something recognisable.
 */

export type PixelArt = {
  grid: string[]
  palette: Record<string, string>
}

/** Screaming cat — More. */
export const CAT: PixelArt = {
  palette: {
    K: '#1b1416',
    O: '#e0a45c',
    C: '#f6ecdc',
    P: '#f2a0b4',
    R: '#a8172a',
  },
  // The wide-open mouth is the whole point of this one, so it takes the
  // middle third of the sprite; anything smaller read as a red button.
  grid: [
    '............',
    '.K........K.',
    '.KPK....KPK.',
    'KOPPK..KPPCK',
    'KOOCCKKCCCCK',
    'KOCKCCCKCCCK',
    'KOCCKRRRKCCK',
    'KOCKRRRRRKCK',
    'KOCKRRRRRKCK',
    'KOCCKRRRKCCK',
    '.KCCCKKKCCCK',
    '..KKKKKKKK..',
  ],
}

/** Shark — Pinly. */
export const SHARK: PixelArt = {
  palette: {
    K: '#14161c',
    S: '#63708e',
    D: '#4a566f',
    W: '#e8ecf2',
  },
  grid: [
    '............',
    '.....K......',
    '....KSK.....',
    'K...KSSK....',
    'KK..KSSSK...',
    'KSK.KSSSSK..',
    'KSSKKSSSSSK.',
    'KSSSSSKSSSSK',
    'KSSSSSSSSSK.',
    '.KKDDDDDDK..',
    '...KWWWWK...',
    '....KKKK....',
  ],
}

/** Lotus — Train.
 *
 * Redrawn to be exactly symmetric about the gap between columns 5 and 6. The
 * previous grid was a pixel wider on the left than the right, and its centre
 * petal was a single column of light pink — at 28px that is under two device
 * pixels, so the flower lost its middle and read as a pink smudge. Now: a
 * two-wide lit centre petal, two outlined side petals per side, and the pad
 * below drawn dark-first so the silhouette survives being greyed out on an
 * inactive tab. */
export const LOTUS: PixelArt = {
  palette: {
    K: '#1b1416',
    P: '#ef5f83',
    L: '#ffb3c6',
    G: '#43975f',
    D: '#2c6b45',
  },
  grid: [
    '............',
    '.....KK.....',
    '....KLLK....',
    '....KLLK....',
    '.K..KLLK..K.',
    'KPK.KLLK.KPK',
    'KPPKKLLKKPPK',
    'KPPPKLLKPPPK',
    '.KPPPLLPPPK.',
    '..KPPPPPPK..',
    '...KKKKKK...',
    '.KGGDDDDGGK.',
  ],
}

export function PixelIcon({
  art,
  size = 26,
  dim,
}: {
  art: PixelArt
  size?: number
  /** Inactive tabs go quiet without losing their silhouette. */
  dim?: boolean
}) {
  const rows = art.grid.length
  const cols = art.grid[0].length

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      style={{
        filter: dim ? 'grayscale(1)' : undefined,
        opacity: dim ? 0.55 : 1,
        transition: 'opacity var(--dur) var(--ease-out), filter var(--dur) var(--ease-out)',
      }}
      aria-hidden
    >
      {art.grid.map((row, y) =>
        [...row].map((ch, x) =>
          ch === '.' ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={art.palette[ch]} />
          ),
        ),
      )}
    </svg>
  )
}
