import { lstat, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const SIDE_CHAT_ID = /^session-sidechat-[A-Za-z0-9_-]+$/
const SESSION_ID = /^[A-Za-z0-9_-]+$/
const EFFECT_META = Symbol.for('cordis.effect')
const queues = new WeakMap()

function service(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name]
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') throw new Error(`side-chat purge requires ${label}.${method}()`)
}

async function missingAsUndefined(operation) {
  try {
    return await operation()
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// Byte-identical cwd grouping to dsh-session-persistence-jsonl's projectKey.
function projectKey(cwd) {
  if (cwd === undefined) return '_no-cwd'
  if (typeof cwd !== 'string' || !cwd || !isAbsolute(cwd)) throw new Error('session cwd must be an absolute nonempty path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const ch = cwd[i]
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else {
      readable += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)
        ? ch : '~' + cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function headerOf(record) {
  return record.header ?? record
}

function addHeader(headers, record) {
  const header = headerOf(record)
  if (typeof header.id !== 'string') throw new Error('invalid session header')
  const previous = headers.get(header.id)
  if (previous && ['cwd', 'createdAt', 'origin', 'parentSession'].some(key => previous[key] !== header[key])) {
    throw new Error(`conflicting session identity for ${header.id}`)
  }
  headers.set(header.id, { ...header })
}

async function headersFor(persistence, sessions, records) {
  const headers = new Map()
  for (const entry of await persistence.list()) addHeader(headers, entry)
  for (const session of sessions.list()) addHeader(headers, session.header)
  for (const record of records) addHeader(headers, record)
  return headers
}

function descendants(headers, sessionId) {
  const root = headers.get(sessionId)
  if (!root) throw new Error(`side chat ${sessionId} was not found; provide previously resolved records to retry a partial purge`)
  if (root.origin !== undefined) throw new Error('the purge root must be an ordinary side-chat session')
  const selected = new Map([[sessionId, root]])
  for (const [parentId] of selected) {
    for (const header of headers.values()) {
      if (header.origin === 'subagent' && header.parentSession === parentId && !selected.has(header.id)) {
        selected.set(header.id, header)
      }
    }
  }
  return selected
}

/** Check every existing component, not just a lexical startsWith(root). */
async function checkedPath(root, target) {
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error(`cleanup root is no longer a real directory: ${root}`)
  const absolute = resolve(target)
  const rel = relative(root, absolute)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`refusing path outside the exact cleanup root: ${absolute}`)
  }
  let current = root
  const parts = rel.split(sep)
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    const stat = await missingAsUndefined(() => lstat(current))
    if (!stat) return absolute
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink in cleanup path: ${current}`)
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`cleanup parent is not a directory: ${current}`)
  }
  return absolute
}

async function removeChecked(root, target, recursive = false) {
  // Recheck immediately before every deletion, including targets checked at preflight.
  const checked = await checkedPath(root, target)
  await rm(checked, { recursive, force: true })
}

function lifecycleDisposer(ctx, sessionId) {
  const label = `agentLoop.lifecycle(${sessionId})`
  const found = new Set()
  for (const runtime of ctx.registry?.values() ?? []) {
    for (const fiber of runtime.fibers ?? []) {
      for (const dispose of fiber._disposables ?? []) {
        if (dispose[EFFECT_META]?.label === label) found.add(dispose)
      }
    }
  }
  if (found.size > 1) throw new Error(`multiple lifecycle owners for ${sessionId}`)
  return [...found][0]
}

function liveTeardown(ctx, agents, sessions, handles, id) {
  const agent = agents.get(id)
  const session = sessions.get(id)
  if (!agent && !session) return undefined
  if (!agent || agent.session !== session) throw new Error(`incomplete live lifecycle for ${id}`)
  requireMethod(agent, 'cancel', 'agent')
  requireMethod(agent, 'whenIdle', 'agent')
  const handle = handles.get(id)
  if (handle && handle.agent !== agent) throw new Error(`stale AgentHandle for ${id}`)
  const dispose = handle ? () => handle.dispose() : lifecycleDisposer(ctx, id)
  if (handle) requireMethod(handle, 'dispose', 'AgentHandle')
  if (!dispose) throw new Error(`no ordered lifecycle disposer for ${id}; refusing to detach a live writer`)
  return { agent, session, dispose }
}

async function sessionPath(persistence, root, header) {
  if (!SESSION_ID.test(header.id)) throw new Error(`unsupported session id: ${header.id}`)
  const lexicalRoot = resolve(persistence.config.root)
  const expected = join(lexicalRoot, projectKey(header.cwd), header.id)
  const location = persistence.locate(header)
  if (location?.kind !== 'jsonl' || !isAbsolute(location.path) || dirname(location.path) !== expected
    || !/^session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.zstd)?$/.test(basename(location.path))) {
    throw new Error(`persistence did not locate the expected JSONL session directory for ${header.id}`)
  }
  return checkedPath(root, join(root, relative(lexicalRoot, expected)))
}

async function trashPaths(root, header) {
  const trash = await checkedPath(root, join(root, '.sessions-trash'))
  const names = await missingAsUndefined(() => readdir(trash)) ?? []
  const suffix = `-${projectKey(header.cwd)}-${header.id}`
  const paths = []
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-/.test(name) || name.slice(24) !== suffix) continue
    const path = await checkedPath(root, join(trash, name))
    const manifestPath = await checkedPath(root, join(path, 'manifest.json'))
    const text = await missingAsUndefined(() => readFile(manifestPath, 'utf8'))
    if (text !== undefined) {
      const manifest = JSON.parse(text)
      if (manifest.id !== header.id || manifest.cwd !== header.cwd) throw new Error(`trash identity mismatch for ${header.id}`)
    }
    paths.push(path)
  }
  return paths
}

async function cacheLocation(cache) {
  if (!cache) return undefined
  // These are runtime-visible internals, checked explicitly instead of guessed disk paths.
  const table = cache.table
  requireMethod(table, 'delete', 'sessionProjectionCache.table')
  requireMethod(cache, 'put', 'sessionProjectionCache')
  const unit = table.host?.unit
  if (unit?.descriptor?.name !== 'session_projcache' || unit.descriptor.layout !== 'per-record'
    || basename(unit.dir ?? '') !== 'session_projcache' || !isAbsolute(unit.dir)) {
    throw new Error('unsupported projection-cache storage layout')
  }
  const root = await realpath(dirname(unit.dir))
  const dir = await checkedPath(root, join(root, 'session_projcache', 'sessions'))
  return { table, root, dir, legacy: join(root, 'session_projcache.json') }
}

async function cachePaths(location, id) {
  if (!location) return []
  const { root, dir } = location
  await checkedPath(root, dir)
  const names = await missingAsUndefined(() => readdir(dir)) ?? []
  return Promise.all(names.filter(name => name === `${id}.json` || name.startsWith(`${id}.json.bak.`))
    .map(name => checkedPath(root, join(dir, name))))
}

async function pruneLegacyCache(location, ids) {
  if (!location) return
  const path = await checkedPath(location.root, location.legacy)
  const text = await missingAsUndefined(() => readFile(path, 'utf8'))
  if (text === undefined) return
  const document = JSON.parse(text)
  if (document.unit?.name !== 'session_projcache' || !document.tables?.sessions) {
    throw new Error('cannot safely prune legacy projection cache')
  }
  let changed = false
  for (const id of ids) {
    if (Object.hasOwn(document.tables.sessions, id)) {
      delete document.tables.sessions[id]
      changed = true
    }
  }
  if (!changed) return
  // The backend only reads this retained legacy document. Purges serialize per backend.
  const temporary = await checkedPath(location.root, `${path}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(document)}\n`, { flag: 'wx', mode: 0o600 })
    await checkedPath(location.root, temporary)
    await checkedPath(location.root, path)
    await rename(temporary, path)
  } finally {
    await removeChecked(location.root, temporary)
  }
}

async function purgeSearchCache(query, ids) {
  if (typeof query?._serialized !== 'function') return
  await query._serialized(undefined, async () => {
    // Do not create a previously unused search index just to delete from it.
    if (query._ready === undefined) {
      const path = query.config.path
      if (path === ':memory:' || !await missingAsUndefined(() => lstat(path))) return
    }
    await query._ensureReady()
    const db = query._requireDb()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of ids) {
        query._deleteSession('persisted', id)
        query._deleteSession('live', id)
      }
      const generation = query._mainGeneration() + 1
      db.prepare('UPDATE search_state SET global_generation = ? WHERE singleton = 1').run(generation)
      db.exec('COMMIT')
      query._globalGeneration += 1
      query._localGeneration = Math.max(query._localGeneration, generation) + 1
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}

/**
 * Permanently erase ONE ordinary session-sidechat-* root and only its
 * origin=subagent descendants. Ordinary forks, the main conversation and shared
 * content-addressed attachments are never erased. This is logical deletion, not
 * secure erasure of filesystem snapshots, backups, telemetry or shared content.
 *
 * The host must serialize this with send/resume/create and stop offering these
 * sessions to history readers during cleanup. Do not call from the target's own
 * running tool/command, which would wait for itself to drain. This module neither
 * calls the mobile endpoint nor changes other plugins or running installations.
 *
 * handles is Map<sessionId, AgentHandle> returned by agentLoop create/resume.
 * records is optional trusted, previously resolved SessionHeader[] for retry after
 * partial deletion or a prior mobile trash move. onPlan(headers), if supplied,
 * is awaited before stopping work and whenever the resolved subtree grows, so a
 * host can durably retain the complete retry plan before irreversible cleanup.
 * Never accept headers from an HTTP request. Conflicting identities and records outside the root's subagent lineage
 * are rejected before stopping work. No caller-supplied filesystem paths are used.
 *
 * Success: { ok, sessionId, deletedSessionIds, records }. Failure throws with
 * stage, records and deletedSessionIds so the caller retains its mapping and can
 * retry without claiming an interrupted irreversible purge was rolled back.
 */
export async function purgeSideChat(ctx, sessionId, { handles = new Map(), records = [], timeoutMs = 20_000, onPlan } = {}) {
  if (typeof sessionId !== 'string' || !SIDE_CHAT_ID.test(sessionId)) throw new Error('purge accepts only a session-sidechat-* root')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive safe integer')
  const persistence = service(ctx, 'sessionPersistence')
  requireMethod(persistence, 'list', 'sessionPersistence')
  requireMethod(persistence, 'locate', 'sessionPersistence')
  const previous = queues.get(persistence) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() => purge(ctx, persistence, sessionId, handles, records, timeoutMs, onPlan))
  queues.set(persistence, pending)
  try {
    return await pending
  } finally {
    if (queues.get(persistence) === pending) queues.delete(persistence)
  }
}

async function purge(ctx, persistence, sessionId, handles, records, timeoutMs, onPlan) {
  const sessions = service(ctx, 'sessions')
  const agents = service(ctx, 'agents')
  const workspaces = service(ctx, 'workspaceRegistry')
  const cache = service(ctx, 'sessionProjectionCache')
  const deletedSessionIds = []
  let selected = new Map()
  let stage = 'preflight'
  let ungate
  let originalPut
  try {
    for (const method of ['get', 'list', 'flush']) requireMethod(sessions, method, 'sessions')
    requireMethod(agents, 'get', 'agents')
    for (const method of ['list', 'unarchiveSession', 'unpinSession']) requireMethod(workspaces, method, 'workspaceRegistry')
    requireMethod(ctx, 'parallel', 'context')
    requireMethod(ctx, 'on', 'context')
    requireMethod(ctx, 'emit', 'context')
    if (typeof persistence.config?.root !== 'string' || !isAbsolute(persistence.config.root)) throw new Error('persistence must expose its absolute storage root')
    const root = await realpath(persistence.config.root)
    selected = descendants(await headersFor(persistence, sessions, records), sessionId)
    for (const record of records) {
      if (!selected.has(headerOf(record).id)) throw new Error('explicit records include a session outside the side-chat subtree')
    }
    const location = await cacheLocation(cache)
    const paths = new Map()
    const prepare = async (header) => {
      const path = await sessionPath(persistence, root, header)
      await trashPaths(root, header)
      await cachePaths(location, header.id)
      liveTeardown(ctx, agents, sessions, handles, header.id)
      paths.set(header.id, path)
    }
    for (const header of selected.values()) await prepare(header)
    for (const workspace of workspaces.list()) requireMethod(workspace, 'detachSession', 'workspace')
    await onPlan?.([...selected.values()])

    // Prevent completion deliveries from starting a new model step while draining.
    ungate = ctx.on('agent/pre-step', ({ agent }, next) => {
      let header = agent.session.header
      const visited = new Set()
      while (header && !visited.has(header.id)) {
        if (selected.has(header.id)) return Promise.resolve({ kind: 'reject' })
        visited.add(header.id)
        if (header.origin !== 'subagent') break
        header = sessions.get(header.parentSession)?.header
      }
      return next()
    })
    if (cache) {
      originalPut = cache.put
      cache.put = function (id, ...args) {
        return selected.has(id) ? Promise.resolve() : originalPut.call(this, id, ...args)
      }
    }
    const stopped = new Set()
    // Re-scan after draining. A tool already spawning a child may publish it while
    // the first stop is settling. Durable lineage, not the first snapshot, wins.
    while ([...selected.keys()].some(id => !stopped.has(id))) {
      const pending = [...selected.values()].filter(header => !stopped.has(header.id))
      stage = 'stop'
      for (const { id } of pending) {
        await withTimeout(ctx.parallel('workspace/session-stop', { sessionId: id }), timeoutMs, `stopping ${id}`)
        agents.get(id)?.cancel({ kind: 'disposed' })
      }
      stage = 'drain-flush-dispose'
      for (const { id } of pending.reverse()) {
        const live = liveTeardown(ctx, agents, sessions, handles, id)
        if (live) {
          await withTimeout(live.agent.whenIdle(), timeoutMs, `draining ${id}`)
          await withTimeout(sessions.flush(live.session), timeoutMs, `flushing ${id}`)
          await withTimeout(Promise.resolve(live.dispose()), timeoutMs, `disposing ${id}`)
        }
        if (agents.get(id) || sessions.get(id)) throw new Error(`session ${id} is still registered after disposal`)
        stopped.add(id)
      }
      const latest = descendants(await headersFor(persistence, sessions, [...selected.values()]), sessionId)
      let grew = false
      for (const header of latest.values()) {
        if (selected.has(header.id)) continue
        await prepare(header)
        selected.set(header.id, header)
        grew = true
      }
      if (grew) await onPlan?.([...selected.values()])
    }

    stage = 'metadata'
    for (const id of selected.keys()) {
      for (const workspace of workspaces.list()) await workspace.detachSession(id)
      await workspaces.unarchiveSession(id)
      await workspaces.unpinSession(id)
    }
    stage = 'cache'
    await pruneLegacyCache(location, selected.keys())
    for (const id of selected.keys()) {
      if (location) {
        await location.table.delete(id)
        for (const path of await cachePaths(location, id)) await removeChecked(location.root, path)
      }
      persistence.coldLogMemo?.delete(id)
      service(ctx, 'sessionQuery')?._observations?.cache?.delete(id)
      workspaces.invalidSessionPaths?.delete(id)
      workspaces.headers?.delete(id)
      workspaces.sessionPaths?.delete(id)
    }
    stage = 'files'
    // Root last. A failed descendant purge remains discoverable for a retry.
    for (const header of [...selected.values()].reverse()) {
      const { id } = header
      if (agents.get(id) || sessions.get(id)) throw new Error(`session ${id} resumed during purge`)
      for (const path of await trashPaths(root, header)) await removeChecked(root, path, true)
      await removeChecked(root, paths.get(id), true)
      deletedSessionIds.push(id)
      handles.delete(id)
    }
    stage = 'search-cache'
    await purgeSearchCache(service(ctx, 'sessionQuery'), selected.keys())
    stage = 'notify'
    for (const id of deletedSessionIds) ctx.emit('api-session/removed', id)
    return { ok: true, sessionId, deletedSessionIds, records: [...selected.values()] }
  } catch (error) {
    error.stage = stage
    error.records = [...selected.values()]
    error.deletedSessionIds = [...deletedSessionIds]
    throw error
  } finally {
    if (originalPut) cache.put = originalPut
    ungate?.()
  }
}
