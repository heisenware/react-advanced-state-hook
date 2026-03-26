import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect
} from 'react'
import { idb } from './idb-wrapper'

// --- Utilities ---

// Suppresses SSR warnings by falling back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

// Lazy-loads and guarantees a unique Tab Session Fingerprint
function getTabSessionId () {
  if (typeof window === 'undefined') return 'ssr'

  let id = sessionStorage.getItem('adv_state_session_id')
  if (!id) {
    // Generate a highly random, collision-resistant string
    id = Math.random().toString(36).substring(2, 15) + Date.now().toString(36)
    sessionStorage.setItem('adv_state_session_id', id)
  }

  return id
}

// --- Internal Pub/Sub Store ---

/**
 * Creates a centralized, framework-agnostic store to hold state
 * and manage subscriber notifications outside of React's render cycle.
 */
function createStore () {
  const subscribers = new Set()
  const stateValues = new Map()

  return {
    subscribe: callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    setState: (key, value) => {
      stateValues.set(key, value)
      for (const callback of subscribers) {
        callback(key, value)
      }
    },
    getState: key => stateValues.get(key),
    initState: (key, value) => {
      if (!stateValues.has(key)) {
        stateValues.set(key, value)
      }
    }
  }
}

// --- React Context ---

export const AdvancedStateContext = React.createContext({
  store: createStore(),
  prefix: 'advState',
  defaultsMap: new Map()
})

// --- URL Scoping Helpers ---

/**
 * Gets a URL parameter by name.
 * @param {string} name - The name of the URL parameter.
 * @returns {string | null}
 */
function getUrlParam (name) {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

/**
 * Parses the URL path based on a string-replacement pattern.
 * @param {string} pattern - e.g., "$1_$3" or "user_$1"
 * @returns {string | null}
 */
function parsePathScope (pattern) {
  if (typeof window === 'undefined' || !pattern) return null
  const pathSegments = window.location.pathname.split('/').filter(Boolean)
  const scope = pattern.replace(/\$(\d+)/g, (match, index) => {
    const i = parseInt(index, 10) - 1
    return pathSegments[i] || ''
  })
  return scope === '' ? null : scope
}

/**
 * Creates the final storage key based on scope.
 * Format: "<prefix>:<scopeValue>:<key>"
 * @param {string} prefix - The global prefix (e.g., 'advState' or 'myApp')
 * @param {string} [scopeByUrlParam] - The URL param name.
 * @param {string} [scopeByUrlPath] - The URL path pattern.
 * @param {string} key - The property key (e.g., 'username')
 * @returns {string}
 */
function getScopedStorageKey (prefix, scopeByUrlParam, scopeByUrlPath, key) {
  let scope = null
  if (scopeByUrlParam) {
    scope = getUrlParam(scopeByUrlParam) || 'default-param'
  } else if (scopeByUrlPath) {
    scope = parsePathScope(scopeByUrlPath) || 'default-path'
  }
  return [prefix, scope, key].filter(Boolean).join(':')
}

/**
 * Provider component that enables 'cross-component' notifications
 * and centralized state configuration.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.prefix='advState'] - A custom prefix for all storage keys.
 * @param {Array<object>} [props.defaults=[]] - An array of default configurations for keys.
 * @returns {React.ReactElement}
 */
export function AdvancedStateProvider ({
  children,
  prefix = 'advState',
  defaults = []
}) {
  // Maintain a stable reference to the central store. This ensures that
  // subscriptions remain intact even if the parent component re-renders.
  const [store] = useState(() => createStore())

  // Memoize the context value to prevent unnecessary re-renders of consumers.
  // The store state is pre-warmed with any provided default configurations.
  const contextValue = useMemo(() => {
    const defaultsMap = new Map()

    for (const item of defaults) {
      if (item.key) {
        defaultsMap.set(item.key, item)
        if (item.initial !== undefined) {
          store.initState(item.key, item.initial)
        }
      }
    }

    return {
      store,
      prefix,
      defaultsMap
    }
  }, [prefix, defaults, store])

  // Eager storage initialization: Ensure persistent items are written to
  // the appropriate browser storage on mount if they do not already exist.
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Kick off the asynchronous Garbage Collector to clear dead tabs
    idb.sweep().catch(e => console.warn('[AdvancedState] IDB sweep failed:', e))

    const { store, defaultsMap } = contextValue

    for (const item of defaultsMap.values()) {
      const { key, persist, scopeByUrlParam, scopeByUrlPath } = item

      if (!persist || !key) continue

      const baseKey = getScopedStorageKey(
        prefix,
        scopeByUrlParam,
        scopeByUrlPath,
        key
      )

      // If sessiondb, prefix it to sandbox it from other tabs
      const storageKey =
        persist === 'sessiondb'
          ? `__sessiondb__:${getTabSessionId()}:${baseKey}`
          : baseKey

      if (persist === 'localdb' || persist === 'sessiondb') {
        // --- Asynchronous IDB Pre-warming ---
        // We use a fire-and-forget promise chain here so we don't block
        // the loop or React's commit phase.
        idb
          .get(storageKey)
          .then(storageValue => {
            if (storageValue === undefined) {
              const valueToStore = store.getState(key)
              if (valueToStore !== undefined) {
                idb.set(storageKey, valueToStore).catch(e => {
                  console.error(
                    `[AdvancedState] Failed to eager-write IDB default for "${key}":`,
                    e
                  )
                })
              }
            }
          })
          .catch(e =>
            console.error(
              `[AdvancedState] Failed to read IDB default for "${key}":`,
              e
            )
          )
      } else {
        // --- Synchronous Web Storage Pre-warming ---
        try {
          const storage = persist === 'local' ? localStorage : sessionStorage
          const storageValue = storage.getItem(storageKey)

          if (storageValue === null) {
            const valueToStore = store.getState(key)
            if (valueToStore !== undefined) {
              storage.setItem(storageKey, JSON.stringify(valueToStore))
            }
          }
        } catch (e) {
          console.error(
            `[AdvancedState] Failed to initialize default for key "${key}":`,
            e
          )
        }
      }
    }
  }, [prefix, contextValue])

  return (
    <AdvancedStateContext.Provider value={contextValue}>
      {children}
    </AdvancedStateContext.Provider>
  )
}

