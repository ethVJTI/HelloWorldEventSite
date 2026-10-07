import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'katex/dist/katex.min.css'
import App from './AppRoot.jsx'

// Auto-heal: ensure stale 'null' view state never traps the user on root
if (typeof window !== 'undefined') {
  try {
    if (localStorage.getItem('pow_view') === 'null' || window.location.pathname === '/' || window.location.pathname === '') {
      localStorage.removeItem('pow_view');
    }
  } catch (_) {}
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
