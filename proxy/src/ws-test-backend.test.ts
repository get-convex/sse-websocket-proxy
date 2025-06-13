import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { WSTestBackend } from './ws-test-backend.js';

describe('WSTestBackend', () => {
  let backend: WSTestBackend;
  const TEST_PORT = 8124;

  beforeEach(async () => {
    backend = await WSTestBackend.create({ port: TEST_PORT });
  });

  afterEach(async () => {
    if (backend) {
      await backend.stop();
    }
  });

  it('should start and stop cleanly', async () => {
    expect(backend).toBeDefined();
    expect(backend.hasConnection()).toBe(false);
    
    // Stop is tested in afterEach, so if we get here it works
  });

  it('should provide a WebSocket connection when client connects', async () => {
    // Start getting the connection first, then connect client
    const connectionPromise = backend.wsConnection();
    
    // Start a client connection
    const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for client to connect
    await new Promise<void>((resolve) => {
      clientWs.on('open', () => resolve());
    });
    
    // Get the server-side connection wrapper
    const connection = await connectionPromise;
    
    expect(backend.hasConnection()).toBe(true);
    expect(connection.readyState).toBe(WebSocket.OPEN);
    
    clientWs.close();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('should allow sending and receiving messages through connection', async () => {
    // Start getting the connection first
    const connectionPromise = backend.wsConnection();
    
    const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for client to connect
    await new Promise<void>((resolve) => {
      clientWs.on('open', () => resolve());
    });
    
    const connection = await connectionPromise;
    
    // Test server -> client messaging
    const messageFromServer = 'Hello from server';
    connection.send(messageFromServer);
    
    const receivedByClient = await new Promise<string>((resolve) => {
      clientWs.on('message', (data) => {
        resolve(data.toString());
      });
    });
    
    expect(receivedByClient).toBe(messageFromServer);
    
    // Test client -> server messaging
    const messageFromClient = 'Hello from client';
    
    const receivedByServer = new Promise<string>((resolve) => {
      connection.onMessage((data) => {
        resolve(data);
      });
    });
    
    clientWs.send(messageFromClient);
    
    expect(await receivedByServer).toBe(messageFromClient);
    
    clientWs.close();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('should handle connection close events', async () => {
    // Start getting the connection first
    const connectionPromise = backend.wsConnection();
    
    const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for client to connect
    await new Promise<void>((resolve) => {
      clientWs.on('open', () => resolve());
    });
    
    const connection = await connectionPromise;
    
    let closeCode: number | undefined;
    let closeReason: string | undefined;
    
    const closePromise = new Promise<void>((resolve) => {
      connection.onClose((code, reason) => {
        closeCode = code;
        closeReason = reason;
        resolve();
      });
    });
    
    clientWs.close(1000, 'Normal closure');
    
    // Wait for close event
    await closePromise;
    
    expect(closeCode).toBe(1000);
    expect(closeReason).toBe('Normal closure');
    expect(backend.hasConnection()).toBe(false);
  });

  it('should handle connection errors', async () => {
    // Start getting the connection first
    const connectionPromise = backend.wsConnection();
    
    const clientWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for client to connect
    await new Promise<void>((resolve) => {
      clientWs.on('open', () => resolve());
    });
    
    const connection = await connectionPromise;
    
    let receivedError: Error | undefined;
    
    const errorPromise = new Promise<void>((resolve) => {
      connection.onError((error) => {
        receivedError = error;
        resolve();
      });
    });
    
    // Force an error by terminating the client WebSocket abruptly
    clientWs.terminate();
    
    // Wait for error event (or timeout if no error occurs)
    await Promise.race([
      errorPromise,
      new Promise(resolve => setTimeout(resolve, 200))
    ]);
    
    // Note: Error may not always be triggered, depending on timing
    // The important thing is that the connection gets cleaned up
    expect(backend.hasConnection()).toBe(false);
  });

  it('should only allow one connection at a time', async () => {
    // Start getting the connection first
    const connectionPromise = backend.wsConnection();
    
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for first client to connect
    await new Promise<void>((resolve) => {
      client1.on('open', () => resolve());
    });
    
    const connection1 = await connectionPromise;
    
    expect(backend.hasConnection()).toBe(true);
    
    // Try to connect a second client - it should be rejected
    const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for second client to be rejected with timeout fallback
    const rejectionPromise = new Promise<number>((resolve) => {
      client2.on('close', (code) => {
        resolve(code);
      });
    });
    
    const result = await Promise.race([
      rejectionPromise,
      new Promise<number>(resolve => setTimeout(() => resolve(-1), 1000)) // timeout fallback
    ]);
    
    expect(result).toBe(1013); // Try again later
    
    // First connection should still be active
    expect(backend.hasConnection()).toBe(true);
    expect(connection1.readyState).toBe(WebSocket.OPEN);
    
    client1.close();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  it('should allow new connection after previous one closes', async () => {
    // First connection
    const connectionPromise1 = backend.wsConnection();
    
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for first client to connect
    await new Promise<void>((resolve) => {
      client1.on('open', () => resolve());
    });
    
    const connection1 = await connectionPromise1;
    
    expect(backend.hasConnection()).toBe(true);
    
    // Close first connection
    client1.close();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(backend.hasConnection()).toBe(false);
    
    // Second connection should work
    const connectionPromise2 = backend.wsConnection();
    
    const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    
    // Wait for second client to connect
    await new Promise<void>((resolve) => {
      client2.on('open', () => resolve());
    });
    
    const connection2 = await connectionPromise2;
    
    expect(backend.hasConnection()).toBe(true);
    expect(connection2.readyState).toBe(WebSocket.OPEN);
    
    client2.close();
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});
