import { useEffect } from 'react'
import { useNavigate } from 'react-router'

export const DASHBOARD_SEARCH_ID = 'dashboard-search'

function isTyping(el: EventTarget | null) {
  const n = el as HTMLElement | null
  if (!n) return false
  return n.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName)
}

/** Global shortcuts: ⌘/Ctrl+K palette, `/` search, `n` new monitor (admin), `g d` dashboard. */
export function useGlobalShortcuts({ togglePalette, isAdmin }: { togglePalette: () => void; isAdmin: boolean }) {
  const navigate = useNavigate()
  useEffect(() => {
    let gAt = 0
    const focusSearch = () => document.getElementById(DASHBOARD_SEARCH_ID)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePalette()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return
      if (document.querySelector('[role="dialog"], [role="menu"], [role="alertdialog"]')) return
      const k = e.key
      if (k === '/') {
        e.preventDefault()
        if (document.getElementById(DASHBOARD_SEARCH_ID)) focusSearch()
        else {
          navigate('/dashboard')
          setTimeout(focusSearch, 150)
        }
      } else if (k === 'n' && isAdmin) {
        e.preventDefault()
        navigate('/monitors/new')
      } else if (k === 'g') {
        gAt = Date.now()
      } else if (k === 'd' && Date.now() - gAt < 1000) {
        gAt = 0
        navigate('/dashboard')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, togglePalette, isAdmin])
}
