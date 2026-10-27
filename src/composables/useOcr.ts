import { ref } from 'vue'
import type {
  OCR as OCRInstance,
  OCRResult,
  OCRSize,
  ProgressInfo,
} from 'runonweb/ocr'

export type OcrStatus = 'idle' | 'loading' | 'ready' | 'reading' | 'error'

let instance: OCRInstance | null = null
let instanceSize: OCRSize | null = null
let loadingPromise: Promise<OCRInstance> | null = null

const status = ref<OcrStatus>('idle')
const progress = ref<number | null>(null)
const message = ref('El model es carregarà al primer document.')
const device = ref<'webgpu' | 'wasm' | null>(null)
const error = ref<string | null>(null)
const loadedSize = ref<OCRSize | null>(null)

function handleProgress(info: ProgressInfo): void {
  if (info.status === 'loading') {
    status.value = 'loading'
    progress.value = 0
    message.value = 'Preparant el model…'
    return
  }
  if (info.status === 'progress') {
    status.value = 'loading'
    progress.value = Math.max(0, Math.min(100, info.progress ?? 0))
    message.value = 'Descarregant el model…'
    return
  }
  if (info.status === 'recognizing') {
    status.value = 'reading'
    progress.value = null
    message.value = 'Reconeixent el text…'
    return
  }
  if (info.status === 'ready') {
    status.value = 'ready'
    progress.value = 100
    message.value = 'Model a punt'
    return
  }
  if (info.status === 'done') {
    status.value = 'ready'
    progress.value = 100
  }
}

function friendlyError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value)
  if (/fetch|network|Failed to load|Could not load/i.test(text)) {
    return 'No s’ha pogut descarregar el model. Comprova la connexió i torna-ho a provar.'
  }
  if (/WebGPU|ORT|ONNX|shader/i.test(text)) {
    return `El model no s’ha pogut inicialitzar (${text}). Prova un altre navegador o recarrega la pàgina.`
  }
  return text || 'Error desconegut en carregar l’OCR.'
}

async function ensure(size: OCRSize): Promise<OCRInstance> {
  if (instance && instanceSize === size) return instance
  if (loadingPromise) {
    const loaded = await loadingPromise
    if (instanceSize === size) return loaded
  }
  if (instance) {
    const previous = instance
    instance = null
    instanceSize = null
    await previous.dispose()
  }

  loadingPromise = (async () => {
    status.value = 'loading'
    progress.value = 0
    message.value = 'Descarregant el model…'
    error.value = null

    const { OCR } = await import('runonweb/ocr')
    const created = new OCR({ size, onProgress: handleProgress })
    await created.load()

    instance = created
    instanceSize = size
    loadedSize.value = size
    const resolved = created.device
    device.value = resolved === 'webgpu' || resolved === 'wasm' ? resolved : null
    status.value = 'ready'
    progress.value = 100
    message.value = 'Model a punt'
    return created
  })()

  try {
    return await loadingPromise
  } catch (value) {
    instance = null
    instanceSize = null
    loadedSize.value = null
    status.value = 'error'
    progress.value = null
    error.value = friendlyError(value)
    message.value = error.value
    throw value
  } finally {
    loadingPromise = null
  }
}

export function useOcr() {
  async function read(blob: Blob, size: OCRSize = 'small'): Promise<OCRResult> {
    const model = await ensure(size)
    status.value = 'reading'
    progress.value = null
    message.value = 'Reconeixent text…'
    error.value = null
    try {
      const result = await model.read(blob)
      status.value = 'ready'
      progress.value = 100
      message.value = 'Model a punt'
      return result
    } catch (value) {
      status.value = 'error'
      error.value = friendlyError(value)
      message.value = error.value
      throw value
    }
  }

  async function dispose(): Promise<void> {
    const current = instance
    instance = null
    instanceSize = null
    loadedSize.value = null
    device.value = null
    status.value = 'idle'
    progress.value = null
    message.value = 'El model es carregarà al primer document.'
    if (current) await current.dispose()
  }

  function resetError(): void {
    error.value = null
    if (status.value === 'error') {
      status.value = instance ? 'ready' : 'idle'
      message.value = instance ? 'Model a punt' : 'El model es carregarà al primer document.'
    }
  }

  return {
    status,
    progress,
    message,
    device,
    error,
    loadedSize,
    read,
    dispose,
    resetError,
  }
}
