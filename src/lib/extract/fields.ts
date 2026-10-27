import type {
  Confidence,
  DocumentKind,
  ExtractedInvoice,
  FieldValue,
  FlatLine,
  LineItem,
  PageOCR,
  RowsResult,
  SourceRef,
  VatEntry,
} from './types'
import { field } from './types'
import {
  cleanText,
  extractAmountTokens,
  extractDateTokens,
  fold,
  formatAmount,
  isValidNif,
  normalizeNif,
  parseAmount,
  parseDate,
} from './normalize'
import { buildRows, rowAbove, rowContextAbove } from './rows'

type Candidate<T> = {
  value: T
  score: number
  sources: SourceRef[]
  note?: string
}

function sourceOf(line: FlatLine): SourceRef {
  return { page: line.page, line: line.index }
}

function confidenceFromScore(score: number): Confidence {
  if (score >= 8) return 'high'
  if (score >= 5) return 'medium'
  return 'low'
}

function best<T>(candidates: Candidate<T>[]): Candidate<T> | null {
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => b.score - a.score)[0] ?? null
}

function valueToField<T>(
  candidate: Candidate<T> | null,
  fallback: T | null = null,
): FieldValue<T> {
  if (!candidate) return field<T>(fallback, 'low')
  return field(candidate.value, confidenceFromScore(candidate.score), candidate.sources, candidate.note)
}

const NAME_EXCLUDE =
  /\b(?:FACTURA|FACTURES|TICKET|TIQUET|RECIBO|REBUT|ALBARAN|ALBARA|PRESUPUESTO|PRESSUPOST|FACTURA SIMPLIFICADA|SIMPLIFICADA|ORDINARIA|RECTIFICATIVA|DUPLICADO|DUPLICAT|COPIA|ORIGINAL|NIF|CIF|DNI|NIE|TEL|TELEFONO|TELEFON|FAX|EMAIL|E-MAIL|WWW|HTTP|C\/|CALLE|CARRER|AVDA|AVENIDA|PLAZA|PLACA|PASEO|RUA|CP|CODIGO POSTAL|CODI POSTAL|FECHA|DATA|NUMERO|NUM|Nº|REF|IBAN|CUENTA|COMPTE|CLIENTE|CLIENT|DESTINATARIO|DESTINATARI|TOTAL|BASE|IVA|IMPORTE|IMPORT|EFECTIVO|EFECTIU|TARJETA|TARGETA|TRANSFERENCIA|TRANSFERENCIA|BANCO|SUCURSAL|DOMICILIO|DOMICILI|MOVIL|MOVIL|PEDIDO|COMANDA|VENCIMIENTO|VENZIMIENTO|PAGO|PAGAMENT|GRACIAS|GRACIES|VUELVA|TORNI|AUTONOMO|EMPRESA|PROVEEDOR|PROVEIDOR)\b/

const ADDRESS_LIKE =
  /\b(?:C\/|CALLE|CARRER|AVDA|AVENIDA|PLAZA|PLACA|PASEO|RUA|CAMINO|CAMI|CP|CODIGO POSTAL|CODI POSTAL|POLIGONO|POLIGON|LOCALIDAD|CIUDAD|BARCELONA|MADRID|VALENCIA|SEVILLA|ZARAGOZA|BILBAO|MALAGA|MURCIA|SALAMANCA|TARRAGONA|GIRONA|LLEIDA)\b/

const LEGAL_SUFFIX =
  /\b(?:S\.?\s?L\.?\s?U?|S\.?\s?A\.?\s?U?|S\.?\s?C\.?\s?C\.?\s?L|S\.?\s?C\.?\s?P|C\.?\s?B|SLL|SLU|SCP|SCCL)\b/

function isNameLike(text: string): boolean {
  const value = cleanText(text)
  if (value.length < 3 || value.length > 70) return false
  const letters = value.replace(/[^A-Za-zÁÉÍÓÚÀÈÒÇÑÜáéíóúàèòçñü]/g, '')
  if (letters.length < 3) return false
  if (NAME_EXCLUDE.test(fold(value))) return false
  if (ADDRESS_LIKE.test(fold(value))) return false
  if (/@|https?:|www\./i.test(value)) return false
  if (parseDate(value)) return false
  if (isValidNif(value)) return false
  if (extractAmountTokens(value).length && letters.length < 6) return false
  const digitCount = (value.match(/\d/g) ?? []).length
  if (digitCount > letters.length) return false
  return true
}

