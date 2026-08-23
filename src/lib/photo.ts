/**
 * Turn a picked image file into a data URL small enough to live in the
 * database.
 *
 * This matters more here than in most apps. The whole database is persisted as
 * a single JSON blob, and the daily backup writes that same blob to a file —
 * so every byte of every photo is re-serialised on each save and re-written
 * once a day. A phone camera shot is 3-8 MB, and base64 inflates it by a
 * third: two of those on one entry would put ~15 MB through the debounced
 * write on every keystroke of the note field.
 *
 * Scaled to fit 1400px and re-encoded as JPEG, the same photo lands around
 * 150-300 KB, which is legible for a receipt and cheap enough to keep several
 * per entry.
 */
const MAX_EDGE = 1400
const QUALITY = 0.72

export async function fileToPhoto(file: File): Promise<string> {
  // `from-image` applies the EXIF orientation, without which photos taken in
  // portrait come back on their side.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not read that image')
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return canvas.toDataURL('image/jpeg', QUALITY)
}

/**
 * Every photo on an entry, however it was stored.
 *
 * Entries saved before this change carry a single `photo`; newer ones carry
 * `photos`. Reading goes through here so nothing else has to know which.
 */
export function photosOf(tx: { photo?: string; photos?: string[] }): string[] {
  if (tx.photos?.length) return tx.photos
  return tx.photo ? [tx.photo] : []
}

/** True for anything fileToAttachment stored as a PDF rather than a
 *  re-encoded image — that's the one branch downstream code has to render
 *  and share differently. */
export function isPdfDataUrl(url: string): boolean {
  return url.startsWith('data:application/pdf')
}

/**
 * Like fileToPhoto, but also accepts a PDF — a loan's sanction letter or a
 * document's certificate is exactly as likely to be a PDF as a photo of one.
 *
 * A PDF is stored as-is rather than through the downscale-and-reencode path
 * above: there's no canvas to draw a PDF onto, and unlike a phone photo it's
 * usually already a reasonable size (a scanned or exported PDF is typically
 * tens to a few hundred KB, not the multi-megabyte camera shot fileToPhoto
 * exists to shrink).
 */
export async function fileToAttachment(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('Could not read that file'))
      reader.readAsDataURL(file)
    })
  }
  return fileToPhoto(file)
}
