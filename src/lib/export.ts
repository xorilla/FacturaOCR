import type { ExtractedInvoice } from './extract'
import { amountForCsv } from './extract'

export type ExportItem = {
  invoice: ExtractedInvoice
  name: string
}

export function invoiceToJson(invoice: ExtractedInvoice): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...invoice,
    },
    null,
    2,
  )
}

const CSV_HEADERS = [
  'Fitxer',
  'Tipus',
  'Emissor',
  'NIF emissor',
  'Client',
  'NIF client',
  'Número',
  'Data emissió',
  'Venciment',
  'Moneda',
  'Base',
  'IVA',
  'Total',
  'Pagament',
  'Confiança OCR',
  'Avisos',
]

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[";\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function invoicesToCsv(items: ExportItem[]): string {
  const rows = items.map(({ invoice, name }) =>
    [
      csvCell(name),
      csvCell(invoice.kind),
      csvCell(invoice.issuerName.value),
      csvCell(invoice.issuerNif.value),
      csvCell(invoice.customerName.value),
      csvCell(invoice.customerNif.value),
      csvCell(invoice.invoiceNumber.value),
      csvCell(invoice.issueDate.value),
      csvCell(invoice.dueDate.value),
      csvCell(invoice.currency.value),
      csvCell(amountForCsv(invoice.base.value)),
      csvCell(amountForCsv(invoice.vatAmount.value)),
      csvCell(amountForCsv(invoice.total.value)),
      csvCell(invoice.paymentMethod.value),
      csvCell(Math.round(invoice.ocrConfidence * 100)),
      csvCell(invoice.warnings.join(' | ')),
    ].join(';'),
  )

  return `\uFEFF${[CSV_HEADERS.join(';'), ...rows].join('\r\n')}`
}

export function safeFilename(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'factura'
  )
}

export function downloadText(
  content: string,
  filename: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadInvoiceJson(invoice: ExtractedInvoice, name: string): void {
  downloadText(
    invoiceToJson(invoice),
    `${safeFilename(name)}.json`,
    'application/json',
  )
}

export function downloadInvoicesCsv(items: ExportItem[], filename = 'factures'): void {
  downloadText(
    invoicesToCsv(items),
    `${safeFilename(filename)}.csv`,
    'text/csv',
  )
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value)
}