function isLikelyCustomerContext(text: string): boolean {
  return /\b(?:CLIENTE|CLIENT|FACTURAR A|DESTINATARIO|DESTINATARI|RECEPTOR|RECEPTORA|NOMBRE DEL CLIENTE)\b/.test(
    fold(text),
  )
}

const NIF_PATTERN =
  /\b(?:ES)?(?:[A-Z]\s?\d{7}\s?[0-9A-J]|\d{8}\s?[A-Z]|[XYZ]\s?\d{7}\s?[A-Z])\b/gi

function extractNifs(
  result: RowsResult,
  warnings: string[],
): { issuer: FieldValue<string>; customer: FieldValue<string> } {
  const issuerCandidates: Candidate<string>[] = []
  const customerCandidates: Candidate<string>[] = []

  for (const line of result.lines) {
    const row = result.rows[line.row]
    const context = row
      ? rowContextAbove(result.rows, row.index, 2)
      : line.text
    const foldedContext = fold(context)
    const customerContext = isLikelyCustomerContext(foldedContext)
    const nifLabel = /\b(?:NIF|CIF|DNI|NIE)\b/.test(foldedContext)
    const normalizedLine = fold(line.text)

    for (const match of normalizedLine.matchAll(NIF_PATTERN)) {
      const raw = match[0]
      const normalized = normalizeNif(raw)
      const valid = isValidNif(normalized)
      if (!valid && !nifLabel) continue
      if (normalized.length < 8) continue

      let score = valid ? 5 : -3
      if (nifLabel) score += 2
      if (line.page === 0) score += 2
      if (row && row.index < 8) score += 1
      if (/(?:S\.?L|S\.?A|EMPRESA|PROVEEDOR|AUTONOMO)/.test(foldedContext)) score += 1
      if (customerContext) score -= 1
      if (valid && !normalizedLine.includes('NIF')) score += 0.5

      const candidate: Candidate<string> = {
        value: normalized,
        score,
        sources: [sourceOf(line)],
      }
      if (customerContext) customerCandidates.push(candidate)
      else issuerCandidates.push(candidate)
    }
  }

  const issuer = best(
    issuerCandidates.filter((candidate) => candidate.value),
  )
  const customer = best(
    customerCandidates.filter(
      (candidate) => candidate.value !== issuer?.value,
    ),
  )

  if (issuer && !isValidNif(issuer.value)) {
    warnings.push(`El NIF de l'emissor (${issuer.value}) no supera la validació.`)
  }
  if (customer && !isValidNif(customer.value)) {
    warnings.push(`El NIF del client (${customer.value}) no supera la validació.`)
  }

  return {
    issuer: valueToField(issuer),
    customer: valueToField(customer),
  }
}

