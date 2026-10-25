import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
async function writeChanged(path, content, immutable = false) {
  const target = new URL(path, root)
  let previous
  try { previous = await readFile(target, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous === content) return
  if (immutable && previous !== undefined) throw new Error(`Immutable build collision: ${path}`)
  await writeFile(target, content)
}
const files = ['host.js', 'purge.js']
const sources = await Promise.all(files.map(name => readFile(new URL(`lib/${name}`, root), 'utf8')))
const revision = createHash('sha256').update(sources.join('\0')).digest('hex').slice(0, 12)
await mkdir(new URL(`dist/host/${revision}/`, root), { recursive: true })
for (const [i, name] of files.entries()) await writeChanged(`dist/host/${revision}/${name}`, sources[i], true)
await writeChanged('release.json', JSON.stringify({ revision, entry: `./dist/host/${revision}/host.js` }, null, 2) + '\n')

// A separate native loader entry can add or update preference inheritance
// without unloading the stable owner of live side-chat agent handles.
const preferences = await readFile(new URL('lib/preferences.js', root), 'utf8')
const preferencesRevision = createHash('sha256').update(preferences).digest('hex').slice(0, 12)
const entry = `dist/preferences/${preferencesRevision}/index.js`
await mkdir(new URL(`dist/preferences/${preferencesRevision}/`, root), { recursive: true })
await writeChanged(entry, preferences, true)
await writeChanged('cordis.patch.yml', `- insert:\n    - id: side-chat\n      name: ./bootstrap.js\n    - id: side-chat-preferences-${preferencesRevision}\n      name: ./${entry}\n`)
console.log(`Built side-chat host ${revision}`)
console.log(`Built side-chat preferences ${preferencesRevision}`)
