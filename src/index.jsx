import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef
} from 'react'

// --- Debounce Utility ---
/**
 * Simple debounce function.
 * @param {Function} func The function to debounce.
 * @param {number} wait The wait time in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce (func, wait) {
  let timeout
  return function executedFunction (...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// --- Pub/Sub Store for Cross-Component Sync ---
/**
 * Creates a lightweight pub/sub store for cross-component state.
 * @returns {object} An object with {setState, subscribe, getState}.
 */
function createStore () {
  const subscribers = new Map()
  const state = new Map()

  return {
    /**
     * Sets a value in the store and notifies subscribers.
     * @param {string} key The key to set.
     * @param {any} value The value.
     */
    setState (key, value) {
      state.set(key, value)
      if (subscribers.has(key)) {
        subscribers.get(key).forEach(callback => callback(value))
      }
    },
    /**
     * Subscribes a callback to a key.
     * @param {string} key The key to subscribe to.
     * @param {Function} callback The callback to run on update.
     * @returns {Function} An unsubscribe function.
     */
    subscribe (key, callback) {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set())
      }
      const keySubscribers = subscribers.get(key)
      keySubscribers.add(callback)
      // Immediately call with current state if it exists
      if (state.has(key)) {
        callback(state.get(key))
      }
      return () => {
        keySubscribers.delete(callback)
      }
    },
    /**
     * Gets a value from the store.
     * @param {string} key The key to get.
     * @returns {any} The value or undefined.
     */
    getState (key) {
      return state.get(key)
    }
  }
}

// --- React Context ---
// The context now holds an object: { store, prefix }
const AdvancedStateContext = createContext(null)

/**
 * Provides the advanced state context to its children.
 * Required for 'cross-component' and 'cross-component-and-tab' notifications.
 * @param {object} props
 * @param {React.ReactNode} props.children - The app components.
 * @param {string} [props.prefix] - A custom prefix for all storage keys (defaults to 'advState').
 */
export function AdvancedStateProvider ({ children, prefix }) {
  // Use useRef to ensure store is created only once
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = createStore()
  }

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      store: storeRef.current,
      prefix: prefix || 'advState'
    }),
    [prefix]
  )

  return (
    <AdvancedStateContext.Provider value={contextValue}>
      {children}
    </AdvancedStateContext.Provider>
  )
}

// --- Helper Functions ---

/**
 * Gets a URL parameter by name.
 * @param {string} name - The name of the URL parameter.
 * @returns {string | null} - The parameter value or null.
 */
