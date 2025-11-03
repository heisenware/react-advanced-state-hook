import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo
} from 'react'

// --- 1. Store Class for Context Notification ---
// This is the "Zustand-like" part. It's a simple event emitter (pub-sub)
// that allows components to subscribe to *specific keys* rather than
// the entire state object, preventing unnecessary re-renders.

class AdvancedStateStore {
  constructor () {
    // Use a Map to store subscribers for each key
    // Map<key, Set<callback>>
    this.subscribers = new Map()
    // Use a Map to store the actual state values
    // Map<key, value>
    this.state = new Map()
  }

  /**
   * Gets the current value for a given key.
   */
  get (key) {
    return this.state.get(key)
  }

  /**
   * Sets a value for a key and notifies all subscribers for that key.
   */
  set (key, value) {
    // Only update and notify if the value has actually changed
    if (this.state.get(key) === value) {
      return
    }
    this.state.set(key, value)
    // Notify all subscribers for this specific key
    this.subscribers.get(key)?.forEach(callback => callback())
  }

  /**
   * Subscribes a callback to changes for a specific key.
   * Returns an unsubscribe function.
   */
  subscribe (key, callback) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    this.subscribers.get(key).add(callback)

    // Return the unsubscribe function
    return () => {
      this.subscribers.get(key)?.delete(callback)
    }
  }
}

// --- 2. React Context ---

// Create a context to hold the single instance of our store
const AdvancedStateContext = createContext(null)

/**
 * AdvancedStateProvider
 * This provider component creates a single, stable instance of the
 * AdvancedStateStore and provides it to all descendant components.
 * It *must* be wrapped around any component using `useAdvancedState`
 * with the `notify: 'cross-component'` or `notify: 'cross-component-and-tab'` option.
 */
export const AdvancedStateProvider = ({ children }) => {
  // Use useRef to create and hold a single, stable instance of the store
  // This ensures the store persists across re-renders without being recreated
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = new AdvancedStateStore()
  }

  return (
    <AdvancedStateContext.Provider value={storeRef.current}>
      {children}
    </AdvancedStateContext.Provider>
  )
}

// --- 3. Helper Functions ---

/**
 * Gets the storage engine (localStorage or sessionStorage) based on the persist option.
 */
function getStorageEngine (persist) {
  // Check for window existence for SSR
  if (typeof window === 'undefined') {
    return null
  }
  if (persist === 'local') {
    return window.localStorage
  }
  if (persist === 'session') {
    return window.sessionStorage
  }
  return null
}

/**
 * Parses a specific URL parameter.
 * @param {string} paramName The name of the URL parameter.
 * @returns {string} The value of the parameter or a default value.
 */
function getUrlParam (paramName) {
  // Ensure this code can run in environments without `window` (like SSR)
  if (typeof window === 'undefined') {
    return `default-${paramName}`
  }
  const params = new URLSearchParams(window.location.search)
  return params.get(paramName) || `default-${paramName}`
}

/**
 * Parses the window.location.pathname against a pattern string to extract scope.
 * @param {string} pattern e.g., "$1_docs_$2"
 * @returns {string} e.g., "users_abc"
 */
function parsePathScope (pattern) {
  if (typeof window === 'undefined') {
    return 'default-path-scope'
  }

  const pathnameSegments = window.location.pathname.split('/').filter(Boolean)
  // Regex to find all placeholders like $1, $2, etc.
  const placeholderRegex = /\$(\d+)/g

  let hasMatch = false

  const scopeKey = pattern.replace(placeholderRegex, (match, numberStr) => {
    hasMatch = true
    const index = parseInt(numberStr, 10) - 1 // $1 -> index 0, $2 -> index 1

    if (index >= 0 && index < pathnameSegments.length) {
      return pathnameSegments[index]
    }

    // Handle cases where placeholder is valid but segment doesn't exist
    // e.g., pattern "$1_$2" but URL is "/segment1" -> scope becomes "segment1_default"
    return 'default'
  })

  if (!hasMatch) {
    console.warn(
      `useAdvancedState: 'scopeByUrlPath' pattern "${pattern}" did not contain any valid placeholders (e.g., $1, $2).`
    )
    // Default scope to prevent key collisions
    return 'default-path-scope'
  }

  return scopeKey
}

/**
 * Generates the unique storage key based on the scope option.
 * The value stored at this key will be an *object* containing all properties
 * for that scope (e.g., { myProp1: 'a', myProp2: 'b' }).
 */
