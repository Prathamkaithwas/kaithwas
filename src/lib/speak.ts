import { QueueStrategy, TextToSpeech } from '@capacitor-community/text-to-speech'

/**
 * Reading a saved number out loud, one character at a time.
 *
 * This used to call `window.speechSynthesis` directly, which is why it did
 * nothing on the phone: inside Capacitor's Android WebView that API exists
 * but frequently never speaks and never fires `onend`, so the button latched
 * on "Stop" and every later tap hit the cancel branch instead. The plugin
 * goes to the platform's own TTS engine on Android and falls back to
 * speechSynthesis on the web, so the dev preview and the phone share a path.
 *
 * Each character is its own request rather than one comma-joined string.
 * Commas only *suggest* a pause and the engine decides how long; separate
 * requests with a real gap between them are the actual "slow enough to write
 * it down" the owner asked for, and no single utterance is long enough for
 * Android's engine to truncate.
 */

/** Characters an engine reads unreliably on their own. */
const SPOKEN: Record<string, string> = {
  '0': 'zero',
  '.': 'dot',
  '-': 'dash',
  '/': 'slash',
  '@': 'at',
  '_': 'underscore',
}

function spokenForm(ch: string): string {
  return SPOKEN[ch] ?? ch
}

export type SpeechHandle = { cancel: () => void }

export function speakCharacters(
  value: string,
  { gapMs = 450, rate = 0.9, onEnd }: { gapMs?: number; rate?: number; onEnd?: () => void } = {},
): SpeechHandle {
  const chars = [...value].filter((c) => c.trim() !== '')
  let stopped = false
  let timer: number | undefined

  // Idempotent: whichever of "finished" and "cancelled" happens first wins,
  // so the caller's button state is reset exactly once. The old version
  // leaned on `onend` alone, which never arrived when the engine was a no-op.
  const end = () => {
    if (stopped) return
    stopped = true
    onEnd?.()
  }

  const run = async () => {
    for (const ch of chars) {
      if (stopped) return
      try {
        await TextToSpeech.speak({
          text: spokenForm(ch),
          rate,
          // Queued rather than flushed — flushing is the default and would
          // have each character cut off the one before it.
          queueStrategy: QueueStrategy.Add,
        })
      } catch {
        // No engine, or the user revoked it mid-read. Stop rather than
        // spend a second per remaining character failing silently.
        break
      }
      if (stopped) return
      await new Promise<void>((r) => {
        timer = window.setTimeout(r, gapMs)
      })
    }
    end()
  }
  void run()

  return {
    cancel: () => {
      window.clearTimeout(timer)
      void TextToSpeech.stop().catch(() => {})
      end()
    },
  }
}
