// Browser half, loaded by the DSH web shell as a classic script.
window.__ModuleLoader__.load({
  id: 'dsh-side-chat',
  factory: (require) => {
    const React = require('react')
    const { symbols } = require('@deepseek-ai/cordis')
    const { useEffect, useRef, useState } = React
    const { Fragment, jsx, jsxs } = require('react/jsx-runtime')
    const { createPortal } = require('react-dom')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
    const {
      Toast, StateDot,
      IconNewChatOutlineRegular, IconWorkspaceTreeOutlineRegular, IconChevronDownOutlineRegular,
      IconTrashOutlineRegular, IconWarningOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const ID = 'dsh-side-chat'
    const NS = 'side-chat'
    const SIDEBAR = 'sidebar.workspaces'
    const HEADER = 'conversation.session.header.actions'
    const WRAPPED = Symbol.for('dsh-side-chat.sidebar-wrapper')
    const LAST_VIEW = 'dsh-side-chat.last-view.v1'
    const isSideChat = (id) => id.startsWith('session-sidechat-')
    const identity = (value) => value
    const Empty = () => null
    const zh = {
      start: '开启 侧边会话', handoff: '交接 侧边会话', delete: '删除侧边会话',
      startVerb: '开启', handoffVerb: '交接',
      count: '{count} 个侧边会话', main: '主会话', side: '侧边会话',
      running: '运行中', idle: '空闲', handingOff: '正在交接…', deleting: '正在删除…',
      loadingSession: '正在加载会话…', refresh: '刷新',
      deleteTitle: '删除 {title}', deleteConfirm: '确定删除侧边会话“{title}”吗？此操作无法撤销。',
      commandError: '{action}失败：{message}', loadError: '侧边会话列表加载失败：{message}',
      serviceUnavailable: '服务暂时不可用（HTTP 503）', authenticationRequired: '登录已失效，请重新登录 DSH',
      httpError: '请求失败（HTTP {status}）', unexpectedResponse: '服务返回了非预期格式，请稍后重试',
      retrying: '，正在自动重试',
    }
    const en = {
      start: 'Start Side Chat', handoff: 'Handoff Side Chat', delete: 'Delete side chat',
      startVerb: 'Start', handoffVerb: 'Handoff',
      count: 'Side chats ({count})', main: 'Main session', side: 'Side Chat',
      running: 'Running', idle: 'Idle', handingOff: 'Handing off…', deleting: 'Deleting…',
      loadingSession: 'Loading session…', refresh: 'Refresh',
      deleteTitle: 'Delete {title}', deleteConfirm: 'Delete side chat “{title}”? This cannot be undone.',
      commandError: '{action} failed: {message}', loadError: 'Could not load side chats: {message}',
      serviceUnavailable: 'Service temporarily unavailable (HTTP 503)', authenticationRequired: 'Your login has expired. Sign in to DSH again',
      httpError: 'Request failed (HTTP {status})', unexpectedResponse: 'The server returned an unexpected response. Try again shortly',
      retrying: '. Retrying automatically',
    }
    // Catalog styling follows SubagentHeaderLineage. Flat leaf rows merge its
    // row/clickarea boxes to retain the same 7px inset without negative margins.
    const CSS = `
.dsh-sc-composer{flex:none;min-width:0}
.dsh-sc-composer.dsh-sc-composer{border-radius:var(--dsw-radius-sm);display:flex;align-items:center;height:28px;min-width:28px;max-width:min(160px,28cqw);padding:0 4px 0 8px;gap:0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:400;line-height:20px;cursor:pointer;background:0 0;border:none;outline:none}
.dsh-sc-composer:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-composer:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.dsh-sc-composer:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-sc-composerPrefix,.dsh-sc-composerText{display:var(--dsh-composer-model-text-display,block)}
.dsh-sc-composerPrefix{flex:none;color:var(--dsw-alias-label-caption);white-space:pre}
.dsh-sc-composerText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-composerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}
.dsh-sc-header{align-items:center;gap:10px;min-width:0;display:inline-flex;position:relative}
.dsh-sc-trigger{border-radius:var(--dsw-radius-sm);min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;gap:4px;padding:3px 2px;font-size:12px;font-weight:400;line-height:18px;display:inline-flex}
.dsh-sc-trigger:hover,.dsh-sc-trigger:focus-visible{color:var(--dsw-alias-label-primary)}
.dsh-sc-trigger svg{flex:none;transition:transform .12s}
.dsh-sc-chevronOpen{transform:rotate(180deg)}
.dsh-sc-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-activitySlot{flex:none;justify-content:center;align-items:center;width:14px;height:14px;display:inline-flex}
.dsh-sc-errorIcon{flex:none;color:var(--dsw-alias-state-error-primary)}
.dsh-sc-menu{z-index:100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:336px;max-width:min(400px,100vw - 32px);max-height:min(560px,100vh - 140px);box-shadow:var(--dsw-elevation-prominent);flex-direction:column;padding:3px;display:flex;position:fixed;overflow:hidden}
.dsh-sc-menu:before{content:"";z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);position:absolute;inset:0}
.dsh-sc-menuBody{flex-direction:column;flex:auto;min-height:0;display:flex;overflow:auto}
.dsh-sc-open{box-sizing:border-box;border-radius:var(--dsw-radius-lg);width:100%;min-height:44px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;outline:none;align-items:flex-start;gap:6px;padding:6px 7px;font-size:12px;line-height:17px;display:flex;position:relative}
.dsh-sc-open:hover,.dsh-sc-open:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-rowActivitySlot{flex:none;justify-content:center;align-items:center;width:14px;height:17px;display:inline-flex}
.dsh-sc-copy{flex-direction:column;flex:1;min-width:0;display:flex}
.dsh-sc-label,.dsh-sc-status{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.dsh-sc-label{color:inherit;font-weight:400}
.dsh-sc-open[aria-current=true] .dsh-sc-label{font-weight:600}
.dsh-sc-status{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}
.dsh-sc-error{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;white-space:normal;overflow-wrap:anywhere}
.dsh-sc-notice{color:var(--dsw-alias-label-tertiary);padding:8px 10px;font-size:11px;line-height:16px}
.dsh-sc-notice.dsh-sc-error{color:var(--dsw-alias-state-error-primary)}
.dsh-sc-delete{border-radius:var(--dsw-radius-sm);width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;flex:none;justify-content:center;align-items:center;margin:4px 0;padding:6px;display:inline-flex}
.dsh-sc-delete:hover,.dsh-sc-delete:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-sc-delete:disabled{cursor:default;opacity:.5}
@media(max-width:767px){
.dsh-sc-composer.dsh-sc-composer{padding:0 3px;max-width:100px}
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
    // Browser navigation only. An absent main key means the main itself, and
    // neither these ids nor the sidebar projection modify the session catalog.
    function createNavigation() {
      const remembered = new Map()
      const wrappers = new WeakMap()
      const waiting = new Set()
      let binding, selected
      try {
        const saved = JSON.parse(window.localStorage?.getItem(LAST_VIEW) ?? 'null')
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
          for (const [mainId, sideId] of Object.entries(saved)) {
            if (mainId && !isSideChat(mainId) && typeof sideId === 'string' && isSideChat(sideId)) remembered.set(mainId, sideId)
          }
        }
      } catch { /* Storage may be unavailable or contain an obsolete value. */ }
      const persist = () => {
        try { window.localStorage?.setItem(LAST_VIEW, JSON.stringify(Object.fromEntries(remembered))) }
        catch { /* Keep the same navigation memory when storage is unavailable. */ }
      }
      const ordinary = (id, catalog) => catalog.ids.includes(id) && catalog.byId[id]?.origin !== 'subagent' && binding.sessions.subagentAddress(id) === undefined
      const validSide = (mainId, sideId, catalog, state) => catalog.byId[sideId] !== undefined && state.records.some((record) => (
        record.sessionId === sideId && record.mainSessionId === mainId && !record.purgeRequested
        && record.state !== 'deleting' && record.state !== 'handoff'
      ))
      const ready = (catalog, state) => catalog.phase === 'ready' && state.loaded && !state.loadError
      const enqueue = (id) => {
        // Retain only the latest visit to each id while the sources catch up.
        waiting.delete(id)
        waiting.add(id)
      }
      const sync = () => {
        const catalog = binding.sessions.list.getSnapshot()
        const state = binding.state.getSnapshot()
        const current = Object.values(catalog.byId).find((row) => (row.retainedBy?.mainView ?? 0) > 0)?.id
        if (current !== selected) {
          selected = current
          if (current !== undefined) enqueue(current)
        }
        // Start navigates before its metadata refresh. Do not prune or consume
        // that visit until both full sources and the operation have settled.
        if (!ready(catalog, state) || Object.values(state.pending).includes('start')) return
        const before = JSON.stringify(Object.fromEntries(remembered))
        for (const [mainId, sideId] of remembered) {
          if (!ordinary(mainId, catalog) || !validSide(mainId, sideId, catalog, state)) remembered.delete(mainId)
        }
        for (const id of waiting) {
          if (!isSideChat(id)) {
            if (ordinary(id, catalog)) remembered.delete(id)
          } else {
            const record = state.records.find((entry) => entry.sessionId === id)
            if (record && ordinary(record.mainSessionId, catalog) && validSide(record.mainSessionId, id, catalog, state)) remembered.set(record.mainSessionId, id)
          }
        }
        waiting.clear()
        if (before !== JSON.stringify(Object.fromEntries(remembered))) persist()
      }
      return {
        connect(sessions, state) {
          binding = { sessions, state }
          const stopCatalog = sessions.list.subscribe(sync)
          const stopState = state.subscribe(sync)
          sync()
          return () => { stopCatalog(); stopState(); binding = undefined; selected = undefined; waiting.clear() }
        },
        record(id) {
          if (!binding) return
          // Explicit header/controller navigation is never redirected, including
          // a click on the already selected main before metadata is available.
          if (!isSideChat(id) && remembered.delete(id)) persist()
          enqueue(id)
          sync()
        },
        wrap(open) {
          if (typeof open !== 'function') return open
          if (!wrappers.has(open)) wrappers.set(open, function (...args) {
            const id = args[0]
            if (binding && remembered.has(id)) {
              const catalog = binding.sessions.list.getSnapshot(), state = binding.state.getSnapshot()
              const sideId = remembered.get(id)
              // A pending command blocks redirects, but only its outcome or host
              // metadata invalidates memory. Failed operations keep the last view.
              if (ready(catalog, state) && ordinary(id, catalog) && !state.pending[sideId] && validSide(id, sideId, catalog, state)) args[0] = sideId
            }
            return open.apply(this, args)
          })
          return wrappers.get(open)
        },
      }
    }
    function installSidebarFilter(ctx, navigation) {
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
              return React.createElement(Original, { ...props, useSessions: filteredHook(props.useSessions), open: navigation.wrap(props.open) })
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

    // DSH 0.2.0-rc.2 has no public update-order method. Adjust only the job
    // entry's order, retaining its component, scope, props and owner's disposer.
    function installHeaderOrder(ctx) {
      const slots = ctx.slots
      return slots.inject(HEADER, function* () {
        const registry = slots[symbols.original] ?? slots
        const core = registry._core
        const record = core?.records?.get(HEADER)
        if (!record || record.spec?.kind !== 'list' || typeof core.markDirty !== 'function') {
          throw new Error('Unsupported DSH header ordering API')
        }
        const patched = new Map()
        let stopped = false
        const notify = () => {
          record.entries = [...record.entries].sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0)
            || (a.options.order ?? 0) - (b.options.order ?? 0))
          core.markDirty(HEADER, record)
        }
        const reconcile = () => {
          if (stopped) return
          const entries = slots.entries(HEADER)
          for (const entry of patched.keys()) if (!entries.includes(entry)) patched.delete(entry)
          let changed = false
          for (const entry of entries) {
            if (entry.options.id !== 'job-list' || patched.has(entry) || entry.options.order === -20) continue
            const options = entry.options
            const descriptor = Object.getOwnPropertyDescriptor(options, 'order')
            Object.defineProperty(options, 'order', descriptor
              ? { ...descriptor, value: -20 }
              : { value: -20, writable: true, configurable: true, enumerable: true })
            patched.set(entry, { options, descriptor })
            changed = true
          }
          if (changed) notify()
        }
        yield () => {
          stopped = true
          let changed = false
          for (const [entry, { options, descriptor }] of patched) {
            if (!record.entries.includes(entry) || entry.options !== options || options.order !== -20) continue
            if (descriptor) Object.defineProperty(options, 'order', descriptor)
            else delete options.order
            changed = true
          }
          patched.clear()
          if (changed) notify()
        }
        yield ctx.on('slots/changed', key => { if (key === HEADER) reconcile() })
        yield slots.subscribe(HEADER, reconcile)
        reconcile()
      })
    }

    const errorFields = (error) => ({ message: error.message ?? String(error),
      ...(error.uiCode ? { uiCode: error.uiCode } : {}), ...(error.status ? { status: error.status } : {}) })
    const errorText = (error, t) => error.uiCode ? t(error.uiCode, { status: error.status }) : error.message
    function responseError(response) {
      const uiCode = response.ok ? 'unexpectedResponse' : response.status === 503 ? 'serviceUnavailable'
        : response.status === 401 ? 'authenticationRequired' : 'httpError'
      return Object.assign(new Error(response.ok ? 'Unexpected response format' : `HTTP ${response.status}`), { uiCode, status: response.status })
    }
    async function callHost(endpoint, payload, signal) {
      const response = await fetch(`api/side-chat/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      let result
      try { result = await response.json() }
      catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error
        if (!response.ok || error.name === 'SyntaxError') throw responseError(response)
        throw error
      }
      if (!response.ok || result?.ok !== true) {
        if (typeof result?.error?.message === 'string') throw Object.assign(new Error(result.error.message), { status: response.status })
        throw responseError(response)
      }
      if (!Object.hasOwn(result, 'value')) throw responseError(response)
      return result.value
    }

    function createController(ctx, navigation) {
      const state = createSnapshotStore({ records: [], loaded: false, loadError: null, loadFailure: null, actionError: null, pending: {} })
      const open = (sessionId) => {
        ctx.uiWorkspace.openSession(sessionId)
        navigation.record(sessionId)
      }
      const lifetime = new AbortController()
      let inFlight
      let revision = 0
      let errorId = 0
      let unavailableReads = 0
      const patch = (values) => {
        if (!lifetime.signal.aborted) state.set({ ...state.getSnapshot(), ...values })
      }
      const refresh = (fresh = false) => {
        if (lifetime.signal.aborted) return Promise.resolve()
        if (inFlight) return fresh ? inFlight.then(() => refresh()) : inFlight
        const started = revision
        inFlight = callHost('list', {}, lifetime.signal).then((value) => {
          if (started === revision) {
            unavailableReads = 0
            patch({ records: value.records, loaded: true, loadError: null, loadFailure: null })
          }
        }).catch((error) => {
          if (started !== revision || lifetime.signal.aborted) return
          unavailableReads = error.status === 503 ? unavailableReads + 1 : 0
          // A single unavailable poll is common during service reconfiguration.
          // Keep the accepted list and let the existing timer retry reads only.
          if (unavailableReads === 1) return
          patch({ loadError: error.message, loadFailure: errorFields(error) })
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
            if (isCurrent() && !state.getSnapshot().actionError) patch({ actionError: { id: ++errorId, action: 'refresh', ...errorFields(error) } })
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
          open(action === 'start' ? value.sessionId : value.mainSessionId)
        } catch (error) {
          if (isCurrent()) patch({ actionError: { id: ++errorId, action, ...errorFields(error) } })
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
        state, refresh, command, open,
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
      const busy = Boolean(state.pending[sessionId] || record?.purgeRequested) || record?.state === 'handoff' || record?.state === 'deleting'
      const label = t(side ? 'handoff' : 'start')
      const Icon = side ? IconWorkspaceTreeOutlineRegular : IconNewChatOutlineRegular
      return jsxs('button', {
        type: 'button', className: 'dsh-sc-composer',
        title: record?.state === 'handoff' ? `${label} · ${t('handingOff')}` : label,
        'aria-label': label, 'aria-busy': busy, disabled: busy,
        onClick: () => { void controller.command(side ? 'handoff' : 'start', sessionId, t('side')) },
        children: [
          jsx(Icon, { size: 16, className: 'dsh-sc-composerIcon' }),
          jsx('span', { className: 'dsh-sc-composerPrefix', children: `${t(side ? 'handoffVerb' : 'startVerb')} ` }),
          jsx('span', { className: 'dsh-sc-composerText', children: t('side') }),
        ],
      })
    }

    // Flat catalog counterpart of the official SubagentCatalogAction. The side
    // catalog has no nested branches, but shares its placement, hover and key flow.
    function SideChatsHeader({ sessionId, isSubagent, useCatalog, useSideChats, controller, t }) {
      const catalog = useCatalog(identity)
      const state = useSideChats(identity)
      const [open, setOpen] = useState(false)
      const [menuPosition, setMenuPosition] = useState()
      const [dismissedError, setDismissedError] = useState(null)
      const rootRef = useRef(null)
      const triggerRef = useRef(null)
      const menuRef = useRef(null)
      const hoverOpenTimer = useRef()
      const hoverCloseTimer = useRef()
      const pinnedRef = useRef(false)
      const current = state.records.find((record) => record.sessionId === sessionId)
      const mainId = isSideChat(sessionId) ? current?.mainSessionId : sessionId
      const sides = state.records.filter((record) => record.mainSessionId === mainId)
      const visible = !isSubagent() && sides.length > 0
      const isRunning = (id, record) => Boolean(catalog.byId[id]?.running || record?.state === 'handoff' || state.pending[id] === 'handoff')
      const running = sides.some((record) => isRunning(record.sessionId, record))
      const handingOff = sides.some((record) => (state.pending[record.sessionId] ?? record.state) === 'handoff')
      const commandError = state.actionError && t('commandError', { action: t(state.actionError.action), message: errorText(state.actionError, t) })
      const loadError = state.loadError && t('loadError', {
        message: errorText(state.loadFailure ?? { message: state.loadError }, t) + (state.loadFailure?.status === 503 ? t('retrying') : ''),
      })
      const error = commandError || loadError || sides.find((record) => record.error)?.error
      const toastError = commandError || loadError
      const toastKey = commandError ? `command:${state.actionError.id}` : loadError ? `list:${state.loadError}` : null
      const label = t('count', { count: sides.length })
      const triggerTitle = error || (handingOff ? `${label} · ${t('handingOff')}` : label)
      const placeMenu = () => {
        const trigger = triggerRef.current
        if (trigger === null) return
        const rect = trigger.getBoundingClientRect()
        const width = Math.min(336, window.innerWidth - 32)
        setMenuPosition({ top: rect.bottom + 5, left: Math.min(Math.max(16, rect.left), window.innerWidth - width - 16) })
      }
      const cancelHoverOpen = () => {
        clearTimeout(hoverOpenTimer.current)
        hoverOpenTimer.current = undefined
      }
      const cancelHoverClose = () => {
        clearTimeout(hoverCloseTimer.current)
        hoverCloseTimer.current = undefined
      }
      const changeOpen = (next, restoreFocus = false) => {
        cancelHoverOpen()
        cancelHoverClose()
        if (next) {
          if (triggerRef.current === null) return
          setOpen(true)
          placeMenu()
          void controller.refresh()
        } else {
          pinnedRef.current = false
          setOpen(false)
          setMenuPosition(undefined)
        }
        if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
      }
      const scheduleHoverOpen = () => {
        cancelHoverOpen()
        cancelHoverClose()
        if (open) return
        hoverOpenTimer.current = setTimeout(() => {
          hoverOpenTimer.current = undefined
          changeOpen(true)
        }, 150)
      }
      const scheduleHoverClose = () => {
        cancelHoverOpen()
        cancelHoverClose()
        if (pinnedRef.current) return
        hoverCloseTimer.current = setTimeout(() => {
          hoverCloseTimer.current = undefined
          changeOpen(false)
        }, 120)
      }
      useEffect(() => {
        if (!open) return
        const closeOutside = (event) => {
          if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) changeOpen(false)
        }
        document.addEventListener('pointerdown', closeOutside)
        window.addEventListener('resize', placeMenu)
        document.addEventListener('scroll', placeMenu, true)
        return () => {
          document.removeEventListener('pointerdown', closeOutside)
          window.removeEventListener('resize', placeMenu)
          document.removeEventListener('scroll', placeMenu, true)
        }
      }, [open])
      useEffect(() => () => { cancelHoverOpen(); cancelHoverClose() }, [])
      useEffect(() => {
        if (!visible) changeOpen(false)
      }, [visible])
      const treeItems = () => menuRef.current === null ? [] : Array.from(menuRef.current.querySelectorAll('[role="treeitem"]'))
      const focusAt = (index) => {
        const items = treeItems()
        if (items.length > 0) items[(index + items.length) % items.length].focus()
      }
      const navigate = (event) => {
        const items = treeItems()
        const index = items.indexOf(document.activeElement)
        if (event.key === 'Escape') { event.preventDefault(); changeOpen(false, true) }
        else if (event.key === 'Home') { event.preventDefault(); focusAt(0) }
        else if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1) }
        else if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(index + 1) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(index < 0 ? items.length - 1 : index - 1) }
      }
      const row = (id, record) => {
        const title = catalog.byId[id]?.displayTitle ?? id
        const pending = state.pending[id]
        const status = pending === 'delete' || (!pending && record?.state === 'deleting') ? t('deleting')
          : record?.state === 'handoff' || pending === 'handoff' ? t('handingOff')
            : t(catalog.byId[id] === undefined ? 'loadingSession' : catalog.byId[id].running ? 'running' : 'idle')
        const openSession = () => { controller.open(id); changeOpen(false) }
        return jsxs('div', {
          role: 'treeitem', tabIndex: 0, 'aria-level': 1, className: 'dsh-sc-open',
          'aria-current': id === sessionId ? 'true' : undefined, title,
          'aria-label': `${title} ${t(record ? 'side' : 'main')} ${status}`,
          onClick: openSession,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              openSession()
            }
          },
          children: [
            jsx('span', { className: 'dsh-sc-rowActivitySlot', children: jsx(StateDot, { state: isRunning(id, record) ? 'ongoing' : 'idle' }) }),
            jsxs('span', { className: 'dsh-sc-copy', children: [
              jsx('span', { className: 'dsh-sc-label', children: title }),
              jsx('span', { className: 'dsh-sc-status', children: `${t(record ? 'side' : 'main')} · ${status}` }),
              record?.error && jsx('span', { className: 'dsh-sc-error', role: 'alert', children: record.error }),
            ] }),
            record && jsx('button', {
              type: 'button', className: 'dsh-sc-delete',
              title: t('deleteTitle', { title }), 'aria-label': t('deleteTitle', { title }), disabled: pending === 'delete',
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (window.confirm(t('deleteConfirm', { title }))) void controller.command('delete', id)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              },
              children: jsx(IconTrashOutlineRegular, { size: 16 }),
            }),
          ],
        }, id)
      }
      return jsxs(Fragment, {
        children: [
          visible && jsxs('div', {
            ref: rootRef, className: 'dsh-sc-header', onKeyDown: navigate, onMouseLeave: scheduleHoverClose,
            children: [
              jsxs('button', {
                ref: triggerRef, type: 'button', className: 'dsh-sc-trigger',
                'aria-haspopup': 'tree', 'aria-expanded': open, 'aria-label': triggerTitle, title: triggerTitle,
                onMouseEnter: scheduleHoverOpen,
                onClick: () => {
                  cancelHoverOpen()
                  cancelHoverClose()
                  pinnedRef.current = true
                  if (!open) changeOpen(true)
                },
                onKeyDown: (event) => {
                  if (event.key !== 'ArrowDown') return
                  event.preventDefault()
                  if (!open) changeOpen(true)
                  queueMicrotask(() => focusAt(0))
                },
                children: [
                  running && jsx('span', { className: 'dsh-sc-activitySlot', role: 'status', 'aria-label': t(handingOff ? 'handingOff' : 'running'), children: jsx(StateDot, { state: 'ongoing' }) }),
                  jsx('span', { className: 'dsh-sc-ellipsis', children: label }),
                  error && jsx(IconWarningOutlineRegular, { size: 14, className: 'dsh-sc-errorIcon' }),
                  jsx(IconChevronDownOutlineRegular, { className: open ? 'dsh-sc-chevronOpen' : undefined }),
                ],
              }),
              open && createPortal(jsx('div', {
                ref: menuRef, className: 'dsh-sc-menu', style: menuPosition,
                onMouseEnter: cancelHoverClose, onMouseLeave: scheduleHoverClose,
                children: jsxs('div', {
                  className: 'dsh-sc-menuBody', role: 'tree', 'aria-label': label,
                  children: [
                    (commandError || loadError) && jsx('div', { className: 'dsh-sc-notice dsh-sc-error', role: 'alert', children: commandError || loadError }),
                    mainId !== undefined && row(mainId),
                    ...sides.map((record) => row(record.sessionId, record)),
                  ],
                }),
              }), document.body),
            ],
          }),
          toastError && dismissedError !== toastKey && jsx(Toast, {
            text: toastError, icon: jsx(IconWarningOutlineRegular, {}), onDone: () => setDismissedError(toastKey),
          }, toastKey),
        ],
      })
    }

    // Filter installation does not wait for the catalog or workspace service.
    // Slot declaration injection follows cold boot, layer unload and re-registration.
    const inject = ['slots']
    function apply(ctx) {
      const navigation = createNavigation()
      installSidebarFilter(ctx, navigation)
      installHeaderOrder(ctx)
      ctx.inject(['sessions', 'locale', 'uiWorkspace'], (ctx) => {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-chat: dictionaries')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', ID)
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'side-chat: styles')
        const controller = createController(ctx, navigation)
        ctx.effect(() => controller.dispose, 'side-chat: polling')
        ctx.effect(() => navigation.connect(ctx.sessions, controller.state), 'side-chat: navigation')
        const injectSeat = (sessionId) => ({
          controller,
          isSubagent: () => ctx.sessions.subagentAddress(sessionId) !== undefined,
          hooks: { catalog: ctx.sessions.list, sideChats: controller.state },
        })
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: ID, order: -20, locale: NS, inject: injectSeat,
        }, ComposerButton))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions', id: ID, order: -40, locale: NS, inject: injectSeat,
        }, SideChatsHeader))
      })
    }
    return { name: ID, inject, apply }
  },
})
