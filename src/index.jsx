import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useCallback
} from 'react'

// --- Internal Pub/Sub Store (Zustand-like) ---
// This creates a lightweight, in-memory store to notify components.

/**
 * Creates a simple pub/sub store for cross-component communication.
 * @returns {{subscribe: Function, publish: Function}}
 */
function createStore () {
  const subscribers = new Set()
  return {
    /**
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    subscribe (callback) {
      subscribers.add(callback)
      return () => {
        subscribers.delete(callback)
      }
    },
    /**
     * @param {string} key
     * @param {*} value
     */
    publish (key, value) {
      subscribers.forEach(callback => callback(key, value))
    }
  }
}

// --- React Context ---
// This holds the store and the user-defined prefix.
const AdvancedStateContext = React.createContext({
  store: createStore(),
  prefix: 'advState'
})

/**
 * Provider component that enables 'cross-component' notifications.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.prefix] - A custom prefix for all storage keys. Defaults to 'advState'.
 */
export function AdvancedStateProvider ({ children, prefix = 'advState' }) {
  // We use useMemo to ensure the store and prefix value are stable and
  // don't cause unnecessary re-renders in consumers.
  const contextValue = useMemo(
    () => ({
      store: createStore(),
      prefix
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
 * @returns {string | null}
 */
function getUrlParam (name) {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get(name)
}

/**
 * Parses the URL path based on a pattern.
 * @param {string} pattern - e.g., "$1_$3"
 * @returns {string | null}
 */
function parsePathScope (pattern) {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  // Split path into segments, remove leading/trailing empty strings
  const segments = path.split('/').filter(Boolean)

  let scope = pattern
  const placeholders = pattern.match(/\$\d/g) || []

  for (const placeholder of placeholders) {
    const index = parseInt(placeholder.substring(1), 10) - 1 // $1 -> index 0
    const value = segments[index] || ''
    scope = scope.replace(placeholder, value)
  }

  // If no placeholders were replaced, or scope is empty, return null
  if (scope === pattern && placeholders.length > 0) return null
  if (scope === '') return null

  return scope
}

/**
 * Creates the final storage key based on scope.
 * Format: "<prefix>:<scopeValue>:<key>"
 * @param {string} prefix - The global prefix (e.g., 'advState' or 'myApp')
 * @param {string} [scopeByUrlParam] - e.g., 'appId'
 * @param {string} [scopeByUrlPath] - e.g., '$1_$3'
 * @param {string} key - The property key (e.g., 'username')
 * @returns {string}
 */
function getScopedStorageKey (prefix, scopeByUrlParam, scopeByUrlPath, key) {
  let scope = ''

  if (scopeByUrlParam) {
    scope = getUrlParam(scopeByUrlParam) || `default-${scopeByUrlParam}`
  } else if (scopeByUrlPath) {
    scope = parsePathScope(scopeByUrlPath) || 'default-path'
  }

  // Use filter(Boolean) to remove empty parts
  return [prefix, scope, key].filter(Boolean).join(':')
}

/**
 * A simple debounce function.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The delay in milliseconds.
 * @returns {Function}
 */
function debounce (func, delay) {
  let timeoutId
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
 * @param {string} key - The unique key for the state.
 * @param {object} [options]
 * @param {T} [options.initial] - The initial value.
 * @param {number} [options.debounce] - Debounce delay in ms for persistence/notification.
 * @param {'local' | 'session'} [options.persist] - Persist to localStorage or sessionStorage.
 * @param {'cross-component' | 'cross-tab' | 'cross-component-and-tab'} [options.notify] - Notification strategy.
 * @param {string} [options.scopeByUrlParam] - Scope storage key by a URL parameter (e.g., 'appId').
 * @param {string} [options.scopeByUrlPath] - Scope storage key by URL path segments (e.g., '$1_$3').
 * @returns {[T, (value: T | ((prev: T) => T)) => void]}
 */
export function useAdvancedState (key, options = {}) {
  const {
    initial,
    debounce: debounceDelay = 0,
    persist,
    notify,
    scopeByUrlParam,
    scopeByUrlPath
  } = options

  // Get store and prefix from context
  const { store, prefix } = useContext(AdvancedStateContext)

  // --- State Initialization ---

  // useRefs to hold the debounced function and options
  // This ensures they are stable and don't change on re-render
  const debouncedSync = useRef(null)

  // Get the scoped storage key (will be stable if args are stable)
  const storageKey = getScopedStorageKey(
    prefix,
    scopeByUrlParam,
    scopeByUrlPath,
    key
  )

  /**
   * Safely gets the initial value from storage, context, or default.
   * This is a "lazy" initializer for useState, so it only runs once.
   */
  const getInitialValue = () => {
    // 1. Try to get from storage if persist is enabled
    if (persist && typeof window !== 'undefined') {
      const storage = persist === 'local' ? localStorage : sessionStorage
      const storageValue = storage.getItem(storageKey)
      if (storageValue !== null) {
        try {
          return JSON.parse(storageValue)
        } catch (e) {
          console.error(`Failed to parse stored value for ${key}:`, e)
          return initial
        }
      }
    }
    // 2. If not in storage, return the default initial value
    return initial
  }

  const [localValue, setLocalValue] = useState(getInitialValue)

  // --- Eager Write Effect ---
  // This effect runs once on mount to write the initial value
  // to storage if storage is currently empty.
  useEffect(() => {
    // Only run if we are persisting and the initial value is defined
    if (!persist || initial === undefined) {
      return
    }

    const storage = persist === 'local' ? localStorage : sessionStorage
    const storageValue = storage.getItem(storageKey)

    // If storage is empty, write the initial value
    if (storageValue === null) {
      const valueToStore = JSON.stringify(initial)
      storage.setItem(storageKey, valueToStore)

      // Notify if requested
      if (notify === 'cross-tab' || notify === 'cross-component-and-tab') {
        const otherStorage = persist === 'local' ? sessionStorage : localStorage
        otherStorage.setItem(storageKey, valueToStore)
        otherStorage.removeItem(storageKey)
      }
      if (
        notify === 'cross-component' ||
        notify === 'cross-component-and-tab'
      ) {
        store.publish(key, initial)
      }
    }
    // Don't add dependencies; this should *only* run once on mount.
    // We use the values as they were at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          console.error(`Failed to save value for ${key}:`, e)
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
  ) // Added dependencies

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
            console.error(`Failed to parse stored value for ${key}:`, e)
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
        debouncedSync.current(newValue)

        // Return the new value for the immediate local state update
        return newValue
      })
    },
    [setLocalValue] // setLocalValue and debouncedSync.current are stable
  )

  return [localValue, setFn]
}
