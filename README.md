# React Advanced State Hook

A powerful React hook that extends `useState` with persistence, debouncing, and
advanced cross-component/cross-tab state synchronization.

This hook is designed to be a lightweight, flexible, and robust solution for
managing complex state in React applications.

## Features

- **Centralized Configuration:** Define your state's schema in one central
  place.

- **Component-Local State:** Behaves just like `useState` by default.

- **Persistent State:** Easily persist state to `localStorage` or
  `sessionStorage`.

- **Debouncing:** Debounce persistence and notifications to prevent storming.

- **Immediate UI Updates:** UI updates are immediate; debouncing only applies to
  syncing.

- **Cross-Component Sync:** Share state between components in the same tab (like
  Zustand).

- **Cross-Tab Sync:** Share state between multiple browser tabs.

- **Hybrid Sync:** Share state across components _and_ tabs simultaneously.

- **Flexible Scoping:**

  - Scope persistent state by URL parameters (e.g., `?appId=123`).

  - Scope persistent state by URL path (e.g., `/users/456/`).

  - Add a custom prefix for all storage keys.

- **SSR Safe:** Works correctly in Server-Side Rendering (SSR) environments.

## Installation

```bash
npm install react-advanced-state-hook
```

## Quick Start

Wrap your application (or the part that needs shared state) with the
`AdvancedStateProvider`. Define your persistent state schema using the
`defaults` prop.

```js
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
    persist: 'local',
    scopeByUrlParam: 'userId' // Scope this key by ?userId=...
  },
  {
    key: 'theme',
    initial: 'light',
    persist: 'local' // This key is global, not scoped
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

Now you can use the hook anywhere in your app. It will _automatically inherit_
the `persist` and `scope` settings from the provider.

```js
import { useAdvancedState } from 'react-advanced-state-hook'

