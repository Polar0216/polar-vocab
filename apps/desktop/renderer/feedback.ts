const bridge = (window as unknown as { captureFeedback: { onProgress(callback: (progress: { id: string; repeated: boolean }) => void): void; painted(id: string): void } }).captureFeedback
let current = ''
bridge.onProgress(({ id, repeated }) => {
  current = id
  document.querySelector('[role=status]')!.textContent = repeated ? '正在读取最新选区…' : '正在读取选区…'
  requestAnimationFrame(() => requestAnimationFrame(() => { if (current === id) bridge.painted(id) }))
})
