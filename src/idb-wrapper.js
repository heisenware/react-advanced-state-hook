export const idb = {
  dbPromise: null,
  init () {
    if (!this.dbPromise && typeof window !== 'undefined') {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('AdvancedStateDB', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('store')
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
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  },
  async set (key, value) {
    const db = await this.init()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('store', 'readwrite')
      const req = tx.objectStore('store').put(value, key)
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
  }
}
