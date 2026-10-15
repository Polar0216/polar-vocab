import { useEffect, useMemo, useState } from 'react'
import { useTheme, type ThemePreference } from '../../app/theme-context'
import { useVocabulary, errorMessage } from '../../app/vocabulary-context'
import { Icon, type IconName } from '../../components/Icon'
import { PageHeader } from '../../components/PageHeader'
import { Feedback } from '../../components/Feedback'
import { Dialog } from '../../components/Dialog'
import { datedFilename, downloadBlob } from '../../components/download'
import { LocalBackupService } from '../import-export/backup-service'
import { exportVocabularyCsv } from '../import-export/export-service'
import type { Language } from '../../domain'
import { LearningSettings } from '../review/LearningSettings'
import { SyncSettings } from '../sync/SyncSettings'

const themes: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
]

export function SettingsPage() {
  const { preference, setPreference } = useTheme()
  const { service, settings, stats, ready, version, defaultLanguage } = useVocabulary()
  const backupService = useMemo(() => new LocalBackupService(service), [service])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [exportLanguage, setExportLanguage] = useState('all')
  const [restorePreview, setRestorePreview] = useState<Awaited<ReturnType<LocalBackupService['preview']>> | null>(null)
  const [clearPreview, setClearPreview] = useState<Awaited<ReturnType<LocalBackupService['prepareClear']>> | null>(null)
  const [backupDownloaded, setBackupDownloaded] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [clearText, setClearText] = useState('')

  useEffect(() => {
    if (!navigator.storage) return
    let active = true
    void navigator.storage.estimate?.().then((value) => { if (active) setStorageEstimate(value) }).catch(() => undefined)
    void navigator.storage.persisted?.().then((value) => { if (active) setPersistent(value) }).catch(() => undefined)
    return () => { active = false }
  }, [version])

  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true); setFeedback(null)
    try { await action(); setFeedback({ text: success }) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }

  async function exportBackup() { await perform(async () => downloadBlob(await backupService.exportBackup(), datedFilename('polar-vocab-backup', 'json')), '已请求下载完整 JSON 备份，请确认文件已保存到设备。') }
  async function exportCsv() { await perform(async () => downloadBlob(exportVocabularyCsv(await service.list(exportLanguage === 'all' ? {} : { language: exportLanguage as Language })), datedFilename(`polar-vocab-${exportLanguage}`, 'csv')), '已请求下载 CSV。无损保存全部字段请使用 JSON 备份。') }

  async function previewBackup(file: File) {
    setBusy(true); setFeedback(null); setBackupDownloaded(false); setAcknowledged(false)
    try { setRestorePreview(await backupService.preview(file)) }
    catch (error) { setFeedback({ text: `备份未通过校验：${errorMessage(error)} 本机数据未修改。`, error: true }) }
    finally { setBusy(false) }
  }

  async function prepareClear() {
    setBusy(true); setFeedback(null); setBackupDownloaded(false); setAcknowledged(false); setClearText('')
    try { setClearPreview(await backupService.prepareClear()) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
    finally { setBusy(false) }
  }

  function saveSafetyBackup(blob: Blob, prefix: string) {
    try { downloadBlob(blob, datedFilename(prefix, 'json')); setBackupDownloaded(true) }
    catch (error) { setFeedback({ text: errorMessage(error), error: true }) }
  }

  async function restore() {
    if (!restorePreview || !backupDownloaded || !acknowledged) return
    setBusy(true); setFeedback(null)
    try {
      downloadBlob(restorePreview.preRestoreBackup, datedFilename('polar-vocab-before-restore', 'json'))
      await backupService.restore(restorePreview, 'replace-local')
      setRestorePreview(null); setFeedback({ text: '完整备份已恢复到本机，设置与记录已重新加载。连接已断开，SHA 和授权已重置；重新连接时只读检查和合并，不将缺失记录视为远端删除。' })
    } catch (error) { setFeedback({ text: `${errorMessage(error)} 恢复没有确认成功，本机原数据保留。若预览后词库已改变，请取消并重新选择备份。`, error: true }) }
    finally { setBusy(false) }
  }

  async function clear() {
    if (!clearPreview || !backupDownloaded || !acknowledged || clearText !== '清除本机数据') return
    setBusy(true); setFeedback(null)
    try {
      downloadBlob(clearPreview.preClearBackup, datedFilename('polar-vocab-before-clear', 'json'))
      await backupService.clearLocal(clearPreview)
      setClearPreview(null); setFeedback({ text: '本机工作区已清除，已建立默认空词库。请妥善保留清除前备份。' })
    } catch (error) { setFeedback({ text: `${errorMessage(error)} 清除没有确认成功，原数据保留。请取消后重新准备。`, error: true }) }
    finally { setBusy(false) }
  }

  const formatSize = (bytes: number | undefined) => bytes === undefined ? '未知' : `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return <>
    <PageHeader eyebrow="让这里，更适合你" title="设置" description="从舒服的阅读方式开始，慢慢建立自己的学习习惯。" />
    {feedback && <Feedback message={feedback.text} error={feedback.error} />}
    <LearningSettings />
    <SyncSettings />
    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="sun" /></div><div><h2>外观</h2><p>选择你更舒服的界面颜色。</p></div></div>
      <fieldset className="theme-options" disabled={!ready || busy}><legend className="sr-only">选择外观主题</legend>{themes.map((theme) => <label key={theme.value} className={`theme-option${preference === theme.value ? ' selected' : ''}`}><input type="radio" name="theme" value={theme.value} checked={preference === theme.value} onChange={() => void perform(() => setPreference(theme.value), '外观偏好已保存到本机。')} /><Icon name={theme.icon} /><span>{theme.label}</span>{preference === theme.value && <Icon name="check" className="theme-check" />}</label>)}</fieldset>
      <p className="settings-footnote">外观偏好保存到 IndexedDB，刷新后仍保留。</p>
    </section>

    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="globe" /></div><div><h2>语言偏好</h2><p>默认录入语言只影响下一次新建，不修改已有词条。</p></div></div><div className="settings-form"><label className="field"><span>默认录入语言</span><select aria-label="默认录入语言" disabled={!ready || busy} value={defaultLanguage} onChange={(event) => void perform(() => service.setDefaultLanguage(event.target.value as Language), '默认录入语言已保存到本机。')}><option value="en">英语 · EN</option><option value="de">德语 · DE</option></select></label><fieldset className="checkbox-options" disabled={!ready || busy}><legend>学习任务偏好</legend>{(['en', 'de'] as const).map((language) => <label key={language}><input type="checkbox" checked={settings?.reviewEnabled[language] ?? true} onChange={(event) => { if (settings) void perform(async () => { await service.updateSettings({ reviewEnabled: { ...settings.reviewEnabled, [language]: event.target.checked } }) }, '学习任务偏好已保存。') }} />{language === 'en' ? '英语' : '德语'}参与今日复习</label>)}</fieldset></div><p className="settings-footnote">停用语言只隐藏其学习任务，不删除词条、卡片或历史。仍可收集两种语言。</p></section>

    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="library" /></div><div><h2>本机词库与存储</h2><p>记录先保存在当前浏览器；云端确认情况请查看上方同步状态。</p></div></div><dl className="storage-stats"><div><dt>英语</dt><dd>{ready ? stats?.en : '—'} 条</dd></div><div><dt>德语</dt><dd>{ready ? stats?.de : '—'} 条</dd></div><div><dt>待整理</dt><dd>{ready ? stats?.inbox : '—'} 条</dd></div><div><dt>待同步操作</dt><dd>{ready ? stats?.pendingCount : '—'} 项</dd></div></dl><p className="form-help">待同步操作已留存在本机，GitHub 同步仅在授权后执行；本地保存不等于云端备份。</p><div className="storage-description"><p>站点存储占用：{formatSize(storageEstimate?.usage)} / 配额 {formatSize(storageEstimate?.quota)}（浏览器估算，包含静态缓存）</p><p>持久存储：{persistent === null ? '浏览器未提供状态' : persistent ? '已获得' : '尚未获得，浏览器仍可能清理数据'}</p></div><button className="button button-secondary" disabled={busy || !navigator.storage?.persist} onClick={() => void perform(async () => { const granted = await navigator.storage.persist(); setPersistent(granted); if (!granted) throw new Error('浏览器未授予持久存储，请定期导出备份。') }, '已获得持久存储；设备清理和手动删站点数据仍会影响词库。')}>申请持久存储</button></section>

    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="download" /></div><div><h2>导出与完整备份</h2><p>JSON 保存完整记录、删除证据与本机必要元数据；CSV 用于词汇交换。</p></div></div><div className="backup-actions"><button className="button button-primary" disabled={!ready || busy} onClick={() => void exportBackup()}>导出完整 JSON 备份</button><label className="field"><span className="sr-only">CSV 导出范围</span><select aria-label="CSV 导出范围" value={exportLanguage} onChange={(event) => setExportLanguage(event.target.value)}><option value="all">全部词汇</option><option value="en">英语词汇</option><option value="de">德语词汇</option></select></label><button className="button button-secondary" disabled={!ready || busy} onClick={() => void exportCsv()}>导出词汇 CSV</button></div><p className="settings-footnote">当前筛选结果可在词汇库直接导出。CSV 防止公式执行，但不包含所有语言专用字段或历史。</p></section>

    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="inbox" /></div><div><h2>恢复完整 JSON 备份</h2><p>先校验和预览，再明确覆盖；恢复前必须保存当前工作区备份。</p></div></div><label className="field file-picker"><span>选择完整备份 JSON</span><input type="file" aria-label="选择完整备份 JSON" accept=".json" disabled={!ready || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewBackup(file); event.target.value = '' }} /></label><p className="settings-footnote">本阶段只支持替换本机工作区，没有合并恢复或多空间。未知版本、损坏引用、旧备份丢失现有删除证据时，会拒绝写入。</p></section>

    <section className="settings-card"><div className="settings-heading"><div className="settings-icon"><Icon name="download" /></div><div><h2>安装到设备</h2><p>像应用一样，从桌面或主屏幕打开。</p></div></div><div className="install-instructions"><p><strong>桌面与 Android</strong><span>支持安装的浏览器会在地址栏或菜单中提供「安装应用」。出现本站安装提示时，也可以直接点击安装。</span></p><p><strong>iPhone 与 iPad</strong><span>在 Safari 打开网站，使用共享菜单中的「添加到主屏幕」。第一次访问需要联网加载应用外壳。</span></p></div><p className="settings-footnote">首次在线缓存后可离线收词与整理。真机 Safari 的剪贴板和主屏幕模式仍需验证。</p></section>

    <section className="settings-card danger-zone"><div className="settings-heading"><div><h2>清除本机工作区</h2><p>会移除本机记录、待同步操作和设置，无法直接撤销。先下载备份，再进行两项确认。</p></div></div><button className="button button-danger" disabled={!ready || busy} onClick={() => void prepareClear()}>准备清除本机数据</button></section>

    {restorePreview && <Dialog title="预览备份与覆盖恢复" onClose={() => { if (!busy) setRestorePreview(null) }}><p className="feedback feedback-error">将以选定备份替换当前本机工作区，并断开授权、清除已确认 SHA。不会自动覆盖远端，重新连接必须再次确认合并。现有记录、未同步修改和设置可能被覆盖。</p><dl className="backup-preview-stats"><div><dt>备份格式版本</dt><dd>{restorePreview.backupVersion} / schema {restorePreview.snapshot.schemaVersion}</dd></div><div><dt>导出时间</dt><dd>{new Date(restorePreview.exportedAt).toLocaleString('zh-CN')}</dd></div><div><dt>词条 / 卡片 / 复习事件</dt><dd>{restorePreview.counts.vocabularies} / {restorePreview.counts.cards} / {restorePreview.counts.reviewEvents}</dd></div><div><dt>删除标记 / 待同步操作</dt><dd>{restorePreview.counts.tombstones} / {restorePreview.counts.pendingOperations}</dd></div></dl><button className="button button-secondary" onClick={() => saveSafetyBackup(restorePreview.preRestoreBackup, 'polar-vocab-before-restore')}>先下载当前工作区备份</button><label className="confirmation-check"><input type="checkbox" disabled={!backupDownloaded || busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已确认备份文件保存完成，并理解将覆盖当前工作区。</label>{feedback?.error && <Feedback message={feedback.text} error />}<div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setRestorePreview(null)}>取消</button><button className="button button-danger" disabled={busy || !backupDownloaded || !acknowledged} onClick={() => void restore()}>确认覆盖恢复</button></div></Dialog>}

    {clearPreview && <Dialog title="确认清除本机工作区" onClose={() => { if (!busy) setClearPreview(null) }}><p className="feedback feedback-error">将清除当前浏览器中的词条、历史、删除证据、待同步操作和设置。本操作不会修改任何远程仓库。</p><p className="form-help">请先下载并确认当前工作区备份已落盘，再输入确认文字。预览后如本机数据改变，操作会拒绝。</p><button className="button button-secondary" onClick={() => saveSafetyBackup(clearPreview.preClearBackup, 'polar-vocab-before-clear')}>先下载清除前备份</button><label className="confirmation-check"><input type="checkbox" disabled={!backupDownloaded || busy} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已保存完整备份，并理解待同步数据也会被清除。</label><label className="field"><span>输入「清除本机数据」确认</span><input aria-label="清除确认文字" value={clearText} onChange={(event) => setClearText(event.target.value)} autoComplete="off" /></label>{feedback?.error && <Feedback message={feedback.text} error />}<div className="dialog-actions"><button className="button button-secondary" disabled={busy} onClick={() => setClearPreview(null)}>取消</button><button className="button button-danger" disabled={busy || !backupDownloaded || !acknowledged || clearText !== '清除本机数据'} onClick={() => void clear()}>确认清除</button></div></Dialog>}
  </>
}