function extractIssuerName(
  result: RowsResult,
  issuerNif: FieldValue<string>,
): FieldValue<string> {
  const candidates: Candidate<string>[] = []
  const nifLines = new Set(issuerNif.sources.map((source) => source.line))

  for (const line of result.lines) {
    if (line.page !== 0) continue
    const row = result.rows[line.row]
    if (!row || row.index > 14) continue
    const text = cleanText(line.text)
    if (!isNameLike(text)) continue

    const folded = fold(text)
    let score = 0
    if (LEGAL_SUFFIX.test(folded)) score += 5
    if (nifLines.has(line.index)) score += 3
    if (row.index === 0) score += 3
    else if (row.index <= 2) score += 2
    else if (row.index <= 5) score += 1
    if (/[A-ZÁÉÍÓÚÀÈÒÇÑÜ]{3}/.test(text)) score += 1
    if (text.length >= 5 && text.length <= 45) score += 1
    if (/\d/.test(text)) score -= 2
    if (/^[A-ZÁÉÍÓÚÀÈÒÇÑÜ\s.&'-]+$/.test(text)) score += 0.5

    candidates.push({ value: text, score, sources: [sourceOf(line)] })
  }

  const winner = best(candidates)
  if (!winner) return field<string>(null, 'low')

  // Logos are often split over two lines: "FERRETERIA" / "SOLER S.L."
  if (winner.value.length < 18 && !LEGAL_SUFFIX.test(fold(winner.value))) {
    const source = winner.sources[0]
    const line = source ? result.lines[source.line] : undefined
    const row = line ? result.rows[line.row] : undefined
    if (row) {
      const next = result.rows[row.index + 1]
      if (
        next &&
        next.page === row.page &&
        next.index - row.index <= 2 &&
        isNameLike(next.text) &&
        !LEGAL_SUFFIX.test(fold(winner.value)) &&
        next.text.length < 45
      ) {
        winner.value = `${winner.value} ${next.text}`
        winner.sources = [...winner.sources, ...next.lines.map(sourceOf)]
        winner.score += 1
      }
    }
  }

  return valueToField(winner)
}

function extractCustomerName(result: RowsResult): FieldValue<string> {
  const candidates: Candidate<string>[] = []

  for (const row of result.rows) {
    if (!isLikelyCustomerContext(row.text)) continue

    let found = false
    for (const line of row.lines) {
      const folded = fold(line.text)
      const label = folded.match(
        /(?:CLIENTE|CLIENT|FACTURAR A|DESTINATARIO|DESTINATARI|RECEPTOR|NOMBRE DEL CLIENTE)\s*[:#-]?\s*/,
      )
      if (!label) continue
      const index = label.index ?? 0
      const after = cleanText(line.text.slice(index + label[0].length))
      if (after && isNameLike(after)) {
        candidates.push({
          value: after,
          score: 7,
          sources: [sourceOf(line)],
        })
        found = true
        break
      }
    }
    if (found) continue

    const sameRow = row.lines.find((line) => isNameLike(line.text))
    if (sameRow) {
      candidates.push({
        value: cleanText(sameRow.text),
        score: 5,
        sources: [sourceOf(sameRow)],
      })
      continue
    }

    const next = result.rows[row.index + 1]
    if (next && next.page === row.page) {
      const nextLine = next.lines.find((line) => isNameLike(line.text))
      if (nextLine) {
        candidates.push({
          value: cleanText(nextLine.text),
          score: 5,
          sources: [sourceOf(nextLine)],
        })
      }
    }
  }

  return valueToField(best(candidates))
}

function extractInvoiceNumber(result: RowsResult): FieldValue<string> {
  const candidates: Candidate<string>[] = []
  const patterns = [
    /(?:FACTURA|FRA\.?|FACT\.?|TICKET|TIQUET|RECIBO|REBUT|ALBARAN)\s*(?:N[ºO°.]|NUM(?:ERO)?|NÚM(?:ERO)?)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_.-]{1,24})/g,
    /(?:N[ºO°.]|NUM(?:ERO)?|NÚM(?:ERO)?)\s*(?:DE\s+)?(?:FACTURA|TICKET|TIQUET|RECIBO|ALBARAN)?\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9/_.-]{1,24})/g,
    /(?:^|\s)(?:N|NUM(?:ERO)?|N[ºO°.])\s*[:#.\-]\s*([A-Z0-9][A-Z0-9/_.-]{1,24})/g,
  ]

  const consider = (line: FlatLine, raw: string, baseScore: number) => {
    const value = cleanText(raw).replace(/[.,;:]+$/, '')
    if (value.length < 2 || value.length > 25) return
    if (!/\d/.test(value)) return
    if (parseDate(value) || isValidNif(value)) return
    if (
      /^(?:FACTURA|TICKET|TIQUET|SIMPLIFICADA|ORDINARIA|RECTIFICATIVA|ELECTRONICA|DUPLICADO|COPIA|ORIGINAL|FECHA|CLIENTE|TOTAL|BASE|IVA)$/.test(
        fold(value).replace(/[^A-Z]/g, ''),
      )
    ) {
      return
    }

    let score = baseScore
    if (/\b(?:NUMERO|NUM|Nº|NÚM)\b/.test(fold(line.text))) score += 3
    if (/\bFACTURA\b/.test(fold(line.text))) score += 2
    if (/\d/.test(value)) score += 2
    if (/[/_.-]/.test(value)) score += 1
    if (line.page === 0) score += 1
    if (result.rows[line.row]?.index !== undefined && result.rows[line.row]!.index < 8) {
      score += 1
    }

    candidates.push({ value, score, sources: [sourceOf(line)] })
  }

  for (const line of result.lines) {
    const text = fold(line.text)
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = match[1]
        if (!raw) continue
        consider(line, raw, 3)
      }
    }

    const row = result.rows[line.row]
    if (row && /^(?:NUMERO|NUM|Nº|NÚM)\s*(?:DE\s+)?(?:FACTURA|TICKET|TIQUET)?\s*[:#.\-]?$/.test(text)) {
      const next = result.rows[row.index + 1]
      if (next && next.page === row.page) {
        const token = next.text.match(/\b[A-Z0-9][A-Z0-9/_.-]{2,24}\b/)
        if (token) consider(next.lines[0]!, token[0], 5)
      }
    }
  }

  return valueToField(best(candidates))
}

