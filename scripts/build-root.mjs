import { build } from 'vite'

process.env.PAGES_BASE_PATH = '/'
await build()