// --- Hook Implementation ---

function debounce (func, delay) {
  let timeoutId = null
  return function (...args) {
    const context = this
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func.apply(context, args), delay)
  }
}

/**
 * The main hook for advanced state management.
 *
 * @template T
 * @param {string} key - The unique key for this piece of state.
 * @param {object} [options={}] - Local options to override defaults.
 * @param {T} [options.initial] - The initial value.
 * @param {number} [options.debounce] - Debounce delay in ms.
 * @param {'local' | 'session' | 'localdb' | 'sessiondb'} [options.persist] - Persistence target.
 * @param {'cross-component' | 'cross-tab' | 'cross-component-and-tab'} [options.notify] - Sync strategy.
 * @param {string} [options.scopeByUrlParam] - Scope storage key by URL parameter.
 * @param {string} [options.scopeByUrlPath] - Scope storage key by URL path segments (e.g., '$1_$3').
 * @returns {[T, (value: T | ((prev: T) => T)) => void, { isCached: boolean, get: () => T }]}
 */
export function useAdvancedState (key, options = {}) {
  const { store, prefix, defaultsMap } = useContext(AdvancedStateContext)

  const mergedOptions = useMemo(() => {
    const defaultOptions = defaultsMap.get(key) || {}
    return { ...defaultOptions, ...options }
  }, [defaultsMap, key, options])

  const {
    initial,
    persist,
    notify,
    debounce: debounceDelay = 0,
    scopeByUrlParam,
    scopeByUrlPath
  } = mergedOptions

  const debouncedSync = useRef(null)
  const wasCachedRef = useRef(false)

  const isIdbTarget = persist === 'localdb' || persist === 'sessiondb'

  const [isInitializing, setIsInitializing] = useState(isIdbTarget)

  const storageKey = useMemo(() => {
    const baseKey = getScopedStorageKey(
      prefix,
      scopeByUrlParam,
      scopeByUrlPath,
      key
    )
    return persist === 'sessiondb'
      ? `__sessiondb__:${getTabSessionId()}:${baseKey}`
      : baseKey
  }, [prefix, scopeByUrlParam, scopeByUrlPath, key, persist])

  // Lazy initializer for useState. Resolves the initial state by checking
  // browser storage, then the central store, and finally falling back to props.
  const getInitialValue = () => {
    if (
      (persist === 'local' || persist === 'session') &&
      typeof window !== 'undefined'
    ) {
      try {
        const storage = persist === 'local' ? localStorage : sessionStorage
        const storageValue = storage.getItem(storageKey)
        if (storageValue !== null) {
          const parsedValue = JSON.parse(storageValue)
          store.initState(key, parsedValue)
          wasCachedRef.current = true
          return parsedValue
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to parse stored value for ${key}:`,
          e
        )
      }
    }

    if (notify === 'cross-component' || notify === 'cross-component-and-tab') {
      const storeValue = store.getState(key)
      if (storeValue !== undefined) {
        wasCachedRef.current = true
        return storeValue
      }
    }

    if (initial !== undefined) {
      store.initState(key, initial)
    }
    return store.getState(key)
  }

  const [localValue, setLocalValue] = useState(getInitialValue)

  // Maintain a layout-safe reference to the current state. This allows the
  // setter function to compute functional updates (e.g., prev => prev + 1)
  // without capturing stale closures or triggering Strict Mode side-effects.
  const latestValueRef = useRef(localValue)

  useIsomorphicLayoutEffect(() => {
    latestValueRef.current = localValue
  }, [localValue])

  // --- Asynchronous load effect for IndexedDB ---
  useEffect(() => {
    if (isIdbTarget && typeof window !== 'undefined') {
      setIsInitializing(true)

      const loadFromIdb = async () => {
        try {
          const storedValue = await idb.get(storageKey)
          if (storedValue !== undefined) {
            setLocalValue(storedValue)
            store.setState(key, storedValue)
            wasCachedRef.current = true
          }
        } catch (e) {
          console.error(`[AdvancedState] IDB load failed for ${key}:`, e)
        } finally {
          setIsInitializing(false)
        }
      }

      loadFromIdb()
    }
  }, [persist, storageKey, key, store])

  // --- Eager storage initialization for Web Storage ---
  useEffect(() => {
    // Skip eager writes for indexeddb so it doesn't leak into sessionStorage!
    if (!persist || isIdbTarget || typeof window === 'undefined') return

    const storage = persist === 'local' ? localStorage : sessionStorage
    const storageValue = storage.getItem(storageKey)

    if (storageValue === null) {
      try {
        const valueToStore = store.getState(key)
        if (valueToStore !== undefined) {
          storage.setItem(storageKey, JSON.stringify(valueToStore))
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to eager-write value for ${key}:`,
          e
        )
      }
    }
  }, [storageKey, persist, key, store])

  // Handles writing data to browser storage and triggering cross-tab events.
  const performSync = useCallback(
    newValue => {
      if (!persist || typeof window === 'undefined') return

      if (isIdbTarget) {
        // Handle Async IndexedDB Write
        const writePromise =
          newValue === undefined
            ? idb.del(storageKey)
            : idb.set(storageKey, newValue)

        writePromise
          .then(() => {
            // Cross-tab sync for IndexedDB using BroadcastChannel
            if (
              notify === 'cross-tab' ||
              notify === 'cross-component-and-tab'
            ) {
              const bc = new BroadcastChannel('adv_state_channel')
              bc.postMessage({ key: storageKey, value: newValue })
              bc.close()
            }
          })
          .catch(e =>
            console.warn(`[AdvancedState] IDB save failed for ${key}:`, e)
          )
      } else {
        const storage = persist === 'local' ? localStorage : sessionStorage
        try {
          if (newValue === undefined) {
            storage.removeItem(storageKey)
          } else {
            const valueToStore = JSON.stringify(newValue)
            storage.setItem(storageKey, valueToStore)
          }

          // Trigger a storage event in other tabs by briefly utilizing the
          // secondary storage mechanism as a conduit.
          if (notify === 'cross-tab' || notify === 'cross-component-and-tab') {
            const otherStorage =
              persist === 'local' ? sessionStorage : localStorage
            if (newValue !== undefined) {
              otherStorage.setItem(storageKey, JSON.stringify(newValue))
            }
            otherStorage.removeItem(storageKey)
          }
        } catch (e) {
          console.warn(`[AdvancedState] Failed to save value for ${key}:`, e)
          if (persist === 'session') {
            try {
              sessionStorage.removeItem(storageKey)
              console.warn(
                `[AdvancedState] Cleared stale session data for ${key} due to quota limits.`
              )
            } catch (cleanupError) {
              console.error(
                `[AdvancedState] Failed to clean up session storage, because: ${cleanupError.message}`
              )
            }
          }
        }
      }
    },
    [persist, storageKey, notify]
  )

  useEffect(() => {
    debouncedSync.current =
      debounceDelay > 0 ? debounce(performSync, debounceDelay) : performSync
  }, [performSync, debounceDelay])

  // Context Subscription: Listen for changes from other components.
  useEffect(() => {
    if (notify === 'cross-component' || notify === 'cross-component-and-tab') {
      const unsubscribe = store.subscribe((updatedKey, newValue) => {
        if (updatedKey === key) {
          setLocalValue(prev => (Object.is(prev, newValue) ? prev : newValue))
        }
      })
      return unsubscribe
    }
  }, [notify, store, key])

  // Storage Subscription: Listen for changes from other tabs/windows.
  useEffect(() => {
    if (
      (notify === 'cross-tab' || notify === 'cross-component-and-tab') &&
      persist &&
      typeof window !== 'undefined'
    ) {
      if (isIdbTarget) {
        const bc = new BroadcastChannel('adv_state_channel')
        bc.onmessage = event => {
          if (event.data.key === storageKey) {
            const newValue = event.data.value
            setLocalValue(prev => (Object.is(prev, newValue) ? prev : newValue))
            if (notify === 'cross-component-and-tab')
              store.setState(key, newValue)
          }
        }
        return () => bc.close()
      } else {
        const handleStorageChange = event => {
          const otherStorage =
            persist === 'local' ? sessionStorage : localStorage
          if (event.storageArea === otherStorage && event.key === storageKey) {
            try {
              const newValue = JSON.parse(event.newValue)

              setLocalValue(prev =>
                Object.is(prev, newValue) ? prev : newValue
              )

              if (notify === 'cross-component-and-tab') {
                store.setState(key, newValue)
              }
            } catch (e) {
              console.error(
                `[AdvancedState] Failed to parse stored value for ${key}:`,
                e
              )
            }
          }
        }
        window.addEventListener('storage', handleStorageChange)
        return () => window.removeEventListener('storage', handleStorageChange)
      }
    }
  }, [notify, persist, storageKey, key, store])

  // Core setter function. Evaluates the new value and orchestrates local,
  // contextual, and persistent updates cleanly without side-effect overlap.
  const setFn = useCallback(
    valueOrFn => {
      const prevValue = latestValueRef.current
      const newValue =
        typeof valueOrFn === 'function' ? valueOrFn(prevValue) : valueOrFn

      if (Object.is(prevValue, newValue)) return

      // 1. Update React state immediately
      setLocalValue(newValue)

      // 2. Broadcast to central store
      if (
        notify === 'cross-component' ||
        notify === 'cross-component-and-tab'
      ) {
        store.setState(key, newValue)
      } else {
        store.initState(key, newValue)
      }

      // 3. Queue persistence
      if (debouncedSync.current) {
        debouncedSync.current(newValue)
      }
    },
    [notify, key, store]
  )

  const meta = useMemo(
    () => ({
      isCached: wasCachedRef.current,
      isInitializing,
      get: () => store.getState(key)
    }),
    [store, key, isInitializing]
  )

  return [localValue, setFn, meta]
}
