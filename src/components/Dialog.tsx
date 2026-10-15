import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = ref.current
    element?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const focusable = Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? []).filter((item) => item.offsetParent !== null || typeof item.getClientRects === 'function' && item.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first) { event.preventDefault(); element?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = originalOverflow; previous?.focus() }
  }, [])
  return <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}><div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="button button-quiet" onClick={onClose} aria-label="关闭弹窗">关闭</button></div>{children}</div></div>
}
