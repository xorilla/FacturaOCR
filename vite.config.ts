import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

/**
 * runonweb points ONNX Runtime at the jsDelivr copy of its WASM binaries.
 * onnxruntime-web still references a local .wasm in its bundle, so Vite copies
 * ~30 MB into dist even though it is never requested at runtime. Keep the
 * deployment lean by dropping that unused asset.
 */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'drop-unused-ort-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/(^|\/)ort-wasm.*\.wasm$/.test(fileName)) {
          delete bundle[fileName]
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), dropUnusedOrtWasm()],
})