function extractDates(
  result: RowsResult,
  warnings: string[],
): { issue: FieldValue<string>; due: FieldValue<string> } {
  const issueCandidates: Candidate<string>[] = []
  const dueCandidates: Candidate<string>[] = []

  for (const line of result.lines) {
    const context = rowContextAbove(result.rows, line.row, 2)
    const foldedContext = fold(context)
    const dueContext =
      /(?:VENCIMIENTO|VENZIMIENTO|VENCIMENT|VENZIMIENTO|VENCE|VTO|PAGO HASTA|FECHA LIMITE|DATA LIMIT)/.test(
        foldedContext,
      )
    const issueContext =
      /(?:FECHA|DATA|EMISION|EXPEDICION|EXPEDICIO|FECHA FACTURA|FECHA DE LA FACTURA)/.test(
        foldedContext,
      )
    const deliveryContext = /(?:ENTREGA|LLIURAMENT|PERIODO|PERIODE|DESDE|HASTA)/.test(
      foldedContext,
    )

    for (const token of extractDateTokens(line.text)) {
      const row = result.rows[line.row]
      let score = 1
      if (issueContext && !dueContext) score += 5
      if (dueContext) score += 6
      if (deliveryContext && !dueContext) score -= 3
      if (line.page === 0) score += 1
      if (row && row.index < 8) score += 1
      const candidate: Candidate<string> = {
        value: token.iso,
        score,
        sources: [sourceOf(line)],
        ...(issueContext ? {} : { note: 'Data inferida' }),
      }
      if (dueContext) dueCandidates.push(candidate)
      else issueCandidates.push(candidate)
    }
  }

  let issue = best(issueCandidates)
  if (!issue && issueCandidates.length === 0) {
    // No labelled date: use the earliest plausible date on the document.
    const dated = result.lines
      .flatMap((line) => extractDateTokens(line.text).map((token) => ({ line, token })))
      .sort((a, b) => {
        if (a.line.page !== b.line.page) return a.line.page - b.line.page
        return a.line.row - b.line.row
      })
    const first = dated[0]
    if (first) {
      issue = {
        value: first.token.iso,
        score: 3,
        sources: [sourceOf(first.line)],
        note: 'Data inferida',
      }
    }
  }

  const due = best(dueCandidates)

  if (issue) {
    const date = new Date(`${issue.value}T00:00:00Z`)
    const tomorrow = new Date()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    if (date.getTime() > tomorrow.getTime()) {
      warnings.push(`La data d'emissió (${issue.value}) és al futur.`)
    }
  } else {
    warnings.push("No s'ha detectat cap data d'emissió.")
  }

  if (due && issue && due.value < issue.value) {
    warnings.push('La data de venciment és anterior a la data d’emissió.')
  }

  return {
    issue: valueToField(issue),
    due: valueToField(due),
  }
}

type AmountClass = 'total' | 'base' | 'vat' | 'discount' | 'payment' | 'none'

type LabelSpan = {
  index: number
  end: number
  klass: AmountClass
  strength: number
}

function labelSpans(text: string): LabelSpan[] {
  const folded = fold(text)
  const spans: LabelSpan[] = []
  const add = (pattern: RegExp, klass: AmountClass, strength: number) => {
    for (const match of folded.matchAll(pattern)) {
      const index = match.index ?? 0
      spans.push({ index, end: index + match[0].length, klass, strength })
    }
  }

  add(/\bTOTAL\s*(?:A\s*PAGAR|FACTURA|IMPORTE|COMPRA|TICKET|EUR)?/g, 'total', 8)
  add(/\bTOTALAPAGAR\b|\bIMPORTETOTAL\b|\bTOTALFACTURA\b|\bTOTALCOMPRA\b|\bTOTALTICKET\b/g, 'total', 8)
  add(/\bIMPORTE\s*TOTAL\b|\bIMPORT\s*TOTAL\b/g, 'total', 8)
  add(/\bBASE\s*(?:IMPONIBLE|LIQUIDABLE|IMPONIBLE)?/g, 'base', 8)
  add(/\bBASEIMPONIBLE\b|\bBASELIQUIDABLE\b/g, 'base', 8)
  add(/\bSUBTOTAL\b/g, 'base', 5)
  add(/\b(?:CUOTA|QUOTA)\s*(?:DE\s*)?IVA\b|\b(?:CUOTA|QUOTA)IVA\b/g, 'vat', 7)
  add(/\bIVA\s*(?:SOPORTADO|REPERCUTIDO|INCLUIDO)?\b/g, 'vat', 4)
  add(/\bI\.?\s*V\.?\s*A\.?\b/g, 'vat', 4)
  add(/\b(?:DESCUENTO|REBAJA|AHORRO|PROMOCION|OFERTA)\b/g, 'discount', 2)
  add(/\b(?:ENTREGADO|CAMBIO|PAGADO|BIZUM|TRANSFERENCIA)\b/g, 'payment', 1)

  spans.sort((a, b) => a.index - b.index || b.end - a.end)
  const filtered: LabelSpan[] = []
  for (const span of spans) {
    if (filtered.some((other) => span.index < other.end && span.end > other.index)) continue
    filtered.push(span)
  }
  return filtered
}

