import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

export const name = 'side-chat'
export const inject = [
  'agents', 'sessions', 'sessionController', 'sessionQuery', 'sessionProjections',
  'agentPresets', 'sessionPersistence', 'workspaceRegistry', 'storageDomain', 'connection', 'sessionTitle',
]

const record = z.object({
  sessionId: z.string(),
  mainSessionId: z.string(),
  createdAt: z.number(),
  forkSeq: z.number(),
  state: z.enum(['open', 'handoff', 'deleting']),
}).passthrough()
const domainSpec = defineDomain({
  name: 'side_chat', version: 1, tables: { chats: domainTable(record) },
})

/**
 * Stable package entry. Agent handles and storage outlive versioned route/UI
 * implementations. Updating the published release manifest loads a new module
 * URL without touching Node's global caches or restarting the DSH host.
 */
export async function apply(ctx) {
  const domain = await ctx.storageDomain.open(domainSpec)
  const bridge = {
    records: domain.table('chats'),
    handles: new Map(),
    jobs: new Map(),
    operations: 0,
    swapping: false,
    closing: false,
    runtime: { revision: null, pendingRevision: null, error: null },
    async createAgent(options) {
      const handle = await ctx.agents.create(options)
      this.handles.set(handle.agent.id, handle)
      return handle.agent
    },
  }
  let mounted, currentModule, currentRelease, rejectedRevision
  let checking = false

  function busy() {
    return bridge.operations > 0 || bridge.jobs.size > 0 || [...bridge.records.entries()].some(([id, row]) =>
      row.state !== 'open' || ctx.agents.get(id)?.status === 'running')
  }

  async function mount(module) {
    const fiber = ctx.plugin({ name: 'side-chat-runtime', apply: child => module.apply(child, bridge) })
    await fiber.await()
    if (fiber.state !== 2) {
      await fiber.dispose()
      throw new Error('Side-chat implementation did not activate')
    }
    return fiber
  }

  async function loadRelease(initial = false) {
    if (checking || bridge.closing) return
    checking = true
    try {
      let release
      try {
        release = JSON.parse(await readFile(new URL('./release.json', import.meta.url), 'utf8'))
      } catch (error) {
        if (!initial && error.code === 'ENOENT') return // package replacement in progress
        throw error
      }
      if (!/^[a-f0-9]{12}$/.test(release.revision) || release.entry !== `./dist/host/${release.revision}/host.js`) {
        throw new Error('Invalid side-chat release manifest')
      }
      if (release.revision === currentRelease?.revision || release.revision === rejectedRevision) return
      bridge.runtime.pendingRevision = release.revision
      if (!initial && busy()) return
      const nextModule = await import(new URL(release.entry, import.meta.url).href)
      if (typeof nextModule.apply !== 'function') throw new Error('Missing side-chat implementation')
      bridge.swapping = true
      const previousModule = currentModule
      try {
        await mounted?.dispose()
        mounted = await mount(nextModule)
        currentModule = nextModule
        currentRelease = release
        bridge.runtime.revision = release.revision
        bridge.runtime.pendingRevision = null
        bridge.runtime.error = null
      } catch (error) {
        rejectedRevision = release.revision
        if (previousModule) mounted = await mount(previousModule)
        throw error
      } finally {
        bridge.swapping = false
      }
    } catch (error) {
      bridge.runtime.error = error.message
      if (initial) throw error
      ctx.logger.warn(`side-chat update deferred: ${error.message}`)
    } finally {
      checking = false
    }
  }

  ctx.effect(() => async () => {
    bridge.closing = true
    await mounted?.dispose()
    await Promise.allSettled([...bridge.handles.values()].map(handle => handle.dispose()))
    await Promise.allSettled([...bridge.jobs.values()])
    await domain.close()
  }, 'side-chat: lifetime')
  await loadRelease(true)
  ctx.effect(() => {
    const timer = setInterval(() => { void loadRelease() }, 2000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'side-chat: published release watch')
}
