// Singleton IntersectionObserver helper. Allows multiple callers to register an
// element and receive visibility changes without creating many observers.

type Callback = (isIntersecting: boolean, entry: IntersectionObserverEntry) => void

const callbacks = new WeakMap<Element, Callback>()
let observer: IntersectionObserver | null = null

function ensureObserver() {
  if (observer)
    return observer
  if (typeof window === 'undefined' || !(window as any).IntersectionObserver) {
    return null
  }
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const cb = callbacks.get(entry.target as Element)
      if (cb) {
        try {
          cb(!!entry.isIntersecting, entry)
        }
        catch { /* ignore */ }
      }
    }
  }, { root: null, threshold: 0 })
  return observer
}

export function observeElement(el: Element, cb: Callback) {
  const obs = ensureObserver()
  callbacks.set(el, cb)
  if (obs)
    obs.observe(el)
  return () => {
    callbacks.delete(el)
    if (obs)
      obs.unobserve(el)
  }
}

export function disconnectAll() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  // callbacks WeakMap will be GC'd as entries removed
}
