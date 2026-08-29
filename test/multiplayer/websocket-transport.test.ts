import { describe, expect, it } from 'vitest'
import {
  WebSocketTransport,
  decodeTransportMessage,
  type TransportMessage,
  type WebSocketLike,
} from '../../src/multiplayer/websocket-transport'

type SocketFixture = {
  readonly socket: WebSocketLike
  readonly sent: string[]
  readonly closed: Array<{ code?: number; reason?: string }>
  readonly setState: (readyState: number) => void
}

const socketOf = (readyState: number): SocketFixture => {
  const sent: string[] = []
  const closed: Array<{ code?: number; reason?: string }> = []
  let currentReadyState = readyState
  const socket: WebSocketLike = {
    get readyState() {
      return currentReadyState
    },
    send: (data) => {
      sent.push(data)
    },
    close: (code, reason) => {
      const event: { code?: number; reason?: string } = {}
      if (code !== undefined) {
        event.code = code
      }
      if (reason !== undefined) {
        event.reason = reason
      }
      closed.push(event)
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  }

  return {
    socket,
    sent,
    closed,
    setState: (nextReadyState) => {
      currentReadyState = nextReadyState
    },
  }
}

const joinMessage: TransportMessage = {
  type: 'join',
  playerId: 'player-1',
}

describe('decodeTransportMessage', () => {
  it('decodes text and UTF-8 messages', () => {
    const stateMessage: TransportMessage = {
      type: 'state',
      playerId: 'player-1',
      payload: 'こんにちは 🌍',
    }

    expect(decodeTransportMessage(JSON.stringify(joinMessage))).toEqual({ ok: true, message: joinMessage })
    expect(
      decodeTransportMessage(new TextEncoder().encode(JSON.stringify({ type: 'leave', playerId: 'player-2' }))),
    ).toEqual({ ok: true, message: { type: 'leave', playerId: 'player-2' } })
    expect(decodeTransportMessage(new TextEncoder().encode(JSON.stringify(stateMessage)))).toEqual({
      ok: true,
      message: stateMessage,
    })
  })

  it('rejects malformed UTF-8 and JSON', () => {
    const malformedBytes = [
      new Uint8Array([0xc2]),
      new Uint8Array([0xc2, 0x20]),
      new Uint8Array([0xc0, 0x80]),
      new Uint8Array([0xe0, 0x80, 0x80]),
      new Uint8Array([0xed, 0xa0, 0x80]),
      new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
      new Uint8Array([0x80]),
    ]

    for (const bytes of malformedBytes) {
      expect(decodeTransportMessage(bytes)).toEqual({ ok: false, reason: 'invalid-json' })
    }
    expect(decodeTransportMessage('{')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(decodeTransportMessage(new Uint8Array([0xff]))).toEqual({ ok: false, reason: 'invalid-json' })
  })

  it('rejects messages with invalid shapes', () => {
    const invalidMessages = [
      'null',
      '[]',
      '1',
      '{}',
      JSON.stringify({ type: 'join', playerId: '' }),
      JSON.stringify({ type: 'state', playerId: 'player-1' }),
      JSON.stringify({ type: 'state', playerId: 'player-1', payload: 1 }),
      JSON.stringify({ type: 'unknown', playerId: 'player-1' }),
    ]

    for (const message of invalidMessages) {
      expect(decodeTransportMessage(message)).toEqual({ ok: false, reason: 'invalid-shape' })
    }
  })
})

describe('WebSocketTransport', () => {
  it('tracks lifecycle, forwards messages, and sends JSON', () => {
    const fixture = socketOf(0)
    const states: string[] = []
    const messages: TransportMessage[] = []
    const errors: unknown[] = []
    const closes: Array<{ code: number; reason: string }> = []
    const transport = new WebSocketTransport(fixture.socket, {
      onStateChange: (state) => states.push(state),
      onMessage: (message) => messages.push(message),
      onError: (error) => errors.push(error),
      onClose: (event) => closes.push(event),
    })

    expect(transport.state).toBe('connecting')
    expect(transport.isOpen).toBe(false)
    fixture.setState(1)
    fixture.socket.onopen?.()
    fixture.socket.onmessage?.({ data: JSON.stringify(joinMessage) })
    fixture.socket.onmessage?.({ data: new Uint8Array([0xff]) })
    fixture.socket.onerror?.(new Error('network'))
    fixture.setState(3)
    fixture.socket.onclose?.({ code: 1000, reason: 'done' })

    expect(states).toEqual(['open', 'closed'])
    expect(messages).toEqual([joinMessage])
    expect(errors.map((error) => (error instanceof Error ? error.message : String(error)))).toEqual([
      'invalid websocket message: invalid-json',
      'network',
    ])
    expect(closes).toEqual([{ code: 1000, reason: 'done' }])

    expect(() => transport.send(joinMessage)).toThrow('websocket is closed')
    fixture.setState(1)
    expect(transport.isOpen).toBe(true)
    transport.send(joinMessage)
    expect(fixture.sent).toEqual([JSON.stringify(joinMessage)])

    fixture.setState(2)
    transport.close(1001, 'leaving')
    expect(fixture.closed).toEqual([{ code: 1001, reason: 'leaving' }])
    fixture.setState(3)
    transport.close()
    expect(fixture.closed).toHaveLength(1)
  })

  it('maps all socket ready states and supports default handlers', () => {
    for (const [readyState, expected] of [
      [0, 'connecting'],
      [1, 'open'],
      [2, 'closing'],
      [3, 'closed'],
      [99, 'closed'],
    ] as const) {
      const fixture = socketOf(readyState)
      const transport = new WebSocketTransport(fixture.socket)
      expect(transport.state).toBe(expected)
    }

    const fixture = socketOf(1)
    const transport = new WebSocketTransport(fixture.socket, {})
    fixture.socket.onopen?.()
    fixture.socket.onmessage?.({ data: JSON.stringify(joinMessage) })
    fixture.socket.onerror?.(new Error('ignored'))
    fixture.setState(3)
    fixture.socket.onclose?.({ code: 1000, reason: '' })
    transport.dispose()
    expect(fixture.socket.onopen).toBeNull()
    expect(fixture.socket.onmessage).toBeNull()
    expect(fixture.socket.onclose).toBeNull()
    expect(fixture.socket.onerror).toBeNull()
  })
})
