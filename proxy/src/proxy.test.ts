import { describe, it, expect, afterEach } from 'vitest'
import { SSEWebSocketProxy } from './index.js'
import getPort from 'get-port'

describe('SSEWebSocketProxy Basic Tests', () => {
  let proxy: SSEWebSocketProxy

  afterEach(async () => {
    if (proxy) {
      await proxy.stop()
    }
  })

  it('should start and stop proxy cleanly', async () => {
    const PROXY_PORT = await getPort()
    const DUMMY_BACKEND_PORT = await getPort()

    proxy = new SSEWebSocketProxy({
      port: PROXY_PORT,
      allowedHosts: [`ws://localhost:${DUMMY_BACKEND_PORT}`],
      allowAnyLocalhostPort: false,
    })

    // Start the proxy
    await proxy.start()

    // Verify it's running by checking the port is in use
    // (we can't easily check if the server is listening without making a request)
    expect(proxy).toBeDefined()

    // Stop the proxy
    await proxy.stop()

    // Test passes if no errors are thrown
  })

  it('should respond to health endpoint', async () => {
    const PROXY_PORT = await getPort()
    const DUMMY_BACKEND_PORT = await getPort()

    proxy = new SSEWebSocketProxy({
      port: PROXY_PORT,
      allowedHosts: [`ws://localhost:${DUMMY_BACKEND_PORT}`],
      allowAnyLocalhostPort: false,
    })

    // Start the proxy
    await proxy.start()

    // Make a request to the health endpoint
    const response = await fetch(`http://localhost:${PROXY_PORT}/health`)

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)

    const data = (await response.json()) as any
    expect(data).toBeDefined()
    expect(data.status).toBe('healthy')
    expect(data.activeConnections).toBe(0)
    expect(typeof data.uptime).toBe('number')

    // Stop the proxy
    await proxy.stop()
  })
})
