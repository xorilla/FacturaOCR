const NBSP = /[\u00a0\u202f]/g

/** Collapse whitespace while keeping the original characters for display. */
export function cleanText(value: string): string {
  return value.replace(NBSP, ' ').replace(/\s+/g, ' ').trim()
}

/** Accent-insensitive, uppercase text used for matching. */
export function fold(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

export type AmountToken = {
  raw: string
  value: number
  index: number
}

const STRONG_AMOUNT =
  /(?<![\d.,])(-?\(?\d+(?:[.\s\u00a0]\d{3})*[.,]\d{2}\)?)(?![\d.,%])/g
const US_AMOUNT =
  /(?<![\d.,])(-?\(?\d{1,3}(?:,\d{3})+\.\d{2}\)?)(?![\d.,%])/g
const CURRENCY_AMOUNT =
  /(?<![\d.,])(-?\(?\d+(?:[.\s\u00a0]\d{3})*\)?)\s*(?:€|EUR|USD|GBP|\$|£)/gi

/**
 * Parse a Spanish-formatted amount. Handles `1.234,56`, `1,234.56`,
 * `1234,56`, `(12,34)`, `-12,34` and currency symbols.
 */
export function parseAmount(input: string): number | null {
  if (!input) return null
  let text = cleanText(input)
    .replace(/[€$£]/g, '')
    .replace(/\b(?:EUR|USD|GBP)\b/gi, '')
    .replace(/%/g, '')
    .trim()

  if (!text) return null

  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1).trim()
  }
  if (text.startsWith('-')) {
    negative = true
    text = text.slice(1).trim()
  }
  text = text.replace(/[.,;:]+$/, '')
  if (!/^\d[\d.,]*$/.test(text)) return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let normalized: string

  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(/,/g, '.')
        : text.replace(/,/g, '')
  } else if (lastComma >= 0) {
    const parts = text.split(',')
    if (parts.length > 2) return null
    const decimals = text.length - lastComma - 1
    normalized = decimals === 3 ? text.replace(/,/g, '') : text.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = text.split('.')
    if (parts.length > 2) {
      normalized = text.replace(/\./g, '')
    } else {
      const decimals = text.length - lastDot - 1
      normalized = decimals === 3 ? text.replace('.', '') : text
    }
  } else {
    normalized = text
  }

  const value = Number(normalized)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/** Find amount-looking tokens, including integers followed by a currency symbol. */
export function extractAmountTokens(text: string): AmountToken[] {
  const found = new Map<number, AmountToken>()

  for (const match of text.matchAll(STRONG_AMOUNT)) {
    const raw = match[1] ?? ''
    const value = parseAmount(raw)
    if (value === null) continue
    found.set(match.index ?? 0, { raw, value, index: match.index ?? 0 })
  }

  for (const match of text.matchAll(US_AMOUNT)) {
    const raw = match[1] ?? ''
    const value = parseAmount(raw)
    if (value === null) continue
    const index = match.index ?? 0
    if (![...found.values()].some((token) => Math.abs(token.index - index) < 2)) {
      found.set(index, { raw, value, index })
    }
  }

  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    const raw = match[1] ?? ''
    const value = parseAmount(raw)
    if (value === null) continue
    const index = match.index ?? 0
    if (![...found.values()].some((token) => Math.abs(token.index - index) < 2)) {
      found.set(index, { raw, value, index })
    }
  }

  return [...found.values()].sort((a, b) => a.index - b.index)
}

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function amountForCsv(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return value.toFixed(2).replace('.', ',')
}

const MONTHS: Record<string, number> = {
  GEN: 1,
  ENE: 1,
  JAN: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  APR: 4,
  MAI: 5,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  AUG: 8,
  SET: 9,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DES: 12,
  DIC: 12,
  DEC: 12,
}

export type DateToken = {
  raw: string
  iso: string
  index: number
}

function makeIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`
}

function fullYear(year: number): number {
  if (year >= 100) return year
  return year <= 69 ? 2000 + year : 1900 + year
}

/** Parse a single date string, dd/mm/yyyy by default for ambiguous values. */
export function parseDate(input: string): string | null {
  const text = cleanText(input)

  const iso = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (iso) {
    return makeIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  const numeric = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (numeric) {
    let day = Number(numeric[1])
    let month = Number(numeric[2])
    if (day > 12 && month <= 12) {
      // already day-first
    } else if (month > 12 && day <= 12) {
      const swap = day
      day = month
      month = swap
    }
    return makeIso(fullYear(Number(numeric[3])), month, day)
  }

  const named = fold(text).match(/\b(\d{1,2})\s*(?:DE\s+)?([A-Z]{3,10})\.?\s*(?:DE\s+)?(\d{2,4})\b/)
  if (named) {
    const month = MONTHS[(named[2] ?? '').slice(0, 3)]
    if (month) return makeIso(fullYear(Number(named[3])), month, Number(named[1]))
  }

  return null
}

export function extractDateTokens(text: string): DateToken[] {
  const tokens: DateToken[] = []
  const patterns: RegExp[] = [
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
    /\b\d{1,2}\s*(?:de\s+)?[A-Za-zÁÉÍÓÚáéíóú]{3,10}\.?\s*(?:de\s+)?\d{2,4}\b/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0]
      const iso = parseDate(raw)
      if (!iso) continue
      const index = match.index ?? 0
      if (tokens.some((token) => Math.abs(token.index - index) < 2)) continue
      tokens.push({ raw, iso, index })
    }
  }

  return tokens.sort((a, b) => a.index - b.index)
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

export function normalizeNif(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s.\-]/g, '')
    .replace(/^ES/, '')
}

/** Validate Spanish DNI, NIE and CIF/NIF. */
export function isValidNif(value: string): boolean {
  const nif = normalizeNif(value)
  if (!nif) return false

  if (/^\d{8}[A-Z]$/.test(nif)) {
    return DNI_LETTERS[Number(nif.slice(0, 8)) % 23] === nif[8]
  }

  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) {
    const prefix = { X: '0', Y: '1', Z: '2' }[nif[0] as 'X' | 'Y' | 'Z']
    return DNI_LETTERS[Number(prefix + nif.slice(1, 8)) % 23] === nif[8]
  }

  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) {
    const digits = nif.slice(1, 8)
    let sum = 0
    for (let i = 0; i < digits.length; i += 1) {
      const digit = Number(digits[i])
      if (i % 2 === 1) {
        sum += digit
      } else {
        const doubled = digit * 2
        sum += Math.floor(doubled / 10) + (doubled % 10)
      }
    }
    const control = (10 - (sum % 10)) % 10
    const expectedLetter = 'JABCDEFGHI'[control]
    const actual = nif[8]
    if (/\d/.test(actual)) return Number(actual) === control
    return actual === expectedLetter
  }

  return false
}

export function nifKind(value: string): 'DNI' | 'NIE' | 'CIF' | null {
  const nif = normalizeNif(value)
  if (/^\d{8}[A-Z]$/.test(nif)) return 'DNI'
  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) return 'NIE'
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) return 'CIF'
  return null
}
