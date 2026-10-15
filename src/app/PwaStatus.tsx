import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Icon } from '../components/Icon'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaStatus() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [installError, setInstallError] = useState(false)
  const [workerError, setWorkerError] = useState(false)
  const { offlineReady: [offlineReady, setOfflineReady], needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisterError: () => setWorkerError(true),
  })

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const installed = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', capturePrompt)
    window.addEventListener('appinstalled', installed)
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt)
      window.removeEventListener('appinstalled', installed)
    }
  }, [])

  async function install() {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(null)
    } catch {
      setInstallError(true)
    }
  }

  async function update() {
    try {
      await updateServiceWorker(true)
    } catch {
      setWorkerError(true)
    }
  }

  if (!offlineReady && !needRefresh && !installPrompt && !workerError && !installError) return null

  return <aside className="pwa-notice" aria-label="应用安装与更新">
    <div role="status" className="pwa-message">
      <Icon name={needRefresh ? 'download' : 'check'} />
      <span>{workerError ? '离线外壳注册或更新失败，可联网重试。' : installError ? '安装提示未能打开，可使用浏览器的安装菜单。' : needRefresh ? '发现应用更新。请先保存编辑内容，确认后刷新。' : offlineReady ? '应用已可离线打开，本机词库保存在此浏览器。请定期导出备份。' : '可将 Polar Vocab 安装为独立应用。'}</span>
    </div>
    <div className="pwa-actions">
      {needRefresh && <button className="button button-primary" onClick={() => void update()}>刷新更新</button>}
      {installPrompt && <button className="button button-primary" onClick={() => void install()}>安装应用</button>}
      <button className="button button-quiet" onClick={() => { setOfflineReady(false); setNeedRefresh(false); setInstallPrompt(null); setWorkerError(false); setInstallError(false) }}>稍后</button>
    </div>
  </aside>
}
