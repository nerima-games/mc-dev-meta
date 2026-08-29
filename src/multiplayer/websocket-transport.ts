export type WebSocketMessageEvent = Readonly<{
  data: string | Uint8Array
}>

export type WebSocketCloseEvent = Readonly<{
  code: number
  reason: string
}>

export interface WebSocketLike {
  readonly readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  onopen: (() => void) | null
  onmessage: ((event: WebSocketMessageEvent) => void) | null
  onclose: ((event: WebSocketCloseEvent) => void) | null
  onerror: ((error: unknown) => void) | null
}

export type TransportState = 'connecting' | 'open' | 'closing' | 'closed'

export type TransportMessage =
  | Readonly<{ type: 'join'; playerId: string }>
  | Readonly<{ type: 'leave'; playerId: string }>
  | Readonly<{ type: 'state'; playerId: string; payload: string }>

export type WebSocketTransportOptions = Readonly<{
  onMessage?: (message: TransportMessage) => void
  onStateChange?: (state: TransportState) => void
  onError?: (error: unknown) => void
  onClose?: (event: WebSocketCloseEvent) => void
}>

export type MessageDecodeResult =
  | Readonly<{ ok: true; message: TransportMessage }>
  | Readonly<{ ok: false; reason: 'invalid-json' | 'invalid-shape' }>

const stateOf = (readyState: number): TransportState => {
  if (readyState === 0) {
    return 'connecting'
  }
  if (readyState === 1) {
    return 'open'
  }
  return readyState === 2 ? 'closing' : 'closed'
}

const invalidShape = (): MessageDecodeResult => ({ ok: false, reason: 'invalid-shape' })

const decodeUtf8 = (bytes: Uint8Array): string => {
  let text = ''
  let index = 0
  while (index < bytes.length) {
    const first = bytes[index] as number
    if (first < 0x80) {
      text += String.fromCharCode(first)
      index += 1
      continue
    }
    const width = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4
    if (index + width > bytes.length) {
      throw new Error('truncated UTF-8 sequence')
    }
    const prefix = width === 2 ? 0xc0 : width === 3 ? 0xe0 : 0xf0
    let codePoint = first - prefix
    for (let offset = 1; offset < width; offset += 1) {
      const next = bytes[index + offset] as number
      if (next < 0x80 || next >= 0xc0) {
        throw new Error('invalid UTF-8 continuation byte')
      }
      codePoint = codePoint * 0x40 + (next - 0x80)
    }
    const minimum = width === 2 ? 0x80 : width === 3 ? 0x800 : 0x10_000
    if (codePoint < minimum || codePoint > 0x10_ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error('invalid UTF-8 code point')
    }
    text += String.fromCodePoint(codePoint)
    index += width
  }
  return text
}

export const decodeTransportMessage = (data: string | Uint8Array): MessageDecodeResult => {
  let text: string
  try {
    text = typeof data === 'string' ? data : decodeUtf8(data)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidShape()
  }
  const record = value as Record<string, unknown>
  const type = record['type']
  const playerId = record['playerId']
  if (typeof playerId !== 'string' || playerId.length === 0) {
    return invalidShape()
  }
  if (type === 'join' || type === 'leave') {
    return { ok: true, message: { type, playerId } }
  }
  if (type === 'state' && typeof record['payload'] === 'string') {
    return { ok: true, message: { type, playerId, payload: record['payload'] } }
  }
  return invalidShape()
}

export class WebSocketTransport {
  private readonly onMessage: (message: TransportMessage) => void
  private readonly onStateChange: (state: TransportState) => void
  private readonly onError: (error: unknown) => void
  private readonly onClose: (event: WebSocketCloseEvent) => void

  public constructor(
    private readonly socket: WebSocketLike,
    options: WebSocketTransportOptions = {},
  ) {
    this.onMessage = options.onMessage ?? (() => undefined)
    this.onStateChange = options.onStateChange ?? (() => undefined)
    this.onError = options.onError ?? (() => undefined)
    this.onClose = options.onClose ?? (() => undefined)
    socket.onopen = () => this.onStateChange(this.state)
    socket.onmessage = (event) => {
      const decoded = decodeTransportMessage(event.data)
      if (!decoded.ok) {
        this.onError(new Error(`invalid websocket message: ${decoded.reason}`))
        return
      }
      this.onMessage(decoded.message)
    }
    socket.onclose = (event) => {
      this.onClose(event)
      this.onStateChange(this.state)
    }
    socket.onerror = (error) => this.onError(error)
  }

  public get state(): TransportState {
    return stateOf(this.socket.readyState)
  }

  public get isOpen(): boolean {
    return this.state === 'open'
  }

  public send(message: TransportMessage): void {
    if (!this.isOpen) {
      throw new Error(`websocket is ${this.state}`)
    }
    this.socket.send(JSON.stringify(message))
  }

  public close(code?: number, reason?: string): void {
    if (this.state === 'closed') {
      return
    }
    this.socket.close(code, reason)
  }

  public dispose(): void {
    this.socket.onopen = null
    this.socket.onmessage = null
    this.socket.onclose = null
    this.socket.onerror = null
  }
}