function classForToken(
  spans: LabelSpan[],
  tokenIndex: number,
): { klass: AmountClass; strength: number } {
  let before: LabelSpan | null = null
  let after: LabelSpan | null = null
  for (const span of spans) {
    if (span.index <= tokenIndex) before = span
    else if (!after) after = span
  }
  const chosen = before ?? after
  return chosen
    ? { klass: chosen.klass, strength: chosen.strength }
    : { klass: 'none', strength: 0 }
}

type AmountCandidate = Candidate<number> & {
  raw: string
  klass: AmountClass
  page: number
  rowIndex: number
  y: number
}

function extractAmounts(
  result: RowsResult,
  pages: PageOCR[],
  warnings: string[],
): {
  base: FieldValue<number>
  vatAmount: FieldValue<number>
  total: FieldValue<number>
  vat: VatEntry[]
} {
  const candidates: AmountCandidate[] = []

  for (const row of result.rows) {
    const tokens = extractAmountTokens(row.text)
    if (!tokens.length) continue

    const ranges: Array<{ line: FlatLine; start: number; end: number }> = []
    let offset = 0
    for (const line of row.lines) {
      const start = offset
      const end = start + line.text.length
      ranges.push({ line, start, end })
      offset = end + 1
    }

    const spans = labelSpans(row.text)
    let inherited: LabelSpan[] = []
    if (!spans.length) {
      const above = rowAbove(result.rows, row.index)
      if (above) inherited = labelSpans(above.text)
    }

    for (const token of tokens) {
      const direct = classForToken(spans, token.index)
      const fallback = classForToken(inherited, 0)
      const klass = direct.klass !== 'none' ? direct.klass : fallback.klass
      const strength =
        direct.klass !== 'none' ? direct.strength : fallback.strength
      if (klass === 'none' || klass === 'discount' || klass === 'payment') continue
      if (token.value <= 0) continue

      const line =
        ranges.find((range) => token.index >= range.start && token.index <= range.end)
          ?.line ?? row.lines[0]
      if (!line) continue

      const page = row.page
      const y = row.centerY
      const lineFolded = fold(row.text)
      const hasCurrency = /[€$£]|\b(?:EUR|USD|GBP)\b/.test(lineFolded)
      const labelOnly = tokens.length === 1
      const pageHeight = pages[page]?.height || 1000
      const yScore = Math.max(0, 2 - (y / pageHeight) * 2)
      let score = strength
      if (hasCurrency) score += 1.5
      if (/[.,]\d{2}/.test(token.raw)) score += 0.5
      if (labelOnly) score += 1
      score += yScore * 0.4
      score += page * 0.4
      if (klass === 'total' && /\b(?:A\s*PAGAR|IMPORTE\s*TOTAL)\b/.test(lineFolded)) {
        score += 1
      }

      candidates.push({
        value: token.value,
        raw: token.raw,
        klass,
        page,
        rowIndex: row.index,
        y,
        score,
        sources: [sourceOf(line)],
      })
    }
  }

  const totalCandidates = candidates.filter(
    (candidate) => candidate.klass === 'total' && candidate.value > 0,
  )
  const baseCandidates = candidates.filter(
    (candidate) => candidate.klass === 'base' && candidate.value > 0,
  )
  const vatCandidates = candidates.filter(
    (candidate) => candidate.klass === 'vat' && candidate.value >= 0,
  )

  let total = best(totalCandidates)
  let base = best(baseCandidates)
  let vatAmount = best(vatCandidates)

  const vatEntries = extractVatEntries(result)
  if (!vatAmount && vatEntries.length) {
    const sum = vatEntries.reduce((value, entry) => value + (entry.amount ?? 0), 0)
    if (sum > 0) {
      const sources = vatEntries.flatMap((entry) => entry.sources)
      vatAmount = {
        value: Number(sum.toFixed(2)),
        score: 5,
        sources,
        note: 'Suma de les quotes d’IVA detectades',
      }
    }
  }

  if (vatEntries.length && vatAmount) {
    const sum = vatEntries.reduce((value, entry) => value + (entry.amount ?? 0), 0)
    if (sum > 0 && Math.abs(sum - vatAmount.value) > 0.02) {
      warnings.push(
        `La suma de les quotes d'IVA (${formatAmount(sum)}) no coincideix amb la quota detectada (${formatAmount(
          vatAmount.value,
        )}).`,
      )
    }
  }

  if (total && base && vatAmount) {
    const expected = Number((base.value + vatAmount.value).toFixed(2))
    if (Math.abs(expected - total.value) > 0.02) {
      warnings.push(
        `Base (${formatAmount(base.value)}) + IVA (${formatAmount(
          vatAmount.value,
        )}) no quadra amb el total (${formatAmount(total.value)}).`,
      )
    }
  }

  if (!total && base && vatAmount) {
    const value = Number((base.value + vatAmount.value).toFixed(2))
    total = {
      value,
      score: 4,
      sources: [...base.sources, ...vatAmount.sources],
      note: 'Calculat a partir de la base i l’IVA',
    }
    warnings.push('El total no s’ha detectat; s’ha calculat a partir de la base i l’IVA.')
  }

  if (!base && total && vatAmount) {
    base = {
      value: Number((total.value - vatAmount.value).toFixed(2)),
      score: 4,
      sources: [...total.sources, ...vatAmount.sources],
      note: 'Calculada a partir del total i l’IVA',
    }
  }

  if (!vatAmount && total && base) {
    vatAmount = {
      value: Number((total.value - base.value).toFixed(2)),
      score: 4,
      sources: [...total.sources, ...base.sources],
      note: 'Calculat a partir del total i la base',
    }
  }

  if (!total && base && vatEntries.length === 1) {
    const rate = vatEntries[0]?.rate
    if (rate !== null && rate !== undefined) {
      const value = Number((base.value * (1 + rate / 100)).toFixed(2))
      total = {
        value,
        score: 3,
        sources: [...base.sources],
        note: 'Calculat amb el tipus d’IVA detectat',
      }
      warnings.push('El total no s’ha detectat; s’ha calculat a partir de la base i el tipus d’IVA.')
    }
  }

  if (total && !base && !vatAmount && vatEntries.length === 1) {
    const rate = vatEntries[0]?.rate
    if (rate !== null && rate !== undefined && rate > 0) {
      const baseValue = Number((total.value / (1 + rate / 100)).toFixed(2))
      base = {
        value: baseValue,
        score: 3,
        sources: [...total.sources],
        note: 'Calculada a partir del total i el tipus d’IVA',
      }
      vatAmount = {
        value: Number((total.value - baseValue).toFixed(2)),
        score: 3,
        sources: [...total.sources],
        note: 'Calculada a partir del total i el tipus d’IVA',
      }
    }
  }

  const singleVat = vatEntries.length === 1 ? vatEntries[0] : undefined
  if (singleVat) {
    if (singleVat.base === null && base) singleVat.base = base.value
    if (
      singleVat.rate === null &&
      singleVat.base !== null &&
      singleVat.base > 0 &&
      singleVat.amount !== null
    ) {
      singleVat.rate = Number(((singleVat.amount / singleVat.base) * 100).toFixed(2))
    }
  }

  if (total && base && total.value < base.value) {
    warnings.push('El total és inferior a la base imposable.')
  }

  const distinctTotals = new Set(
    totalCandidates.map((candidate) => candidate.value.toFixed(2)),
  )
  if (distinctTotals.size > 1) {
    warnings.push("S'han detectat diversos imports que podrien ser el total; revisa'l.")
  }

  return {
    base: valueToField(base),
    vatAmount: valueToField(vatAmount),
    total: valueToField(total),
    vat: vatEntries,
  }
}

