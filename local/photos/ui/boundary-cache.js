/* Public administrative boundaries only: no photos, capture GPS or AMap credentials. */
(() => {
  const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  let databasePromise;
  function database() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(resolve => {
      if (!window.indexedDB) { resolve(null); return; }
      let settled = false;
      const finish = value => { if (settled) { if (value) value.close(); return; } settled = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => finish(null), 1500);
      try {
        const request = indexedDB.open('local-photo-city-boundaries', 1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('regions')) request.result.createObjectStore('regions', { keyPath: 'id' }); };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); finish(request.result); };
        request.onerror = request.onblocked = () => finish(null);
      } catch (_) { finish(null); }
    });
    return databasePromise;
  }
  function serialize(value) {
    const boundaries = value.boundaries.map(ring => ring.map(point => [
      typeof point.getLng === 'function' ? point.getLng() : point[0],
      typeof point.getLat === 'function' ? point.getLat() : point[1],
    ]));
    if (!boundaries.length || boundaries.some(ring => ring.length < 3 || ring.some(point => !point.every(Number.isFinite)))) return null;
    return { name: value.name, adcode: value.adcode || '', boundaries };
  }
  async function getMany(ids) {
    const db = await database(), values = new Map(); if (!db) return values;
    try {
      await new Promise(resolve => {
        const transaction = db.transaction('regions', 'readonly'), store = transaction.objectStore('regions');
        ids.forEach(id => { const request = store.get(id); request.onsuccess = () => { const entry = request.result; if (entry?.version === 1 && Date.now() - entry.savedAt < MAX_AGE && entry.geometry?.boundaries?.length) values.set(id, entry.geometry); }; });
        transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
      });
    } catch (_) { /* Browsing remains available without persistent storage. */ }
    return values;
  }
  async function put(id, geometry) {
    const value = serialize(geometry), db = await database(); if (!value || !db) return;
    try {
      await new Promise(resolve => {
        const transaction = db.transaction('regions', 'readwrite');
        transaction.objectStore('regions').put({ id, version: 1, savedAt: Date.now(), geometry: value });
        transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
      });
    } catch (_) { /* Quota or private-browsing failures do not block the map. */ }
  }
  window.PhotoBoundaryCache = { getMany, put };
})();
