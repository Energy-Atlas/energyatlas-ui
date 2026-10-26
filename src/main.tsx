import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist/wght-italic.css'
import './index.css'
import { App } from './App.tsx'

// Package spikes load only with ?spike=<name>, outside the product bundle path.
const SpikeApp = lazy(() => import('./spikes/SpikeApp.tsx'))
// The component gallery (decision 0027) loads only with ?gallery.
const ComponentGallery = lazy(
  () => import('./app/gallery/ComponentGallery.tsx'),
)
const params = new URLSearchParams(window.location.search)
const spike = params.get('spike')
const gallery = params.has('gallery')

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element in index.html')
}

createRoot(root).render(
  <StrictMode>
    {spike ? (
      <Suspense fallback={<p>Loading spike…</p>}>
        <SpikeApp name={spike} />
      </Suspense>
    ) : gallery ? (
      <Suspense fallback={<p>Loading gallery…</p>}>
        <ComponentGallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
