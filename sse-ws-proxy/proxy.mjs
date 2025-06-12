#!/usr/bin/env node

/**
 * Usage: node sse-websocket-proxy.mjs [backend-url] [proxy-port]
 * Example: node sse-websocket-proxy.mjs wss://happy-animal-123.convex.cloud 3001
 */

import http from 'http'
import { WebSocket } from 'ws'
import { URL } from 'url'

// Configuration
const BACKEND_URL = process.argv[2] || 'http://localhost:8000'
const PROXY_PORT = parseInt(process.argv[3]) || 3001
const KEEPALIVE_INTERVAL = 30000 // 30 seconds
const CONNECTION_TIMEOUT = 60000 // 60 seconds

class SSEWebSocketProxy {
  constructor() {
    this.clients = new Map() // sessionId -> { sseResponse, websocket, lastActivity }
    this.server = null
  }

  start() {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.listen(PROXY_PORT, () => {
      console.log(`SSE-WebSocket Proxy listening on port ${PROXY_PORT}`)
      console.log(`Proxying to backend: ${BACKEND_URL}`)
    })

    // Cleanup inactive connections
    setInterval(() => {
      this.cleanupInactiveConnections()
    }, CONNECTION_TIMEOUT)
  }

  handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${PROXY_PORT}`)

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
    } else if (url.pathname === '/health') {
      this.handleHealthCheck(req, res)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  }

  setCORSHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }

  handleSSEConnection(req, res) {
    const url = new URL(req.url, `http://localhost:${PROXY_PORT}`)
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
    const wsUrl = this.buildWebSocketUrl(BACKEND_URL, req.url)
    console.log(`Connecting to WebSocket backend: ${wsUrl}`)
    const websocket = new WebSocket(wsUrl)

    const client = {
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
    }, KEEPALIVE_INTERVAL)
  }

  handleMessageSend(req, res) {
    const sessionId = req.headers['x-session-id']

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

  handleHealthCheck(req, res) {
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

  setupWebSocketHandlers(client) {
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
      this.sendSSEMessage(sseResponse, {
        type: 'websocket-closed',
        code,
        reason: reason.toString(),
        timestamp: Date.now(),
      })

      // Clean up the client connection
      this.cleanupClient(sessionId)
    })
  }

  setupSSECleanup(req, res, sessionId) {
    res.on('close', () => {
      console.log(`SSE connection closed for session: ${sessionId}`)
      this.cleanupClient(sessionId)
    })

    req.on('aborted', () => {
      console.log(`SSE connection aborted for session: ${sessionId}`)
      this.cleanupClient(sessionId)
    })
  }

  sendSSEMessage(res, data) {
    if (res.destroyed) return

    const message = `data: ${JSON.stringify(data)}\n\n`
    res.write(message)
  }

  cleanupClient(sessionId) {
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

  cleanupInactiveConnections() {
    const now = Date.now()
    for (const [sessionId, client] of this.clients.entries()) {
      if (now - client.lastActivity > CONNECTION_TIMEOUT) {
        console.log(`Cleaning up inactive session: ${sessionId}`)
        this.cleanupClient(sessionId)
      }
    }
  }

  buildWebSocketUrl(backendUrl, originalRequestUrl) {
    // Extract the backend URL
    const backendUrlObj = new URL(backendUrl)
    const protocol = backendUrlObj.protocol === 'https:' ? 'wss:' : 'ws:'

    // Force IPv4 for localhost to avoid IPv6 connection issues
    let host = backendUrlObj.host
    if (host === 'localhost:8000' || host === 'localhost') {
      host = host.replace('localhost', '127.0.0.1')
    }

    if (originalRequestUrl) {
      const originalUrl = new URL(originalRequestUrl, `http://localhost:${PROXY_PORT}`)

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

  generateSessionId() {
    // Generate a more random session ID using crypto
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 15)
    const random2 = Math.random().toString(36).substring(2, 15)
    return `session-${timestamp}-${random}-${random2}`
  }

  getWebSocketState(ws) {
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

  getCORSHeaders() {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Id',
      'Access-Control-Allow-Credentials': 'true',
    }
  }

  stop() {
    console.log('Shutting down proxy server...')

    // Close all client connections
    for (const [sessionId, client] of this.clients.entries()) {
      this.cleanupClient(sessionId)
    }

    // Close the HTTP server
    if (this.server) {
      this.server.close(() => {
        console.log('Proxy server shut down complete')
      })
    }
  }
}

// Handle graceful shutdown
const proxy = new SSEWebSocketProxy()

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...')
  proxy.stop()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...')
  proxy.stop()
  process.exit(0)
})

// Start the proxy server
proxy.start()
