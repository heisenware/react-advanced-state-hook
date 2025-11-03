import React from 'react'
import ReactDOM from 'react-dom/client'
import { AdvancedStateProvider } from './useAdvancedState' // Adjust this path if needed
import App from './App'

// 1. Wrap your entire app (or the relevant part) in the provider
// This is necessary for 'cross-component' and 'cross-component-and-tab'
const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <AdvancedStateProvider>
      <App />
    </AdvancedStateProvider>
  </React.StrictMode>
)