function extractVatEntries(result: RowsResult): VatEntry[] {
  const entries: VatEntry[] = []

  for (const row of result.rows) {
    const folded = fold(row.text)
    if (!/\bIVA\b|\bI\.?\s*V\.?\s*A\.?\b/.test(folded)) continue
    const rateMatch = folded.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/)
    const rate = rateMatch ? parseAmount(rateMatch[1] ?? '') : null
    const tokens = extractAmountTokens(row.text)
    if (!rate && !tokens.length) continue

    const spans = labelSpans(row.text)
    let base: number | null = null
    let amount: number | null = null

    for (const token of tokens) {
      const { klass } = classForToken(spans, token.index)
      if (klass === 'base') base = token.value
      else if (klass === 'vat') amount = token.value
    }

    if (amount === null && tokens.length === 1) amount = tokens[0]!.value
    if (base === null && amount === null && tokens.length >= 2) {
      base = tokens[0]!.value
      amount = tokens[tokens.length - 1]!.value
    }
    if (amount === null && tokens.length >= 2) {
      amount = tokens[tokens.length - 1]!.value
    }

    if (base === null && amount === null) continue
    if (rate === 0 && !amount) continue

    const already = entries.find(
      (entry) =>
        entry.rate === rate &&
        entry.base === base &&
        entry.amount === amount,
    )
    if (already || entries.length >= 12) continue

    const sourceLine =
      row.lines.find((line) => extractAmountTokens(line.text).length > 0) ??
      row.lines[0]
    if (!sourceLine) continue

    entries.push({
      rate,
      base,
      amount,
      sources: [sourceOf(sourceLine)],
    })
  }

  return entries
}

