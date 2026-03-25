# React Advanced State Hook

A powerful React hook that extends `useState` with synchronous Web Storage, asynchronous IndexedDB persistence, debouncing, and advanced cross-component/cross-tab state synchronization.

This hook is designed to be a lightweight, flexible, and enterprise-grade solution for managing complex state in React applications, acting as a drop-in replacement for `useState`.

## Features

- **Multi-Engine Persistence:** Easily persist state to `localStorage`, `sessionStorage`, or seamlessly scale up to **IndexedDB** for massive datasets.
- **Tab-Isolated Database (`sessiondb`):** Get the massive capacity of IndexedDB with the tab-isolated, ephemeral lifespan of `sessionStorage`. Includes an automatic background garbage collector to prevent ghost data.
- **Centralized Configuration:** Define your state's schema and default values in one central provider.
- **Cross-Component Sync:** Share state between components in the same tab instantly (like Zustand).
- **Cross-Tab Sync:** Share state between multiple browser tabs in real-time using native Storage events and BroadcastChannel API.
- **Storage Quota Safety:** Safely catches `QuotaExceededError` if Web Storage fills up, intelligently clearing stale session data or gracefully falling back to in-memory state without crashing your app.
- **Flexible Scoping:** Scope persistent state by URL parameters (e.g., `?appId=123`) or URL path (e.g., `/users/456/`).
- **Debouncing:** Debounce high-frequency persistence and cross-tab notifications to prevent thrashing the disk or network.
- **SSR Safe:** Fully compatible with Server-Side Rendering (SSR) frameworks like Next.js and Remix via isomorphic effect fallback.

## Installation

```bash
npm install react-advanced-state-hook
```

## Quick Start

Wrap your application (or the part that needs shared state) with the `AdvancedStateProvider`. Define your persistent state schema using the `defaults` prop.

```jsx
// In your index.js or App.js
import React from 'react'
import ReactDOM from 'react-dom'
import App from './App'
import { AdvancedStateProvider } from 'react-advanced-state-hook'

// Define your app's shared, persistent state schema
const appStateDefaults = [
  {
    key: 'username',
    initial: 'Guest',
    persist: 'local', // Synchronous localStorage
    scopeByUrlParam: 'userId'
  },
  {
    key: 'heavyDashboardData',
    initial: null,
    persist: 'localdb' // Asynchronous IndexedDB for large objects
  }
]

ReactDOM.render(
  <React.StrictMode>
    <AdvancedStateProvider prefix='myApp' defaults={appStateDefaults}>
      <App />
    </AdvancedStateProvider>
  </React.StrictMode>,
  document.getElementById('root')
)
```

Now use the hook anywhere in your app. It will _automatically inherit_ the `persist` and `scope` settings from the provider.

```jsx
import { useAdvancedState } from 'react-advanced-state-hook'

function Dashboard() {
  const [data, setData, meta] = useAdvancedState('heavyDashboardData', {
    notify: 'cross-tab' // Sync this large IDB object across tabs!
  })

  // Because IDB is asynchronous, we can use meta.isInitializing to show a loader
  if (meta.isInitializing) {
    return <div>Loading data from database...</div>
  }

  return (
    <div>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={() => setData({ new: 'data' })}>Update</button>
    </div>
  )
}
```

## API

### `useAdvancedState(key, options)`

This is the main hook you will use. It takes a required `key` and an optional `options` object.

#### Options

- **`initial`** (any) The initial value to use if no value is found in storage.
- **`debounce`** (number) Debounce delay in milliseconds. Applies only to persistence and notifications, not the local React UI update.
- **`persist`** (string) Specifies the storage engine:
  - `'local'`: Synchronous `localStorage` (Strings/JSON, ~5MB limit).
  - `'session'`: Synchronous `sessionStorage` (Tab-scoped, ~5MB limit).
  - `'localdb'`: Asynchronous `IndexedDB` (Native JS Objects, gigabytes of capacity, persistent).
  - `'sessiondb'`: Asynchronous `IndexedDB` (Tab-scoped via unique fingerprinting, automatically garbage-collected).
  - If not set, state is in-memory only.
- **`notify`** (string) Defines the synchronization strategy:
  - `'cross-component'`: Syncs components in the same tab.
  - `'cross-tab'`: Syncs across multiple open tabs/windows.
  - `'cross-component-and-tab'`: Does both.
- **`scopeByUrlParam`** (string) Scopes storage key by a URL parameter (e.g., `'appId'` maps to `?appId=...`).
- **`scopeByUrlPath`** (string) Scopes storage key by URL path segments using `$1`, `$2` placeholders.

#### Returns: `[value, setValue, meta]`

- **`value`**: The current state value.
- **`setValue`**: The setter function. Accepts a new value or a callback `(prev) => new_value`.
- **`meta`** (object):
  - **`isInitializing`** (boolean): `true` while asynchronous engines (`localdb`, `sessiondb`) are fetching the initial payload from disk. Turns `false` when the data is ready. (Always `false` for synchronous Web Storage).
  - **`isCached`** (boolean): `true` if the value was successfully loaded from storage/cache rather than falling back to the `initial` default. Useful for preventing redundant network calls.
  - **`get`** (function): A synchronous getter method `() => value`. Highly useful inside complex async callbacks or event listeners to read the latest state without adding the state variable to a dependency array.

### `<AdvancedStateProvider>`

Required for cross-component notifications and centralized configuration. It also handles eager-writing defaults to storage and running the background garbage collector for `sessiondb`.

#### Props

- **`prefix`** (string) A custom prefix for all storage keys. Defaults to `'advState'`.
- **`defaults`** (Array\<object\>) **Recommended.** An array of default configurations for your persistent state keys.

## Storage Key Format

The hook generates a clean, readable key for storage to prevent collisions:

`<prefix>:<scopeValue>:<key>`

- `myApp:username` (Standard)
- `myApp:123:docTitle` (Scoped by URL param)
- `__sessiondb__:<tab-fingerprint>:myApp:draft` (Tab-isolated IndexedDB)

## How is this different from Zustand?

Zustand creates a single, global store that holds all your state in one object. This hook is an **"atomic"** state manager (like Recoil or Jotai), where each piece of state is managed independently by its key.

When Zustand's persist middleware saves, it stringifies your _entire state object_. This hook allows you to mix and match storage engines—keeping UI toggles in synchronous `localStorage` while routing massive datasets to asynchronous `IndexedDB`—only updating the exact key that changed.

## Best Practices & Caveats

- **Asynchronous Initial Renders:** When using `localdb` or `sessiondb`, the hook will synchronously return your `initial` value on the very first render, and then trigger a re-render a few milliseconds later once the database responds. Use `meta.isInitializing` to prevent UI flicker.
- **Centralize Your Schema:** Define all persistent state in the `defaults` prop on the `AdvancedStateProvider`. This centralizes your app's state schema and ensures correct background initialization.
- **Storage Limits:** If `localStorage` or `sessionStorage` exceeds the browser quota, the hook will safely catch the error, log a warning, and gracefully continue operating in-memory to prevent app crashes.
