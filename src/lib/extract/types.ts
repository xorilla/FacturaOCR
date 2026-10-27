export type BoundingBox = {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

export type OCRLine = {
  text: string
  score: number
  box: BoundingBox
}

export type PageOCR = {
  page: number
  width: number
  height: number
  text: string
  lines: OCRLine[]
  confidence: number
}

export type Confidence = 'high' | 'medium' | 'low'

export type SourceRef = {
  page: number
  line: number
}

export type FieldValue<T> = {
  value: T | null
  confidence: Confidence
  sources: SourceRef[]
  note?: string
}

export type VatEntry = {
  rate: number | null
  base: number | null
  amount: number | null
  sources: SourceRef[]
}

export type LineItem = {
  description: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  confidence: Confidence
  sources: SourceRef[]
}

export type DocumentKind = 'factura' | 'tiquet' | 'altres'

export type ExtractedInvoice = {
  kind: DocumentKind
  issuerName: FieldValue<string>
  issuerNif: FieldValue<string>
  customerName: FieldValue<string>
  customerNif: FieldValue<string>
  invoiceNumber: FieldValue<string>
  issueDate: FieldValue<string>
  dueDate: FieldValue<string>
  currency: FieldValue<string>
  base: FieldValue<number>
  vatAmount: FieldValue<number>
  total: FieldValue<number>
  vat: VatEntry[]
  paymentMethod: FieldValue<string>
  lineItems: LineItem[]
  warnings: string[]
  rawText: string
  ocrConfidence: number
}

export type FlatLine = OCRLine & {
  page: number
  index: number
  row: number
}

export type Row = {
  index: number
  page: number
  lines: FlatLine[]
  text: string
  centerY: number
  height: number
}

export type RowsResult = {
  lines: FlatLine[]
  rows: Row[]
  medianHeight: number
}

export function emptyField<T>(value: T | null = null): FieldValue<T> {
  return { value, confidence: 'low', sources: [] }
}

export function field<T>(
  value: T | null,
  confidence: Confidence,
  sources: SourceRef[] = [],
  note?: string,
): FieldValue<T> {
  return { value, confidence, sources, ...(note ? { note } : {}) }
}