function extractPaymentMethod(result: RowsResult): FieldValue<string> {
  const methods: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bBIZUM\b/, label: 'Bizum' },
    { pattern: /\bTRANSFERENCIA\b|\bTRANSFERENCIA BANCARIA\b/, label: 'Transferència' },
    { pattern: /\bTARJETA\b|\bTARGETA\b|\bVISA\b|\bMASTERCARD\b|\bAMEX\b/, label: 'Targeta' },
    { pattern: /\bEFECTIVO\b|\bMETALICO\b|\bEFECTIU\b/, label: 'Efectiu' },
    { pattern: /\bDOMICILIADO\b|\bDOMICILIACIO\b/, label: 'Domiciliació' },
    { pattern: /\bPAYPAL\b/, label: 'PayPal' },
    { pattern: /\bCHEQUE\b|\bXEC\b/, label: 'Xec' },
  ]
  const candidates: Candidate<string>[] = []

  for (const line of result.lines) {
    const folded = fold(line.text)
    for (const method of methods) {
      if (!method.pattern.test(folded)) continue
      let score = 4
      const context = rowContextAbove(result.rows, line.row, 2)
      if (/\b(?:FORMA DE PAGO|FORMA DE PAGAMENT|PAGO|PAGAMENT|METODO)\b/.test(fold(context))) {
        score += 3
      }
      candidates.push({
        value: method.label,
        score,
        sources: [sourceOf(line)],
      })
    }
  }

  return valueToField(best(candidates))
}

function extractCurrency(result: RowsResult): FieldValue<string> {
  const text = fold(result.lines.map((line) => line.text).join(' '))
  if (/\bEUR\b|€/.test(text)) {
    return field('EUR', 'high')
  }
  if (/\bUSD\b|\$/.test(text)) {
    return field('USD', 'medium')
  }
  if (/\bGBP\b|£/.test(text)) {
    return field('GBP', 'medium')
  }
  return field('EUR', 'low', [], 'Moneda per defecte')
}

function extractKind(result: RowsResult): DocumentKind {
  const text = fold(result.lines.map((line) => line.text).join(' '))
  if (/\bFACTURA\b/.test(text)) return 'factura'
  if (/\bTICKET\b|\bTIQUET\b/.test(text)) return 'tiquet'
  if (/\bBASE IMPONIBLE\b|\bCUOTA IVA\b|\bIVA\b/.test(text)) return 'factura'
  if (result.lines.length > 18) return 'factura'
  return result.lines.length ? 'tiquet' : 'altres'
}

const ITEM_EXCLUDE =
  /\b(?:TOTAL|TOTALAPAGAR|IMPORTETOTAL|IMPORTTOTAL|SUBTOTAL|BASE|BASEIMPONIBLE|BASELIQUIDABLE|IVA|CUOTA|CUOTAIVA|QUOTA|QUOTAIVA|IMPORTE|DESCUENTO|REBAJA|AHORRO|ENTREGADO|CAMBIO|EFECTIVO|TARJETA|TRANSFERENCIA|BIZUM|FACTURA|TICKET|TIQUET|CLIENTE|DESTINATARIO|NIF|CIF|DNI|FECHA|VENCIMIENTO|DIRECCION|TELEFONO|EMAIL|WWW|GRACIAS|VUELVA|OPERACION|CAJERO|TERMINAL|AUTORIZACION)\b/

