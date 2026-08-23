import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

/**
 * Native haptic feedback — Android's real vibration motor API via Capacitor,
 * not the Web Vibration API this used to wrap. The old version worked, but
 * every call site picked its own raw millisecond count by feel (5? 8? 12?),
 * which is exactly the kind of thing that drifts inconsistent across a dozen
 * screens built in a dozen sessions. These four map onto the three tiers a
 * shop owner actually feels as different: a light tap that just acknowledges
 * a touch landed, a firmer one for something real happening, and a heavier
 * or error-shaped one for something that can't be undone or went wrong.
 *
 * In the browser dev preview, Capacitor's own web fallback takes over and
 * calls `navigator.vibrate` with a canned pattern per style — so these are
 * safe to call from anywhere without checking platform first, same as the
 * function they replace.
 *
 * Every call swallows its own rejection. A device with the haptics motor
 * disabled, a browser tab with no Vibration API, a WebView that throws
 * instead of refusing — none of that is worth surfacing to the person who
 * just tapped a button; the tap already worked, the buzz is a bonus.
 */
function safe(run: () => Promise<void>): void {
  run().catch(() => {
    /* no haptics hardware, or the web fallback isn't available — never fatal */
  })
}

/** A routine tap — navigation, a minor toggle, a drag crossing a step.
 *  This is the one that gets called the most, by a wide margin, so it has to
 *  stay genuinely subtle or the whole app starts to feel like it's buzzing. */
export function hapticLight(): void {
  safe(() => Haptics.impact({ style: ImpactStyle.Light }))
}

/** Something real just happened — a save landed, a habit got marked done, a
 *  deleted item came back. Not dangerous, but worth more than a tap. */
export function hapticMedium(): void {
  safe(() => Haptics.impact({ style: ImpactStyle.Medium }))
}

/** A destructive action actually completing — a delete firing, not the
 *  confirmation dialog that leads up to it. Reserved for the moment
 *  something is actually gone, not for opening the "are you sure". */
export function hapticHeavy(): void {
  safe(() => Haptics.impact({ style: ImpactStyle.Heavy }))
}

/** Something failed — a wrong PIN, a validation error blocking a save. Its
 *  own notification pattern rather than a plain heavy impact, so a genuine
 *  error reads distinctly from "you just deleted something on purpose". */
export function hapticError(): void {
  safe(() => Haptics.notification({ type: NotificationType.Error }))
}