function getUrlParam (name) {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

/**
 * Parses the URL path based on a placeholder pattern.
 * @param {string} pattern - The placeholder pattern (e.g., "$2_$4" or "user_$2").
 * @returns {string | null} - The resolved string or null.
 */
function parsePathScope (pattern) {
  if (typeof window === 'undefined' || !pattern) return null

  const pathSegments = window.location.pathname.split('/').filter(seg => seg)

  let resolvedScope = pattern

  // Regex to find all placeholders like $1, $2, etc.
  const placeholderRegex = /\$(\d+)/g

  let match
  while ((match = placeholderRegex.exec(pattern)) !== null) {
    const placeholder = match[0] // e.g., "$1"
    const index = parseInt(match[1], 10) - 1 // 1-indexed to 0-indexed

    if (index >= 0 && index < pathSegments.length) {
      resolvedScope = resolvedScope.replace(placeholder, pathSegments[index])
    } else {
      // If placeholder is out of bounds, replace it with a default
      console.warn(
        `useAdvancedState: scopeByUrlPath placeholder ${placeholder} not found in URL path.`
      )
      resolvedScope = resolvedScope.replace(placeholder, 'default')
    }
  }

  return resolvedScope
}

/**
 * Creates the unique storage key based on scope.
 * @param {string} prefix - The global prefix (from context).
 * @param {string} key - The base key.
 * @param {string} scopeByUrlParam - The URL param name.
 * @param {string} scopeByUrlPath - The URL path pattern.
 * @returns {string} - The final, unique key.
 */
function getScopedStorageKey (prefix, key, scopeByUrlParam, scopeByUrlPath) {
  let scope = ''

  if (scopeByUrlParam) {
    const paramValue =
      getUrlParam(scopeByUrlParam) || `default-${scopeByUrlParam}`
    // Use only the value for the scope
    scope = paramValue
  } else if (scopeByUrlPath) {
    const pathScope = parsePathScope(scopeByUrlPath) || 'default-path-scope'
    // Use only the parsed value for the scope
    scope = pathScope
  }

  // New simpler key format: [prefix]:[scope]:[key] or [prefix]:[key]
  const parts = [prefix]
  if (scope) parts.push(scope)
  parts.push(key)

  return parts.join(':')
}

/**
 * Reads a value from the appropriate storage.
 * @param {string} storageKey - The key to read from.
 * @param {string} persist - 'local' or 'session'.
 * @returns {any} - The parsed value or null.
 */
function readFromStorage (storageKey, persist) {
  if (typeof window === 'undefined') return null

  try {
    const storage = persist === 'local' ? localStorage : sessionStorage
    const item = storage.getItem(storageKey)
    return item ? JSON.parse(item) : null
  } catch (e) {
    console.error('Failed to read from storage:', e)
    return null
  }
}

// --- The Hook ---

/**
 * @typedef {object} AdvancedStateOptions
 * @property {any} [initial] - Initial value if none is found.
 * @property {number} [debounce] - Time in ms to debounce persistence and notifications.
 * @property {'local' | 'session'} [persist] - Persistence strategy.
 * @property {'cross-component' | 'cross-tab' | 'cross-component-and-tab'} [notify] - Notification strategy.
 * @property {string} [scopeByUrlParam] - URL parameter name to scope storage.
 * @property {string} [scopeByUrlPath] - URL path pattern to scope storage.
 */

/**
 * A powerful React hook that extends useState with persistence, debouncing,
 * and advanced cross-component/cross-tab state synchronization.
 *
 * @param {string} key - A unique key for the state.
 * @param {AdvancedStateOptions} [options] - Configuration options.
 * @returns {[any, (value: any | ((prev: any) => any)) => void]}
 */
export function useAdvancedState (
  key,
  {
    initial = undefined,
    debounce: debounceTime = 0,
    persist,
    notify,
    scopeByUrlParam,
    scopeByUrlPath
  } = {}
) {
  const context = useContext(AdvancedStateContext)
  const store = context?.store
  const prefix = context?.prefix || 'advState' // Default prefix

  // Helper to get the initial value from all sources
  const getInitialValue = useCallback(() => {
    // 1. Check context store (for cross-component)
    if (store) {
      const contextValue = store.getState(key)
      if (contextValue !== undefined) return contextValue
    }

    // 2. Check storage (for persist)
    if (persist) {
      const storageKey = getScopedStorageKey(
        prefix,
        key,
        persist,
        scopeByUrlParam,
        scopeByUrlPath
      )
      const storedValue = readFromStorage(storageKey, persist)
      if (storedValue !== null) {
        // Also update context store if this is the first load
        if (store) {
          store.setState(key, storedValue)
        }
        return storedValue
      }
    }

    // 3. Use initial value
    if (initial !== undefined) {
      // Set initial value in context store if this is the first load
      if (store) {
        store.setState(key, initial)
      }
    }
    return initial
  }, [key, persist, scopeByUrlParam, scopeByUrlPath, store, prefix])
  // We intentionally omit `initial` from deps so it only runs on first mount

  // This state is updated *immediately* for UI responsiveness
  const [localValue, setLocalValue] = useState(getInitialValue)

  // --- START: Syncing Logic (Persistence & Notification) ---

  // This function contains the logic to persist and notify
  const syncState = useCallback(
    newValue => {
      // 1. Notify context (if configured)
      if (
        notify === 'cross-component' ||
        notify === 'cross-component-and-tab'
      ) {
        if (store) {
          store.setState(key, newValue)
        } else {
          console.warn(
            'useAdvancedState: "notify" is set to "cross-component" but no <AdvancedStateProvider> was found.'
          )
        }
      }

      // 2. Handle Persistence & Cross-Tab Notification
      if (!persist) {
        return // No persistence, so we're done.
      }

      const storageKey = getScopedStorageKey(
        prefix,
        key,
        persist,
        scopeByUrlParam,
        scopeByUrlPath
      )

      const storage = persist === 'local' ? localStorage : sessionStorage

      if (
        (notify === 'cross-tab' || notify === 'cross-component-and-tab') &&
        persist !== 'local'
      ) {
        console.warn(
          `useAdvancedState: 'notify: "${notify}"' relies on 'localStorage' for cross-tab events. Using 'persist: "session"' may not notify other tabs.`
        )
      }

      try {
        storage.setItem(storageKey, JSON.stringify(newValue))
      } catch (e) {
        console.error(`Failed to persist state to ${persist}Storage:`, e)
      }
    },
    [key, persist, notify, scopeByUrlParam, scopeByUrlPath, store, prefix]
  )

  // Create a memoized debounced function for syncing
  const debouncedSync = useMemo(
    () => debounce(syncState, debounceTime),
    [syncState, debounceTime]
  )

  // This is the setter function returned to the user
  const setFn = useCallback(
    valueOrFn => {
      // We move all logic inside setLocalValue's functional update
      // to get the latest state and ensure stable setter identity.
      setLocalValue(currentValue => {
        // 1. Get new value
        const newValue =
          typeof valueOrFn === 'function' ? valueOrFn(currentValue) : valueOrFn

        // 2. Call sync function (debounced or not)
        if (debounceTime > 0) {
          debouncedSync(newValue)
        } else {
          syncState(newValue)
        }

        // 3. Return new value to update local state
        return newValue
      })
    },
    [debounceTime, debouncedSync, syncState] // No localValue dependency!
  )

  // --- END: Syncing Logic ---

  // --- START: Event Listeners for External Updates ---

  // Effect for Storage Events (other tabs)
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !persist ||
      !(notify === 'cross-tab' || notify === 'cross-component-and-tab')
    ) {
      return
    }

    const storageKey = getScopedStorageKey(
      prefix,
      key,
      persist,
      scopeByUrlParam,
      scopeByUrlPath
    )

    const handleStorageChange = event => {
      if (event.key === storageKey && event.newValue) {
        try {
          const newValue = JSON.parse(event.newValue)
          setLocalValue(newValue) // Update local state
          // Also update context store for other components in this tab
          if (
            store &&
            notify === 'cross-component-and-tab' &&
            store.getState(key) !== newValue
          ) {
            store.setState(key, newValue)
          }
        } catch (e) {
          console.error('Failed to parse storage event value:', e)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [key, persist, notify, scopeByUrlParam, scopeByUrlPath, store, prefix])

  // Effect for Context Events (other components, same tab)
  useEffect(() => {
    if (
      !store ||
      !(notify === 'cross-component' || notify === 'cross-component-and-tab')
    ) {
      return
    }

    const handleContextChange = newValue => {
      // Only update if the value is actually different
      setLocalValue(currentValue => {
        if (currentValue !== newValue) {
          return newValue
        }
        return currentValue
      })
    }

    const unsubscribe = store.subscribe(key, handleContextChange)
    return () => {
      unsubscribe()
    }
  }, [key, store, notify])

  // --- END: Event Listeners ---

  // --- START: Lifecycle & Warnings ---

  // On mount, re-check value. This handles race conditions if another
  // tab/component updated state *after* initial render but *before*
  // effects ran.
  useEffect(() => {
    const freshValue = getInitialValue()
    setLocalValue(currentValue => {
      if (currentValue !== freshValue) {
        return freshValue
      }
      return currentValue
    })
  }, [getInitialValue])

  // Warn if scoping is used without persistence
  useEffect(() => {
    if ((scopeByUrlParam || scopeByUrlPath) && !persist) {
      console.warn(
        'useAdvancedState: "scopeByUrlParam" or "scopeByUrlPath" is used without the "persist" option. Scoping will have no effect.'
      )
    }
    if (scopeByUrlParam && scopeByUrlPath) {
      console.warn(
        'useAdvancedState: "scopeByUrlParam" and "scopeByUrlPath" are mutually exclusive. "scopeByUrlParam" will take precedence.'
      )
    }
  }, [scopeByUrlParam, scopeByUrlPath, persist])

  return [localValue, setFn]
}
