import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useCallback
} from 'react'

// --- Internal Pub/Sub Store (Zustand-like) ---
/**
 * Creates a simple pub/sub store for cross-component communication.
 * @returns {{subscribe: Function, publish: Function}}
 */
function createStore () {
  const subscribers = new Set()
  return {
    subscribe: callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    publish: (key, value) => {
      for (const callback of subscribers) {
        callback(key, value)
      }
    }
  }
}

// --- React Context ---
// This holds the store, the user-defined prefix, and the new defaults map.
const AdvancedStateContext = React.createContext({
  store: createStore(),
  prefix: 'advState',
  defaultsMap: new Map()
})

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

  // Get path segments, filter out empty strings
  const pathSegments = window.location.pathname.split('/').filter(Boolean)

  // Replace placeholders like $1, $2 with path segments
  const scope = pattern.replace(/\$(\d+)/g, (match, index) => {
    const i = parseInt(index, 10) - 1 // $1 is index 0
    return pathSegments[i] || ''
  })

  if (scope === '') return null
  return scope
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

  // Use filter(Boolean) to remove empty parts (e.g., if no scope)
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
  // We use useMemo to ensure the store and prefix value are stable and
  // don't cause unnecessary re-renders in consumers.
  // The defaultsMap is created for O(1) lookups in the hook.
  const contextValue = useMemo(() => {
    const defaultsMap = new Map()
    for (const item of defaults) {
      if (item.key) {
        defaultsMap.set(item.key, item)
      }
    }
    return {
      store: createStore(),
      prefix,
      defaultsMap
    }
  }, [prefix, defaults])

  // --- Eager Initialization ---
  // On mount, loop through defaults and "pre-warm" storage for the
  // *current* URL scope, if storage is empty.
  useEffect(() => {
    if (typeof window === 'undefined') return

    for (const item of defaults) {
      const { key, initial, persist, scopeByUrlParam, scopeByUrlPath } = item

      // Only initialize items that are persistent and have an initial value
      if (!persist || initial === undefined || !key) {
        continue
      }

      try {
        const storageKey = getScopedStorageKey(
          prefix,
          scopeByUrlParam,
          scopeByUrlPath,
          key
        )
        const storage = persist === 'local' ? localStorage : sessionStorage
        const storageValue = storage.getItem(storageKey)

        // If storage is empty for this key, set the initial value
        if (storageValue === null) {
          storage.setItem(storageKey, JSON.stringify(initial))
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to initialize default for key "${key}":`,
          e
        )
      }
    }
    // This effect runs only once on provider mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, defaults]) // Rerunning if defaults prop changes is complex, so we run once.

  return (
    <AdvancedStateContext.Provider value={contextValue}>
      {children}
    </AdvancedStateContext.Provider>
  )
}

// --- Helper Functions ---

/**
 * A simple debounce function.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The delay in milliseconds.
 * @returns {Function}
 */
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
 * @param {'local' | 'session'} [options.persist] - Persistence target.
 * @param {'cross-component' | 'cross-tab' | 'cross-component-and-tab'} [options.notify] - Sync strategy.
 * @param {string} [options.scopeByUrlParam] - Scope storage key by URL parameter.
 * @param {string} [options.scopeByUrlPath] - Scope storage key by URL path segments (e.g., '$1_$3').
 * @returns {[T, (value: T | ((prev: T) => T)) => void]}
 */
export function useAdvancedState (key, options = {}) {
  // Get store, prefix, and defaults from context
  const { store, prefix, defaultsMap } = useContext(AdvancedStateContext)

  // --- Options Merging ---
  // Merge the provider defaults with the local options.
  // Local options always win.
  const mergedOptions = useMemo(() => {
    const defaultOptions = defaultsMap.get(key) || {}
    return { ...defaultOptions, ...options }
  }, [defaultsMap, key, options])

  // Deconstruct the *merged* options
  const {
    initial,
    persist,
    notify,
    debounce: debounceDelay = 0,
    scopeByUrlParam,
    scopeByUrlPath
  } = mergedOptions

  // --- State Initialization ---

  const debouncedSync = useRef(null)

  // Get the scoped storage key
  const storageKey = useMemo(
    () => getScopedStorageKey(prefix, scopeByUrlParam, scopeByUrlPath, key),
    [prefix, scopeByUrlParam, scopeByUrlPath, key]
  )

  /**
   * Safely gets the initial value from storage or default.
   * This is a "lazy" initializer for useState, so it only runs once.
   */
  const getInitialValue = () => {
    // 1. Check storage first
    if (persist && typeof window !== 'undefined') {
      try {
        const storage = persist === 'local' ? localStorage : sessionStorage
        const storageValue = storage.getItem(storageKey)
        if (storageValue !== null) {
          return JSON.parse(storageValue)
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to parse stored value for ${key}:`,
          e
        )
      }
    }
    // 2. If not in storage, return the default initial value
    return initial
  }

  const [localValue, setLocalValue] = useState(getInitialValue)

  // --- Eager Write Effect (Hook-level) ---
  // This effect ensures that if we navigate to a *new* scope
  // (one that the provider didn't initialize), we still
  // eagerly write the initial value.
  useEffect(() => {
    if (!persist || initial === undefined || typeof window === 'undefined') {
      return
    }

    const storage = persist === 'local' ? localStorage : sessionStorage
    const storageValue = storage.getItem(storageKey)

    // If storage is empty, write the initial value
    if (storageValue === null) {
      try {
        const valueToStore = JSON.stringify(initial)
        storage.setItem(storageKey, valueToStore)

        // Notify if requested
        if (notify === 'cross-tab' || notify === 'cross-component-and-tab') {
          const otherStorage =
            persist === 'local' ? sessionStorage : localStorage
          // This "signal" write triggers the event
          otherStorage.setItem(storageKey, valueToStore)
          otherStorage.removeItem(storageKey)
        }
        if (
          notify === 'cross-component' ||
          notify === 'cross-component-and-tab'
        ) {
          store.publish(key, initial)
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to eager-write value for ${key}:`,
          e
        )
      }
    }
    // This effect must re-run if the storageKey changes (e.g., URL navigation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, persist, initial, notify, key, store])

  // --- Synchronization Logic ---

  /**
   * This is the function that actually performs the debounced sync.
   * It writes to storage and notifies other components/tabs.
   */
  const performSync = useCallback(
    newValue => {
      // 1. Persist to storage
      if (persist && typeof window !== 'undefined') {
        const storage = persist === 'local' ? localStorage : sessionStorage
        try {
          const valueToStore = JSON.stringify(newValue)
          storage.setItem(storageKey, valueToStore)

          // 2. Notify cross-tab (if configured)
          // We write to the *other* storage to trigger the 'storage' event
          if (notify === 'cross-tab' || notify === 'cross-component-and-tab') {
            const otherStorage =
              persist === 'local' ? sessionStorage : localStorage
            otherStorage.setItem(storageKey, valueToStore)
            otherStorage.removeItem(storageKey) // Clean up immediately
          }
        } catch (e) {
          console.error(`[AdvancedState] Failed to save value for ${key}:`, e)
        }
      }

      // 3. Notify cross-component (if configured)
      if (
        notify === 'cross-component' ||
        notify === 'cross-component-and-tab'
      ) {
        store.publish(key, newValue)
      }
    },
    [persist, storageKey, notify, key, store]
  )

  // Create or update the debounced function
  // This effect runs when performSync or debounceDelay changes
  useEffect(() => {
    debouncedSync.current =
      debounceDelay > 0 ? debounce(performSync, debounceDelay) : performSync
  }, [performSync, debounceDelay])

  // --- Event Listeners for Syncing ---

  // Effect for 'cross-component' (context) notifications
  useEffect(() => {
    if (notify === 'cross-component' || notify === 'cross-component-and-tab') {
      const unsubscribe = store.subscribe((updatedKey, newValue) => {
        if (updatedKey === key) {
          setLocalValue(newValue)
        }
      })
      return unsubscribe // Clean up subscription on unmount
    }
  }, [notify, store, key])

  // Effect for 'cross-tab' (storage) notifications
  useEffect(() => {
    if (
      (notify === 'cross-tab' || notify === 'cross-component-and-tab') &&
      persist &&
      typeof window !== 'undefined'
    ) {
      const handleStorageChange = event => {
        // We listen to the *other* storage for our signal
        const otherStorage = persist === 'local' ? sessionStorage : localStorage
        if (event.storageArea === otherStorage && event.key === storageKey) {
          try {
            const newValue = JSON.parse(event.newValue)
            setLocalValue(newValue) // Update local state

            // Also update context store if this component is a hybrid
            if (notify === 'cross-component-and-tab') {
              store.publish(key, newValue)
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
      return () => {
        window.removeEventListener('storage', handleStorageChange)
      }
    }
  }, [notify, persist, storageKey, key, store])

  // --- Setter Function ---

  /**
   * The wrapped setter function returned by the hook.
   * It updates local state *immediately* and then triggers the debounced sync.
   */
  const setFn = useCallback(
    valueOrFn => {
      // Use the functional update form of useState
      setLocalValue(prevValue => {
        const newValue =
          typeof valueOrFn === 'function' ? valueOrFn(prevValue) : valueOrFn

        // Trigger the (debounced) sync with the new value
        if (debouncedSync.current) {
          debouncedSync.current(newValue)
        }

        // Return the new value for the immediate local state update
        return newValue
      })
    },
    [setLocalValue] // setLocalValue is stable
  )

  return [localValue, setFn]
}