function getScopedStorageKey (scopeByUrlParam, scopeByUrlPath) {
  // Prioritize param-based scope if both are provided
  if (scopeByUrlParam) {
    const paramValue = getUrlParam(scopeByUrlParam)
    return `advancedState:param:${scopeByUrlParam}:${paramValue}`
  }

  if (scopeByUrlPath) {
    const pathScope = parsePathScope(scopeByUrlPath)
    return `advancedState:path:${pathScope}`
  }

  // A fallback global scope if no scope is provided but 'persist' is
  return 'advancedState:global'
}

/**
 * Reads a specific property's value from the scoped storage object.
 */
function readFromStorage (storage, scopedKey, propKey) {
  if (!storage) {
    return undefined
  }
  try {
    const rawValue = storage.getItem(scopedKey)
    if (rawValue) {
      const stateObject = JSON.parse(rawValue)
      return stateObject[propKey]
    }
  } catch (error) {
    console.error(`Error reading from storage: ${error}`)
  }
  return undefined
}

/**
 * Writes a specific property's value to the scoped storage object.
 */
function writeToStorage (storage, scopedKey, propKey, value) {
  if (!storage) {
    return
  }
  try {
    const rawValue = storage.getItem(scopedKey)
    const stateObject = rawValue ? JSON.parse(rawValue) : {}

    if (value === undefined || value === null) {
      delete stateObject[propKey]
    } else {
      stateObject[propKey] = value
    }

    storage.setItem(scopedKey, JSON.stringify(stateObject))
  } catch (error) {
    console.error(`Error writing to storage: ${error}`)
  }
}

// --- 4. The Main Hook: useAdvancedState ---

/**
 * A custom hook that extends useState with optional debouncing,
 * persistence (local/session storage), and notification.
 *
 * @param {string} key The unique key for this piece of state.
 * @param {object} options
 * @param {*} [options.initial] The initial value if nothing is found in storage.
 * @param {number} [options.debounce=0] Debounce time in ms for setting the value.
 * @param {'local' | 'session'} [options.persist] Persistence strategy.
 * @param {'cross-component' | 'cross-tab' | 'cross-component-and-tab'} [options.notify] Notification strategy.
 * @param {string} [options.scopeByUrlParam] A URL parameter name to scope storage by. Mutually exclusive with `scopeByUrlPath`.
 * @param {string} [options.scopeByUrlPath] A path pattern (e.g., `"$1_docs_$2"`) to scope storage by. Mutually exclusive with `scopeByUrlParam`.
 * @returns {[*, Function]} A [value, setValue] tuple.
 */
