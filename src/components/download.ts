export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function datedFilename(prefix: string, extension: string) {
  return `${prefix}-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.${extension}`
}
