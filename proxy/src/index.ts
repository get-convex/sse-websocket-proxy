import WsWebSocket from 'ws'
import { IncomingMessage, ServerResponse, Server, createServer } from 'http'
import {
  encodePingMessage,
  encodeWebSocketConnectedMessage,
  encodeDataMessage,
  encodeBinaryDataMessage,
  encodeWebSocketErrorMessage,
  encodeWebSocketClosedMessage,
} from './sse-protocol.js'
import { decodeMessageRequest, decodeBinaryData, isTextMessageRequest, isBinaryMessageRequest } from './messages-protocol.js'

export interface ProxyConfig {
  port: number
  allowedHosts: string[]
  allowAnyLocalhostPort: boolean
  dangerouslyAllowAnyHost?: boolean
  keepaliveInterval?: number
  connectionTimeout?: number
}

interface Client {
  sseResponse: ServerResponse
  websocket: WsWebSocket
  sessionId: string
  lastActivity: number
}

export class SSEWebSocketProxy {
  private clients = new Map<string, Client>()
  private server: Server | null = null
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(private config: ProxyConfig) {
    this.config = {
      keepaliveInterval: 30000, // 30 seconds
      connectionTimeout: 60000, // 60 seconds
      ...config,
    }
  }

  private isVerbose(): boolean {
    return !!process.env.SSE_WS_PROXY_VERBOSE
  }

  private verboseLog(...args: any[]): void {
    if (this.isVerbose()) {
      console.log('[SSE-WS-PROXY-VERBOSE]', ...args)
    }
  }

