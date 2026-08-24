/**
 * Saving a file out of the app.
 *
 * On the web an anchor with `download` is all it takes. Inside Capacitor's
 * Android WebView that same anchor does nothing at all — there is no
 * DownloadListener behind it, so `a.click()` returns cleanly and no file is
 * ever written. The previous build shipped exactly that, which meant "Backup
 * to file" appeared to work on the phone and silently produced nothing.
 *
 * Natively we therefore write through the Filesystem plugin and then hand the
 * file to the share sheet, so the backup both lands somewhere findable on the
 * device and can be sent straight to Telegram/Drive. Every failure is
 * reported back to the caller — a backup that quietly does nothing is the one
 * outcome this app cannot afford.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

export interface SaveResult {
  ok: boolean
  /** Where it ended up, in words a person can act on. */
  where: string
}

/** Directories to try, best (most findable) first. */
const TARGETS: { dir: Directory; label: string }[] = [
  { dir: Directory.Documents, label: 'Documents' },
  { dir: Directory.External, label: 'app storage' },
  { dir: Directory.Cache, label: 'temporary storage' },
]

async function saveNative(
  filename: string,
  content: string,
  share = true,
): Promise<SaveResult> {
  let lastError: unknown = null

  for (const { dir, label } of TARGETS) {
    try {
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: dir,
        encoding: Encoding.UTF8,
        recursive: true,
      })

      // Offer the share sheet as well, so the file can leave the phone
      // immediately. A backup that only exists on the device it is backing up
      // is not much of a backup. Declining the sheet is not a failure.
      // The daily automatic backup passes share=false — a share sheet nobody
      // asked for, appearing once a day, would train you to dismiss it.
      if (share) {
        try {
          const { uri } = await Filesystem.getUri({ path: filename, directory: dir })
          await Share.share({ title: filename, url: uri })
        } catch {
          /* share sheet unavailable or dismissed — the file is still written */
        }
      }

      return { ok: true, where: `${label}/${filename}` }
    } catch (err) {
      lastError = err
    }
  }

  return {
    ok: false,
    where:
      lastError instanceof Error
        ? lastError.message
        : 'could not write the file to storage',
  }
}

function saveWeb(filename: string, content: string, mime: string): SaveResult {
  try {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoking synchronously can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return { ok: true, where: filename }
  } catch (err) {
    return {
      ok: false,
      where: err instanceof Error ? err.message : 'the browser blocked the download',
    }
  }
}

export async function saveFile(
  filename: string,
  content: string,
  mime: string,
): Promise<SaveResult> {
  return Capacitor.isNativePlatform()
    ? saveNative(filename, content)
    : saveWeb(filename, content, mime)
}

/* ==========================================================================
   The daily automatic backup.
   ========================================================================== */

/** What the last automatic attempt did, so Settings can show it. */
export interface AutoBackupState {
  /** YYYY-MM-DD of the last *successful* snapshot. */
  lastDate: string
  /** Where that snapshot landed. */
  where: string
  /** Set only when the most recent attempt failed. */
  error?: string
  /**
   * The last date a copy was actually sent off this phone, YYYY-MM-DD.
   *
   * Tracked separately from `lastDate` because they answer different
   * questions. The daily snapshot proves the books are written down; this
   * proves they exist somewhere the phone's own misfortunes cannot reach.
   * A drawer full of daily snapshots on a stolen phone is not a backup.
   */
  lastOffDevice?: string
  /** Set when the overdue nudge was last dismissed, so it asks again in a
   *  week rather than every single time the app opens. */
  snoozedOn?: string
}

const AUTO_KEY = 'autoBackup'

export function readAutoBackupState(): AutoBackupState | null {
  try {
    const raw = localStorage.getItem(AUTO_KEY)
    return raw ? (JSON.parse(raw) as AutoBackupState) : null
  } catch {
    return null
  }
}

function writeAutoBackupState(s: AutoBackupState): void {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(s))
  } catch {
    /* storage full or blocked — the file itself is what matters */
  }
}

/**
 * Write one snapshot per calendar day, silently.
 *
 * Snapshots are never deleted. Disk is cheap and this is the only copy of a
 * real business's books; a retention rule that trimmed old files would be a
 * rule that could one day delete the last good one.
 *
 * The filename carries the date, so today's file is *rewritten* rather than
 * duplicated each time this runs. That is deliberate: writing once and then
 * skipping the rest of the day would freeze the snapshot at whatever the books
 * looked like at breakfast, and a day's entries are exactly what a backup is
 * meant to protect. Rewriting one small file hourly is the cheaper mistake.
 * Yesterday's file is never touched again.
 *
 * Only runs on the device. In a browser there is nowhere to silently write to,
 * and firing the download bar once a day would be worse than doing nothing.
 */
export async function runDailyBackup(db: unknown, today: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  const prev = readAutoBackupState()

  const result = await saveNative(
    `kaithwas-auto-${today}.json`,
    JSON.stringify(db),
    false,
  )

  if (result.ok) {
    writeAutoBackupState({ lastDate: today, where: result.where })
  } else {
    writeAutoBackupState({
      lastDate: prev?.lastDate ?? '',
      where: prev?.where ?? '',
      error: result.where,
    })
  }
}


/** How many days of books are at risk — the gap since a copy last left the
 *  phone. `undefined` means one never has, which is the worst case and is
 *  deliberately not reported as zero. */
export function daysSinceOffDevice(today: string): number | undefined {
  const last = readAutoBackupState()?.lastOffDevice
  if (!last) return undefined
  const a = new Date(last + 'T12:00').getTime()
  const b = new Date(today + 'T12:00').getTime()
  if (!isFinite(a) || !isFinite(b)) return undefined
  return Math.max(0, Math.round((b - a) / 86400000))
}

/** A week is the most books anyone should be willing to retype. */
const OFF_DEVICE_GRACE = 7

/** Whether to raise the nudge: overdue, and not already waved away this week. */
export function offDeviceOverdue(today: string): boolean {
  const state = readAutoBackupState()
  if (!state) return false
  const snoozed = state.snoozedOn
  if (snoozed) {
    const days = Math.round(
      (new Date(today + 'T12:00').getTime() - new Date(snoozed + 'T12:00').getTime()) / 86400000,
    )
    if (isFinite(days) && days < OFF_DEVICE_GRACE) return false
  }
  const since = daysSinceOffDevice(today)
  return since === undefined || since >= OFF_DEVICE_GRACE
}

export function snoozeOffDeviceNudge(today: string): void {
  const state = readAutoBackupState()
  writeAutoBackupState({ ...(state ?? { lastDate: '', where: '' }), snoozedOn: today })
}

/**
 * Write a snapshot and hand it straight to the share sheet, so a copy can go
 * to WhatsApp, Drive, or anywhere else off this phone in one action.
 *
 * The date is recorded only when the whole thing succeeds. The share sheet
 * being dismissed rejects, and that has to count as "not sent" — marking it
 * done on a cancelled share would be the app reassuring itself, which is the
 * one thing a backup feature must never do.
 */
export async function sendBackupOffDevice(db: unknown, today: string): Promise<SaveResult> {
  const result = await saveFile(`kaithwas-${today}.json`, JSON.stringify(db), "application/json")
  if (result.ok) {
    const state = readAutoBackupState()
    writeAutoBackupState({
      ...(state ?? { lastDate: '', where: '' }),
      lastOffDevice: today,
      snoozedOn: undefined,
    })
  }
  return result
}
