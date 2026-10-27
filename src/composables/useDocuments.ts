import { computed, reactive, ref, watch } from 'vue'
import type { ExtractedInvoice, FieldValue, OCRLine, PageOCR } from '../lib/extract'
import { extractInvoice } from '../lib/extract'
import type { OCRSize } from 'runonweb/ocr'
import type { HistoryEntry, HistoryPreview } from '../lib/storage'
import { deleteHistory, listHistory, saveHistory } from '../lib/storage'
import { makeThumbnail, prepareImage } from '../lib/image'
import type { PreparedImage } from '../lib/image'
import { useOcr } from './useOcr'

export type PageView = {
  page: number
  imageUrl: string
  imageBlob: Blob
  sourceBlob: Blob
  ocrBlob: Blob
  width: number
  height: number
  rotation: number
  text: string
  lines: OCRLine[]
  confidence: number
  status: 'pending' | 'processing' | 'done' | 'error'
}

export type DocumentJob = {
  id: string
  name: string
  sourceKind: 'image' | 'pdf'
  sourceFile: File | null
  size: number
  createdAt: number
  status: 'queued' | 'processing' | 'done' | 'error'
  stage: string
  progress: number | null
  error: string | null
  pages: PageView[]
  activePage: number
  invoice: ReturnType<typeof extractInvoice> | null
  saved: boolean
  historyId: string | null
  thumbnail: string
}

export type AppSettings = {
  size: OCRSize
  maxSide: number
  enhance: boolean
  maxPages: number
}

export type Notice = {
  message: string
  type: 'info' | 'success' | 'error'
}

const SETTINGS_KEY = 'factura-ocr:settings'
const DEFAULT_SETTINGS: AppSettings = {
  size: 'small',
  maxSide: 2400,
  enhance: false,
  maxPages: 10,
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      size: parsed.size === 'tiny' || parsed.size === 'medium' ? parsed.size : 'small',
      maxSide:
        typeof parsed.maxSide === 'number' && parsed.maxSide >= 1000
          ? parsed.maxSide
          : DEFAULT_SETTINGS.maxSide,
      enhance: Boolean(parsed.enhance),
      maxPages:
        typeof parsed.maxPages === 'number' && parsed.maxPages >= 1
          ? parsed.maxPages
          : DEFAULT_SETTINGS.maxPages,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

const documents = ref<DocumentJob[]>([])
const selectedId = ref<string | null>(null)
const history = ref<HistoryEntry[]>([])
const notice = ref<Notice | null>(null)
const settings = reactive<AppSettings>(loadSettings())
const queue: string[] = []
const removed = new Set<string>()
const pumping = ref(false)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const { read: ocrRead, status: ocrStatus } = useOcr()

watch(
  settings,
  (value) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
    } catch {
      // Storage can be unavailable in private mode; settings still work in memory.
    }
  },
  { deep: true },
)

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function notify(message: string, type: Notice['type'] = 'info'): void {
  notice.value = { message, type }
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = null
  }, 4800)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function revokePage(page: PageView): void {
  if (page.imageUrl.startsWith('blob:')) URL.revokeObjectURL(page.imageUrl)
}

function clearPages(doc: DocumentJob): void {
  doc.pages.forEach(revokePage)
  doc.pages = []
  doc.activePage = 0
}

