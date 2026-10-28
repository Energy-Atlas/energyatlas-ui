import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist/wght-italic.css'
import '../index.css'
import { ViewerApp } from './ViewerApp.tsx'

// The viewer page (decision 0032, stage 5): a second entry, viewer.html,
// beside the modeller's index.html. It opens frozen handover packages and is
// view only; its server session refuses every model change.

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element in viewer.html')
}

createRoot(root).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
)
