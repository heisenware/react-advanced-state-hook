// --- Polyfills for React 18+ SSR Testing in JSDOM ---
const { TextEncoder, TextDecoder } = require('util')
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

import React from 'react'
import {
  renderHook,
  act,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import '@testing-library/jest-dom'

// --- IndexedDB & BroadcastChannel Mocks ---

jest.mock('../src/idb-wrapper', () => {
  const store = {}
  return {
    idb: {
      get: jest.fn(async key => store[key]),
      set: jest.fn(async (key, value) => {
        store[key] = value
      }),
      del: jest.fn(async key => {
        delete store[key]
      }),
      sweep: jest.fn(async () => {}), // <-- ADDED: Mock the garbage collector
      _clear: () => {
        for (const key in store) delete store[key]
        jest.clearAllMocks() // Ensure call counts reset between tests
      }
    }
  }
})

import { AdvancedStateProvider, useAdvancedState } from '../src/index'
import { idb as mockIdb } from '../src/idb-wrapper'

class MockBroadcastChannel {
  constructor (name) {
    this.name = name
    if (!global.__BCCheck) global.__BCCheck = {}
    if (!global.__BCCheck[name]) global.__BCCheck[name] = []
    global.__BCCheck[name].push(this)
  }
  postMessage (message) {
    global.__BCCheck[this.name].forEach(bc => {
      if (bc !== this && typeof bc.onmessage === 'function') {
        bc.onmessage({ data: message })
      }
    })
  }
  close () {
    global.__BCCheck[this.name] = global.__BCCheck[this.name].filter(
      bc => bc !== this
    )
  }
}
global.BroadcastChannel = MockBroadcastChannel

// --- Web Storage Mocks & Setup ---

const createMockStorage = () => {
  let store = {}
  return {
    getItem: jest.fn(key => (key in store ? store[key] : null)),
    setItem: jest.fn((key, value) => {
      store[key] = String(value)
    }),
    removeItem: jest.fn(key => {
      delete store[key]
    }),
    clear: jest.fn(() => {
      store = {}
    })
  }
}

const localStorageMock = createMockStorage()
const sessionStorageMock = createMockStorage()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock })

const originalLocation = window.location
beforeAll(() => {
  delete window.location
  window.location = { search: '', pathname: '/' }
})

afterAll(() => {
  window.location = originalLocation
})

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.location.search = ''
  window.location.pathname = '/'

  mockIdb._clear()
  global.__BCCheck = {}

  jest.clearAllMocks()
})

const createWrapper = (props = {}) => {
  return function Wrapper ({ children }) {
    return (
      <AdvancedStateProvider prefix='testApp' {...props}>
        {children}
      </AdvancedStateProvider>
    )
  }
}

// --- Test Suite ---

