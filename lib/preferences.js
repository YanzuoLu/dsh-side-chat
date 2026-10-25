/**
 * Side-chat preference inheritance. A newly created side chat starts with a
 * copy of its main session's per-session preferences that other plugins own,
 * then keeps them independently. Records are written through each owner's
 * already-open domain, so the owner's schema, write queue and in-memory state
 * apply and the owner sees the copy immediately. A preference whose owner is
 * not loaded, or that the main session never set, is skipped.
 */
export const name = 'side-chat-preferences'
export const inject = ['agents', 'storageDomain']

const SIDE_PREFIX = 'session-sidechat-'
/** Per-session preference tables, keyed by session id, owned by other plugins. */
const PREFERENCES = [
  { domain: 'subagent_model', table: 'overrides' },
  { domain: 'devin_fusion', table: 'sessions' },
]

const isSideChat = header => header.id.startsWith(SIDE_PREFIX) && header.parentSession !== undefined && header.origin !== 'subagent'
/** A write rejected because its owner is unloading and closing the domain. */
const isClosing = error => error?.name === 'DomainError' && error.code === 'closed'

export function apply(ctx) {
  const operations = new Set()
  const track = promise => {
    operations.add(promise)
    return promise.finally(() => operations.delete(promise))
  }
  // Registered first so it is disposed after the listeners below.
  ctx.effect(() => async () => { await Promise.allSettled([...operations]) }, 'side-chat-preferences: pending writes')

  /** The owner's live table, or undefined while its plugin is not loaded. */
  const tableOf = ({ domain, table }) => ctx.storageDomain.get(domain)?.table(table)

  async function copy(header) {
    const written = []
    try {
      for (const preference of PREFERENCES) {
        const table = tableOf(preference)
        const value = table?.get(header.parentSession)
        if (value === undefined || table.get(header.id) !== undefined) continue
        const copied = structuredClone(value)
        try {
          await table.put(header.id, copied)
        } catch (error) {
          if (isClosing(error)) continue
          throw error
        }
        written.push([table, copied])
      }
    } catch (error) {
      // Undo only copies this side chat still holds unchanged.
      for (const [table, copied] of written.reverse()) {
        try {
          if (table.get(header.id) === copied) await table.delete(header.id)
        } catch (rollback) {
          if (!isClosing(rollback)) throw new AggregateError([error, rollback], 'Side-chat preference copy failed and its rollback failed', { cause: error })
        }
      }
      throw error
    }
    if (written.length) ctx.emit('system-prompt/change')
  }

  async function remove(id) {
    for (const preference of PREFERENCES) {
      try {
        await tableOf(preference)?.delete(id)
      } catch (error) {
        if (!isClosing(error)) throw error
      }
    }
  }

  // Creation listeners run serially and are awaited before the side chat
  // accepts input, so its first request already sees the copied preferences.
  ctx.on('agent/created', ({ agent, source }) => {
    const header = agent.session.header
    if (source !== 'startup' || !isSideChat(header)) return
    return track(copy(header))
  })
  ctx.on('api-session/removed', id => {
    if (!id.startsWith(SIDE_PREFIX)) return
    void track(remove(id)).catch(error => ctx.logger.warn(`side-chat preference removal: ${error.message}`))
  })
}
