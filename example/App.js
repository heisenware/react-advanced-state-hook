import React from 'react'
import { useAdvancedState } from '../src/index.jsx' // Adjust path if needed

/*
 * Component A: Manages 'username'
 * It INHERITS its 'persist' and 'scopeByUrlParam' from the provider's
 * 'defaults' prop.
 */
function ComponentA () {
  // This call is now much cleaner!
  // It automatically knows to persist to 'local' and scope by 'appId'.
  const [username, setUsername] = useAdvancedState('username', {
    // We only set options that are *not* in the defaults,
    // like 'notify' or 'debounce'.
    notify: 'cross-component-and-tab',
    debounce: 300
  })

  return (
    <div className='p-6 bg-white border border-gray-200 rounded-lg shadow-sm'>
      <label
        htmlFor='username'
        className='block text-sm font-medium text-gray-700'
      >
        Username (synced, debounced, scoped by ?appId)
      </label>
      <input
        id='username'
        type='text'
        value={username || ''} // Handle null/undefined initial state
        onChange={e => setUsername(e.target.value)}
        className='mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500'
      />
    </div>
  )
}

/*
 * Component B: Also manages 'username'
 * This component demonstrates the 'cross-component' sync.
 * It also inherits all its settings from the provider.
 */
function ComponentB () {
  // This hook also inherits its config and syncs with ComponentA
  const [username] = useAdvancedState('username', {
    notify: 'cross-component' // Just needs to listen
  })

  return (
    <div className='p-6 bg-white border border-gray-200 rounded-lg shadow-sm'>
      <p className='text-sm font-medium text-gray-700'>
        Component B (Read-only mirror):
      </p>
      <p className='mt-1 text-lg font-semibold text-gray-900 truncate'>
        {username || '...'}
      </p>
    </div>
  )
}

/*
 * Component C: Manages 'theme'
 * This component OVERRIDES its default 'initial' value.
 */
function ComponentC () {
  // The 'theme' key defaults to persist: 'local' and initial: 'light'.
  // We can just use it...
  const [theme, setTheme] = useAdvancedState('theme', {
    notify: 'cross-component-and-tab'
  })

  // ...or we can override *only* the initial value for this
  // component's first render, if storage is empty.
  // const [theme, setTheme] = useAdvancedState('theme', {
  //   initial: 'dark', // This would override the 'light' default
  //   notify: 'cross-component-and-tab',
  // });

  const toggleTheme = () => {
    setTheme(t => (t === 'light' ? 'dark' : 'light'))
  }

  return (
    <div className='p-6 bg-white border border-gray-200 rounded-lg shadow-sm'>
      <p className='text-sm font-medium text-gray-700'>
        Global Theme (synced, not scoped):
      </p>
      <div className='flex items-center justify-between mt-2'>
        <p className='text-lg font-semibold text-gray-900 capitalize'>
          {theme}
        </p>
        <button
          onClick={toggleTheme}
          className='px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
        >
          Toggle
        </button>
      </div>
    </div>
  )
}

export default function App () {
  const [key, setKey] = React.useState('app1')
  const [docId, setDocId] = React.useState('doc123')

  const setUrl = () => {
    const newUrl = `/?appId=${key}&docId=${docId}`
    window.history.pushState({}, '', newUrl)
    // Note: We force a reload to simulate navigation for this simple demo
    // In a real app with React Router, this is not needed.
    window.location.reload()
  }

  return (
    <div className='min-h-screen p-4 sm:p-8 bg-gray-50'>
      <div className='max-w-4xl mx-auto'>
        <h1 className='text-3xl font-bold text-gray-900'>
          useAdvancedState Test App
        </h1>
        <p className='mt-2 text-gray-600'>
          Using centralized `defaults` from the provider.
        </p>

        <div className='p-6 mt-6 bg-yellow-50 border border-yellow-200 rounded-lg'>
          <h2 className='text-lg font-semibold text-yellow-800'>
            Test Instructions
          </h2>
          <ol className='mt-4 space-y-2 list-decimal list-inside text-yellow-700'>
            <li>
              Type in the "Username" box. The "Read-only mirror" should update
              instantly (cross-component sync).
            </li>
            <li>
              Open this page in a **second tab**. It should load with the
              username you typed (persistence).
            </li>
            <li>
              Change the username in one tab. It should update in the other
              (cross-tab sync).
            </li>
            <li>
              Change the "Test URL Scopes" below and click "Reload". The
              username field will reset to "Guest". This is a *new scope*.
            </li>
            <li>
              Change the URL back to the original `appId` and click "Reload"
              again. Your original username will re-appear (scope persistence).
            </li>
          </ol>
        </div>

        <div className='p-4 mt-6 bg-white border rounded-lg shadow-sm'>
          <h3 className='font-medium text-gray-700'>Test URL Scopes</h3>
          <p className='text-sm text-gray-500'>
            The 'username' field is scoped by `appId`.
          </p>
          <div className='flex flex-col sm:flex-row gap-2 mt-2'>
            <input
              type='text'
              value={key}
              onChange={e => setKey(e.target.value)}
              className='block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm sm:w-auto focus:outline-none focus:ring-blue-500 focus:border-blue-500'
              placeholder='appId'
            />
            <input
              type='text'
              value={docId}
              onChange={e => setDocId(e.target.value)}
              className='block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm sm:w-auto focus:outline-none focus:ring-blue-500 focus:border-blue-500'
              placeholder='docId (unused)'
            />
            <button
              onClick={setUrl}
              className='px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500'
            >
              Reload with New URL
            </button>
          </div>
          <p className='mt-2 text-xs text-gray-500'>
            Current URL params: <strong>{window.location.search}</strong>
          </p>
        </div>

        <div className='grid grid-cols-1 gap-6 mt-6 md:grid-cols-2'>
          <ComponentA />
          <ComponentB />
          <ComponentC />
        </div>
      </div>
    </div>
  )
}
