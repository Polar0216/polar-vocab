// Test-only independent owner; no user text, clipboard, network or files.
import { app, globalShortcut } from 'electron'
import process from 'node:process'
app.setPath('userData', process.env.POLAR_VOCAB_CAPTURE_DATA_DIR)
app.whenReady().then(() => globalShortcut.register('Control+Shift+S', () => {}))
app.on('before-quit', () => globalShortcut.unregisterAll())
