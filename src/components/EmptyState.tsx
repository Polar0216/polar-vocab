import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function EmptyState({ icon, title, description, children }: { icon: IconName; title: string; description: string; children?: ReactNode }) {
  return <section className="empty-state">
    <div className="empty-icon"><Icon name={icon} /></div>
    <h2>{title}</h2>
    <p>{description}</p>
    {children && <div className="empty-actions">{children}</div>}
  </section>
}
