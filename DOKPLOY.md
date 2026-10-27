# Desplegar Factura OCR a Dokploy

L’app és una SPA estàtica: no necessita base de dades ni backend. Dokploy només ha de construir la imatge, servir `dist/` amb nginx i publicar-la sota un domini amb HTTPS.

Al repositori hi ha:

- `Dockerfile` multi-stage: Node 22 construeix la SPA i nginx la serveix.
- `nginx.conf`: capçaleres de seguretat i CSP, caché dels assets, MIME correcte per als `.mjs` de pdf.js i endpoint `/healthz`.
- `.dockerignore`.

La imatge final fa uns **77 MB** i el contenidor escolta al **port 80**.

## 1. Puja el projecte a un repositori Git

Dokploy desplega des de Git (GitHub, GitLab, Gitea, Bitbucket o una URL Git). El repositori ha de contenir com a mínim:

```text
Dockerfile
nginx.conf
package.json
package-lock.json
index.html
src/
public/
vite.config.ts
tsconfig*.json
```

No cal pujar `node_modules/` ni `dist/`; el `Dockerfile` els genera dins la imatge.

Si encara no tens repositori:

```bash
git init
git add .
git commit -m "Factura OCR"
git branch -M main
git remote add origin git@github.com:el-teu-usuari/factura-ocr.git
git push -u origin main
```

## 2. Crea l’aplicació a Dokploy

1. Entra a Dokploy i crea un **Project** (o usa’n un d’existent).
2. Dins del projecte, crea una **Application**.
3. A la pestanya **General**:
   - **Source**: el teu proveïdor Git i el repositori.
   - **Branch**: `main`.
   - **Build Type**: **Dockerfile**.
   - **Dockerfile Path**: `Dockerfile`.
   - **Docker Context Path**: `.`.
   - **Docker Build Stage**: deixa-ho buit (s’usa l’última etapa, `runtime`).
   - **Auto Deploy**: activa’l si vols desplegar a cada push.
4. A **Environment** no cal cap variable. No hi ha secrets ni API keys.
5. Fes clic a **Deploy** i espera que acabi el build.

Si el repositori és privat, configura abans el proveïdor Git o una deploy key a Dokploy.

## 3. Configura el domini i HTTPS

A la pestanya **Domains** de l’aplicació:

- **Host**: `factura.el-teu-domini.com`
- **Path**: `/`
- **Internal Path**: buit
- **Strip Path**: desactivat
- **Container Port**: `80`
- **HTTPS**: activat
- **Certificate**: `letsencrypt`

Al DNS del domini, crea un registre `A` (o `AAAA` si el servidor té IPv6) apuntant a la IP de Dokploy. Si utilitzes un subdomini, també pots fer un `CNAME`.

Assegura’t que els ports **80** i **443** del servidor són accessibles des d’internet. Dokploy/Traefik s’encarrega del certificat i de la redirecció a HTTPS.

> Si uses Cloudflare amb el proxy actiu, la validació HTTP-01 de Let’s Encrypt pot fallar segons la configuració. Consulta la guia de Cloudflare de Dokploy o posa el registre en mode **DNS only** durant la primera emissió del certificat.

## 4. Comprova el desplegament

- Obre `https://factura.el-teu-domini.com`.
- Comprova `https://factura.el-teu-domini.com/healthz`: ha de retornar `ok`.
- La primera vegada que processis un document, el navegador baixarà el model OCR (~31 MB) de Hugging Face i els binaris d’ONNX Runtime de jsDelivr. El servidor de Dokploy **no** intervé en aquestes descàrregues: les fa el navegador del client.
- Prova una imatge i un PDF. Si l’app carrega però l’OCR falla, mira la consola del navegador: normalment serà un bloqueig de xarxa/CSP o un proxy corporatiu que no deixa accedir a `huggingface.co` o `cdn.jsdelivr.net`.

## Alternativa sense Dockerfile: Nixpacks + Publish Directory

Si prefereixes no mantenir un `Dockerfile`, Dokploy també pot construir una SPA amb **Nixpacks**:

1. **Build Type**: `Nixpacks`.
2. A **Environment**, afegeix:
   ```text
   NIXPACKS_INSTALL_CMD=npm ci
   NIXPACKS_BUILD_CMD=npm run build
   ```
3. **Publish Directory**: `dist`.
4. **Container Port** del domini: `80`.

Dokploy farà servir la seva imatge nginx optimitzada. És més simple, però **perds** el `nginx.conf` propi: capçaleres de seguretat, CSP, caché llarga dels assets, MIME forçat per `.mjs` i `/healthz`. Per a producció, recomano el Dockerfile.

També existeix el **Build Type: Static**, però serveix directament el contingut d’un directori del repositori; com que `dist/` està al `.gitignore`, no és adequat llevat que canviïs el flux per publicar la build.

## Actualitzacions i rollback

- **Auto Deploy** desplega a cada push a la branca configurada.
- Sense auto deploy: **Deploy** manual des de Dokploy.
- Per tornar enrere: **Deployments** → tria un desplegament anterior → **Rollback**.
- Els logs del build i del contenidor són a **Deployments** i **Logs**.

Gràcies al `Dockerfile`, les capes de `npm ci` queden en caché si no canvien `package.json` ni `package-lock.json`.

## Notes de producció

- **No hi ha dades al servidor**. L’historial viu a IndexedDB del navegador de cada usuari. Si es neteja el navegador, es perd; per això hi ha exportació JSON/CSV. No cal volum persistent ni backup de base de dades.
- **No cal escalar** per dades: qualsevol rèplica serveix els mateixos fitxers estàtics.
- **HTTPS és necessari** per a la càmera, la Cache API i WebGPU. El certificat de Dokploy ho cobreix.
- **Subdomini**: no cal tocar res. **Subdirectori** (`https://domini.com/ocr`): configura `base: '/ocr/'` a `vite.config.ts` i torna a desplegar; si no, els assets es demanaran a l’arrel del domini.
- **CSP**: el `nginx.conf` permet Hugging Face, `*.hf.co`, jsDelivr, `blob:` i `wasm-unsafe-eval`. Si afegeixes analítiques, fonts o una altra API, actualitza la capçalera `Content-Security-Policy`.
- **Model offline**: els pesos no s’inclouen a la imatge. Si els usuaris no poden accedir a Hugging Face, cal autoallotjar els pesos i els binaris d’ONNX Runtime i ajustar les URLs de `runonweb` (o afegir un proxy). Això ja és una feina a part.
- **Memòria del build**: Vite necessita uns quants centenars de MB. Si el build falla per OOM, apuja la memòria del servidor o del build de Dokploy.
- **Capçaleres HSTS**: les pot afegir Traefik o el proxy; no les posis al contenidor si també el proves en HTTP local.

## Prova local del Docker

```bash
docker build -t factura-ocr .
docker run --rm -p 8080:80 factura-ocr
```

Obre `http://localhost:8080`. El contenidor inclou un `HEALTHCHECK` que consulta `/healthz`.
