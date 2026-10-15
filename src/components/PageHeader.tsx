export function PageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-heading">
    <p className="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p className="page-description">{description}</p>
  </header>
}
