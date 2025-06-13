import WebSocket, { WebSocketServer } from 'ws'
import { IncomingMessage, ServerResponse, Server, createServer } from 'http'

export interface ProxyConfig {
  backendUrl: string
  port: number
  keepaliveInterval?: number
  connectionTimeout?: number
}

interface Client {
  sseResponse: ServerResponse
  websocket: WebSocket
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

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.listen(this.config.port, () => {
        console.log(`SSE-WebSocket Proxy listening on port ${this.config.port}`)
        console.log(`Proxying to backend: ${this.config.backendUrl}`)

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

    console.log(`SSE connection request for session: ${sessionId}`)
    console.log(`Original request URL: ${req.url}`)
    console.log(`Parsed URL path: ${url.pathname}`)

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...this.getCORSHeaders(),
    })

    // Send initial connection event
    this.sendSSEMessage(res, { type: 'connected', sessionId })

    // Create WebSocket connection to backend, preserving the original path structure
    const wsUrl = this.buildWebSocketUrl(this.config.backendUrl, req.url!)
    console.log(`Connecting to WebSocket backend: ${wsUrl}`)
    const websocket = new WebSocket(wsUrl)

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
        this.sendSSEMessage(res, { type: 'ping', timestamp: Date.now() })
        client.lastActivity = Date.now()
      } else {
        clearInterval(keepaliveInterval)
      }
    }, this.config.keepaliveInterval!)
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

    // Read the request body
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        const message = JSON.parse(body)
        client.websocket.send(JSON.stringify(message))
        client.lastActivity = Date.now()

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))

        console.log(`Sent message for session ${sessionId}:`, message.type)
      } catch (error) {
        console.error('Error sending message:', error)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
  }

  private handleCloseRequest(req: IncomingMessage, res: ServerResponse): void {
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

    // Read the request body
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', () => {
      try {
        const { code = 1000, reason = '' } = JSON.parse(body)

        // Set up close event listener to capture actual close info
        const closeHandler = (actualCode: number, actualReason: Buffer) => {
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
        console.log(`Closing WebSocket for session ${sessionId} with code ${code}, reason: ${reason}`)
        
        // Handle different WebSocket states
        if (client.websocket.readyState === WebSocket.CONNECTING) {
          // Still connecting - terminate to avoid error
          client.websocket.terminate()
        } else if (client.websocket.readyState === WebSocket.OPEN) {
          // Open - normal close
          client.websocket.close(code, reason)
        }
        // If already closing or closed, do nothing
      } catch (error) {
        console.error('Error parsing close request:', error)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
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
      console.log(`WebSocket connected for session: ${sessionId}`)
      this.sendSSEMessage(sseResponse, {
        type: 'websocket-connected',
        sessionId,
        timestamp: Date.now(),
      })
    })

    websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        client.lastActivity = Date.now()

        // Forward WebSocket message to SSE client
        this.sendSSEMessage(sseResponse, {
          type: 'message',
          data: message,
          timestamp: Date.now(),
        })

        console.log(`Forwarded message to SSE client ${sessionId}:`, message.type)
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    })

    websocket.on('error', (error) => {
      console.error(`WebSocket error for session ${sessionId}:`, error)
      this.sendSSEMessage(sseResponse, {
        type: 'websocket-error',
        error: error.message,
        timestamp: Date.now(),
      })
    })

    websocket.on('close', (code, reason) => {
      console.log(`WebSocket closed for session ${sessionId}:`, code, reason.toString())

      // Determine if close was clean (normal closure codes)
      const wasClean = code >= 1000 && code <= 1003

      this.sendSSEMessage(sseResponse, {
        type: 'websocket-closed',
        code,
        reason: reason.toString(),
        wasClean,
        timestamp: Date.now(),
      })

      // Clean up the client connection
      this.cleanupClient(sessionId)
    })
  }

  private setupSSECleanup(req: IncomingMessage, res: ServerResponse, sessionId: string): void {
    res.on('close', () => {
      console.log(`SSE connection closed for session: ${sessionId}`)
      this.cleanupClient(sessionId)
    })

    req.on('aborted', () => {
      console.log(`SSE connection aborted for session: ${sessionId}`)
      this.cleanupClient(sessionId)
    })
  }

  private sendSSEMessage(res: ServerResponse, data: any): void {
    if (res.destroyed) return

    const message = `data: ${JSON.stringify(data)}\n\n`
    res.write(message)
  }

  private cleanupClient(sessionId: string): void {
    const client = this.clients.get(sessionId)
    if (client) {
      if (client.websocket && client.websocket.readyState === WebSocket.OPEN) {
        client.websocket.close()
      }
      if (!client.sseResponse.destroyed) {
        client.sseResponse.end()
      }
      this.clients.delete(sessionId)
      console.log(`Cleaned up session: ${sessionId}`)
    }
  }

  private cleanupInactiveConnections(): void {
    const now = Date.now()
    for (const [sessionId, client] of this.clients.entries()) {
      if (now - client.lastActivity > this.config.connectionTimeout!) {
        console.log(`Cleaning up inactive session: ${sessionId}`)
        this.cleanupClient(sessionId)
      }
    }
  }

  private buildWebSocketUrl(backendUrl: string, originalRequestUrl: string): string {
    // Extract the backend URL
    const backendUrlObj = new URL(backendUrl)
    const protocol = backendUrlObj.protocol === 'https:' ? 'wss:' : 'ws:'

    // Force IPv4 for localhost to avoid IPv6 connection issues
    let host = backendUrlObj.host
    if (host === 'localhost:8000' || host === 'localhost') {
      host = host.replace('localhost', '127.0.0.1')
    }

    if (originalRequestUrl) {
      const originalUrl = new URL(originalRequestUrl, `http://localhost:${this.config.port}`)

      // Strip /sse prefix if present, then use the remaining path
      let targetPath = originalUrl.pathname
      if (targetPath.startsWith('/sse')) {
        targetPath = targetPath.substring(4) // Remove '/sse'
        if (!targetPath.startsWith('/')) {
          targetPath = '/' + targetPath // Ensure it starts with /
        }
      }

      const fullPath = targetPath + originalUrl.search

      console.log(`Mapping SSE request '${originalUrl.pathname}' to WebSocket path '${fullPath}'`)
      return `${protocol}//${host}${fullPath}`
    }

    // Fallback if no URL provided
    console.log('No original request URL provided, using root path')
    return `${protocol}//${host}/`
  }

  private generateSessionId(): string {
    // Generate a more random session ID using crypto
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 15)
    const random2 = Math.random().toString(36).substring(2, 15)
    return `session-${timestamp}-${random}-${random2}`
  }

  private getWebSocketState(ws: WebSocket): string {
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
    for (const [sessionId, client] of this.clients.entries()) {
      this.cleanupClient(sessionId)
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
}
