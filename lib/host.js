import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork'
import { fallbackSessionTitle } from '@deepseek-ai/dsh-session-title'
import { purgeSideChat } from './purge.js'

export const PREFIX = 'session-sidechat-'
export const SIDE_NOTE = 'This is a side chat forked from the main session. The main session continues separately and does not see this conversation.'
export const HANDOFF_REQUEST = 'Write a handoff for the main session: a self-contained account of what happened here and what it needs to know or do.'
export const HANDOFF_PREFIX = 'Handoff from a side chat:\n\n'

const textOf = message => (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')
const isSideNote = event => event.type === 'user/message' && event.data.source.kind === 'side-chat-boundary'
const clearError = ({ error: _error, ...record }) => record

/** Public session routing, with its ownership and resume checks intact. */
async function resolveAgent(ctx, id) {
  const found = await ctx.sessionController.resolveAgent(id)
  if (found.error) throw found.error
  return found.agent
}

async function observe(ctx, id, fn) {
  const view = await ctx.sessionQuery.observeSession(id)
  try { return await fn(view) } finally { view[Symbol.dispose]() }
}

function requiredSession(payload) {
  if (typeof payload?.sessionId !== 'string' || !payload.sessionId) throw new Error('sessionId is required')
  return payload.sessionId
}

/** Versioned implementation. The stable entry owns storage, jobs and live agents. */
export async function apply(ctx, bridge) {
  const { records, handles } = bridge
  const boundarySeen = new WeakMap()
  const titleStarted = new WeakSet()
  const deleting = new Map()
  const delivering = new Map()
  const creating = new Map()
  let reconciling = false

  function requireSide(id) {
    const record = records.get(id)
    if (!id.startsWith(PREFIX) || !record) throw new Error('Side chat not found')
    return record
  }

  async function remove(id, fromHandoff = false) {
    const original = records.get(id)
    if (!fromHandoff && delivering.has(id)) {
      await delivering.get(id).catch(() => {})
      if (!records.get(id)) return { mainSessionId: original.mainSessionId }
    }
    const previous = deleting.get(id)
    if (previous) return previous
    const operation = (async () => {
      const row = requireSide(id)
      await records.put(id, { ...clearError(row), state: 'deleting' })
      try {
        await purgeSideChat(ctx, id, {
          handles, records: row.purgeRecords ?? [],
          onPlan: async headers => records.update(id, current => ({ ...current, purgeRecords: headers })),
        })
        await records.delete(id)
        return { mainSessionId: row.mainSessionId }
      } catch (error) {
        const current = records.get(id)
        if (current) await records.put(id, { ...current, state: 'deleting', error: error.message })
        throw error
      }
    })().finally(() => deleting.delete(id))
    deleting.set(id, operation)
    return operation
  }

  // The note is appended only with the first real user input. It becomes a
  // durable context message after the inherited prefix and before that input.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    const row = records.get(agent.id)
    if (!row || decision.kind !== 'enter' || signal.aborted) return decision
    if (row.state === 'deleting') return { kind: 'reject', reason: 'Side chat is being deleted' }
    if (!decision.messages.some(message => message.source.kind === 'user')) return decision
    let seen = boundarySeen.get(agent.session)
    if (seen === undefined) {
      seen = await observe(ctx, agent.id, view => view.events.slice(view.inheritedEventCount).some(isSideNote))
      boundarySeen.set(agent.session, seen)
    }
    if (seen) return decision
    const note = createUserMessage({
      source: { kind: 'side-chat-boundary', form: 'notice', summary: row.initialTitle ?? 'Side Chat' },
      content: [{ type: 'text', text: SIDE_NOTE }],
    })
    return { ...decision, messages: [note, ...decision.messages] }
  }, { prepend: true })
  async function titleSideChat(session, event) {
    const row = records.get(session.id)
    const titles = ctx.sessionTitle
    if (!row || row.titleInputSeq !== undefined || titleStarted.has(session) || titles.get(session)?.source.kind === 'user') return
    const text = textOf(event.data).trim()
    if (!text || event.data.source.rpcId?.startsWith('side-chat-handoff-')) return
    const input = { seq: event.seq, text }
    titleStarted.add(session)
    await records.update(session.id, current => ({ ...current, titleInputSeq: event.seq }))
    if (ctx.sessions.get(session.id) !== session || records.get(session.id)?.state === 'deleting' || titles.get(session)?.source.kind === 'user') return
    const title = fallbackSessionTitle(text, titles.config.fallbackMaxWords, titles.config.fallbackMaxBytes)
    if (title) session.append('session/title', { title, messageSeqs: [event.seq], source: { kind: 'fallback' } })
    // Ordinary forks inherit title inputs. Reuse the installed native generator
    // and its validator with ONLY the side chat's first human message.
    const registration = titles.registration
    if (!registration || registration.closing) return
    const controller = new AbortController()
    const cancel = ctx.on('session/disposed', disposed => { if (disposed.id === session.id) controller.abort() })
    try {
      const route = session.requestHeader()?.config
      const result = await registration.provider.generate({
        session, messages: [input], signal: controller.signal,
        ...(route ? { route: { provider: route.provider, model: route.model } } : {}),
      })
      if (controller.signal.aborted || bridge.closing || ctx.sessions.get(session.id) !== session || !records.get(session.id)
        || records.get(session.id).state === 'deleting' || titles.get(session)?.source.kind === 'user') return
      const accepted = titles.validateResult(result, [input])
      session.append('session/title', {
        title: accepted.title, messageSeqs: accepted.messageSeqs,
        source: { kind: 'provider', provider: registration.provider.id, ...(accepted.model ? { model: accepted.model } : {}) },
      })
    } finally { cancel() }
  }
  ctx.on('session/event', (session, event) => {
    if (!records.get(session.id)) return
    if (isSideNote(event)) boundarySeen.set(session, true)
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      bridge.operations += 1
      void titleSideChat(session, event).catch(error => ctx.logger.warn(`side-chat title: ${error.message}`))
        .finally(() => { bridge.operations -= 1 })
    }
  })

  async function start(payload) {
    const requested = requiredSession(payload)
    const mainId = records.get(requested)?.mainSessionId ?? requested
    if (ctx.workspaceRegistry.archivedSessionIds.includes(mainId)) throw new Error('Main session is archived')
    const requestId = payload.requestId
    if (typeof requestId !== 'string' || !requestId) throw new Error('requestId is required')
    const existing = [...records.entries()].find(([, row]) => row.creationRequestId === requestId)
    if (existing) return { sessionId: existing[0], mainSessionId: existing[1].mainSessionId }
    const main = await resolveAgent(ctx, mainId)
    if (main.session.header.origin === 'subagent') throw new Error('Open a side chat from an ordinary session')
    await ctx.sessions.flush(main.session)
    return observe(ctx, mainId, async source => {
      const boundary = payload.atSeq ?? source.events.at(-1)?.seq ?? -1
      if (!Number.isSafeInteger(boundary) || boundary < -1 || (boundary !== -1 && source.events[boundary]?.seq !== boundary)) throw new Error('Invalid side-chat fork point')
      const route = source.projections?.values.modelSelection?.pending
        ?? main.session.requestHeader()?.config ?? main.options
      if (!route?.provider || !route?.model) throw new Error('Select a model in the main session first')
      // Compatibility seam: use the controller's own pre-publication setup so
      // model selection, the source preset and normal composer behavior agree.
      const manager = ctx.sessionController.agents
      if (typeof manager?.composeAgent !== 'function') throw new Error('Unsupported DSH session composition API')
      const composition = await manager.composeAgent(source.projections?.values.agentPreset ?? source.header.agentPreset)
      const id = `${PREFIX}${randomUUID()}`
      const location = await ctx.sessionPersistence.locate(source.header)
      const initialTitle = payload.initialTitle === '侧边会话' ? '侧边会话' : 'Side Chat'
      const row = {
        sessionId: id, mainSessionId: mainId, createdAt: Date.now(), forkSeq: boundary,
        state: 'open', creationRequestId: requestId, initialTitle,
        ...(location?.kind === 'jsonl' ? { mainDir: dirname(location.path) } : {}),
      }
      await records.put(id, row) // identity precedes publication to every client
      try {
        const selection = {
          provider: route.provider, model: route.model,
          ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        }
        const side = await bridge.createAgent({
          sessionId: id,
          seed: boundary === -1 ? [] : buildForkSeed(source.events, boundary),
          inheritedEventCount: boundary + 1,
          meta: {
            cwd: source.header.cwd, parentSession: mainId,
            isSeeded: boundary !== -1, delegationDepth: 0, agentPreset: composition.agentPreset,
          },
          agentOptions: selection,
          setup: async (agentCtx, agent) => {
            agent.session.append('model/selection', selection)
            agent.session.append('session/title', { title: initialTitle, messageSeqs: [], source: { kind: 'fallback' } })
            await composition.setup(agentCtx, agent)
          },
        })
        const workspace = ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(mainId))
        if (workspace) await workspace.attachSession(id)
        await ctx.sessions.flush(side.session)
        return { sessionId: id, mainSessionId: mainId }
      } catch (error) {
        // Keep a failed published identity deletable rather than orphaning it.
        if (handles.has(id)) await remove(id)
        else await records.delete(id)
        throw error
      }
    })
  }

  async function deliverHandoff(id, requestId) {
    const row = requireSide(id)
    const side = await resolveAgent(ctx, id)
    await ctx.sessionController.prompt({
      sessionId: id, requestId, mode: 'queue', content: [{ type: 'text', text: HANDOFF_REQUEST }],
    })
    await side.whenIdle()
    if (bridge.closing || records.get(id)?.state !== 'handoff') return
    const report = await observe(ctx, id, view => {
      const input = view.events.findLast(event => event.type === 'user/message' && event.data.source.rpcId === requestId)
      if (!input) throw new Error('Handoff request did not run')
      const turn = view.events.findLast(event => event.seq < input.seq && event.type === 'turn/start')?.data.turn
      const end = view.events.find(event => event.seq > input.seq && event.type === 'turn/end' && event.data.turn === turn)
      if (end?.data.reason.kind !== 'completed') throw new Error('Handoff was interrupted or failed; the side chat has been kept')
      const answer = view.events.findLast(event => event.seq > input.seq && event.seq < end.seq && event.type === 'assistant/message' && textOf(event.data.message).trim())
      if (!answer) throw new Error('Handoff returned no text; the side chat has been kept')
      return textOf(answer.data.message)
    })
    // Serialize final delivery with explicit deletion. A delete during report
    // generation cancels it; once delivery starts, deletion waits for its receipt.
    const delivery = (async () => {
      const main = await resolveAgent(ctx, row.mainSessionId)
      if (bridge.closing || records.get(id)?.state !== 'handoff') return
      if (ctx.workspaceRegistry.archivedSessionIds.includes(row.mainSessionId)) throw new Error('Main session is archived')
      await ctx.sessionController.prompt({
        sessionId: row.mainSessionId, requestId: `side-chat-delivery-${requestId}`,
        mode: main.status === 'running' ? 'steer' : 'queue',
        content: [{ type: 'text', text: HANDOFF_PREFIX + report }],
      })
      await ctx.sessions.flush(main.session)
      await records.put(id, { ...requireSide(id), state: 'deleting', delivered: true })
      await remove(id, true)
    })()
    delivering.set(id, delivery)
    try { await delivery } finally { delivering.delete(id) }
  }

  async function handoff(payload) {
    const id = requiredSession(payload)
    const row = requireSide(id)
    if (row.state === 'deleting') throw new Error('Side chat is being deleted')
    if (bridge.jobs.has(id)) return { mainSessionId: row.mainSessionId }
    const requestId = `side-chat-handoff-${randomUUID()}`
    await records.put(id, { ...clearError(row), state: 'handoff', handoffRequestId: requestId })
    const job = deliverHandoff(id, requestId).catch(async error => {
      const current = records.get(id)
      if (current && current.state !== 'deleting') await records.put(id, { ...current, state: 'open', error: error.message })
      ctx.logger.warn(`side-chat handoff: ${error.message}`)
    }).finally(() => bridge.jobs.delete(id))
    bridge.jobs.set(id, job)
    return { mainSessionId: row.mainSessionId }
  }

  async function reconcile() {
    if (reconciling || bridge.closing || bridge.swapping) return
    reconciling = true
    bridge.operations += 1
    try {
      for (const [id, row] of records.entries()) {
        let parentMissing = false
        if (row.mainDir && !ctx.agents.get(row.mainSessionId) && !ctx.sessions.get(row.mainSessionId)) {
          try {
            if (!(await stat(row.mainDir)).isDirectory()) throw new Error('Main session directory is not a directory')
          } catch (error) { if (error.code === 'ENOENT') parentMissing = true; else throw error }
        }
        if (parentMissing || ctx.workspaceRegistry.archivedSessionIds.includes(row.mainSessionId) || (row.state === 'deleting' && !deleting.has(id))) {
          await remove(id).catch(error => ctx.logger.warn(`side-chat cleanup: ${error.message}`))
        }
      }
    } finally {
      bridge.operations -= 1
      reconciling = false
    }
  }
  const scheduleReconcile = () => { void reconcile().catch(error => ctx.logger.warn(`side-chat parent reconciliation: ${error.message}`)) }
  ctx.on('domain/changed', change => {
    if (change.domain === 'workspace') scheduleReconcile()
  })
  ctx.on('api-session/removed', id => {
    if ([...records.entries()].some(([, row]) => row.mainSessionId === id)) scheduleReconcile()
  })
  ctx.effect(() => {
    const timer = setInterval(scheduleReconcile, 5000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'side-chat: parent lifecycle')

  for (const [id, row] of records.entries()) {
    if (row.state === 'handoff' && !bridge.jobs.has(id)) await records.put(id, { ...row, state: 'open', error: 'Handoff was interrupted. The side chat has been kept; review it before handing off again.' })
  }

  const routes = {
    list: async () => ({ records: [...records.entries()].map(([, row]) => row), runtime: bridge.runtime }),
    start: payload => {
      const key = payload?.requestId
      if (creating.has(key)) return creating.get(key)
      const operation = start(payload).finally(() => creating.delete(key))
      creating.set(key, operation)
      return operation
    },
    handoff,
    delete: payload => remove(requiredSession(payload)),
  }
  for (const [endpoint, handler] of Object.entries(routes)) {
    ctx.connection.fetch.register({
      path: `/api/side-chat/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (bridge.closing || bridge.swapping) return Response.json({ ok: false, error: { message: 'Side chat is updating. Try again shortly.' } }, { status: 503 })
        bridge.operations += 1
        try {
          return Response.json({ ok: true, value: await handler(await request.json()) })
        } catch (error) {
          return Response.json({ ok: false, error: { message: error.message } }, { status: 400 })
        } finally { bridge.operations -= 1 }
      },
    })
  }
  scheduleReconcile()
}
