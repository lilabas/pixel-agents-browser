type MessageHandler = (msg: unknown) => void

let ws: WebSocket | null = null
const handlers = new Set<MessageHandler>()
const pending: unknown[] = []

export function connectWebSocket(): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${protocol}//${location.host}/ws`)

  ws.onopen = () => {
    for (const msg of pending) ws!.send(JSON.stringify(msg))
    pending.length = 0
  }

  ws.onmessage = (e) => {
    const data = JSON.parse(e.data as string)
    for (const h of handlers) h(data)
  }

  ws.onclose = () => setTimeout(connectWebSocket, 2000)
}

export function addMessageHandler(h: MessageHandler): () => void {
  handlers.add(h)
  return () => handlers.delete(h)
}

// Drop-in replacement for vscode.postMessage
export const vscode = {
  postMessage(msg: unknown): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    } else {
      pending.push(msg)
    }
  },
}
