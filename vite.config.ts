import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * A build stamp, so a running app can say which build it is.
 * Without it every APK reports the same "v1.0.0" and there is no way to tell
 * whether an install actually took.
 */
const BUILD_STAMP = new Date()
  .toLocaleString('en-CA', { year: '2-digit', month: '2-digit', day: '2-digit' })
  .replace(/-/g, '')

/**
 * The version shown in Settings used to be a string typed by hand into
 * App.tsx ("1.7."), completely disconnected from versionName in
 * android/app/build.gradle. The two drifted apart for at least three
 * releases — the on-screen number stayed "1.0" while the installed APK was
 * really 1.2, then later showed "1.7" while nothing had actually shipped
 * that build. Reading it straight out of the Gradle file makes it structurally
 * impossible for the two to disagree again: there is only one number now,
 * and this is where it lives.
 */
const gradlePath = fileURLToPath(
  new URL('android/app/build.gradle', import.meta.url),
)
const gradleSrc = readFileSync(gradlePath, 'utf-8')
const versionMatch = /versionName\s+"([^"]+)"/.exec(gradleSrc)
if (!versionMatch) {
  throw new Error(`Could not read versionName from ${gradlePath}`)
}
const APP_VERSION = versionMatch[1]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5180 },
  define: {
    __BUILD__: JSON.stringify(BUILD_STAMP),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
})
