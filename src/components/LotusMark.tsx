/**
 * The lotus, as line art.
 *
 * Replaces the pixel sprite that used to sit on the Train tab. The same paths
 * are rasterised into the launcher icons by scripts/lotus_render.py, so the
 * mark in the tab bar and the mark on the home screen are literally the same
 * drawing — change one and the other has to be regenerated.
 *
 * Strokes rather than fills, and `currentColor` throughout, so the tab bar can
 * colour it by state without the component knowing anything about tabs.
 * `vector-effect: non-scaling-stroke` keeps the line the same visual weight at
 * 28px in the bar as at 96px anywhere else — without it the stroke scales with
 * the viewBox and the mark turns into a blob at tab size.
 */
export function LotusMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* centre petal */}
      <path d="M50 16 C58.5 30 64 42.5 64 52.5 C64 62 58 68.5 50 68.5 C42 68.5 36 62 36 52.5 C36 42.5 41.5 30 50 16 Z" />
      {/* the pair tucked behind it */}
      <path d="M33.5 33.5 C39.5 38.5 43.5 45 44.5 51.5 C37.5 48 33 41.5 33.5 33.5 Z" />
      <path d="M66.5 33.5 C60.5 38.5 56.5 45 55.5 51.5 C62.5 48 67 41.5 66.5 33.5 Z" />
      {/* the two that carry the width */}
      <path d="M11 47.5 C27 45.5 42 52 49.5 66.5 C33 70.5 17.5 62.5 11 47.5 Z" />
      <path d="M89 47.5 C73 45.5 58 52 50.5 66.5 C67 70.5 82.5 62.5 89 47.5 Z" />
      {/* the base, crossing under the flower */}
      <path d="M34 70 C41 68.5 47 71 50 76.5 C43.5 79 36.5 76 34 70 Z" />
      <path d="M66 70 C59 68.5 53 71 50 76.5 C56.5 79 63.5 76 66 70 Z" />
      <path d="M26.5 64.5 C31 68 36 70 41 70.5" />
      <path d="M73.5 64.5 C69 68 64 70 59 70.5" />
    </svg>
  )
}
