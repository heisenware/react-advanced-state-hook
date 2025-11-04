import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Adjust this import path to where your hook file is located
import { AdvancedStateProvider } from './useAdvancedState'

// 1. Get the root element
const container = document.getElementById('root')

// 2. Create a root
const root = createRoot(container)

// 3. Initial render: Render your app
root.render(
  <React.StrictMode>
    {/*
      Add the 'prefix' prop here to test custom storage keys.
      Check your browser's devtools (Application -> Local Storage)
      to see the keys prefixed with "myTestApp:"
    */}
    <AdvancedStateProvider prefix='myTestApp'>
      <App />
    </AdvancedStateProvider>
  </React.StrictMode>
)
