import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const files = ['host.js', 'purge.js']
const sources = await Promise.all(files.map(name => readFile(new URL(`lib/${name}`, root), 'utf8')))
const revision = createHash('sha256').update(sources.join('\0')).digest('hex').slice(0, 12)
const directory = new URL(`dist/host/${revision}/`, root)
await mkdir(directory, { recursive: true })
for (const [i, name] of files.entries()) await writeFile(new URL(name, directory), sources[i])
await writeFile(new URL('release.json', root), JSON.stringify({ revision, entry: `./dist/host/${revision}/host.js` }, null, 2) + '\n')
console.log(`Built side-chat host ${revision}`)
