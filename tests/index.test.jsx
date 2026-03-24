import React from 'react'
import { renderHook, act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AdvancedStateProvider, useAdvancedState } from '../src/index'

// --- Mocks & Setup ---

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
  jest.clearAllMocks()
  window.location.search = ''
  window.location.pathname = '/'
})

// --- Test Utilities ---

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
        valueB = shared // Capture value for assertion
        return null
      }

      render(
        <AdvancedStateProvider prefix='testApp'>
          <ComponentA />
          <ComponentB />
        </AdvancedStateProvider>
      )

      expect(valueB).toBe('A') // Initial state

      act(() => {
        screen.getByText('Update Shared').click()
      })

      expect(valueB).toBe('B') // Synced state
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

      // Storage should not be called with interim values
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'testApp:search',
        '"a"'
      )
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'testApp:search',
        '"ab"'
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

      // 3. React should now correctly bail out!
      expect(renderTracker).toHaveBeenCalledTimes(2)
    })

    it('does not re-render components listening to unrelated keys', () => {
      const renderTrackerA = jest.fn()
      const renderTrackerB = jest.fn()

      // Completely isolate Hook A and Hook B into separate React components
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

      // Component A should re-render
      expect(renderTrackerA).toHaveBeenCalledTimes(2)

      // Component B should NOT re-render
      expect(renderTrackerB).toHaveBeenCalledTimes(1)
    })
  })
})
