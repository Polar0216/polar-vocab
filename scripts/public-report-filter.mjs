// Git clean filter: no disk writes, credentials or network. Originals remain on disk.
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const original = Buffer.concat(chunks).toString('utf8')
const sanitized = original.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\r\n]+[\\/]Desktop[\\/]polar-vocab/g, '<project-root>')
process.stdout.write(sanitized)
