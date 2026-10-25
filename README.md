# dsh-side-chat

Full-capability side conversations for DeepSeek Harness Web.

## Usage

- **Start Side Chat** in the composer creates an ordinary conversation from the main session's current event boundary. It opens without making a model request. The main session keeps working.
- Side chats start with the main session's model, reasoning effort, working directory and agent preset. They are not delegated subagents and retain normal session capabilities.
- The header's **Side chats** menu switches between the main session and any of its side chats. Each side chat can be deleted there.
- Inside a side chat the native title breadcrumb shows **Main title / Side-chat title**. Click the main title to return directly to main. This explicit choice also resets that family's remembered sidebar destination to main. Native typography, separators, title updates, tabs and other header controls are reused. A real subagent opened below a side chat retains its own native lineage after these two titles.
- Header activity controls appear in this order: **Side chats → Subagents → Background jobs → Mode**. Native visibility rules remain unchanged, so absent activity does not add empty controls. The native background-jobs entry keeps its component and actions; only its ordering metadata changes. Unloading this plugin restores its original order.
- The sidebar remembers the last conversation viewed in each main session's family. Returning to that main session from the sidebar reopens the remembered side chat. Explicitly choosing main in the header stays on main. Handoff or deletion clears that side chat's remembered position. This preference is stored per browser and survives page refreshes.
- Inside a side chat the composer action becomes **Handoff Side Chat**. It asks that conversation to write a handoff, immediately returns the view to main, then delivers the finished report to main and permanently deletes the side chat. Failed or interrupted reports keep the side chat available.
- Archiving or deleting the main session cleans up its side chats. Deletion removes the side-chat log, descendants created as subagents, trash copies, projection entries and search-index rows. It never removes the main conversation or unrelated ordinary forks. Shared attachment objects are retained because other sessions can reference them. This is logical deletion, not forensic erasure of snapshots or backups.

UI labels follow DSH's language preference. The initial title is **Side Chat** in English or **侧边会话** in Chinese. After the first human input, the existing DSH title generator receives only that side-chat input. Explicit user renames are preserved. No numbered names are assigned.

## Context and handoff

The side chat inherits the main history through the opening boundary. On its first actual human input, one context message is added immediately after that inherited history and before the user's message:

> This is a side chat forked from the main session. The main session continues separately and does not see this conversation.

Opening alone neither sends this note to a model nor starts a turn. The note is committed once in the history, not repeatedly appended to the system prompt. The note remains model-facing context and is not displayed in the normal chat view. No custom compaction is performed.

Handoff asks:

> Write a handoff for the main session: a self-contained account of what happened here and what it needs to know or do.

Main receives `Handoff from a side chat:` followed by the final text. It is steered into a running main session or queued into an idle one. The report is accepted and flushed in main before deletion begins.

## Sidebar behavior

Side-chat identities start with `session-sidechat-`. A small client compatibility layer decorates the existing `sidebar.workspaces` component. It supplies a local projection of `useSessions` that excludes side chats from both `ids` and `byId` before the native grouping and five-row quota calculation. The global session store, host APIs and navigation remain unchanged.

This does not use CSS hiding, move DOM rows, detach workspace membership, or pretend ordinary sessions are subagents. Side chats do not appear under workspaces, Ungrouped, flat lists, or sidebar search, and do not consume the normal five-row quota. They remain ordinary sessions in host metadata, not private or access-restricted sessions.

Their native UI status is aggregated onto the visible main-session row in the sidebar, including flat and search views. A running side chat or its running subagents keeps that main row active and outside the idle-row quota. Native pending interactions retain priority, followed by running activity and unread completion reminders. The green dot uses DSH's own `completionUnread` state, which means an unread transition to idle, not proof of success. Viewing the corresponding side chat clears its native reminder; viewing only main does not acknowledge an unread side chat. No completion is invented for an already-idle baseline. These reminders follow DSH's normal browser-lifetime behavior and are not reconstructed after a page refresh. The global session/status stores and main-session run/stop controls are unchanged.

The stock server limits a content-search page before the sidebar projection; a query matching many side chats can therefore yield fewer visible matches. The projection does not alter another plugin's separately implemented session browser. Disable or uninstall this plugin only after handing off or deleting outstanding side chats, since native DSH has no hidden-session flag.

## Updates without restarting DSH

The published package has a stable entry and versioned host implementations. `npm run build` produces an immutable implementation URL and a release manifest. After updating from GitHub, the entry reads that manifest and switches implementations in place. It waits while a side chat is running, handing off, or being deleted. Agent handles and persistent state are owned by the stable entry rather than the replaceable implementation.

A failed new implementation is rolled back to the previous one. No global Node module cache is cleared and the plugin never restarts DSH. Frontend bundle updates may require a browser refresh. Updates to the stable entry itself, its dependency graph, or DSH's core are not covered by this mechanism and require separate review.

## Install

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-side-chat
```

## Compatibility

Tested against DSH **0.2.0-rc.2**. The sidebar entry decorator, native-header breadcrumb projection, header-order metadata update and registry notification, native title-provider selection, controller composition setup, and permanent deletion use small version-specific compatibility seams. Unsupported layouts fail visibly instead of silently dropping or deleting an unrelated session. No DSH source or other plugin is patched on disk.

The JSON storage backend persists relationships in the `side_chat` domain. Successful handoff/deletion removes each relationship. Interrupted handoffs are retained for review rather than automatically replayed after restart.

## Development

```sh
npm run build
```

Source host modules are in `lib/`. Publish generated `dist/host/<revision>/` and `release.json` together. Tests and temporary fixtures live in the gitignored `.cache/` directory.
