/**
 * Turns assets/source-icon.png into the layers @capacitor/assets expects.
 *
 * The source is a rounded-square badge sitting on a white page. Android's
 * adaptive icons apply their own circle/squircle mask and hide roughly the
 * outer quarter of the layer, so handing it the badge as-is would round an
 * already-rounded corner and clip the artwork. Instead:
 *
 *   icon-only        the badge, trimmed off the white page, corners made
 *                    transparent — used by older launchers that draw the
 *                    icon exactly as given
 *   icon-background  flat brand green
 *   icon-foreground  the badge's *interior* (no corners) scaled so its edges
 *                    fall outside whatever mask the launcher applies, which
 *                    leaves only artwork on green visible
 */
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const SRC = 'assets/source-icon.png'
const GREEN = '#024e46'
const OUT = 1024

const roundedMask = (size, radius) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
  )

await mkdir('assets', { recursive: true })

// 1. drop the white page around the badge
const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer()
const { width: S } = await sharp(trimmed).metadata()
console.log('trimmed badge:', S + 'x' + S)

// 2. icon-only — badge with genuinely transparent corners
await sharp(trimmed)
  .resize(OUT, OUT, { fit: 'fill' })
  .composite([{ input: roundedMask(OUT, Math.round(OUT * 0.225)), blend: 'dest-in' }])
  .png()
  .toFile('assets/icon-only.png')

// 3. background layer. Averaging the badge's own green means the seam where
//    the foreground ends is near-invisible, instead of a flat swatch showing
//    a rectangle against the badge's gradient.
const { channels } = await sharp(trimmed).stats()
const [r, g, b] = channels.map((c) => Math.round(c.mean))
console.log('background green:', `rgb(${r},${g},${b})`)
await sharp({
  create: { width: OUT, height: OUT, channels: 4, background: { r, g, b, alpha: 1 } },
})
  .png()
  .toFile('assets/icon-background.png')

// 4. foreground — the badge's interior only, so no rounded corner is baked in.
//    Full bleed: ic_launcher.xml already insets this layer by 16.7% to hit the
//    adaptive safe zone, so padding it here too would shrink the art twice.
const inset = Math.round(S * 0.08)
const inner = await sharp(trimmed)
  .extract({ left: inset, top: inset, width: S - inset * 2, height: S - inset * 2 })
  .toBuffer()

await sharp(inner).resize(OUT, OUT, { fit: 'fill' }).png().toFile('assets/icon-foreground.png')

// 5. splash — badge centred on brand green, both themes identical
const SPLASH = 2732
const badge = Math.round(SPLASH * 0.22)
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({
    create: { width: SPLASH, height: SPLASH, channels: 4, background: GREEN },
  })
    .composite([
      {
        input: await sharp('assets/icon-only.png').resize(badge, badge).toBuffer(),
        left: Math.round((SPLASH - badge) / 2),
        top: Math.round((SPLASH - badge) / 2),
      },
    ])
    .png()
    .toFile(`assets/${name}`)
}

console.log('wrote icon-only / icon-background / icon-foreground / splash')