function quantityFromText(text: string): { quantity: number | null; description: string } {
  const match = cleanText(text).match(
    /^(.*?)(?:\s+)(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:[xX*]|UDS?\.?|UNITATS?)?\s*$/,
  )
  if (!match) return { quantity: null, description: cleanText(text) }
  const quantity = parseAmount(match[2] ?? '')
  if (quantity === null || quantity <= 0 || quantity > 999) {
    return { quantity: null, description: cleanText(text) }
  }
  return {
    quantity,
    description: cleanText(match[1] ?? ''),
  }
}

function extractLineItems(result: RowsResult): LineItem[] {
  const items: LineItem[] = []

  for (const row of result.rows) {
    const folded = fold(row.text)
    if (!folded || ITEM_EXCLUDE.test(folded)) continue
    const tokens = extractAmountTokens(row.text)
    if (!tokens.length) continue

    const first = tokens[0]!
    const before = cleanText(row.text.slice(0, first.index))
    const letters = before.replace(/[^A-Za-zÁÉÍÓÚÀÈÒÇÑÜáéíóúàèòçñü]/g, '')
    if (letters.length < 2) continue

    let description = before
    let quantity: number | null = null
    let unitPrice: number | null = null
    let amount: number | null = null

    if (tokens.length === 1) {
      amount = first.value
      const parsed = quantityFromText(before)
      quantity = parsed.quantity
      description = parsed.description
      if (quantity && quantity > 0) unitPrice = Number((amount / quantity).toFixed(2))
    } else {
      amount = tokens[tokens.length - 1]!.value
      unitPrice = tokens[tokens.length - 2]!.value
      const parsed = quantityFromText(before)
      quantity = parsed.quantity
      description = parsed.description
      if (
        quantity === null &&
        unitPrice &&
        unitPrice > 0 &&
        amount > 0 &&
        Math.abs(amount / unitPrice - Math.round(amount / unitPrice)) < 0.05
      ) {
        quantity = Math.round(amount / unitPrice)
      }
    }

    if (!description || description.length < 2) continue
    if (amount === null || amount <= 0) continue
    const confidence: Confidence =
      tokens.length >= 2 && quantity !== null
        ? 'high'
        : tokens.length >= 2
          ? 'medium'
          : 'low'

    items.push({
      description,
      quantity,
      unitPrice,
      amount,
      confidence,
      sources: row.lines.map(sourceOf),
    })
    if (items.length >= 80) break
  }

  return items
}

function buildRawText(pages: PageOCR[]): string {
  if (pages.length === 1) return pages[0]?.text ?? ''
  return pages
    .map((page) => `--- Pàgina ${page.page + 1} ---\n${page.text}`)
    .join('\n\n')
}

export function extractInvoice(pages: PageOCR[]): ExtractedInvoice {
  const result = buildRows(pages)
  const warnings: string[] = []
  const nifs = extractNifs(result, warnings)
  const dates = extractDates(result, warnings)
  const amounts = extractAmounts(result, pages, warnings)
  const lineItems = extractLineItems(result)
  const issuerName = extractIssuerName(result, nifs.issuer)
  const customerName = extractCustomerName(result)
  const invoiceNumber = extractInvoiceNumber(result)
  const currency = extractCurrency(result)
  const paymentMethod = extractPaymentMethod(result)
  const kind = extractKind(result)

  if (!issuerName.value) warnings.push("No s'ha detectat el nom de l'emissor.")
  if (!nifs.issuer.value) warnings.push("No s'ha detectat cap NIF de l'emissor.")
  if (!invoiceNumber.value) warnings.push("No s'ha detectat el número de factura o tiquet.")
  if (!amounts.total.value) warnings.push("No s'ha detectat el total.")
  if (!lineItems.length) warnings.push("No s'han detectat línies de detall; el formulari continua sent editable.")

  const ocrConfidence =
    pages.length === 0
      ? 0
      : pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length

  if (ocrConfidence > 0 && ocrConfidence < 0.72) {
    warnings.push(
      "La confiança mitjana de l'OCR és baixa; revisa els camps i prova una imatge més nítida o el model mitjà.",
    )
  }

  return {
    kind,
    issuerName,
    issuerNif: nifs.issuer,
    customerName,
    customerNif: nifs.customer,
    invoiceNumber,
    issueDate: dates.issue,
    dueDate: dates.due,
    currency,
    base: amounts.base,
    vatAmount: amounts.vatAmount,
    total: amounts.total,
    vat: amounts.vat,
    paymentMethod,
    lineItems,
    warnings: [...new Set(warnings)],
    rawText: buildRawText(pages),
    ocrConfidence,
  }
}
