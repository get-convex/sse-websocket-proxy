#!/usr/bin/env node

import { Command } from 'commander'
import { SSEWebSocketProxy } from './index.js'

const program = new Command()

program
  .name('sse-websocket-proxy')
  .description('A proxy server that converts WebSocket connections to Server-Sent Events (SSE) for browsers with network restrictions')
  .version('0.0.1')
  .option('-p, --port <port>', 'Port to run the proxy server on', '3001')
  .option('-k, --keepalive <ms>', 'Keepalive interval in milliseconds', '30000')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds', '60000')
  .option('-v, --verbose', 'Enable verbose logging (same as SSE_WS_PROXY_VERBOSE=1)')
  .option(
    '--allow-host <url>',
    'Allow connections to this host (can be used multiple times)',
    (value: string, previous: string[]) => {
      return previous ? [...previous, value] : [value]
    },
    [],
  )
  .option('--allow-any-localhost-port', 'Allow connections to any localhost/127.0.0.1 port')
  .option('--dangerously-allow-any-host', 'DANGEROUS: Allow connections to any host (disables all security)')
  .addHelpText(
    'after',
    `
Examples:
  $ npx @convex-dev/sse-websocket-proxy --allow-host https://api.example.com   # Allow only api.example.com
  $ npx @convex-dev/sse-websocket-proxy --allow-any-localhost-port            # Allow any localhost port
  $ npx @convex-dev/sse-websocket-proxy --allow-host wss://ws.example.com --allow-host https://api.other.com  # Multiple hosts
  $ npx @convex-dev/sse-websocket-proxy --allow-any-localhost-port --verbose  # Localhost + verbose logging
  $ npx @convex-dev/sse-websocket-proxy --dangerously-allow-any-host          # DANGEROUS: Allow any host

Usage in client:
  The client specifies the backend URL when connecting:
  GET /sse?backend=ws://localhost:8080&sessionId=abc123

Environment Variables:
  SSE_WS_PROXY_VERBOSE=1        Enable verbose message logging (overrides --verbose)
  SSE_WS_PROXY_HEALTH_SECRET    Secret required to access detailed health information

API Endpoints:
  GET  /sse?backend=<url>&sessionId=<id>   Server-Sent Events endpoint with backend URL
  POST /messages                           Send messages to WebSocket backend  
  GET  /health                             Health check and connection status
  GET  /health?secret=<secret>             Detailed health info (requires SSE_WS_PROXY_HEALTH_SECRET)

Security:
  You must specify at least one allowed host or use --allow-any-localhost-port
  By default, no destinations are allowed for security
  Use --dangerously-allow-any-host only in development environments!
`,
  )

program.parse(process.argv)

const options = program.opts()

async function main() {
  console.log('This proxy is beta, not officially supported software. Run at your own risk.')
  // Validate that at least one allowed destination is specified (unless dangerously allowing any host)
  if (!options.dangerouslyAllowAnyHost && !options.allowAnyLocalhostPort && (!options.allowHost || options.allowHost.length === 0)) {
    console.error(
      'Error: You must specify at least one allowed host (--allow-host), use --allow-any-localhost-port, or --dangerously-allow-any-host',
    )
    console.error('Run with --help for usage examples')
    process.exit(1)
  }

  // Set verbose mode if requested
  if (options.verbose && !process.env.SSE_WS_PROXY_VERBOSE) {
    process.env.SSE_WS_PROXY_VERBOSE = '1'
  }

  const proxy = new SSEWebSocketProxy({
    port: parseInt(options.port),
    allowedHosts: options.allowHost || [],
    allowAnyLocalhostPort: !!options.allowAnyLocalhostPort,
    dangerouslyAllowAnyHost: !!options.dangerouslyAllowAnyHost,
    keepaliveInterval: parseInt(options.keepalive),
    connectionTimeout: parseInt(options.timeout),
  })

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...')
    await proxy.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...')
    await proxy.stop()
    process.exit(0)
  })

  // Start the proxy server
  try {
    await proxy.start()
  } catch (error) {
    console.error('Failed to start proxy server:', error)
    process.exit(1)
  }
}

main().catch(console.error)
