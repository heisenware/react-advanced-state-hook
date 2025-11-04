import React from 'react'
import ReactDOM from 'react-dom'
import App from './App'
import { AdvancedStateProvider } from '../src/index.jsx' // Adjust path if needed

// --- Centralized State Definition ---
// This is the recommended way to define all persistent state.
const appStateDefaults = [
  {
    key: 'username',
    initial: 'Guest',
    persist: 'local',
    scopeByUrlParam: 'appId' // Scoped to ?appId=...
  },
  {
    key: 'theme',
    initial: 'light',
    persist: 'local' // Global, not scoped
  },
  {
    key: 'notes',
    initial: '',
    persist: 'session',
    scopeByUrlPath: 'doc_$1' // Scoped to /doc/...
  }
]
// -------------------------------------

ReactDOM.render(
  <React.StrictMode>
    {/*
      We pass our prefix and new defaults array to the provider.
      It will now pre-populate storage with these values.
    */}
    <AdvancedStateProvider prefix='myTestApp' defaults={appStateDefaults}>
      <App />
    </AdvancedStateProvider>
  </React.StrictMode>,
  document.getElementById('root')
)
