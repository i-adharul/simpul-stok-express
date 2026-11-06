// A tiny toast without extra libraries: builds one daisyUI toast element and removes it after a delay.
const CONTAINER_ID = 'toast-container'
const DURATION_MS = 4000

function getContainer() {
  let container = document.getElementById(CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    container.className = 'toast toast-top toast-end z-50 mt-16'
    document.body.appendChild(container)
  }
  return container
}

function show(type, message) {
  const item = document.createElement('div')
  item.className = `alert alert-${type} border border-base-content/20 shadow-lg`
  item.setAttribute('role', 'status')
  item.textContent = message // textContent, never innerHTML: the message may contain user data
  getContainer().appendChild(item)
  setTimeout(() => item.remove(), DURATION_MS)
}

export const toast = {
  success: (message) => show('success', message),
  error: (message) => show('error', message),
  info: (message) => show('info', message),
}
