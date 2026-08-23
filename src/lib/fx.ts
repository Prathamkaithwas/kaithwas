/**
 * Transient visual effects — ripples, particle bursts, confetti.
 *
 * All three work the same way: put absolutely-positioned children into a host
 * element, let CSS animate them, then remove them on `animationend`. Nothing
 * here holds state, nothing runs on a timer, and nothing survives the effect —
 * so none of it can leak into a later render or keep a dead node alive.
 *
 * They are written as plain DOM rather than React because these elements have
 * no business being in the component tree: they exist for half a second, they
 * are never interacted with, and re-rendering a list because a spark is in
 * flight is exactly the kind of cost that started swallowing keystrokes on the
 * calculator.
 *
 * Every host needs `position: relative` and `overflow: hidden` (ripple) or
 * `overflow: visible` (bursts). The helpers do not set it — that belongs to
 * the component's own styling.
 */

/** Remove a node once its animation finishes, with a timeout as a backstop. */
function reap(el: HTMLElement, ms: number): void {
  let done = false
  const kill = () => {
    if (done) return
    done = true
    el.remove()
  }
  el.addEventListener('animationend', kill, { once: true })
  // A tab backgrounded mid-flight never fires animationend; without this the
  // node would sit in the DOM until the screen unmounted.
  setTimeout(kill, ms + 120)
}

/**
 * Material-style ripple starting at the exact point touched.
 *
 * Sized to reach the furthest corner from that point, so a tap near an edge
 * still floods the whole control rather than stopping short.
 */
export function ripple(host: HTMLElement, clientX: number, clientY: number): void {
  const r = host.getBoundingClientRect()
  const x = clientX - r.left
  const y = clientY - r.top
  // distance to the furthest corner — the radius the circle has to reach
  const far = Math.max(
    Math.hypot(x, y),
    Math.hypot(r.width - x, y),
    Math.hypot(x, r.height - y),
    Math.hypot(r.width - x, r.height - y),
  )
  const d = far * 2

  const el = document.createElement('span')
  el.className = 'fx-ripple'
  el.style.width = `${d}px`
  el.style.height = `${d}px`
  el.style.left = `${x - far}px`
  el.style.top = `${y - far}px`
  host.appendChild(el)
  reap(el, 600)
}

/**
 * A ring of particles thrown outward — the burst behind the habit tick.
 *
 * Evenly spaced around a circle so it reads as a deliberate pop rather than a
 * scatter, with only a little jitter on the distance so it does not look
 * mechanical.
 */
export function burst(host: HTMLElement, color: string, count = 8): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const dist = 26 + Math.random() * 12
    const el = document.createElement('span')
    el.className = 'fx-particle'
    el.style.background = color
    el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`)
    host.appendChild(el)
    reap(el, 600)
  }
}

/**
 * Confetti from the centre of a control.
 *
 * Squares rather than dots, each on its own evenly-spaced heading with a
 * little randomness, thrown a random distance and tumbling as it goes. Uses
 * the app's own colours, not a rainbow — it should read as this app being
 * pleased, not as a party hat.
 */
const CONFETTI_COLORS = ['#F4695D', '#F5C242', '#3FC77F', '#4C8CF5', '#B476E5', '#35C5C0']

export function confetti(host: HTMLElement, count = 16): void {
  for (let i = 0; i < count; i++) {
    // even spread, nudged so the pieces do not fly in perfect spokes
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5
    const dist = 60 + Math.random() * 70
    const el = document.createElement('span')
    el.className = 'fx-confetti'
    el.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`)
    el.style.setProperty('--spin', `${(Math.random() - 0.5) * 720}deg`)
    el.style.animationDelay = `${Math.random() * 60}ms`
    host.appendChild(el)
    reap(el, 960)
  }
}
