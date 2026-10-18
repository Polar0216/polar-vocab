export function popupBounds(point: { x: number; y: number }, area: { x: number; y: number; width: number; height: number }) {
  const width = Math.min(600, area.width), height = Math.min(800, area.height)
  return { width, height, x: Math.max(area.x, Math.min(point.x + 16, area.x + area.width - width)), y: Math.max(area.y, Math.min(point.y + 16, area.y + area.height - height)) }
}
