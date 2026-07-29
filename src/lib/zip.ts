export interface ZipEntry {
  filename: string
  content: string
}

const encoder = new TextEncoder()

export function createZipBlob(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = sanitizeZipPath(entry.filename)
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(entry.content)
    const crc = crc32(data)
    const { dosTime, dosDate } = dosDateTime(new Date())

    const local = concat(
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      data,
    )
    localParts.push(local)

    centralParts.push(concat(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(name.endsWith('.sh') ? 0x81ed0000 : 0x81a40000),
      u32(offset),
      nameBytes,
    ))
    offset += local.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = concat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  )

  const zipBytes = concat(...localParts, ...centralParts, end)
  return new Blob([toArrayBuffer(zipBytes)], { type: 'application/zip' })
}

function sanitizeZipPath(path: string) {
  return path.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/') || 'file.txt'
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear())
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

function u16(value: number) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, true)
  return out
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array) {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})
