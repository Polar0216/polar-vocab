import { useState } from 'react'
import type { DesktopBridge, DesktopStatus, Reply } from '../src/contracts'

export function ConnectionSettings({ status, api, perform, onPreview }: { status?: DesktopStatus; api: DesktopBridge; perform: (action: () => Promise<Reply<unknown>>) => Promise<void>; onPreview: (text: string) => void }) {
  const [owner, setOwner] = useState('Polar0216'), [repository, setRepository] = useState('polar-vocab-data-test'), [branch, setBranch] = useState('main'), [prompting, setPrompting] = useState(false)
  return <section><h2>GitHub 私有采集仓库</h2><p role="status" className="hint">{status?.authorization.message ?? '未授权，可先离线收藏'}{status?.target ? ' · ' + status.target : ''}</p>
    <p className="hint">凭证仅在原生授权窗口输入，网页界面不读取。确认后可选择由 Windows 凭证管理器记住此设备；网络暂不可用不会删除保存的凭证。只授权目标私库 Contents 读写，勿将 PAT 发到聊天。</p>
    <label>仓库所有者<input aria-label="仓库所有者" value={owner} maxLength={100} onChange={event => setOwner(event.target.value)} /></label><label>私有仓库名称<input aria-label="私有仓库名称" value={repository} maxLength={100} onChange={event => setRepository(event.target.value)} /></label><label>分支<input aria-label="分支" value={branch} maxLength={200} onChange={event => setBranch(event.target.value)} /></label>
    <div className="actions"><button disabled={prompting || status?.syncing} onClick={() => { setPrompting(true); void perform(async () => { const reply = await api.connect({ owner, repository, branch }); if (reply.ok && reply.value) onPreview(reply.value); return reply }).finally(() => setPrompting(false)) }}>{prompting ? '请完成系统授权窗口…' : '输入凭证并测试（系统窗口）'}</button><button disabled={!status?.authorization.remembered || status?.authorization.state === 'checking'} onClick={() => { void perform(() => api.restoreAuthorization()) }}>重试自动连接</button><button disabled={!status?.connected && !status?.authorization.remembered} onClick={() => { void perform(() => api.disconnect()) }}>断开连接并忘记凭证</button></div>
    <p className="hint">{status?.web.message}</p><button onClick={() => { void perform(() => api.verifyWebsite()) }}>核对正式网站兼容性</button>
  </section>
}
