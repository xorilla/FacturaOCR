# Factura OCR

Mini app per extreure dades de factures i tiquets amb **OCR local al navegador**. Puja una imatge o un PDF, revisa els camps detectats i exporta **JSON** o **CSV**. Els fitxers no s’envien a cap servidor.

Construïda amb **Vue 3 + Vite + TypeScript**, [`runonweb/ocr`](https://github.com/midudev/runonweb.ai) (PP-OCRv6 de PaddleOCR) i `pdfjs-dist`.

## Funcions

- Imatges (JPG, PNG, WebP, HEIC si el navegador ho suporta) i PDF multipàgina.
- Càmera del mòbil, drag & drop i enganxar una captura amb `Ctrl+V`.
- OCR amb **WebGPU** quan està disponible i fallback automàtic a **WASM**.
- Extracció de:
  - tipus de document (factura, tiquet, altres)
  - emissor i NIF/CIF, client i NIF/CIF
  - número de factura, data d’emissió i venciment
  - base imposable, quota d’IVA, desglossament per tipus i total
  - forma de pagament i moneda
  - línies de detall (orientatives)
- Validació de **DNI, NIE i CIF** i comprovació `base + IVA ≈ total`.
- Confiança per camp (alta / mitjana / baixa) i avisos d’incoherències.
- Previsualització amb les caixes OCR; en enfocar un camp s’il·lumina la línia d’origen.
- Rotació de pàgina i re-processament amb una altra qualitat o resolució.
- Historial local a **IndexedDB** amb miniatures i cerca.
- Exportació JSON completa i CSV (separador `;`, coma decimal i BOM per Excel).

## Posada en marxa

Requisits: Node.js 20.19+ o 22.12+ i un navegador modern.

```bash
npm install
npm run dev
```

Obre l’URL que mostra Vite. La primera vegada que processis un document, el navegador descarregarà el model OCR (~31 MB amb `small`). Les vegades següents queda a la **Cache API** del navegador.

Altres ordres:

```bash
npm test          # tests d'extracció amb Vitest
npm run build     # comprova tipus i genera dist/
npm run preview   # serveix la build de producció
```

## Com funciona

1. **Preprocessat** (`src/lib/image.ts`): orientació EXIF, escalat a un màxim de píxels, rotació opcional i contrast opcional.
2. **PDF** (`src/lib/pdf.ts`): `pdfjs-dist` rasteritza cada pàgina a una imatge; després es passa pel mateix pipeline.
3. **OCR** (`src/composables/useOcr.ts`): una única instància de `OCR` de `runonweb/ocr`, reutilitzada entre documents. El model es carrega sota demanda amb `import()` dinàmic.
4. **Extracció** (`src/lib/extract/`):
   - normalitza text i imports (`1.234,56`, `1,234.56`, `(12,34)`…)
   - agrupa les línies OCR en files per coordenada `y`
   - associa etiquetes i valors dins la mateixa fila o a la fila de dalt
   - puntua candidats per etiqueta, posició, moneda i decimals
   - valida NIF/CIF i quadra base + IVA amb el total
5. **Formulari** (`src/components/InvoiceForm.vue`): tots els camps són editables; els canvis es poden desar a l’historial.
6. **Exportació** (`src/lib/export.ts`): JSON complet o CSV amb una fila per document.

## Models i privacitat

- El processament és **100% local**: ni les imatges ni el text surten del navegador.
- La primera càrrega baixa els pesos del model de **Hugging Face** i els binaris WASM d’ONNX Runtime de **jsDelivr**. Això vol dir que cal xarxa la primera vegada i que aquests dominis han d’estar permesos si tens una CSP o un proxy corporatiu.
- El model `small` (~31 MB) és el valor per defecte. També pots triar `tiny` (~6 MB) o `medium` (~139 MB) a la configuració.
- L’app desa a IndexedDB la miniatura, les dades extretes i el text OCR. **No desa el fitxer original**: després de recarregar, un document de l’historial es pot consultar i exportar, però no re-processar ni girar.
- Els tests automàtics no fan cap crida de xarxa.

### CSP orientativa

Si serveixes l’app amb una Content Security Policy estricta, necessitaràs com a mínim:

```text
default-src 'self';
connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net;
script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net;
worker-src 'self' blob:;
img-src 'self' blob: data:;
style-src 'self' 'unsafe-inline';
```

Ajusta-ho segons el teu proveïdor i comprova-ho amb la consola del navegador.

## Desplegament

`npm run build` genera una SPA estàtica a `dist/`. Es pot publicar a qualsevol hosting estàtic (Cloudflare Pages, Netlify, Vercel, GitHub Pages…). Cal **HTTPS** o `localhost` perquè funcionin la càmera, la Cache API i, si hi és, WebGPU.

### Docker

El repositori inclou `Dockerfile`, `nginx.conf` i `.dockerignore`:

```bash
docker build -t factura-ocr .
docker run --rm -p 8080:80 factura-ocr
```

Obre `http://localhost:8080`. La imatge final fa uns 77 MB, escolta al port 80 i inclou `HEALTHCHECK` a `/healthz`.

### Dokploy

Hi ha una guia pas a pas a [`DOKPLOY.md`](./DOKPLOY.md). Resum: puja el repo a Git, crea una **Application** amb **Build Type: Dockerfile**, `Dockerfile` + context `.`, domini amb **Container Port 80** i HTTPS Let's Encrypt. No cal cap variable d'entorn.

El `vite.config.ts` elimina del bundle el `.wasm` d’ONNX Runtime que `runonweb` carrega des de jsDelivr; d’aquesta manera `dist/` passa d’uns 30 MB a uns 2,4 MB. Si vols una app **offline de veritat**, hauries d’autoallotjar els pesos del model i els binaris WASM i afegir un service worker.

## Estructura

```text
src/
  App.vue                     # pantalla principal, cua, historial, exportació
  components/
    DocumentDropzone.vue      # drag & drop, càmera, fitxers
    DocumentPreview.vue       # imatge + caixes OCR
    InvoiceForm.vue           # formularis i camps editables
    LineItemsTable.vue
    WarningsPanel.vue
    HistoryList.vue
    SettingsPanel.vue
  composables/
    useOcr.ts                 # cicle de vida del model OCR
    useDocuments.ts           # cua, processament, rotació, historial
  lib/
    image.ts                  # preprocessat i miniatures
    pdf.ts                    # PDF → imatges
    export.ts                 # JSON / CSV
    storage.ts                # IndexedDB
    extract/
      normalize.ts            # imports, dates, NIF/CIF
      rows.ts                 # agrupació de línies per files
      fields.ts               # extractors i validacions
      types.ts
      __tests__/
```

## Límits coneguts

- L’OCR no és perfecte: tiquets tèrmics, fotos mogudes, lletra manuscrita o columnes molt juntes poden empitjorar la lectura. Prova `medium`, apuja la resolució o activa el contrast.
- Les **línies de detall** són orientatives; l’OCR pot barrejar columnes. Els camps de capçalera i els imports són la font principal.
- Els NIF/CIF es validen amb l’algoritme espanyol; factures d’altres països poden necessitar ajustos.
- Si gires una pàgina i la lectura empitjora, l’app conserva les dades financeres anteriors i t’avisa. Torna a girar-la fins que el text quedi horitzontal.
- No és una eina de compliment fiscal: valida sempre les dades abans de presentar-les.

## Llicències

- Codi de l’app: el que decideixis tu.
- `runonweb`: MIT.
- Model PP-OCRv6: Apache-2.0 (PaddlePaddle). Els pesos no s’inclouen al repositori; es descarreguen del Hugging Face Hub.
- `pdfjs-dist`: Apache-2.0.
