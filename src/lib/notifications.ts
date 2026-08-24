import { LocalNotifications } from '@capacitor/local-notifications'
import type { Habit } from '../types'

/**
 * A habit's reminders live as a plain "HH:mm" list (see Habit.reminders in
 * types.ts). This is what actually turns that list into scheduled Android
 * notifications, using @capacitor/local-notifications.
 *
 * No-ops silently everywhere this can't work — the dev preview in a browser,
 * or a platform without the plugin — rather than throwing, since scheduling a
 * reminder is a nice-to-have alongside saving the habit itself, never a
 * reason to block it.
 */

/** However many reminder slots a single habit can ever occupy, whether or not
 *  it currently uses that many. Cancelling always sweeps this whole range, so
 *  shrinking a habit from 3 reminders to 1 actually clears the two it dropped
 *  instead of leaving them to fire on their own forever. */
const MAX_REMINDER_SLOTS = 8

function available(): boolean {
  // Capacitor's web fallback registers every plugin as an object, but
  // scheduling on it either throws or silently does nothing depending on the
  // browser — checking for the native bridge directly is what actually tells
  // a Capacitor WebView apart from the Vite dev server.
  return typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
}

/** A stable positive int32 from a habit id — Android notification ids are
 *  plain ints, not strings. Combined with a reminder's index in the list so
 *  each of a habit's reminders gets its own id within MAX_REMINDER_SLOTS. */
function baseId(habitId: string): number {
  let h = 0
  for (let i = 0; i < habitId.length; i++) h = (h * 31 + habitId.charCodeAt(i)) >>> 0
  return (h % 1_000_000) * 10
}

function slotIds(habitId: string): number[] {
  const base = baseId(habitId)
  return Array.from({ length: MAX_REMINDER_SLOTS }, (_, i) => base + i)
}

/** Requests notification permission once. Safe to call again later — a
 *  denial the first time doesn't get re-asked until the OS itself allows it
 *  (typically the app settings screen), same as any other permission. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!available()) return false
  try {
    const current = await LocalNotifications.checkPermissions()
    if (current.display === 'granted') return true
    const asked = await LocalNotifications.requestPermissions()
    return asked.display === 'granted'
  } catch {
    return false
  }
}

/** Cancels every reminder slot a habit could ever have used — call this on
 *  delete, or before rescheduling so a shrunk list doesn't leave stragglers. */
export async function cancelHabitReminders(habitId: string): Promise<void> {
  if (!available()) return
  try {
    await LocalNotifications.cancel({ notifications: slotIds(habitId).map((id) => ({ id })) })
  } catch {
    /* nothing scheduled to cancel, or the plugin isn't there — either way, done */
  }
}

/**
 * Cancels whatever this habit had scheduled and reschedules it from
 * `habit.reminders` — the full list, every time, rather than diffing against
 * whatever was there before. A habit's reminders change rarely enough that
 * cancel-and-resend is simpler and cannot drift out of sync with what's
 * actually saved.
 */
export async function syncHabitReminders(
  habit: Pick<Habit, 'id' | 'name' | 'subtitle' | 'reminders'>,
): Promise<void> {
  await cancelHabitReminders(habit.id)
  const times = habit.reminders
  if (!times?.length || !available()) return

  const granted = await ensureNotificationPermission()
  if (!granted) return

  const ids = slotIds(habit.id)
  const notifications = times.slice(0, MAX_REMINDER_SLOTS).map((time, i) => {
    const [hour, minute] = time.split(':').map(Number)
    return {
      id: ids[i],
      title: habit.name,
      body: habit.subtitle || 'Time to log this one in Kaithwas.',
      // isExactMandatory defaults to false — an exact alarm the OS won't
      // grant falls back to an inexact one instead of failing the whole
      // schedule call, and a reminder a few minutes off is still far better
      // than none at all.
      schedule: { on: { hour, minute }, allowWhileIdle: true },
    }
  })

  try {
    await LocalNotifications.schedule({ notifications })
  } catch {
    /* best-effort — the habit itself already saved either way */
  }
}
