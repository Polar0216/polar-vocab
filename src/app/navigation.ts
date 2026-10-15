import type { IconName } from '../components/Icon'

export const navigation: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: '首页', icon: 'home' },
  { path: '/inbox', label: '生词箱', icon: 'inbox' },
  { path: '/review', label: '复习', icon: 'review' },
  { path: '/vocabulary', label: '词汇库', icon: 'library' },
  { path: '/settings', label: '设置', icon: 'settings' },
]
