# React Advanced State Hook

A powerful React hook that extends useState with optional persistence, debouncing, and advanced cross-component/cross-tab state synchronization.

- Persist State: Save state to localStorage or sessionStorage.
- Debounce Updates: Automatically debounce state setters.
- Cross-Component Sync: Share state between components without prop drilling (similar to Zustand).
- Cross-Tab Sync: Share state between different browser tabs.
- Scoped Storage: Automatically scope persisted state to URL parameters (like appId) or URL path segments (like `$1-$2`).

## Install

```bash
npm install react-advanced-state-hook
```

## Quick Start

### 1. Wrap Your App

Wrap your application (or the part of your app that will use the hook) with the `AdvancedStateProvider`.

```js
// In your main index.js or App.js
import React from 'react'
import ReactDOM from 'react-dom'
import App from './App'
import { AdvancedStateProvider } from 'react-advanced-state-hook'

ReactDOM.render(
  <React.StrictMode>
    <AdvancedStateProvider>
      <App />
    </AdvancedStateProvider>
  </React.StrictMode>,
  document.getElementById('root')
)
```

### 2. Use the Hook

Use the `useAdvancedState` hook just like `useState`, but with a unique key and an options object.

```js
import { useAdvancedState } from 'react-advanced-state-hook'

// --- Component A ---
// Assuming URL is: https://example.com/app/project-123/editor?appId=my-app

const ComponentA = () => {
  // This state is scoped by URL parameter:
  const [name, setName] = useAdvancedState('username', {
    initial: 'Guest',
    persist: 'local',
    notify: 'cross-component-and-tab',
    scopeByUrlParam: 'appId' // Key will be scoped to 'my-app'
  })

  // This state is scoped by URL path:
  const [docId, setDocId] = useAdvancedState('currentDoc', {
    initial: null,
    persist: 'local',
    scopeByUrlPath: '$2' // Key will be scoped to 'project-123'
  })

  return (
    <div>
      <h3>Component A (Editor)</h3>
      <input type='text' value={name} onChange={e => setName(e.target.value)} />
      <p>Current Doc Scope: {docId}</p>
    </div>
  )
}

// --- Component B (in a different part of your app) ---

const ComponentB = () => {

  // This component will update in real-time with ComponentA
  // because they share the same key ('username')

  const [name] = useAdvancedState('username', {
    initial: 'Guest',
    notify: 'cross-component', // Just listens for context updates
    scopeByUrlParam: 'appId' // Must use same scope to sync
  })

  return (
    <div>
      <h3>Component B (Viewer)</h3>
      <p>Current user: {name}</p>
    </div>
  )
}
```

## Running the Example Project

This repository includes an `/example` folder so you can test the hook.

To run it:

1. Clone the repository.

2. Set up a simple React project (using Vite, Next.js, or `create-react-app`).

3. Inside your test project's src folder, copy the `useAdvancedState.js` file (or `src/index.js`) from this library.

4. Copy the `example/App.js` and `example/index.js` files into your test project's src folder (you can overwrite the existing `App.js` and `index.js`).

5. Make sure the imports are correct (e.g., `import { useAdvancedState } from './useAdvancedState'`).

6. Run `npm install` and `npm run dev` (or `npm start`).

The example app will open in your browser, and you can follow the on-screen instructions to test persistence, cross-tab sync, and scoping.

## API

`useAdvancedState(key, options)`

- `key` (string): **Required**. A unique string key to identify this piece of state.
- `options` (object): An optional configuration object.
  - `initial` (any): The initial value to use if no value is found in storage.
  - `debounce` (number): Time in milliseconds to debounce the `setValue` function. Defaults to `0` (no debounce).
  - `persist` (`'local'` | `'session'`): The persistence strategy.
    - `'local'`: Persist to localStorage.
    - `'session'`: Persist to sessionStorage.
  - `notify` (`'cross-component'` | `'cross-tab'` | `'cross-component-and-tab'`): The notification strategy.
    - if not defined behaves like `useState`, local to the component.
    - `'cross-component'`: Shares state with other components in the same tab (requires `AdvancedStateProvider`).
    - `'cross-tab'`: Notifies other tabs (requires `persist`).
    - `'cross-component-and-tab'`: Does both (requires `AdvancedStateProvider` and `persist`).
  - `scopeByUrlParam` (string): A URL parameter name (e.g., `'appId'`) to scope the persisted state. Mutually exclusive with `scopeByUrlPath`.
  - `scopeByUrlPath` (string): A string pattern to scope the persisted state. Placeholders ($1, $2, etc.) are replaced with the corresponding URL path segments (1-indexed). Mutually exclusive with `scopeByUrlParam`.
    - Example: `scopeByUrlPath`: `'doc_$2-user_$4'`
    - On URL `/app/project-abc/docs/user-xyz/edit`
    - `$1` is `app`, `$2` is `project-abc`, `$3` is `docs`, `$4` is `user-xyz`
    - Resulting scope key: `doc_project-abc-user_user-xyz`

## Best Practices & Caveats

To ensure your state stays in sync and behaves predictably, follow these simple rules.

### Rule 1: Be consistent with configuration.

All components that use the same key should also use the exact same values for persist, scopeByUrlParam, and scopeByUrlPath. Using different configurations for the same key will lead to desynchronized state and unpredictable behavior.

### Rule 2: The initial value is "first-come, first-served".

If multiple components use the same key, the initial value from the first component to mount will be used. All other components will ignore their initial value and use the one that was already set.

### Rule 3: Scoping only applies when persist is set.

The scopeByUrlParam and scopeByUrlPath options are only used to create the storage key for localStorage or sessionStorage. If you do not set the persist option, these scoping options are ignored.
