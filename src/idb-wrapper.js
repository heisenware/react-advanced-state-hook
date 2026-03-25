// src/idb-wrapper.js

export const idb = {
  dbPromise: null,
  init () {
    if (!this.dbPromise && typeof window !== 'undefined') {
      this.dbPromise = new Promise((resolve, reject) => {
        // Bumped version to 2 to accommodate the new payload structure
        const request = indexedDB.open('AdvancedStateDB', 2)

        request.onupgradeneeded = e => {
          const db = e.target.result
          if (!db.objectStoreNames.contains('store')) {
            db.createObjectStore('store')
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return this.dbPromise
  },

  async get (key) {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readonly')
      const req = tx.objectStore('store').get(key)
      req.onsuccess = () => {
        const result = req.result
        // Backwards compatibility: If it has a timestamp, unwrap it.
        // Otherwise, it's legacy v1 data, return as-is.
        if (result && result.__ts) {
          resolve(result.payload)
        } else {
          resolve(result)
        }
      }
      req.onerror = () => reject(req.error)
    })
  },

  async set (key, value) {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite')
      // Wrap the data with a timestamp for the Garbage Collector
      const req = tx
        .objectStore('store')
        .put({ payload: value, __ts: Date.now() }, key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  },

  async del (key) {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite')
      const req = tx.objectStore('store').delete(key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  },

  // --- Garbage Collector ---
  async sweep (maxAgeMs = 24 * 60 * 60 * 1000) {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite')
      const store = tx.objectStore('store')
      const req = store.openCursor()
      const now = Date.now()

      req.onsuccess = e => {
        const cursor = e.target.result
        if (cursor) {
          // Only sweep keys that belong to sessiondb AND are older than maxAgeMs
          if (
            typeof cursor.key === 'string' &&
            cursor.key.startsWith('__sessiondb__:') &&
            cursor.value &&
            cursor.value.__ts &&
            now - cursor.value.__ts > maxAgeMs
          ) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve() // Sweeping finished
        }
      }
      req.onerror = () => reject(req.error)
    })
  }
}
