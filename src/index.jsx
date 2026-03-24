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
 * Creates a simple store that holds state and notifies subscribers.
 * @returns {{
 * subscribe: Function,
 * setState: Function,
 * getState: Function,
 * initState: Function
 * }}
 */
function createStore () {
  const subscribers = new Set()
  const stateValues = new Map() // This now holds the state

  return {
    /**
     * Subscribe to state changes.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    subscribe: callback => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },

    /**
     * Set a state value and notify subscribers.
     * @param {string} key
     * @param {*} value
     */
    setState: (key, value) => {
      stateValues.set(key, value)
      for (const callback of subscribers) {
        callback(key, value)
      }
    },

    /**
     * Get a state value.
     * @param {string} key
     * @returns {*}
     */
    getState: key => stateValues.get(key),

    /**
     * Initialize a state value *only if* it doesn't exist.
     * @param {string} key
     * @param {*} value
     */
    initState: (key, value) => {
      if (!stateValues.has(key)) {
        stateValues.set(key, value)
      }
    }
  }
}

// --- React Context ---
// This holds the store, the user-defined prefix, and the defaults map.
export const AdvancedStateContext = React.createContext({
  store: createStore(), // Default store for safety (though provider is required)
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
  const pathSegments = window.location.pathname.split('/').filter(Boolean)
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
  const contextValue = useMemo(() => {
    const store = createStore()
    const defaultsMap = new Map()

    // Loop through defaults and "pre-warm" the *context store*
    for (const item of defaults) {
      if (item.key) {
        defaultsMap.set(item.key, item)
        // Initialize the context store with the default initial value
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
  }, [prefix, defaults])

  // --- Eager Storage Write ---
  // On mount, loop through defaults and "pre-warm" *storage*
  // for persistent items, using the value from the pre-warmed store.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const { store, defaultsMap } = contextValue

    for (const item of defaultsMap.values()) {
      const { key, persist, scopeByUrlParam, scopeByUrlPath } = item

      // Only initialize *persistent* items
      if (!persist || !key) {
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
        // from the context store
        if (storageValue === null) {
          const valueToStore = store.getState(key) // Get 'initial' from store
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
    // This effect runs only once on provider mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, contextValue]) // contextValue is stable

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
 * @returns {[T, (value: T | ((prev: T) => T)) => void, { isCached: boolean, get: () => T }]}
 */
export function useAdvancedState (key, options = {}) {
  // Get store, prefix, and defaults from context
  const { store, prefix, defaultsMap } = useContext(AdvancedStateContext)

  // --- Options Merging ---
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

  // --- State Initialization ---

  const debouncedSync = useRef(null)

  // Track if the initial value was pulled from an existing cache
  const wasCachedRef = useRef(false)

  const storageKey = useMemo(
    () => getScopedStorageKey(prefix, scopeByUrlParam, scopeByUrlPath, key),
    [prefix, scopeByUrlParam, scopeByUrlPath, key]
  )

  /**
   * Safely gets the initial value.
   * This is a "lazy" initializer for useState, so it only runs once.
   */
  const getInitialValue = () => {
    // 1. Check storage first (if persist)
    if (persist && typeof window !== 'undefined') {
      try {
        const storage = persist === 'local' ? localStorage : sessionStorage
        const storageValue = storage.getItem(storageKey)
        if (storageValue !== null) {
          const parsedValue = JSON.parse(storageValue)
          // Sync context store with storage on load
          store.initState(key, parsedValue)

          wasCachedRef.current = true // Flag as cached
          return parsedValue
        }
      } catch (e) {
        console.error(
          `[AdvancedState] Failed to parse stored value for ${key}:`,
          e
        )
      }
    }

    // 2. Check context store (if notify)
    if (notify === 'cross-component' || notify === 'cross-component-and-tab') {
      const storeValue = store.getState(key)
      if (storeValue !== undefined) {
        wasCachedRef.current = true // Flag as cached
        return storeValue
      }
    }

    // 3. Use local 'initial' and update the store
    if (initial !== undefined) {
      store.initState(key, initial)
    }
    // Get the final initialized value from the store
    return store.getState(key)
  }

  const [localValue, setLocalValue] = useState(getInitialValue)

  // --- Hook-level Eager Write (for new scopes) ---
  useEffect(() => {
    if (!persist || typeof window === 'undefined') {
      return
    }

    // This logic handles "eager writing" for *new* URL scopes
    // that the provider didn't initialize on mount.
    const storage = persist === 'local' ? localStorage : sessionStorage
    const storageValue = storage.getItem(storageKey)

    if (storageValue === null) {
      try {
        // Get value from the store (which was set by getInitialValue)
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
    // This effect must re-run if the storageKey changes (e.g., URL navigation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, persist, key, store]) // removed 'initial' as store is now the source

  // --- Synchronization Logic ---

  /**
   * This function performs the debounced *persistence* and *cross-tab* sync.
   * Cross-component sync is now handled by store.setState in the setter.
   */
  const performSync = useCallback(
    newValue => {
      if (persist && typeof window !== 'undefined') {
        const storage = persist === 'local' ? localStorage : sessionStorage
        try {
          // If the value is undefined, remove it from storage entirely
          if (newValue === undefined) {
            storage.removeItem(storageKey)
          } else {
            const valueToStore = JSON.stringify(newValue)
            storage.setItem(storageKey, valueToStore)
          }
          // Note: We removed the manual cross-tab signaling here.
          // The browser automatically fires a 'storage' event in other tabs
          // when localStorage is updated.
        } catch (e) {
          console.error(`[AdvancedState] Failed to save value for ${key}:`, e)
        }
      }
    },
    [persist, storageKey, key]
  )

  // Create or update the debounced function
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
          setLocalValue(prev => {
            if (Object.is(prev, newValue)) return prev
            return newValue
          })
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
        const otherStorage = persist === 'local' ? sessionStorage : localStorage
        if (event.storageArea === otherStorage && event.key === storageKey) {
          try {
            const newValue = JSON.parse(event.newValue)
            // Update local state *and* the central context store
            setLocalValue(newValue)
            if (notify === 'cross-component-and-tab') {
              store.setState(key, newValue) // Sync context store
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

  const latestValueRef = useRef(localValue)
  latestValueRef.current = localValue

  /**
   * The wrapped setter function returned by the hook.
   */
  const setFn = useCallback(
    valueOrFn => {
      const prev = latestValueRef.current
      const newValue =
        typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn

      // Explicit Early Bailout
      if (Object.is(prev, newValue)) {
        return
      }

      // Update the local React state immediately
      setLocalValue(newValue)

      // Sync Context Store
      if (
        notify === 'cross-component' ||
        notify === 'cross-component-and-tab'
      ) {
        // Prevent infinite loops by only updating if the store actually needs it
        if (!Object.is(store.getState(key), newValue)) {
          store.setState(key, newValue)
        }
      } else {
        // Keep the store silently updated for components that might mount later
        store.initState(key, newValue)
      }

      // 4. Sync Persistence (Debounced)
      if (debouncedSync.current) {
        debouncedSync.current(newValue)
      }
    },
    [notify, key, store] // Notice `localValue` is not here, keeping the reference stable!
  )

  // Construct the meta object
  const meta = useMemo(
    () => ({
      isCached: wasCachedRef.current,
      get: () => store.getState(key)
    }),
    [store, key]
  )

  return [localValue, setFn, meta]
}
