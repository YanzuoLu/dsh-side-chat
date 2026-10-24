// Browser half, loaded by the DSH web shell as a classic script.
window.__ModuleLoader__.load({
  id: 'dsh-side-chat',
  factory: (require) => {
    const React = require('react')
    const { useState } = React
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const {
      Button, Menu, Toast,
      IconNewChatOutlineRegular, IconWorkspaceTreeOutlineRegular,
      IconTrashOutlineRegular, IconWarningOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const ID = 'dsh-side-chat'
    const NS = 'side-chat'
    const SIDEBAR = 'sidebar.workspaces'
    const WRAPPED = Symbol.for('dsh-side-chat.sidebar-wrapper')
    const isSideChat = (id) => id.startsWith('session-sidechat-')
    const identity = (value) => value
    const Empty = () => null
    const zh = {
      start: '开启侧边会话', handoff: '交接会话', delete: '删除侧边会话',
      count: '侧边会话 {count}', main: '主会话', side: '侧边会话',
      running: '运行中', idle: '空闲', handingOff: '正在交接…', deleting: '正在删除…',
      loading: '正在加载侧边会话…', missing: '找不到此侧边会话的关联信息。',
      loadingSession: '正在加载会话…', refresh: '刷新',
      deleteTitle: '删除 {title}', deleteConfirm: '确定删除侧边会话“{title}”吗？此操作无法撤销。',
      commandError: '{action}失败：{message}', loadError: '侧边会话列表加载失败：{message}',
    }
    const en = {
      start: 'Start Side Chat', handoff: 'Handoff Session', delete: 'Delete side chat',
      count: 'Side chats ({count})', main: 'Main session', side: 'Side Chat',
      running: 'Running', idle: 'Idle', handingOff: 'Handing off…', deleting: 'Deleting…',
      loading: 'Loading side chats…', missing: 'The relationship for this side chat could not be found.',
      loadingSession: 'Loading session…', refresh: 'Refresh',
      deleteTitle: 'Delete {title}', deleteConfirm: 'Delete side chat “{title}”? This cannot be undone.',
      commandError: '{action} failed: {message}', loadError: 'Could not load side chats: {message}',
    }
    const CSS = `
.dsh-sc-composer{flex:none;min-width:0}
.dsh-sc-composer.dsh-sc-composer{height:28px;min-width:28px;max-width:min(160px,28cqw);padding:0 6px;gap:0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400}
.dsh-sc-composerText{display:var(--dsh-composer-model-text-display,block);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-composerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.dsh-sc-header{display:flex;align-items:center;min-width:0;gap:4px}
.dsh-sc-trigger.dsh-sc-trigger{max-width:min(240px,38vw);gap:4px;padding:0 6px;font-size:12px;font-weight:400}
.dsh-sc-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-activity{flex:none;color:var(--dsw-alias-label-secondary);font-size:11px}
.dsh-sc-errorIcon{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-sc-menu.dsh-sc-menu{box-sizing:border-box;width:340px;min-width:0;max-width:calc(100vw - 24px);max-height:min(480px,70vh)}
.dsh-sc-row{display:flex;align-items:center;gap:4px;min-width:0}
.dsh-sc-open.dsh-sc-open{flex:1;min-width:0;height:auto;justify-content:flex-start;text-align:left;padding:7px 8px;white-space:normal}
.dsh-sc-open[aria-current=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-copy{display:flex;flex-direction:column;min-width:0;gap:2px;width:100%}
.dsh-sc-status{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400;line-height:16px}
.dsh-sc-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;white-space:normal;overflow-wrap:anywhere}
.dsh-sc-notice{padding:8px;font-size:12px;line-height:18px}
.dsh-sc-delete.dsh-sc-delete{flex:none;width:28px;padding:0;color:var(--dsw-alias-label-tertiary)}
.dsh-sc-delete:hover{color:var(--dsw-alias-state-error-primary)}
@media(max-width:767px){
.dsh-sc-composer.dsh-sc-composer{padding:0 3px;max-width:100px}
.dsh-sc-trigger.dsh-sc-trigger{max-width:42vw;padding:0 4px}
.dsh-sc-activity{font-size:10px}
}
`

    // Only the workspace browser's input is projected. Header/navigation sources
    // remain intact. Both axes must be filtered before grouping, quotas and search.
    const projections = new WeakMap()
    const filteredHooks = new WeakMap()
    function projectSessions(snapshot) {
      let projected = projections.get(snapshot)
      if (projected === undefined) {
        projected = {
          ...snapshot,
          ids: snapshot.ids.filter((id) => !isSideChat(id)),
          byId: Object.fromEntries(Object.entries(snapshot.byId).filter(([id]) => !isSideChat(id))),
        }
        projections.set(snapshot, projected)
      }
      return projected
    }
    function filteredHook(useSessions) {
      let hook = filteredHooks.get(useSessions)
      if (hook === undefined) {
        hook = (selector, equal) => useSessions((snapshot) => selector(projectSessions(snapshot)), equal)
        filteredHooks.set(useSessions, hook)
      }
      return hook
    }
    function installSidebarFilter(ctx) {
      const slots = ctx.slots
      return slots.inject(SIDEBAR, function* () {
        const patched = new Map()
        let stopped = false
        const reconcile = () => {
          if (stopped) return
          const entries = slots.entries(SIDEBAR)
          for (const entry of patched.keys()) if (!entries.includes(entry)) patched.delete(entry)
          for (const entry of entries) {
            const Original = entry.component
            if (Original === Empty || Original[WRAPPED]) continue
            function SideChatWorkspace(props) {
              return React.createElement(Original, { ...props, useSessions: filteredHook(props.useSessions) })
            }
            SideChatWorkspace[WRAPPED] = true
            patched.set(entry, { Original, wrapper: SideChatWorkspace })
            // Do not replace the entry or re-register its children/store/inject/locale.
            entry.component = SideChatWorkspace
          }
        }
        yield ctx.on('slots/changed', (key) => {
          if (key === SIDEBAR) reconcile()
        })
        yield slots.subscribe(SIDEBAR, reconcile)
        reconcile()
        const pulseOptions = () => ({
          name: SIDEBAR,
          priority: Math.max(1e9, ...slots.entries(SIDEBAR).map((entry) => entry.options.priority ?? 0)) + 1,
        })
        // A component mutation alone does not notify RootEntry. The empty loser
        // bumps the real registry version without taking ownership of child slots.
        slots.register(pulseOptions(), Empty)()
        // Cordis forbids registering effects on an unloading fiber. Pre-arm the
        // unload pulse and remove it only AFTER restoring the original components.
        yield slots.register(pulseOptions(), Empty)
        yield () => {
          stopped = true
          for (const [entry, { Original, wrapper }] of patched) {
            if (entry.component === wrapper) entry.component = Original
          }
          patched.clear()
        }
      })
    }

    async function callHost(endpoint, payload, signal) {
      const response = await fetch(`api/side-chat/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      const result = await response.json()
      if (!result.ok) throw new Error(result.error.message)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return result.value
    }

    function createController(ctx) {
      const state = createSnapshotStore({ records: [], loaded: false, loadError: null, actionError: null, pending: {} })
      const lifetime = new AbortController()
      let inFlight
      let revision = 0
      let errorId = 0
      const patch = (values) => {
        if (!lifetime.signal.aborted) state.set({ ...state.getSnapshot(), ...values })
      }
      const refresh = (fresh = false) => {
        if (lifetime.signal.aborted) return Promise.resolve()
        if (inFlight) return fresh ? inFlight.then(() => refresh()) : inFlight
        const started = revision
        inFlight = callHost('list', {}, lifetime.signal).then((value) => {
          if (started === revision) patch({ records: value.records, loaded: true, loadError: null })
        }).catch((error) => {
          if (started === revision) patch({ loadError: error.message })
        }).finally(() => { inFlight = undefined })
        return inFlight
      }
      const operations = new Map()
      const command = async (action, sessionId, initialTitle = 'Side Chat') => {
        const previous = state.getSnapshot().pending[sessionId]
        if (lifetime.signal.aborted || (previous && (action !== 'delete' || previous === 'delete'))) return
        // Delete may supersede an outstanding handoff. Its late reply must not
        // change navigation, errors or the newer operation's pending marker.
        const operation = {}
        operations.set(sessionId, operation)
        const isCurrent = () => !lifetime.signal.aborted && operations.get(sessionId) === operation
        const refreshCatalog = async () => {
          try {
            await ctx.sessions.refresh()
            return true
          } catch (error) {
            if (isCurrent() && !state.getSnapshot().actionError) patch({ actionError: { id: ++errorId, action: 'refresh', message: error.message } })
            return false
          }
        }
        let catalogRefresh
        revision += 1
        patch({ actionError: null, pending: { ...state.getSnapshot().pending, [sessionId]: action } })
        try {
          const payload = action === 'start' ? { sessionId, requestId: crypto.randomUUID(), initialTitle } : { sessionId }
          const value = await callHost(action, payload, lifetime.signal)
          if (!isCurrent()) return
          revision += 1
          if (action === 'start') {
            // openSession resolves catalog identities. A newly created id must
            // be loaded before navigation, independently of broadcast timing.
            catalogRefresh = refreshCatalog()
            if (!await catalogRefresh || !isCurrent()) return
          }
          if (action === 'handoff') patch({ records: state.getSnapshot().records.map((record) => record.sessionId === sessionId ? { ...record, state: 'handoff', error: undefined } : record) })
          if (action === 'delete') patch({ records: state.getSnapshot().records.filter((record) => record.sessionId !== sessionId) })
          // Handoff returns before background work completes. Go back immediately,
          // then keep polling metadata. Failures remain on the host's side record.
          ctx.uiWorkspace.openSession(action === 'start' ? value.sessionId : value.mainSessionId)
        } catch (error) {
          if (isCurrent()) patch({ actionError: { id: ++errorId, action, message: error.message } })
        } finally {
          if (!isCurrent()) return
          await Promise.all([refresh(true), catalogRefresh ?? refreshCatalog()])
          if (!isCurrent()) return
          operations.delete(sessionId)
          const pending = { ...state.getSnapshot().pending }
          delete pending[sessionId]
          patch({ pending })
        }
      }
      const timer = setInterval(() => { void refresh() }, 5000)
      void refresh()
      return {
        state, refresh, command,
        open: (sessionId) => ctx.uiWorkspace.openSession(sessionId),
        dispose: () => {
          lifetime.abort()
          clearInterval(timer)
        },
      }
    }

    function ComposerButton({ sessionId, isSubagent, useCatalog, useSideChats, controller, t }) {
      useCatalog(identity)
      const state = useSideChats(identity)
      if (isSubagent()) return null
      const side = isSideChat(sessionId)
      const record = state.records.find((entry) => entry.sessionId === sessionId)
      const busy = Boolean(state.pending[sessionId]) || record?.state === 'handoff' || record?.state === 'deleting'
      const label = t(side ? 'handoff' : 'start')
      const Icon = side ? IconWorkspaceTreeOutlineRegular : IconNewChatOutlineRegular
      return jsxs(Button, {
        type: 'button', variant: 'ghost', size: 'sm', className: 'dsh-sc-composer',
        title: record?.state === 'handoff' ? `${label} · ${t('handingOff')}` : label,
        'aria-label': label, 'aria-busy': busy, disabled: busy,
        onClick: () => { void controller.command(side ? 'handoff' : 'start', sessionId, t('side')) },
        children: [jsx(Icon, { size: 16, className: 'dsh-sc-composerIcon' }), jsx('span', { className: 'dsh-sc-composerText', children: label })],
      })
    }

    function SideChatsHeader({ sessionId, isSubagent, useCatalog, useSideChats, controller, t }) {
      const catalog = useCatalog(identity)
      const state = useSideChats(identity)
      const [open, setOpen] = useState(false)
      const [dismissedError, setDismissedError] = useState(null)
      if (isSubagent()) return null
      const current = state.records.find((record) => record.sessionId === sessionId)
      const mainId = isSideChat(sessionId) ? current?.mainSessionId : sessionId
      const sides = state.records.filter((record) => record.mainSessionId === mainId)
      const handingOff = sides.some((record) => (state.pending[record.sessionId] ?? record.state) === 'handoff')
      const commandError = state.actionError && t('commandError', { action: t(state.actionError.action), message: state.actionError.message })
      const loadError = state.loadError && t('loadError', { message: state.loadError })
      const error = commandError || loadError || sides.find((record) => record.error)?.error
      const label = t('count', { count: sides.length })
      const titleOf = (id) => catalog.byId[id]?.displayTitle ?? id
      const row = (id, record) => {
        const title = titleOf(id)
        const pending = state.pending[id]
        const status = pending === 'delete' || (!pending && record?.state === 'deleting') ? t('deleting')
          : record?.state === 'handoff' || pending === 'handoff' ? t('handingOff')
            : t(catalog.byId[id] === undefined ? 'loadingSession' : catalog.byId[id].running ? 'running' : 'idle')
        return jsxs('div', {
          className: 'dsh-sc-row',
          children: [
            jsx(Button, {
              type: 'button', variant: 'ghost', size: 'sm', role: 'menuitem', className: 'dsh-sc-open',
              'aria-current': id === sessionId ? 'true' : undefined, title,
              onClick: () => { setOpen(false); controller.open(id) },
              children: jsxs('span', { className: 'dsh-sc-copy', children: [
                jsx('span', { className: 'dsh-sc-ellipsis', children: title }),
                jsx('span', { className: 'dsh-sc-status', children: `${t(record ? 'side' : 'main')} · ${status}` }),
                record?.error && jsx('span', { className: 'dsh-sc-error', role: 'alert', children: record.error }),
              ] }),
            }),
            record && jsx(Button, {
              type: 'button', variant: 'ghost', size: 'sm', role: 'menuitem', className: 'dsh-sc-delete',
              title: t('deleteTitle', { title }), 'aria-label': t('deleteTitle', { title }),
              disabled: pending === 'delete',
              onClick: () => {
                if (window.confirm(t('deleteConfirm', { title }))) void controller.command('delete', id)
              },
              children: jsx(IconTrashOutlineRegular, { size: 16 }),
            }),
          ],
        }, id)
      }
      return jsxs('div', {
        className: 'dsh-sc-header',
        children: [
          jsx(Menu, {
            open, portal: true, align: 'end', autoFocus: true, compact: true, listClassName: 'dsh-sc-menu',
            onClose: () => setOpen(false),
            anchor: jsxs(Button, {
              type: 'button', variant: 'toolbar', size: 'sm', className: 'dsh-sc-trigger',
              'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': `${label}${error ? ` · ${error}` : ''}`,
              title: error || label,
              onClick: () => { setOpen(!open); if (!open) void controller.refresh() },
              children: [
                jsx('span', { className: 'dsh-sc-ellipsis', children: label }),
                handingOff && jsx('span', { className: 'dsh-sc-activity', role: 'status', children: t('handingOff') }),
                error && jsx(IconWarningOutlineRegular, { size: 14, className: 'dsh-sc-errorIcon' }),
              ],
            }),
            children: [
              (commandError || loadError) && jsx('div', { className: 'dsh-sc-notice dsh-sc-error', role: 'alert', children: commandError || loadError }),
              !state.loaded && jsx('div', { className: 'dsh-sc-notice', role: 'status', children: t('loading') }),
              mainId !== undefined && row(mainId),
              ...sides.map((record) => row(record.sessionId, record)),
              state.loaded && mainId === undefined && jsx('div', { className: 'dsh-sc-notice dsh-sc-error', role: 'alert', children: t('missing') }),
              loadError && jsx(Button, { type: 'button', role: 'menuitem', size: 'sm', onClick: () => { void controller.refresh() }, children: t('refresh') }),
            ],
          }),
          commandError && dismissedError !== state.actionError.id && jsx(Toast, {
            text: commandError, icon: jsx(IconWarningOutlineRegular, {}),
            onDone: () => setDismissedError(state.actionError.id),
          }, state.actionError.id),
        ],
      })
    }

    // Filter installation does not wait for the catalog or workspace service.
    // Slot declaration injection follows cold boot, layer unload and re-registration.
    const inject = ['slots']
    function apply(ctx) {
      installSidebarFilter(ctx)
      ctx.inject(['sessions', 'locale', 'uiWorkspace'], (ctx) => {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-chat: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', ID)
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'side-chat: styles')
        const controller = createController(ctx)
        ctx.effect(() => controller.dispose, 'side-chat: polling')
        const injectSeat = (sessionId) => ({
          controller,
          isSubagent: () => ctx.sessions.subagentAddress(sessionId) !== undefined,
          hooks: { catalog: ctx.sessions.list, sideChats: controller.state },
        })
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: ID, order: -20, locale: NS, inject: injectSeat,
        }, ComposerButton))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions', id: ID, locale: NS, inject: injectSeat,
        }, SideChatsHeader))
      })
    }
    return { name: ID, inject, apply }
  },
})
