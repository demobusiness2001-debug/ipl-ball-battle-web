export function createGameSocket({ url }) {
  const listeners = new Map()
  let ws = null
  let isOpen = false

  function emit(type, payload) {
    const set = listeners.get(type)
    if (!set) return
    for (const fn of set) fn(payload)
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(fn)
    return () => listeners.get(type).delete(fn)
  }

  function connect() {
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      isOpen = true
      emit('open', null)
    })
    ws.addEventListener('close', () => {
      isOpen = false
      emit('close', null)
    })
    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        emit('message', msg)
      } catch {
        // ignore
      }
    })
    ws.addEventListener('error', () => {
      emit('error', null)
    })
  }

  function send(msg) {
    if (!ws || !isOpen) return false
    ws.send(JSON.stringify(msg))
    return true
  }

  return { connect, on, send }
}
