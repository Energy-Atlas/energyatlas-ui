import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { BASE_PATH } from './basePath.ts'

const FLEXLAYOUT_STYLESHEET =
  /\/node_modules\/flexlayout-react\/style\/[^/]+\.css$/
const TRAILING_SOURCE_MAP_COMMENT = /\/\*#\s*sourceMappingURL=[^*]*\*\/\s*$/

// flexlayout-react 0.11.0 ends its theme stylesheets with a sourceMappingURL
// comment but ships no .map files, so the dev server logs a failed source map
// load whenever a stylesheet is requested. Load those files without the
// dangling comment; a plugin-provided load skips Vite's source map lookup.
function stripMissingFlexLayoutSourceMaps(): Plugin {
  return {
    name: 'eaui:strip-flexlayout-css-source-maps',
    enforce: 'pre',
    async load(id) {
      const file = (id.split('?')[0] ?? '').replaceAll('\\', '/')
      if (!FLEXLAYOUT_STYLESHEET.test(file)) return null
      const code = await readFile(file, 'utf8')
      return { code: code.replace(TRAILING_SOURCE_MAP_COMMENT, ''), map: null }
    },
  }
}

// MapLibre 6 builds its worker URL from import.meta.url at run time, so the
// bundler never sees the reference and emits nothing; the request then 404s on
// a static host (decision 0017). The worker also imports the package's shared
// chunk, so both files ship beside the MapLibre chunk under their exact names.
const MAPLIBRE_WORKER_FILES = [
  'maplibre-gl-worker.mjs',
  'maplibre-gl-shared.mjs',
]

function emitMapLibreWorker(): Plugin {
  let assetsDir = 'assets'
  return {
    name: 'eaui:emit-maplibre-worker',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir
    },
    async generateBundle() {
      // The package exports "." for import only, so require.resolve cannot take
      // it; its exports map lists "./package.json", which resolves either way.
      const require = createRequire(import.meta.url)
      const packageDist = join(
        dirname(require.resolve('maplibre-gl/package.json')),
        'dist',
      )
      for (const file of MAPLIBRE_WORKER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${assetsDir}/${file}`,
          source: await readFile(join(packageDist, file)),
        })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves a project site from /<repository>/, so a built bundle
  // needs that prefix on its asset URLs (decision 0017). Only the build takes
  // it: the dev server and the Playwright specs that visit "/" stay at the
  // root. `basePath.ts` holds the prefix and its override, so the build, the
  // preview server, and the production spec cannot disagree about it.
  // `vite preview` reports command "serve", so it needs isPreview as well or it
  // would serve the built bundle at "/" while its asset URLs carry the prefix.
  base: command === 'build' || isPreview ? BASE_PATH : '/',
  plugins: [stripMissingFlexLayoutSourceMaps(), emitMapLibreWorker(), react()],
  build: {
    // Two pages (decision 0032, stage 5): the modeller and the view-only
    // viewer, each its own HTML entry beside the other under the base path.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url)),
      },
    },
  },
  optimizeDeps: {
    // Pre-bundling moves maplibre-gl but not its worker module, which then 404s.
    exclude: ['maplibre-gl'],
  },
}))
