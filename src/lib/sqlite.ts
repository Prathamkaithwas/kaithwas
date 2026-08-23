/**
 * Minimal read-only SQLite 3 reader — enough to do a full table scan of an
 * unencrypted database file. Used to read Money Manager `.mmbak` backups in the
 * browser without pulling in a WASM SQLite build.
 *
 * Supports: table b-trees (interior + leaf), record decoding for every serial
 * type, overflow pages, and INTEGER PRIMARY KEY rowid aliases.
 * Does not support: indexes, WAL frames, encryption, writing.
 */

export type SqlValue = string | number | Uint8Array | null
export type SqlRow = Record<string, SqlValue>

const HEADER = 'SQLite format 3\0'

export function isSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  for (let i = 0; i < 16; i++) {
    if (bytes[i] !== HEADER.charCodeAt(i)) return false
  }
  return true
}

class Reader {
  readonly bytes: Uint8Array
  readonly view: DataView
  readonly pageSize: number
  readonly usable: number

  constructor(bytes: Uint8Array) {
    if (!isSqlite(bytes)) throw new Error('Not a SQLite database file')
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const raw = this.view.getUint16(16)
    // 1 is the escape value for a 65536-byte page
    this.pageSize = raw === 1 ? 65536 : raw
    this.usable = this.pageSize - bytes[20]
  }

  /** 1-based page number → byte offset */
  pageOffset(page: number): number {
    return (page - 1) * this.pageSize
  }
}

function varint(bytes: Uint8Array, pos: number): [number, number] {
  let value = 0
  for (let i = 0; i < 8; i++) {
    const byte = bytes[pos + i]
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return [value, pos + i + 1]
  }
  // 9th byte contributes all 8 bits
  value = value * 256 + bytes[pos + 8]
  return [value, pos + 9]
}

const decoder = new TextDecoder('utf-8')

