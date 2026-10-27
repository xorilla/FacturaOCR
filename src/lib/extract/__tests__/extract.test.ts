import { describe, expect, it } from 'vitest'
import type { OCRLine, PageOCR } from '../types'
import { extractInvoice } from '../fields'
import { extractAmountTokens, isValidNif, parseAmount, parseDate } from '../normalize'

function makePage(rows: Array<string | string[]>, page = 0): PageOCR {
  const lines: OCRLine[] = []
  const rowHeight = 30
  const lineHeight = 22
  const top = 20

  rows.forEach((row, rowIndex) => {
    const parts = typeof row === 'string' ? [row] : row
    let x = 20
    for (const text of parts) {
      const width = Math.max(30, text.length * 9)
      const y = top + rowIndex * rowHeight
      lines.push({
        text,
        score: 0.95,
        box: { xmin: x, ymin: y, xmax: x + width, ymax: y + lineHeight },
      })
      x += width + 24
    }
  })

  return {
    page,
    width: 1100,
    height: top + rows.length * rowHeight + 40,
    text: rows.map((row) => (typeof row === 'string' ? row : row.join(' '))).join('\n'),
    lines,
    confidence: 0.94,
  }
}

describe('normalize helpers', () => {
  it('parses Spanish and international amounts', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('1234,56 €')).toBe(1234.56)
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('(12,34)')).toBe(-12.34)
    expect(parseAmount('21%')).toBe(21)
    expect(parseAmount('12/03/2026')).toBeNull()
    expect(extractAmountTokens('Total 1,234.56 USD')).toEqual([
      { raw: '1,234.56', value: 1234.56, index: 6 },
    ])
  })

  it('validates DNI, NIE and CIF', () => {
    expect(isValidNif('12345678Z')).toBe(true)
    expect(isValidNif('X1234567L')).toBe(true)
    expect(isValidNif('B12345674')).toBe(true)
    expect(isValidNif('B12345678')).toBe(false)
  })

  it('parses dates in several formats', () => {
    expect(parseDate('12/03/2026')).toBe('2026-03-12')
    expect(parseDate('2026-03-12')).toBe('2026-03-12')
    expect(parseDate('12 de març de 2026')).toBe('2026-03-12')
    expect(parseDate('12/13/2026')).toBe('2026-12-13')
  })
})

describe('extractInvoice', () => {
  it('extracts a Spanish invoice with VAT breakdown', () => {
    const page = makePage([
      ['FERRETERIA SOLER, S.L.'],
      ['C/ Major, 12'],
      ['NIF: B12345674'],
      ['FACTURA Nº: 2026/0042'],
      ['Fecha: 12/03/2026'],
      ['Cliente: Anna Puig'],
      ['NIF: 12345678Z'],
      ['BASE IMPONIBLE', '100,00'],
      ['IVA 21%', '21,00'],
      ['TOTAL A PAGAR', '121,00'],
    ])

    const invoice = extractInvoice([page])

    expect(invoice.kind).toBe('factura')
    expect(invoice.issuerName.value).toBe('FERRETERIA SOLER, S.L.')
    expect(invoice.issuerNif.value).toBe('B12345674')
    expect(invoice.customerNif.value).toBe('12345678Z')
    expect(invoice.customerName.value).toBe('Anna Puig')
    expect(invoice.invoiceNumber.value).toBe('2026/0042')
    expect(invoice.issueDate.value).toBe('2026-03-12')
    expect(invoice.base.value).toBe(100)
    expect(invoice.vatAmount.value).toBe(21)
    expect(invoice.total.value).toBe(121)
    expect(invoice.vat).toHaveLength(1)
    expect(invoice.vat[0]?.rate).toBe(21)
    expect(invoice.vat[0]?.amount).toBe(21)
    expect(invoice.warnings).not.toContain(
      "Base (100,00) + IVA (21,00) no quadra amb el total (121,00).",
    )
  })

  it('extracts a receipt and its line items', () => {
    const page = makePage([
      ['SUPERMERCAT CENTRAL'],
      ['Carrer Nou, 3'],
      ['NIF: B87654323'],
      ['TICKET 20260312-001'],
      ['12/03/2026'],
      ['LLET 2,10'],
      ['PA 1,20'],
      ['TOTAL 3,30'],
      ['EFECTIVO 5,00'],
      ['CAMBIO 1,70'],
    ])

    const invoice = extractInvoice([page])

    expect(invoice.kind).toBe('tiquet')
    expect(invoice.issuerName.value).toBe('SUPERMERCAT CENTRAL')
    expect(invoice.issuerNif.value).toBe('B87654323')
    expect(invoice.invoiceNumber.value).toBe('20260312-001')
    expect(invoice.issueDate.value).toBe('2026-03-12')
    expect(invoice.total.value).toBe(3.3)
    expect(invoice.paymentMethod.value).toBe('Efectiu')
    expect(invoice.lineItems).toHaveLength(2)
    expect(invoice.lineItems.map((item) => item.amount)).toEqual([2.1, 1.2])
  })

  it('handles merged OCR columns and compact labels', () => {
    const page = makePage([
      ['FERRETERIA SOLER, S.L. FACTURA'],
      ['C/Major,12 N:2026/0042'],
      ['08001 Barcelona Fecha:12/03/2026'],
      ['NIF:B12345674 Vencimiento: 11/04/2026'],
      ['cliente', 'Forma de pago'],
      ['Anna Puig', 'Transferencia'],
      ['NIF:12345678Z'],
      ['Baseimponible 100,00 €'],
      ['IVA 21% 21,00 €'],
      ['TOTAL A PAGAR 121,00 €'],
    ])

    const invoice = extractInvoice([page])

    expect(invoice.invoiceNumber.value).toBe('2026/0042')
    expect(invoice.customerName.value).toBe('Anna Puig')
    expect(invoice.customerNif.value).toBe('12345678Z')
    expect(invoice.issueDate.value).toBe('2026-03-12')
    expect(invoice.dueDate.value).toBe('2026-04-11')
    expect(invoice.base.value).toBe(100)
    expect(invoice.total.value).toBe(121)
    expect(invoice.lineItems).toHaveLength(0)
  })

  it('derives the total when only base and VAT are printed', () => {
    const page = makePage([
      ['EMPRESA EXEMPLE SL'],
      ['NIF: B12345674'],
      ['FACTURA 88'],
      ['05/06/2026'],
      ['BASE IMPONIBLE 200,00'],
      ['IVA 21% 42,00'],
    ])

    const invoice = extractInvoice([page])
    expect(invoice.total.value).toBe(242)
    expect(invoice.total.note).toContain('Calculat')
    expect(invoice.warnings.join(' ')).toContain('total no s’ha detectat')
  })

  it('warns when base plus VAT does not match the total', () => {
    const page = makePage([
      ['EMPRESA EXEMPLE SL'],
      ['NIF: B12345674'],
      ['FACTURA 99'],
      ['05/06/2026'],
      ['BASE IMPONIBLE 100,00'],
      ['IVA 21% 21,00'],
      ['TOTAL 130,00'],
    ])

    const invoice = extractInvoice([page])
    expect(invoice.warnings.join(' ')).toContain('no quadra')
  })
})