  private isBackendAllowed(backendUrl: string): boolean {
    try {
      const url = new URL(backendUrl)

      // Allow any host if explicitly enabled
      if (this.config.dangerouslyAllowAnyHost) {
        console.warn(
          `⚠️  SECURITY WARNING: dangerouslyAllowAnyHost is enabled - allowing connection to ${url.hostname}:${url.port || (url.protocol === 'wss:' ? 443 : 80)}`,
        )
        return true
      }

      // Check localhost/127.0.0.1 (any port allowed if enabled)
      if (this.config.allowAnyLocalhostPort) {
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
        if (isLocalhost) {
          return true
        }
      }

      // Check against allowed hosts (exact match including port)
      const hostWithPort = url.port ? `${url.hostname}:${url.port}` : url.hostname
      const hostWithoutPort = url.hostname

      for (const allowedHost of this.config.allowedHosts) {
        try {
          const allowedUrl = new URL(allowedHost)
          const allowedHostWithPort = allowedUrl.port ? `${allowedUrl.hostname}:${allowedUrl.port}` : allowedUrl.hostname
          const allowedHostWithoutPort = allowedUrl.hostname

          // Match with or without port, and ensure protocol compatibility
          // WebSocket protocols (ws/wss) should match HTTP protocols (http/https)
          const normalizeProtocol = (protocol: string): string => {
            const p = protocol.replace(':', '')
            if (p === 'ws') return 'http'
            if (p === 'wss') return 'https'
            return p
          }

          if (
            (hostWithPort === allowedHostWithPort || hostWithoutPort === allowedHostWithoutPort) &&
            normalizeProtocol(url.protocol) === normalizeProtocol(allowedUrl.protocol)
          ) {
            return true
          }
        } catch {
          // If allowedHost is not a valid URL, skip it
          continue
        }
      }

      return false
    } catch {
      // Invalid URL
      return false
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.listen(this.config.port, () => {
        console.log(`SSE-WebSocket Proxy listening on port ${this.config.port}`)
        console.log(`Allowed hosts: ${this.config.allowedHosts.length > 0 ? this.config.allowedHosts.join(', ') : 'none'}`)
        console.log(`Localhost allowed: ${this.config.allowAnyLocalhostPort ? 'yes (any port)' : 'no'}`)
        if (this.config.dangerouslyAllowAnyHost) {
          console.warn(`⚠️  SECURITY WARNING: Any host connections allowed (--dangerously-allow-any-host)`)
        }

        // Cleanup inactive connections
        this.cleanupInterval = setInterval(() => {
          this.cleanupInactiveConnections()
        }, this.config.connectionTimeout!)

        resolve()
      })

      this.server.on('error', reject)
    })
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url!, `http://localhost:${this.config.port}`)

    // Enable CORS for all requests
    this.setCORSHeaders(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (url.pathname.startsWith('/sse')) {
      this.handleSSEConnection(req, res)
    } else if (url.pathname === '/messages' && req.method === 'POST') {
      this.handleMessageSend(req, res)
    } else if (url.pathname === '/close' && req.method === 'POST') {
      this.handleCloseRequest(req, res)
    } else if (url.pathname === '/health') {
      this.handleHealthCheck(req, res)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  }

  private setCORSHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  private handleSSEConnection(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url!, `http://localhost:${this.config.port}`)
    const sessionId = url.searchParams.get('sessionId') || this.generateSessionId()
    const backendUrl = url.searchParams.get('backend')

    // Enhanced connection logging
    console.log(`SSE connection established: session=${sessionId}, client_url=${req.url}, client_ip=${req.socket.remoteAddress}`)

    // Validate backend URL is provided
    if (!backendUrl) {
      console.log(`Rejecting connection: no backend URL specified (session ${sessionId})`)
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Missing backend parameter. Usage: /sse?backend=ws://localhost:8080&sessionId=...')
      return
    }

    // Validate backend URL is allowed
    if (!this.isBackendAllowed(backendUrl)) {
      console.log(`Rejecting connection: backend URL not allowed: ${backendUrl} (session ${sessionId})`)
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end(`Backend URL not allowed: ${backendUrl}`)
      return
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...this.getCORSHeaders(),
    })

    // Create WebSocket connection to backend, preserving the original path structure
    const wsUrl = this.buildWebSocketUrl(backendUrl, req.url!)
    console.log(`Connecting to WebSocket backend: ${wsUrl} (for session ${sessionId})`)
    const websocket = new WsWebSocket(wsUrl)
    websocket.binaryType = 'arraybuffer'

    const client: Client = {
      sseResponse: res,
      websocket,
      sessionId,
      lastActivity: Date.now(),
    }

    this.clients.set(sessionId, client)

    this.setupWebSocketHandlers(client)
    this.setupSSECleanup(req, res, sessionId)

    // Send keepalive pings
    const keepaliveInterval = setInterval(() => {
      if (!res.destroyed) {
        this.sendSSEMessage(res, encodePingMessage(Date.now()))
        client.lastActivity = Date.now()
      } else {
        clearInterval(keepaliveInterval)
      }
    }, this.config.keepaliveInterval!)
  }

  private async handleRequestWithSession<T>(
    req: IncomingMessage,
    res: ServerResponse,
    options: { requireOpenWebSocket?: boolean } = {},
    handler: (client: Client, data: T) => void | Promise<void>,
  ): Promise<void> {
    const sessionId = req.headers['x-session-id'] as string

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing X-Session-Id header' }))
      return
    }

    const client = this.clients.get(sessionId)
    if (!client) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    if (options.requireOpenWebSocket && client.websocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'WebSocket not connected' }))
      return
    }

    // Read the request body
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', async () => {
      let data: T
      try {
        data = JSON.parse(body)
      } catch (error) {
        console.error('Error parsing JSON request:', error)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      // Call the handler - any errors here should crash, not be caught
      await handler(client, data)
    })
  }

  private handleMessageSend(req: IncomingMessage, res: ServerResponse): void {
    const sessionId = req.headers['x-session-id'] as string

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing X-Session-Id header' }))
      return
    }

    const client = this.clients.get(sessionId)
    if (!client) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    if (client.websocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'WebSocket not connected' }))
      return
    }

    // Read the request body as JSON
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        // Parse and validate the message request
        const messageRequest = decodeMessageRequest(body)
        this.verboseLog(`Received message from client:`, messageRequest)

        if (isTextMessageRequest(messageRequest)) {
          // Send text message directly to WebSocket backend
          this.verboseLog(`Sending text message to WebSocket backend:`, messageRequest.data)
          client.websocket.send(messageRequest.data)
        } else if (isBinaryMessageRequest(messageRequest)) {
          // Decode base64 data and send as binary to WebSocket backend
          const binaryData = decodeBinaryData(messageRequest.data)
          this.verboseLog(`Sending binary message to WebSocket backend: ${binaryData.length} bytes`)
          client.websocket.send(binaryData)
        }

        client.lastActivity = Date.now()

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        console.error(`Failed to process message for session:`, error)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: `Invalid message format: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }),
        )
      }
    })
  }

  private handleCloseRequest(req: IncomingMessage, res: ServerResponse): void {
    this.handleRequestWithSession(
      req,
      res,
      {}, // Don't require open WebSocket - we might want to close during CONNECTING
      (client, data: { code?: number; reason?: string }) => {
        const { code = 1000, reason = '' } = data

        // Track if response has been sent
        let responseSent = false

        // Set up close event listener to capture actual close info
        const closeHandler = (actualCode: number, actualReason: Buffer) => {
          if (responseSent) return
          responseSent = true

          const wasClean = actualCode >= 1000 && actualCode <= 1003
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              code: actualCode,
              reason: actualReason.toString(),
              wasClean,
            }),
          )
        }

        // Set up timeout in case WebSocket doesn't close cleanly
        const timeout = setTimeout(() => {
          if (responseSent) return
          responseSent = true

          client.websocket.removeListener('close', closeHandler)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              code: 1006,
              reason: 'Close timeout',
              wasClean: false,
            }),
          )
        }, 5000) // 5 second timeout

        client.websocket.once('close', (actualCode, actualReason) => {
          clearTimeout(timeout)
          closeHandler(actualCode, actualReason)
        })

        // Close the backend WebSocket with the requested code/reason
        console.log(`Closing WebSocket with code ${code}, reason: ${reason}`)

        // Handle different WebSocket states
        if (client.websocket.readyState === WebSocket.CONNECTING) {
          // Still connecting - terminate to avoid error
          client.websocket.terminate()
        } else if (client.websocket.readyState === WebSocket.OPEN) {
          // Open - normal close
          client.websocket.close(code, reason)
        }
        // If already closing or closed, do nothing
      },
    )
  }

  private handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    const activeConnections = Array.from(this.clients.entries()).map(([sessionId, client]) => ({
      sessionId,
      websocketState: this.getWebSocketState(client.websocket),
      lastActivity: new Date(client.lastActivity).toISOString(),
    }))

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        status: 'healthy',
        activeConnections: activeConnections.length,
        connections: activeConnections,
        uptime: process.uptime(),
      }),
    )
  }

  private setupWebSocketHandlers(client: Client): void {
    const { websocket, sseResponse, sessionId } = client

    websocket.on('open', () => {
      console.log(`WebSocket connected to backend (session ${sessionId})`)
      this.verboseLog(`WebSocket connected event fired for session ${sessionId}`)
      this.sendSSEMessage(sseResponse, encodeWebSocketConnectedMessage(sessionId, Date.now()))
    })

    websocket.on('message', (data, isBinary) => {
      client.lastActivity = Date.now()

      if (isBinary) {
        // Binary message - encode as base64 and send as binary SSE message
        let base64Data: string
        if (data instanceof ArrayBuffer) {
          base64Data = Buffer.from(data).toString('base64')
        } else if (Buffer.isBuffer(data)) {
          base64Data = data.toString('base64')
        } else {
          // Handle other binary types
          base64Data = Buffer.from(data as any).toString('base64')
        }
        this.verboseLog(
          `Received binary message from WebSocket backend (session ${sessionId}): ${'length' in data ? data.length : (data as any).byteLength || 0} bytes`,
        )
        this.sendSSEMessage(sseResponse, encodeBinaryDataMessage(base64Data, Date.now()))
      } else {
        // Text message
        this.verboseLog(`Received text message from WebSocket backend (session ${sessionId}):`, data.toString())
        this.sendSSEMessage(sseResponse, encodeDataMessage(data.toString(), Date.now()))
      }
    })

    websocket.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error)
      this.sendSSEMessage(sseResponse, encodeWebSocketErrorMessage(error.message, Date.now()))
    })

    websocket.on('close', (code, reason) => {
      console.log(`WebSocket closed (session ${sessionId}): code=${code}, reason=${reason.toString()}`)
      this.verboseLog(`WebSocket close event fired for session ${sessionId}: code=${code}, reason=${reason.toString()}`)

      // Determine if close was clean (normal closure codes)
      const wasClean = code >= 1000 && code <= 1003

      this.sendSSEMessage(sseResponse, encodeWebSocketClosedMessage(code, reason.toString(), wasClean, Date.now()))

      // Clean up the client connection
      this.cleanupClient(sessionId, 'websocket-closed')
    })
  }

  private setupSSECleanup(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
    res.on('close', () => {
      this.cleanupClient(sessionId, 'sse-closed')
    })

    req.on('aborted', () => {
      this.cleanupClient(sessionId, 'sse-aborted')
    })
  }

  private sendSSEMessage(res: ServerResponse, encodedData: string): void {
    if (res.destroyed) return

    const message = `data: ${encodedData}\n\n`
    this.verboseLog(`Sending SSE message to client:`, encodedData)
    res.write(message)
  }

  private cleanupClient(
    sessionId: string,
    reason: 'sse-closed' | 'sse-aborted' | 'websocket-closed' | 'timeout' = 'websocket-closed',
  ): void {
    const client = this.clients.get(sessionId)
    if (client) {
      if (client.websocket && client.websocket.readyState === WebSocket.OPEN) {
        // If SSE connection was terminated (tab close, network issue), send 1001 "going away"
        if (reason === 'sse-closed' || reason === 'sse-aborted') {
          client.websocket.close(1001, 'Client going away')
        } else {
          // Normal cleanup - let WebSocket close naturally
          client.websocket.close()
        }
      }
      if (!client.sseResponse.destroyed) {
        client.sseResponse.end()
      }
      this.clients.delete(sessionId)
    }
  }

  private cleanupInactiveConnections(): void {
    const now = Date.now()
    for (const [sessionId, client] of this.clients.entries()) {
      if (now - client.lastActivity > this.config.connectionTimeout!) {
        console.log(`Cleaning up inactive session: ${sessionId}`)
        this.cleanupClient(sessionId, 'timeout')
      }
    }
  }

  private buildWebSocketUrl(backendUrl: string, originalRequestUrl: string): string {
    // The backend URL is now passed directly from the client, so we just need to ensure
    // localhost uses IPv4 to avoid connection issues
    const url = new URL(backendUrl)

    // Force IPv4 for localhost to avoid IPv6 connection issues
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
    }

    return url.toString()
  }

  private generateSessionId(): string {
    // Generate a more random session ID using crypto
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 15)
    const random2 = Math.random().toString(36).substring(2, 15)
    return `session-${timestamp}-${random}-${random2}`
  }

  private getWebSocketState(ws: WsWebSocket): string {
    switch (ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting'
      case WebSocket.OPEN:
        return 'open'
      case WebSocket.CLOSING:
        return 'closing'
      case WebSocket.CLOSED:
        return 'closed'
      default:
        return 'unknown'
    }
  }

  private getCORSHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Id',
      'Access-Control-Allow-Credentials': 'true',
    }
  }

  async stop(): Promise<void> {
    console.log('Shutting down proxy server...')

    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Close all client connections
    for (const sessionId of this.clients.keys()) {
      this.cleanupClient(sessionId, 'websocket-closed')
    }

    // Close the HTTP server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log('Proxy server shut down complete')
          this.server = null
          resolve()
        })
      })
    }
  }

  // Test utilities for sending raw messages to specific sessions
  sendRawMessageToSession(sessionId: string, rawData: string): boolean {
    const client = this.clients.get(sessionId)
    if (!client) {
      return false
    }

    this.sendSSEMessage(client.sseResponse, rawData)
    return true
  }

  getActiveSessionIds(): string[] {
    return Array.from(this.clients.keys())
  }

  hasSession(sessionId: string): boolean {
    return this.clients.has(sessionId)
  }
}
