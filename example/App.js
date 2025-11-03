import React from 'react'
import { useAdvancedState } from './useAdvancedState' // Adjust this path if needed

// --- STYLING ---
// Just some simple styling to make the demo clear.
const styles = {
  app: {
    fontFamily: 'Arial, sans-serif',
    padding: '20px',
    maxWidth: '700px',
    margin: '20px auto',
    backgroundColor: '#f9f9f9',
    borderRadius: '10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
  },
  header: {
    borderBottom: '2px solid #eee',
    paddingBottom: '10px',
    marginBottom: '20px'
  },
  components: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px'
  },
  componentBox: {
    border: '1px solid #ddd',
    padding: '15px',
    borderRadius: '8px',
    backgroundColor: '#fff'
  },
  input: {
    width: 'calc(100% - 20px)',
    padding: '10px',
    fontSize: '16px',
    borderRadius: '5px',
    border: '1px solid #ccc'
  },
  instructions: {
    marginTop: '30px',
    backgroundColor: '#fff',
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '15px'
  },
  instructionList: {
    paddingLeft: '20px'
  },
  code: {
    backgroundColor: '#eee',
    padding: '2px 5px',
    borderRadius: '3px',
    fontFamily: 'monospace'
  },
  h2: { margin: 0, marginBottom: '10px' },
  h3: { margin: 0, marginBottom: '15px' },
  p: { lineHeight: 1.6, fontSize: '14px', color: '#333' },
  li: { marginBottom: '10px', lineHeight: 1.6 }
}

// --- COMPONENT A ---
function ComponentA () {
  const [syncedValue, setSyncedValue] = useAdvancedState('testKey', {
    initial: 'Hello!',
    persist: 'local',
    notify: 'cross-component-and-tab',
    scopeByUrlParam: 'appId', // Try visiting ?appId=app1
    debounce: 300 // Debounce this input
  })

  return (
    <div style={styles.componentBox}>
      <h3 style={styles.h3}>Component A</h3>
      <p style={styles.p}>
        This component uses a <strong>300ms debounce</strong>.
      </p>
      <input
        style={styles.input}
        value={syncedValue || ''}
        onChange={e => setSyncedValue(e.target.value)}
      />
      <p style={styles.p}>
        <strong>Current Value:</strong> {syncedValue}
      </p>
    </div>
  )
}

// --- COMPONENT B ---
function ComponentB () {
  const [syncedValue, setSyncedValue] = useAdvancedState('testKey', {
    initial: 'Hello!',
    persist: 'local',
    notify: 'cross-component-and-tab',
    scopeByUrlParam: 'appId' // Try visiting ?appId=app1
    // No debounce on this one
  })

  return (
    <div style={styles.componentBox}>
      <h3 style={styles.h3}>Component B</h3>
      <p style={styles.p}>
        This component has <strong>no debounce</strong>.
      </p>
      <input
        style={styles.input}
        value={syncedValue || ''}
        onChange={e => setSyncedValue(e.target.value)}
      />
      <p style={styles.p}>
        <strong>Current Value:</strong> {syncedValue}
      </p>
    </div>
  )
}

// --- MAIN APP ---
export default function App () {
  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h2 style={styles.h2}>useAdvancedState Test App</h2>
      </div>

      <div style={styles.components}>
        <ComponentA />
        <ComponentB />
      </div>

      <div style={styles.instructions}>
        <h3 style={styles.h3}>How to Test:</h3>
        <ol style={styles.instructionList}>
          <li style={styles.li}>
            <strong>Test Cross-Component Sync:</strong> Type in either input
            box. The other box should update in real-time. (Note Component A's
            debounce).
          </li>
          <li style={styles.li}>
            <strong>Test Persistence:</strong> Type a new value, then{' '}
            <strong>reload the page</strong>. The value should still be there.
          </li>
          <li style={styles.li}>
            <strong>Test Cross-Tab Sync:</strong>{' '}
            <strong>Open this page in a new browser tab</strong> (with the same
            URL). Type in one tab and watch the other tab update.
          </li>
          <li style={styles.li}>
            <strong>Test Scoping:</strong>
            <br />
            a. Change the URL to add{' '}
            <code style={styles.code}>?appId=app1</code>.
            <br />
            b. Type a new value (e.g., "This is App 1").
            <br />
            c. Now, change the URL to{' '}
            <code style={styles.code}>?appId=app2</code>.
            <br />
            d. The value should reset to the initial "Hello!" (or whatever was
            saved for "app2"). If you go back to{' '}
            <code style={styles.code}>?appId=app1</code>, your "This is App 1"
            value will re-appear.
          </li>
        </ol>
      </div>
    </div>
  )
}