export const useAdvancedState = (key, options = {}) => {
  const {
    initial,
    debounce = 0,
    persist,
    notify,
    scopeByUrlParam,
    scopeByUrlPath // New
  } = options

  // --- A. Setup and Refs ---

  // Get the global store instance from context.
  // This will be null if AdvancedStateProvider is not used.
  const store = useContext(AdvancedStateContext)

  // Ref to hold the debounce timeout
  const debounceTimeoutRef = useRef(null)

  // Memoize storage engine and scoped key calculation
  const storage = useMemo(() => getStorageEngine(persist), [persist])
  const scopedStorageKey = useMemo(
    () => getScopedStorageKey(scopeByUrlParam, scopeByUrlPath),
    [scopeByUrlParam, scopeByUrlPath]
  ) // Updated

  // Check for configuration errors
  useEffect(() => {
    if (scopeByUrlParam && scopeByUrlPath) {
      console.warn(
        `useAdvancedState: 'scopeByUrlParam' and 'scopeByUrlPath' were both provided for key "${key}". 'scopeByUrlParam' will be used. Please provide only one scope option.`
      )
    }

    if (
      (notify === 'cross-component' || notify === 'cross-component-and-tab') &&
      !store
    ) {
      console.warn(
        `useAdvancedState: 'notify: "${notify}"' was used for key "${key}" but no <AdvancedStateProvider> was found. Context notification will not work.`
      )
    }
    if (
      (notify === 'cross-tab' || notify === 'cross-component-and-tab') &&
      !storage
    ) {
      console.warn(
        `useAdvancedState: 'notify: "${notify}"' was used for key "${key}" but no 'persist' option was provided. Cross-tab notification requires 'persist: "local" | "session"'.`
      )
    }
  }, [notify, store, key, storage, scopeByUrlParam, scopeByUrlPath]) // Added dependencies

  // --- B. State Initialization ---

  // We use a lazy initializer for useState to read the initial value.
  // This logic runs *only once* on component mount.
  // Priority:
  // 1. Value already in Context Store (if notify includes 'cross-component')
  // 2. Value in specified Storage (if persist: 'local' | 'session')
  // 3. `options.initial`
  const [value, setValue] = useState(() => {
    let initialValue = initial // Default

    // 1. Check Context
    if (
      (notify === 'cross-component' || notify === 'cross-component-and-tab') &&
      store?.get(key) !== undefined
    ) {
      initialValue = store.get(key)
    }
    // 2. Check Storage
    else if (storage) {
      const storedValue = readFromStorage(storage, scopedStorageKey, key)
      if (storedValue !== undefined) {
        initialValue = storedValue
      }
    }

    // If we're using context and the store is uninitialized for this key,
    // let's populate it.
    if (
      (notify === 'cross-component' || notify === 'cross-component-and-tab') &&
      store?.get(key) === undefined
    ) {
      store.set(key, initialValue)
    }

    return initialValue
  })

  // --- C. Cross-Component Notification Effects ---

  useEffect(() => {
    let contextUnsubscribe = () => {}
    let eventUnsubscribe = () => {}

    // 1. `notify: 'cross-component'` or 'cross-component-and-tab'
    // Subscribe to the global store for changes to *this key*
    if (
      (notify === 'cross-component' || notify === 'cross-component-and-tab') &&
      store
    ) {
      contextUnsubscribe = store.subscribe(key, () => {
        const storeValue = store.get(key)
        // Update local state *only if* it differs from the store
        // This check prevents an infinite loop if `setValue` also writes to the store
        setValue(prevValue => {
          if (prevValue !== storeValue) {
            return storeValue
          }
          return prevValue
        })
      })
    }

    // 2. `notify: 'cross-tab'` or 'cross-component-and-tab'
    // Subscribe to the window 'storage' event for cross-tab communication
    if (
      (notify === 'cross-tab' || notify === 'cross-component-and-tab') &&
      storage
    ) {
      const handleStorageEvent = event => {
        // Check for window existence for SSR
        if (typeof window === 'undefined') {
          return
        }
        // Check if the event is for our storage engine and our scoped key
        if (event.storageArea === storage && event.key === scopedStorageKey) {
          try {
            const newStateObject = JSON.parse(event.newValue)
            const newValue = newStateObject ? newStateObject[key] : undefined

            // Update local state if the value has changed
            setValue(prevValue => {
              if (newValue !== prevValue) {
                // IMPORTANT: If we're also notifying context, update the store.
                // This propagates the cross-tab change to other components
                // in *this* tab.
                if (
                  (notify === 'cross-component' ||
                    notify === 'cross-component-and-tab') &&
                  store
                ) {
                  store.set(key, newValue)
                }
                return newValue
              }
              return prevValue
            })
          } catch (error) {
            console.error(`Error handling storage event: ${error}`)
          }
        }
      }

      window.addEventListener('storage', handleStorageEvent)
      // Set up the unsubscribe function to remove this listener
      eventUnsubscribe = () => {
        window.removeEventListener('storage', handleStorageEvent)
      }
    }

    // Cleanup function:
    // This will be called when the component unmounts
    return () => {
      contextUnsubscribe()
      eventUnsubscribe()
    }
  }, [key, notify, store, storage, scopedStorageKey])

  // --- D/E. The Setter Function (with Debounce logic) ---

  const setFn = useCallback(
    newValueOrFn => {
      // Resolve the new value if a function is passed (like in setState)
      const newValue =
        typeof newValueOrFn === 'function' ? newValueOrFn(value) : newValueOrFn

      // This is the "real" update logic
      const update = val => {
        // 1. Update local state
        setValue(val)

        // 2. Persist to storage (if configured)
        writeToStorage(storage, scopedStorageKey, key, val)

        // 3. Notify context (if configured)
        if (
          (notify === 'cross-component' ||
            notify === 'cross-component-and-tab') &&
          store
        ) {
          store.set(key, val)
        }
      }

      // If debounce is enabled, use the timeout
      if (debounce > 0) {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current)
        }
        debounceTimeoutRef.current = setTimeout(() => {
          update(newValue)
        }, debounce)
      } else {
        // Otherwise, update immediately
        update(newValue)
      }
    },
    [value, storage, scopedStorageKey, key, notify, store, debounce]
  )

  // --- F. Return Value ---

  // Return the current value and the (potentially debounced) setter function
  return [value, setFn]
}
