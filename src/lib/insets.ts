/**
 * Safe areas.
 *
 * On Android the native layer does this now: MainActivity gives the WebView
 * margins equal to the window insets and consumes them, so the web layer is
 * handed a viewport that already excludes the status bar, the navigation bar
 * and the keyboard. There is nothing to inset here, and the safe-area
 * variables are pinned to zero so a stale env() value cannot add a second
 * gap on top of the margin.
 *
 * That replaced two attempts to push or pull the insets into CSS variables.
 * Both had timing holes that left the bottom inset at zero, which put the
 * app's own bottom navigation underneath the 3-button navigation bar. The
 * note in MainActivity.java has the details.
 *
 * Elsewhere — a browser, iOS — env(safe-area-inset-*) is left alone and the
 * CSS falls back to it exactly as before.
 */

import { Capacitor } from '@capacitor/core'

interface LedgerBars {
  setDark?: (dark: boolean) => void
}

function bridge(): LedgerBars | undefined {
  return (window as unknown as { LedgerBars?: LedgerBars }).LedgerBars
}

/**
 * Tell the CSS that the platform has already made room. Only called on
 * Android, where the WebView is natively inset.
 */
export function watchInsets(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}

  const r = document.documentElement
  for (const name of ['--sat', '--sar', '--sab', '--sal']) {
    r.style.setProperty(name, '0px')
  }
  r.dataset.insets = 'native'
  return () => {}
}

/**
 * Publish the on-screen keyboard's height as `--kbh`, on every platform.
 *
 * This runs natively now. It used to bail out on device, on the theory that
 * MainActivity resizing the WebView already made room — but that resize was
 * itself the bug (it repainted black, see the note in MainActivity.java), so
 * it is gone, and with it went the only thing handling the keyboard on device.
 *
 * The measurement cannot double-count against the viewport meta's
 * `interactive-widget=resizes-content`. If Chrome honours that, it shrinks the
 * layout viewport, `window.innerHeight` shrinks with `visualViewport.height`,
 * and `covered` works out to zero by itself — the page has already made room
 * and this adds nothing. If Chrome ignores it, `innerHeight` stays full while
 * the visual viewport shrinks, `covered` is the keyboard's real height, and
 * the padding below is what keeps a field clear of it. Either way the room is
 * made exactly once.
 */
export function watchKeyboard(): () => void {
  const vv = window.visualViewport
  if (!vv) {
    document.documentElement.style.setProperty('--kbh', '0px')
    return () => {}
  }

  const r = document.documentElement
  const apply = () => {
    // Below ~80px the difference is browser chrome or rounding, not a keyboard.
    const covered = window.innerHeight - vv.height - vv.offsetTop
    r.style.setProperty('--kbh', `${covered > 80 ? Math.round(covered) : 0}px`)
  }

  apply()
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  return () => {
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    r.style.setProperty('--kbh', '0px')
  }
}

/** Match the system-bar icons and their backdrop to the app's theme. */
export function setSystemBarsDark(dark: boolean): void {
  bridge()?.setDark?.(dark)
}

/**
 * Keep the focused field above the on-screen keyboard.
 *
 * `block: 'nearest'` rather than 'center' on purpose. The WebView does not
 * shrink when the keyboard opens, so 'center' aimed at the middle of a
 * viewport whose bottom half was covered — scrolling the form clean off the
 * top and leaving an empty band. 'nearest' scrolls the minimum needed, which
 * combined with the `--kbh` padding on the scroller puts the field just above
 * the keyboard and moves nothing else.
 */
export function keepFocusVisible(): () => void {
  let pending: number | undefined

  const onFocus = (e: FocusEvent) => {
    const el = e.target
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLSelectElement)
    ) {
      return
    }

    clearTimeout(pending)
    const scroll = () => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

    const onResize = () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(pending)
      requestAnimationFrame(() => requestAnimationFrame(scroll))
    }
    window.addEventListener('resize', onResize)

    // Fallback for when nothing resizes — a hardware keyboard, or the web.
    pending = setTimeout(() => {
      window.removeEventListener('resize', onResize)
      scroll()
    }, 350) as unknown as number
  }

  document.addEventListener('focusin', onFocus)
  return () => {
    clearTimeout(pending)
    document.removeEventListener('focusin', onFocus)
  }
}