function UserProfile() {
  // This hook call is now very clean.
  // It automatically gets its 'initial', 'persist', and 'scopeByUrlParam'
  // settings from the 'defaults' prop on the provider.
  const [username, setUsername] = useAdvancedState('username', {
    // We only pass options here to *override* a default
    // or set a transient option like 'notify'.
    notify: 'cross-component-and-tab',
    debounce: 300
  })

  return (
    <div>
      <label>Username:</label>
      <input value={username} onChange={e => setUsername(e.target.value)} />
    </div>
  )
}
```

## API

### `useAdvancedState(key, options)`

This is the main hook you will use. It takes a required `key` and an optional
`options` object.

- **`key`** (string)
  **Required.** The unique key for this piece of state (e.g., `'username'`).

- **`options`** (object)
  An optional object to configure the hook's advanced features.

---

#### Options

- **`initial`** (any) The initial value to use if no value is found in storage.
  This value is **eagerly written** to storage on mount if storage is empty.

- **`debounce`** (number) Debounce delay in milliseconds. Applies only to
  persistence and notifications, not the local UI update.

- **`persist`** (string)
  Specifies where to persist the state.

  - `'local'` for `localStorage`.
  - `'session'` for `sessionStorage`.
  - If not set, state is in-memory only.

- **`notify`** (string)
  Defines the synchronization strategy.

  - `'cross-component'`: Notifies other components in the same tab (requires
    `AdvancedStateProvider`).
  - `'cross-tab'`: Notifies other tabs (requires `persist`).
  - `'cross-component-and-tab'`: Does both (requires `AdvancedStateProvider` and
    `persist`).
  - If not set, no one is notified. Behaves like `useState`

- **`scopeByUrlParam`** (string) Scopes storage key by a URL parameter. E.g.,
  `'appId'` uses the value of `?appId=...`.

- **`scopeByUrlPath`** (string) Scopes storage key by URL path segments. Uses
  string replacement for placeholders `$1`, `$2`, etc. E.g., `user_$1` with path
  `/users/123` becomes `user_123`.

---

### `<AdvancedStateProvider>`

This provider component is **required** if you use the
`notify: 'cross-component'` or `notify: 'cross-component-and-tab'` options.
It's also used to set a custom prefix for all your storage keys.

#### Props

- **`prefix`** (string)
  A custom prefix for all storage keys. Defaults to `'advState'`.

- **`defaults`** (Array\<object\>) **Recommended.** An array of default
  configuration objects for your persistent state. Each object can contain
  `key`, `initial`, `notify`, `persist`, `debounce`, `scopeByUrlParam`, and
  `scopeByUrlPath`.

## How is this different from Zustand?

Zustand is a fantastic, simple global state manager. This hook solves a similar
problem but with a different philosophy and some unique advantages.

- **Atomic vs. Single Store:** Zustand creates a single, global store that holds
  all your state in one object (like Redux). This hook is an "atomic" state
  manager (like Recoil or Jotai), where each piece of state is managed
  independently by its key. Using this hook for all your shared state is a
  perfectly valid and performant approach.

- **API:** Zustand uses a selector-based API (`useStore(state => state.user)`).
  This hook mimics `useState` (`[value, setValue]`), making it feel like a
  "supercharged" version of React's built-in hook.

- **Persistence Performance:** When Zustand's `persist` middleware saves, it
  stringifies your _entire state object_. This hook only stringifies the _single
  value that changed_. For large states, this can be a significant performance
  advantage on writes.

- **Built-in Features:** This hook was designed from the ground up with
  persistence, robust cross-tab synchronization, and URL-based scoping as core,
  first-class features, not just middleware.

**Use this hook** when you want to easily upgrade individual pieces of state
with persistence and cross-tab sync. **Use Zustand** when you want a more
traditional, single-store global state solution.

## Storage Key Format

The hook generates a clean, readable key for storage:

`<prefix>:<scopeValue>:<key>`

**Examples:**

- With `prefix: 'myApp'`, `key: 'username'`:
  `myApp:username`

- With `prefix: 'myApp'`, `key: 'docTitle'`, `scopeByUrlParam: 'docId'` and URL
  `.../?docId=123`: `myApp:123:docTitle`

- With `prefix: 'wiki'`, `key: 'content'`, `scopeByUrlPath: 'page_$2'` and URL
  `.../user/abc/page/456`: `wiki:page_abc:content`

## Best Practices & Caveats

- **Use `defaults` for Persistent State**. Define all your persistent, shared
  state in the `defaults` prop on the `AdvancedStateProvider`. This centralizes
  your app's state schema, ensures correct initialization, and keeps your hook
  calls clean.

- **Be Consistent**. If you don't use the `defaults` prop, all components
  sharing the same `key` should use the exact same `persist` and `scope`
  options.

- **Provider Placement**. Place the `AdvancedStateProvider` at the highest level
  possible, wrapping your entire application.

- **`initial` Value Precedence:** The initial value in `defaults` is used to
  pre-populate storage. If a component mounts and storage is _still_ empty
  (e.g., for a new URL scope), its _own_ `initial` value will be used for that
  scope.

- Scoping is for Storage: The scopeByUrlParam and scopeByUrlPath options only
  affect persistence. They have no effect if `persist` is not set.

## How to Test (for development)

You can test this library locally by using the `example/App.js` and
`example/index.js` files.

1. **Clone the repository.**

2. **Create a test project:** In a separate directory, create a new React app
   (e.g., `npx create-react-app test-app`).

3. **Link your library:**

   - In your `react-advanced-state-hook` library folder, run:

     ```bash
     npm link
     ```

   - In your `test-app` folder, run:

     ```bash
     npm link react-advanced-state-hook
     ```

4. **Replace test app files:**

   - Copy the `example/App.js` file from the library into your `test-app/src/`
     folder.

   - Copy the `example/index.js` file from the library into your `test-app/src/`
     folder.

5. **Run the test app:**

```bash
npm start
```

You now have a running application where you can test all the features,
including cross-tab sync and URL scoping.
