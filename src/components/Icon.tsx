import type { SVGProps } from 'react'

export type IconName = 'home' | 'inbox' | 'review' | 'library' | 'settings' | 'arrow' | 'spark' | 'globe' | 'sun' | 'moon' | 'monitor' | 'download' | 'check' | 'leaf'

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-7h6v7" /></>,
  inbox: <><path d="M4 5h16l2 11v4H2v-4L4 5Z" /><path d="M2 15h6l2 3h4l2-3h6" /></>,
  review: <><path d="M20 8a8 8 0 1 0 1 6M20 3v5h-5" /><path d="M12 7v5l3 2" /></>,
  library: <><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 3 15-4 1z" /></>,
  settings: <><path d="m10 3-.6 2.1-2 .9-2-.7-2 3.4L5 10.2v2.3l-1.6 1.4 2 3.4 2-.7 2 .9.6 2.1h4l.6-2.1 2-.9 2 .7 2-3.4-1.6-1.4v-2.3l1.6-1.5-2-3.4-2 .7-2-.9L14 3z" /><circle cx="12" cy="11.3" r="3" /></>,
  arrow: <><path d="M5 12h14m-5-5 5 5-5 5" /></>,
  spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.5 14.1A9 9 0 0 1 9.9 3.5 9 9 0 1 0 20.5 14.1Z" />,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  leaf: <><path d="M20 3c-1 10-2 16-9 16a7 7 0 0 1-7-7C4 5 10 4 20 3Z" /><path d="m4 20 11-11" /></>,
}

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>
}
