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

    // Test 1: Health endpoint without secret (should return minimal info)
    const response = await fetch(`http://localhost:${PROXY_PORT}/health`)

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)

    const data = (await response.json()) as any
    expect(data).toBeDefined()
    expect(data.status).toBe('healthy')
    // With security changes, these fields are not exposed without secret
    expect(data.activeConnections).toBeUndefined()
    expect(data.uptime).toBeUndefined()

    // Test 2: Health endpoint with secret (should return detailed info)
    const healthSecret = 'test-secret-123'
    process.env.SSE_WS_PROXY_HEALTH_SECRET = healthSecret

    const responseWithSecret = await fetch(`http://localhost:${PROXY_PORT}/health?secret=${healthSecret}`)
    expect(responseWithSecret.ok).toBe(true)

    const dataWithSecret = (await responseWithSecret.json()) as any
    expect(dataWithSecret).toBeDefined()
    expect(dataWithSecret.status).toBe('healthy')
    expect(dataWithSecret.activeConnections).toBe(0)
    expect(typeof dataWithSecret.uptime).toBe('number')

    // Cleanup
    delete process.env.SSE_WS_PROXY_HEALTH_SECRET

    // Stop the proxy
    await proxy.stop()
  })
})