function decodeRecord(payload: Uint8Array, rowid: number, rowidCol: number): SqlValue[] {
  const [headerSize, afterSize] = varint(payload, 0)
  const serials: number[] = []
  let p = afterSize
  while (p < headerSize) {
    const [type, next] = varint(payload, p)
    serials.push(type)
    p = next
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const out: SqlValue[] = []
  let body = headerSize

  for (let i = 0; i < serials.length; i++) {
    const t = serials[i]
    switch (t) {
      case 0:
        out.push(i === rowidCol ? rowid : null)
        break
      case 1:
        out.push(view.getInt8(body))
        body += 1
        break
      case 2:
        out.push(view.getInt16(body))
        body += 2
        break
      case 3: {
        const v = (payload[body] << 16) | (payload[body + 1] << 8) | payload[body + 2]
        out.push(v & 0x800000 ? v - 0x1000000 : v)
        body += 3
        break
      }
      case 4:
        out.push(view.getInt32(body))
        body += 4
        break
      case 5: {
        const hi = view.getInt16(body)
        const lo = view.getUint32(body + 2)
        out.push(hi * 0x100000000 + lo)
        body += 6
        break
      }
      case 6:
        out.push(Number(view.getBigInt64(body)))
        body += 8
        break
      case 7:
        out.push(view.getFloat64(body))
        body += 8
        break
      case 8:
        out.push(0)
        break
      case 9:
        out.push(1)
        break
      case 10:
      case 11:
        out.push(null)
        break
      default: {
        const len = Math.floor((t - 12) / 2)
        const slice = payload.subarray(body, body + len)
        out.push(t % 2 === 0 ? new Uint8Array(slice) : decoder.decode(slice))
        body += len
        break
      }
    }
  }
  return out
}

/** Reassemble a cell payload that may continue onto overflow pages. */
function readPayload(r: Reader, start: number, total: number): Uint8Array {
  const X = r.usable - 35
  if (total <= X) return r.bytes.subarray(start, start + total)

  const M = Math.floor(((r.usable - 12) * 32) / 255) - 23
  const K = M + ((total - M) % (r.usable - 4))
  const local = K <= X ? K : M

  const out = new Uint8Array(total)
  out.set(r.bytes.subarray(start, start + local), 0)
  let filled = local
  let next = r.view.getUint32(start + local)

  while (next !== 0 && filled < total) {
    const off = r.pageOffset(next)
    const take = Math.min(r.usable - 4, total - filled)
    out.set(r.bytes.subarray(off + 4, off + 4 + take), filled)
    filled += take
    next = r.view.getUint32(off)
  }
  return out
}

/** Walk a table b-tree, collecting [rowid, payload] for every leaf cell. */
function scanTable(r: Reader, page: number, out: [number, Uint8Array][], seen: Set<number>) {
  if (page < 1 || seen.has(page)) return
  seen.add(page)

  const base = r.pageOffset(page)
  // page 1 carries the 100-byte database header before its b-tree header
  const hdr = page === 1 ? base + 100 : base
  const type = r.bytes[hdr]
  const cellCount = r.view.getUint16(hdr + 3)
  const cellArray = hdr + (type === 0x05 || type === 0x02 ? 12 : 8)

  if (type === 0x0d) {
    for (let i = 0; i < cellCount; i++) {
      const cell = base + r.view.getUint16(cellArray + i * 2)
      const [size, afterSize] = varint(r.bytes, cell)
      const [rowid, afterRowid] = varint(r.bytes, afterSize)
      out.push([rowid, readPayload(r, afterRowid, size)])
    }
    return
  }

  if (type === 0x05) {
    for (let i = 0; i < cellCount; i++) {
      const cell = base + r.view.getUint16(cellArray + i * 2)
      scanTable(r, r.view.getUint32(cell), out, seen)
    }
    scanTable(r, r.view.getUint32(hdr + 8), out, seen)
    return
  }
  // index pages hold no table rows
}

/** Column names in declaration order, plus which one aliases the rowid. */
function parseColumns(sql: string): { names: string[]; rowidCol: number } {
  const open = sql.indexOf('(')
  const inner = sql.slice(open + 1, sql.lastIndexOf(')'))

  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)

  const names: string[] = []
  let rowidCol = -1
  const CONSTRAINTS = /^(primary|unique|check|foreign|constraint)\b/i

  for (const part of parts) {
    const def = part.trim()
    if (!def || CONSTRAINTS.test(def)) continue
    const name = def.split(/[\s(]/)[0].replace(/["'`[\]]/g, '')
    if (!name) continue
    if (/\binteger\s+primary\s+key\b/i.test(def)) rowidCol = names.length
    names.push(name)
  }
  return { names, rowidCol }
}

export interface SqliteDb {
  tables: string[]
  /** Full scan of one table. Returns [] for a table that does not exist. */
  all(table: string): SqlRow[]
}

export function openSqlite(bytes: Uint8Array): SqliteDb {
  const r = new Reader(bytes)

  const masterCells: [number, Uint8Array][] = []
  scanTable(r, 1, masterCells, new Set())

  const schema = new Map<string, { root: number; sql: string }>()
  for (const [rowid, payload] of masterCells) {
    // sqlite_master: type, name, tbl_name, rootpage, sql
    const [type, name, , root, sql] = decodeRecord(payload, rowid, -1)
    if (type === 'table' && typeof name === 'string' && typeof root === 'number') {
      schema.set(name, { root, sql: typeof sql === 'string' ? sql : '' })
    }
  }

  return {
    tables: [...schema.keys()],
    all(table) {
      const entry = schema.get(table)
      if (!entry || !entry.sql) return []
      const { names, rowidCol } = parseColumns(entry.sql)
      const cells: [number, Uint8Array][] = []
      scanTable(r, entry.root, cells, new Set())
      return cells.map(([rowid, payload]) => {
        const values = decodeRecord(payload, rowid, rowidCol)
        const row: SqlRow = {}
        names.forEach((n, i) => {
          row[n] = values[i] ?? null
        })
        return row
      })
    },
  }
}