function classifyFile(file: File): 'image' | 'pdf' | null {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (
    file.type.startsWith('image/') ||
    /\.(?:jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(file.name)
  ) {
    return 'image'
  }
  return null
}

function addFiles(input: File[] | FileList): number {
  const files = [...input]
  let accepted = 0
  let firstNewId: string | null = null

  for (const file of files) {
    const kind = classifyFile(file)
    if (!kind) {
      notify(`“${file.name}” no és una imatge ni un PDF.`, 'error')
      continue
    }
    if (file.size > 30 * 1024 * 1024) {
      notify(`“${file.name}” és massa gran (màxim 30 MB).`, 'error')
      continue
    }

    const doc: DocumentJob = {
      id: uid(),
      name: file.name || 'document',
      sourceKind: kind,
      sourceFile: file,
      size: file.size,
      createdAt: Date.now(),
      status: 'queued',
      stage: 'A l’espera',
      progress: 0,
      error: null,
      pages: [],
      activePage: 0,
      invoice: null,
      saved: false,
      historyId: null,
      thumbnail: '',
    }
    documents.value.push(doc)
    queue.push(doc.id)
    accepted += 1
    if (!firstNewId) firstNewId = doc.id
  }

  if (firstNewId) selectedId.value = firstNewId
  if (accepted) void pump()
  return accepted
}

async function pump(): Promise<void> {
  if (pumping.value) return
  pumping.value = true
  try {
    while (queue.length) {
      const id = queue.shift()
      if (!id) continue
      const doc = documents.value.find((candidate) => candidate.id === id)
      if (!doc) continue
      await processDoc(doc)
    }
  } finally {
    pumping.value = false
  }
}

function makePageView(
  page: number,
  prepared: PreparedImage,
  sourceBlob: Blob,
): PageView {
  return {
    page,
    imageUrl: prepared.url,
    imageBlob: prepared.blob,
    sourceBlob,
    ocrBlob: prepared.blob,
    width: prepared.width,
    height: prepared.height,
    rotation: prepared.rotation,
    text: '',
    lines: [],
    confidence: 0,
    status: 'pending',
  }
}

function toPageOCR(page: PageView): PageOCR {
  return {
    page: page.page,
    width: page.width,
    height: page.height,
    text: page.text,
    lines: page.lines,
    confidence: page.confidence,
  }
}

function documentErrorMessage(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  if (/image|bitmap|decode|imatge/i.test(text)) {
    return 'No s’ha pogut llegir la imatge. Prova un JPG o PNG, o torna a fer la foto.'
  }
  return text || 'Error processant el document.'
}

async function processDoc(doc: DocumentJob): Promise<void> {
  if (!doc.sourceFile) {
    doc.status = 'error'
    doc.error = 'Aquest document desat no té el fitxer original per tornar-lo a processar.'
    return
  }

  removed.delete(doc.id)
  doc.status = 'processing'
  doc.error = null
  doc.stage = 'Preparant el document…'
  doc.progress = 0
  doc.saved = false
  clearPages(doc)

  try {
    if (doc.sourceKind === 'image') {
      const prepared = await prepareImage(doc.sourceFile, {
        maxSide: settings.maxSide,
        enhance: settings.enhance,
        upscale: true,
      })
      if (removed.has(doc.id)) {
        URL.revokeObjectURL(prepared.url)
        return
      }
      doc.pages.push(makePageView(0, prepared, doc.sourceFile))
      doc.activePage = 0
      doc.progress = 15
    } else {
      doc.stage = 'Convertint el PDF…'
      const { renderPdf } = await import('../lib/pdf')
      const rendered = await renderPdf(doc.sourceFile, {
        maxSide: settings.maxSide,
        maxPages: settings.maxPages,
        onProgress: (page, total) => {
          doc.stage = `Convertint la pàgina ${page} de ${total}…`
          doc.progress = 5 + (page / Math.max(1, total)) * 20
        },
      })
      if (removed.has(doc.id)) return
      if (rendered.truncated) {
        notify(
          `El PDF té ${rendered.totalPages} pàgines; només se n’han processat ${rendered.pages.length}.`,
          'info',
        )
      }
      for (const page of rendered.pages) {
        const prepared = await prepareImage(page.blob, {
          maxSide: settings.maxSide,
          enhance: settings.enhance,
        })
        if (removed.has(doc.id)) {
          URL.revokeObjectURL(prepared.url)
          return
        }
        doc.pages.push(makePageView(page.page, prepared, page.blob))
      }
      doc.activePage = 0
      doc.progress = 25
    }

    if (!doc.pages.length) throw new Error('No hi ha pàgines per processar.')

    doc.stage = 'Reconeixent el text…'
    for (let index = 0; index < doc.pages.length; index += 1) {
      const page = doc.pages[index]
      if (!page) continue
      page.status = 'processing'
      doc.stage = `Reconeixent la pàgina ${index + 1} de ${doc.pages.length}…`
      const result = await ocrRead(page.ocrBlob, settings.size)
      if (removed.has(doc.id)) return
      page.text = result.text
      page.lines = result.lines
      page.confidence = result.confidence
      page.status = 'done'
      doc.progress = 25 + ((index + 1) / doc.pages.length) * 70
    }

    doc.invoice = extractInvoice(doc.pages.map(toPageOCR))
    doc.status = 'done'
    doc.stage = 'Completat'
    doc.progress = 100
    await persistDoc(doc)
    notify(
      doc.saved
        ? `“${doc.name}” s’ha processat correctament.`
        : 'Document processat, però no s’ha pogut desar a l’historial. Exporta’l manualment.',
      doc.saved ? 'success' : 'info',
    )
  } catch (value) {
    if (removed.has(doc.id)) return
    doc.status = 'error'
    doc.stage = 'Error'
    doc.progress = null
    doc.error = documentErrorMessage(value)
    notify(doc.error, 'error')
  }
}

async function persistDoc(doc: DocumentJob): Promise<void> {
  if (!doc.invoice) return
  const active = doc.pages[doc.activePage] ?? doc.pages[0]
  let thumbnail = doc.thumbnail
  if (active?.imageBlob.size) {
    try {
      thumbnail = await makeThumbnail(active.imageBlob)
    } catch {
      // Keep the previous thumbnail if the browser cannot encode one.
    }
  }

  const preview: HistoryPreview | null = active
    ? {
        page: active.page,
        width: active.width,
        height: active.height,
        text: active.text,
        lines: clone(active.lines),
        confidence: active.confidence,
      }
    : null

  const entry: HistoryEntry = {
    id: doc.historyId ?? doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    thumbnail,
    sourceKind: doc.sourceKind,
    invoice: clone(doc.invoice),
    preview,
  }

  try {
    await saveHistory(entry)
    doc.historyId = entry.id
    doc.thumbnail = thumbnail
    doc.saved = true
    await refreshHistory()
  } catch (value) {
    notify(
      `No s’ha pogut desar a l’historial: ${
        value instanceof Error ? value.message : String(value)
      }`,
      'error',
    )
  }
}

async function refreshHistory(): Promise<void> {
  try {
    history.value = await listHistory()
  } catch {
    history.value = []
  }
}

const selected = computed(
  () => documents.value.find((doc) => doc.id === selectedId.value) ?? null,
)

const exportable = computed(() =>
  documents.value
    .filter((doc) => doc.invoice !== null)
    .map((doc) => ({ invoice: doc.invoice!, name: doc.name })),
)

const isBusy = computed(
  () => pumping.value || ocrStatus.value === 'loading' || ocrStatus.value === 'reading',
)

function selectDoc(id: string | null): void {
  selectedId.value = id
}

function selectPage(doc: DocumentJob, index: number): void {
  if (index >= 0 && index < doc.pages.length) doc.activePage = index
}

async function removeDoc(id: string): Promise<void> {
  removed.add(id)
  const index = documents.value.findIndex((doc) => doc.id === id)
  const doc = documents.value[index]
  if (doc) {
    clearPages(doc)
    documents.value.splice(index, 1)
  }
  const queueIndex = queue.indexOf(id)
  if (queueIndex >= 0) queue.splice(queueIndex, 1)
  if (selectedId.value === id) {
    selectedId.value = documents.value[0]?.id ?? null
  }
}

async function reprocessDoc(doc: DocumentJob): Promise<void> {
  if (!doc.sourceFile) {
    notify('Aquest document només existeix a l’historial; no es pot tornar a processar.', 'info')
    return
  }
  doc.invoice = null
  doc.status = 'queued'
  doc.stage = 'A l’espera'
  doc.progress = 0
  queue.push(doc.id)
  void pump()
}

function preserveMissingFields(
  previous: ExtractedInvoice,
  next: ExtractedInvoice,
  preserveFinancial = false,
): ExtractedInvoice {
  const keys = [
    'issuerName',
    'issuerNif',
    'customerName',
    'customerNif',
    'invoiceNumber',
    'issueDate',
    'dueDate',
    'currency',
    'base',
    'vatAmount',
    'total',
    'paymentMethod',
  ] as const
  const previousRecord = previous as unknown as Record<string, FieldValue<unknown>>
  const nextRecord = next as unknown as Record<string, FieldValue<unknown>>

  for (const key of keys) {
    const current = nextRecord[key]
    const old = previousRecord[key]
    if (
      current &&
      old &&
      (current.value === null || current.value === '') &&
      old.value !== null &&
      old.value !== ''
    ) {
      nextRecord[key] = old
    }
  }

  if (preserveFinancial) {
    next.base = previous.base
    next.vatAmount = previous.vatAmount
    next.total = previous.total
    next.vat = previous.vat
    next.lineItems = previous.lineItems
  } else {
    if (!next.vat.length && previous.vat.length) next.vat = previous.vat
    if (!next.lineItems.length && previous.lineItems.length) {
      next.lineItems = previous.lineItems
    }
  }

  next.warnings = [
    ...new Set([
      ...next.warnings,
      'La rotació ha empitjorat la lectura. Es mantenen les dades anteriors; gira la pàgina fins que el text quedi horitzontal o revisa el text OCR.',
    ]),
  ]
  return next
}

async function rotatePage(doc: DocumentJob, delta: number): Promise<void> {
  if (!doc.sourceFile) {
    notify('La rotació només està disponible mentre el fitxer original és obert.', 'info')
    return
  }
  if (isBusy.value) {
    notify('Espera que acabi el processament actual abans de girar la pàgina.', 'info')
    return
  }
  const page = doc.pages[doc.activePage]
  if (!page || !page.sourceBlob.size) return

  const previousInvoice = doc.invoice
  doc.status = 'processing'
  doc.stage = 'Girant la pàgina…'
  try {
    const rotation = (page.rotation + delta + 360) % 360
    const prepared = await prepareImage(page.sourceBlob, {
      maxSide: settings.maxSide,
      rotation,
      enhance: settings.enhance,
      upscale: doc.sourceKind === 'image',
    })
    revokePage(page)
    page.imageUrl = prepared.url
    page.imageBlob = prepared.blob
    page.ocrBlob = prepared.blob
    page.width = prepared.width
    page.height = prepared.height
    page.rotation = prepared.rotation
    page.status = 'processing'
    doc.stage = 'Tornant a reconèixer el text…'
    const result = await ocrRead(page.ocrBlob, settings.size)
    page.text = result.text
    page.lines = result.lines
    page.confidence = result.confidence
    page.status = 'done'
    const nextInvoice = extractInvoice(doc.pages.map(toPageOCR))
    const previousTotal = previousInvoice?.total.value ?? null
    const nextTotal = nextInvoice.total.value
    const lostBreakdown =
      (previousInvoice !== null &&
        previousInvoice.base.value !== null &&
        previousInvoice.base.value > 0 &&
        !nextInvoice.base.value) ||
      (previousInvoice !== null &&
        previousInvoice.vatAmount.value !== null &&
        previousInvoice.vatAmount.value > 0 &&
        !nextInvoice.vatAmount.value)
    const dropped =
      previousTotal !== null &&
      nextTotal !== null &&
      nextTotal < previousTotal * 0.5
    const degraded =
      previousTotal !== null &&
      (nextTotal === null || lostBreakdown || dropped)
    doc.invoice =
      degraded && previousInvoice
        ? preserveMissingFields(previousInvoice, nextInvoice, true)
        : nextInvoice
    doc.status = 'done'
    doc.stage = 'Completat'
    doc.progress = 100
    await persistDoc(doc)
    notify(
      degraded
        ? 'Pàgina girada, però la lectura ha empitjorat: es mantenen les dades anteriors.'
        : 'Pàgina girada i text actualitzat.',
      degraded ? 'info' : 'success',
    )
  } catch (value) {
    doc.status = doc.invoice ? 'done' : 'error'
    doc.stage = doc.invoice ? 'Completat' : 'Error'
    doc.error = documentErrorMessage(value)
    notify(doc.error, 'error')
  }
}

function setActivePageForSources(sources: Array<{ page: number }>): void {
  const doc = selected.value
  if (!doc || !sources.length) return
  const page = sources[0]?.page
  if (page === undefined) return
  const index = doc.pages.findIndex((candidate) => candidate.page === page)
  if (index >= 0) doc.activePage = index
}

function openHistory(entry: HistoryEntry): void {
  const existing = documents.value.find(
    (doc) => doc.historyId === entry.id || doc.id === entry.id,
  )
  if (existing) {
    selectedId.value = existing.id
    return
  }

  const preview = entry.preview
  const page: PageView | null = preview
    ? {
        page: preview.page,
        imageUrl: entry.thumbnail,
        imageBlob: new Blob(),
        sourceBlob: new Blob(),
        ocrBlob: new Blob(),
        width: preview.width,
        height: preview.height,
        rotation: 0,
        text: preview.text,
        lines: clone(preview.lines),
        confidence: preview.confidence,
        status: 'done',
      }
    : null

  const doc: DocumentJob = {
    id: entry.id,
    name: entry.name,
    sourceKind: entry.sourceKind,
    sourceFile: null,
    size: 0,
    createdAt: entry.createdAt,
    status: 'done',
    stage: 'Desat a l’historial',
    progress: 100,
    error: null,
    pages: page ? [page] : [],
    activePage: 0,
    invoice: clone(entry.invoice),
    saved: true,
    historyId: entry.id,
    thumbnail: entry.thumbnail,
  }

  documents.value.push(doc)
  selectedId.value = doc.id
}

async function removeHistoryEntry(id: string): Promise<void> {
  await deleteHistory(id)
  history.value = history.value.filter((entry) => entry.id !== id)
  const open = documents.value.find((doc) => doc.historyId === id)
  if (open && !open.sourceFile) {
    open.saved = false
    open.historyId = null
    open.stage = 'Sense desar'
  }
}

async function saveCurrent(doc: DocumentJob): Promise<void> {
  if (!doc.invoice) {
    notify('Encara no hi ha dades per desar.', 'info')
    return
  }
  await persistDoc(doc)
  notify(
    doc.saved ? 'Canvis desats a l’historial.' : 'No s’ha pogut desar a l’historial.',
    doc.saved ? 'success' : 'error',
  )
}

function resetSettings(): void {
  Object.assign(settings, DEFAULT_SETTINGS)
}

export function useDocuments() {
  return {
    documents,
    selected,
    selectedId,
    history,
    notice,
    settings,
    exportable,
    isBusy,
    ocrStatus,
    addFiles,
    selectDoc,
    selectPage,
    removeDoc,
    reprocessDoc,
    rotatePage,
    openHistory,
    removeHistoryEntry,
    refreshHistory,
    saveCurrent,
    setActivePageForSources,
    resetSettings,
    notify,
  }
}