describe('Advanced State Management', () => {
  describe('Initialization and Eager Writing', () => {
    it('initializes context with default values and pre-warms storage', () => {
      const defaults = [{ key: 'theme', initial: 'dark', persist: 'local' }]
      render(
        <AdvancedStateProvider prefix='testApp' defaults={defaults}>
          {null}
        </AdvancedStateProvider>
      )
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'testApp:theme',
        '"dark"'
      )
    })

    it('returns the initial value from hook options if not in defaults', () => {
      const { result } = renderHook(
        () => useAdvancedState('user', { initial: 'Alice' }),
        { wrapper: createWrapper() }
      )
      expect(result.current[0]).toBe('Alice')
      expect(result.current[2].isCached).toBe(false)
    })

    it('loads value from storage if it exists (isCached = true)', () => {
      localStorageMock.setItem('testApp:token', '"xyz123"')
      const { result } = renderHook(
        () => useAdvancedState('token', { initial: 'empty', persist: 'local' }),
        { wrapper: createWrapper() }
      )
      expect(result.current[0]).toBe('xyz123')
      expect(result.current[2].isCached).toBe(true)
    })
    it('recovers gracefully from corrupted JSON in storage', () => {
      // 1. Inject broken JSON into the mock storage
      localStorageMock.setItem('testApp:brokenKey', '{"this is not valid JSON')

      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      // 2. Render the hook
      const { result } = renderHook(
        () =>
          useAdvancedState('brokenKey', {
            initial: 'safe-fallback',
            persist: 'local'
          }),
        { wrapper: createWrapper() }
      )

      // 3. Assert it caught the error, logged it, and used the fallback
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse stored value for brokenKey'),
        expect.any(Error)
      )
      expect(result.current[0]).toBe('safe-fallback')
      expect(result.current[2].isCached).toBe(false)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('State Updates', () => {
    it('updates local state and writes to storage', () => {
      const { result } = renderHook(
        () => useAdvancedState('counter', { initial: 0, persist: 'local' }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1](1)
      })
      expect(result.current[0]).toBe(1)
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
        'testApp:counter',
        '1'
      )
    })

    it('safely handles undefined without crashing and removes key from storage', () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('status', { initial: 'active', persist: 'local' }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1](undefined)
      })
      expect(result.current[0]).toBeUndefined()
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'testApp:status',
        undefined
      )
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('testApp:status')
    })

    it('handles functional state updates', () => {
      const { result } = renderHook(
        () => useAdvancedState('count', { initial: 5 }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1](prev => prev + 5)
      })
      expect(result.current[0]).toBe(10)
    })
  })

  describe('URL Scoping', () => {
    it('scopes storage keys by URL Parameter', () => {
      window.location.search = '?userId=99'
      renderHook(
        () =>
          useAdvancedState('profile', {
            initial: 'data',
            persist: 'local',
            scopeByUrlParam: 'userId'
          }),
        { wrapper: createWrapper() }
      )
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'testApp:99:profile',
        '"data"'
      )
    })

    it('scopes storage keys by URL Path pattern', () => {
      window.location.pathname = '/dashboard/settings/user123'
      renderHook(
        () =>
          useAdvancedState('theme', {
            initial: 'light',
            persist: 'local',
            scopeByUrlPath: '$3'
          }),
        { wrapper: createWrapper() }
      )
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'testApp:user123:theme',
        '"light"'
      )
    })
  })

  describe('Synchronization (Cross-Component and Cross-Tab)', () => {
    it('syncs state between two distinct components using the same key', () => {
      let valueB = null
      const ComponentA = () => {
        const [, setShared] = useAdvancedState('shared', {
          initial: 'A',
          notify: 'cross-component'
        })
        return <button onClick={() => setShared('B')}>Update Shared</button>
      }
      const ComponentB = () => {
        const [shared] = useAdvancedState('shared', {
          notify: 'cross-component'
        })
        valueB = shared
        return null
      }
      render(
        <AdvancedStateProvider prefix='testApp'>
          <ComponentA />
          <ComponentB />
        </AdvancedStateProvider>
      )
      expect(valueB).toBe('A')
      act(() => {
        screen.getByText('Update Shared').click()
      })
      expect(valueB).toBe('B')
    })

    it('responds to cross-tab storage events', () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('tabSync', {
            initial: 'old',
            persist: 'local',
            notify: 'cross-tab'
          }),
        { wrapper: createWrapper() }
      )
      act(() => {
        const event = new Event('storage')
        event.key = 'testApp:tabSync'
        event.newValue = '"new-from-tab"'
        event.storageArea = sessionStorageMock
        window.dispatchEvent(event)
      })
      expect(result.current[0]).toBe('new-from-tab')
    })
  })

  describe('Debouncing', () => {
    beforeAll(() => {
      jest.useFakeTimers()
    })
    afterAll(() => {
      jest.useRealTimers()
    })

    it('debounces storage writes', () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('search', {
            initial: '',
            persist: 'local',
            debounce: 500
          }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1]('a')
        result.current[1]('ab')
        result.current[1]('abc')
      })
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'testApp:search',
        '"a"'
      )
      act(() => {
        jest.advanceTimersByTime(500)
      })
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
        'testApp:search',
        '"abc"'
      )
    })
  })

  describe('Storage Quota Limits & Error Handling', () => {
    let consoleErrorSpy
    let consoleWarnSpy

    beforeEach(() => {
      consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
      consoleWarnSpy.mockRestore()
    })

    it('clears session storage when quota is exceeded', () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('sessionData', {
            initial: 'chunk1',
            persist: 'session'
          }),
        { wrapper: createWrapper() }
      )
      sessionStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      act(() => {
        result.current[1]('chunk2-that-is-too-large')
      })
      expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
        'testApp:sessionData',
        '"chunk2-that-is-too-large"'
      )
      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
        'testApp:sessionData'
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save value for sessionData'),
        expect.any(Error)
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cleared stale session data for sessionData due to quota limits.'
        )
      )
    })

    it('does not clear local storage when quota is exceeded', () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('localData', {
            initial: 'chunk1',
            persist: 'local'
          }),
        { wrapper: createWrapper() }
      )
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      act(() => {
        result.current[1]('chunk2-that-is-too-large')
      })
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'testApp:localData',
        '"chunk2-that-is-too-large"'
      )
      expect(localStorageMock.removeItem).not.toHaveBeenCalledWith(
        'testApp:localData'
      )
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save value for localData'),
        expect.any(Error)
      )
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
  })

  // ---> UPDATED: Renamed block from IndexedDB to LocalDB
  describe('LocalDB Asynchronous Persistence', () => {
    it('initializes asynchronously and updates the isInitializing flag', async () => {
      await mockIdb.set('testApp:asyncData', { user: 'Bob' })
      const { result } = renderHook(
        () =>
          useAdvancedState('asyncData', {
            initial: null,
            persist: 'localdb' // <-- Changed from 'indexeddb'
          }),
        { wrapper: createWrapper() }
      )

      expect(result.current[0]).toBeNull()
      expect(result.current[2].isInitializing).toBe(true)
      expect(result.current[2].isCached).toBe(false)

      await waitFor(() => {
        expect(result.current[2].isInitializing).toBe(false)
      })

      expect(result.current[0]).toEqual({ user: 'Bob' })
      expect(result.current[2].isCached).toBe(true)
    })

    it('writes to IndexedDB asynchronously upon state change', async () => {
      const { result } = renderHook(
        () => useAdvancedState('saveData', { initial: 0, persist: 'localdb' }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1](42)
      })
      expect(result.current[0]).toBe(42)

      await waitFor(() => {
        expect(mockIdb.set).toHaveBeenCalledWith('testApp:saveData', 42)
      })
    })

    it('syncs cross-tab using BroadcastChannel', async () => {
      const { result: hookA } = renderHook(
        () =>
          useAdvancedState('sharedIdb', {
            initial: 'A',
            persist: 'localdb',
            notify: 'cross-tab'
          }),
        { wrapper: createWrapper() }
      )
      const { result: hookB } = renderHook(
        () =>
          useAdvancedState('sharedIdb', {
            initial: 'A',
            persist: 'localdb',
            notify: 'cross-tab'
          }),
        { wrapper: createWrapper() }
      )

      act(() => {
        hookA.current[1]('B')
      })
      expect(hookA.current[0]).toBe('B')

      await waitFor(() => {
        expect(hookB.current[0]).toBe('B')
      })
    })

    it('deletes from IndexedDB when setting to undefined', async () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('deleteData', {
            initial: 'keep-me',
            persist: 'localdb'
          }),
        { wrapper: createWrapper() }
      )
      act(() => {
        result.current[1](undefined)
      })

      await waitFor(() => {
        expect(mockIdb.del).toHaveBeenCalledWith('testApp:deleteData')
      })
    })
  })

  describe('SessionDB & Garbage Collection', () => {
    it('calls idb.sweep on provider mount to clean up old sessiondb data', async () => {
      render(
        <AdvancedStateProvider prefix='testApp'>{null}</AdvancedStateProvider>
      )
      await waitFor(() => {
        expect(mockIdb.sweep).toHaveBeenCalled()
      })
    })

    it('prefixes storage keys with a session ID when using sessiondb', async () => {
      const { result } = renderHook(
        () =>
          useAdvancedState('ephemeralData', {
            initial: 'secret',
            persist: 'sessiondb'
          }),
        { wrapper: createWrapper() }
      )

      act(() => {
        result.current[1]('new-secret')
      })

      await waitFor(() => {
        // We use a regex to ensure it starts with __sessiondb__ and ends with our key
        expect(mockIdb.set).toHaveBeenCalledWith(
          expect.stringMatching(/^__sessiondb__:.*:testApp:ephemeralData$/),
          'new-secret'
        )
      })
    })

    it('reuses an existing session ID if present in sessionStorage (Tab Duplication)', async () => {
      // Simulate a tab duplication by pre-populating sessionStorage
      sessionStorageMock.setItem('adv_state_session_id', 'mocked-tab-id-123')

      const { result } = renderHook(
        () =>
          useAdvancedState('dupData', {
            initial: 'value',
            persist: 'sessiondb'
          }),
        { wrapper: createWrapper() }
      )

      act(() => {
        result.current[1]('new-value')
      })

      await waitFor(() => {
        // It should precisely match the mocked ID we injected
        expect(mockIdb.set).toHaveBeenCalledWith(
          '__sessiondb__:mocked-tab-id-123:testApp:dupData',
          'new-value'
        )
      })
    })
  })

  describe('Render Optimization', () => {
    it('does not cause extra renders when setting the exact same primitive value', () => {
      const renderTracker = jest.fn()
      const { result } = renderHook(
        () => {
          renderTracker()
          return useAdvancedState('optimCount', { initial: 1 })
        },
        { wrapper: createWrapper() }
      )

      expect(renderTracker).toHaveBeenCalledTimes(1)
      act(() => {
        result.current[1](2)
      })
      expect(renderTracker).toHaveBeenCalledTimes(2)
      act(() => {
        result.current[1](2)
      })
      expect(renderTracker).toHaveBeenCalledTimes(2)
    })

    it('does not re-render components listening to unrelated keys', () => {
      const renderTrackerA = jest.fn()
      const renderTrackerB = jest.fn()

      const ComponentA = () => {
        renderTrackerA()
        const [, setA] = useAdvancedState('keyA', {
          initial: 'apple',
          notify: 'cross-component'
        })
        return <button onClick={() => setA('apricot')}>Update A</button>
      }

      const ComponentB = () => {
        renderTrackerB()
        useAdvancedState('keyB', {
          initial: 'banana',
          notify: 'cross-component'
        })
        return null
      }

      render(
        <AdvancedStateProvider prefix='testApp'>
          <ComponentA />
          <ComponentB />
        </AdvancedStateProvider>
      )

      expect(renderTrackerA).toHaveBeenCalledTimes(1)
      expect(renderTrackerB).toHaveBeenCalledTimes(1)
      act(() => {
        screen.getByText('Update A').click()
      })
      expect(renderTrackerA).toHaveBeenCalledTimes(2)
      expect(renderTrackerB).toHaveBeenCalledTimes(1)
    })
  })

  describe('Server-Side Rendering (SSR) Safety', () => {
    const originalWindow = global.window

    beforeEach(() => {
      // Temporarily delete the window object to simulate a Node.js SSR environment
      delete global.window
    })

    afterEach(() => {
      // Restore the window object so we don't break other tests
      global.window = originalWindow
    })

    it('returns the initial state without crashing when window is undefined', () => {
      const { renderToString } = require('react-dom/server')
      // In an SSR environment, we cannot use RTL's DOM-based renderHook.
      // We must use React's native renderToString, exactly like Next.js does.
      const TestComponent = () => {
        const [value, , meta] = useAdvancedState('ssrData', {
          initial: 'server-value',
          persist: 'local'
        })

        // Render the state directly into the HTML string
        return (
          <div>
            <span id='val'>{value}</span>
            <span id='cache'>{meta.isCached ? 'cached' : 'not-cached'}</span>
          </div>
        )
      }

      const html = renderToString(
        <AdvancedStateProvider prefix='testApp'>
          <TestComponent />
        </AdvancedStateProvider>
      )

      // Assert the HTML string contains our expected server-side values
      expect(html).toContain('server-value')
      expect(html).toContain('not-cached')
    })
  })
})
