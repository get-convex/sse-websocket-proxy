import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SimulatedWebsocket, CONNECTING, OPEN, CLOSING, CLOSED } from "../node.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import getPort from "get-port";

describe("Invalid State Transitions", () => {
  let simulatedWs: SimulatedWebsocket;
  
  afterEach(() => {
    if (simulatedWs) {
      simulatedWs.close();
    }
  });

  it("should throw when calling send() during CONNECTING state", async () => {
    const nonExistentPort = await getPort();
    const backendUrl = "ws://localhost:8999";
    
    // Create SimulatedWebSocket - it starts in CONNECTING state
    simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${nonExistentPort}`);
    
    // Should be in CONNECTING state initially
    expect(simulatedWs.readyState).toBe(CONNECTING);
    
    // Trying to send should throw an error
    expect(() => {
      simulatedWs.send("test message");
    }).toThrow("WebSocket is not open");
  });

  it("should handle close() during CONNECTING state gracefully", async () => {
    const nonExistentPort = await getPort();
    const backendUrl = "ws://localhost:8999";
    
    // Track events
    let closeEventReceived = false;
    let closeEvent: any = null;
    let errorEventReceived = false;
    
    const closePromise = new Promise<void>((resolve) => {
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${nonExistentPort}`);
      
      simulatedWs.addEventListener("close", (event: any) => {
        closeEventReceived = true;
        closeEvent = event;
        resolve();
      });
      
      simulatedWs.addEventListener("error", () => {
        errorEventReceived = true;
      });
      
      // Should be in CONNECTING state initially
      expect(simulatedWs.readyState).toBe(CONNECTING);
      
      // Call close() while still connecting - this should work without throwing
      simulatedWs.close(1000, "Client initiated close during connecting");
    });
    
    // Should go directly to CLOSED state since no WebSocket connection was established
    expect(simulatedWs.readyState).toBe(CLOSED);
    
    // Wait for close event
    await closePromise;
    
    // Should receive close event, not error event
    expect(closeEventReceived).toBe(true);
    expect(errorEventReceived).toBe(false);
    expect(closeEvent).toBeDefined();
    expect(closeEvent.code).toBe(1000);
    expect(closeEvent.reason).toBe("Client initiated close during connecting");
    expect(closeEvent.wasClean).toBe(true);
    
    // Should end up in CLOSED state
    expect(simulatedWs.readyState).toBe(CLOSED);
  });

  it("should be idempotent when calling close() multiple times", async () => {
    const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
    const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");
    
    const proxyPort = await getPort();
    const backendPort = await getPort();
    
    // Start a real backend and proxy
    const testBackend = await WSTestBackend.create({ port: backendPort });
    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `http://localhost:${backendPort}`,
    });
    
    await proxy.start();
    
    try {
      const backendUrl = `ws://localhost:${backendPort}`;
      
      // Wait for connection to be established
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);
      
      await new Promise<void>((resolve) => {
        simulatedWs.addEventListener("open", () => {
          resolve();
        });
      });
      
      expect(simulatedWs.readyState).toBe(OPEN);
      
      // Track close events
      let closeEventCount = 0;
      simulatedWs.addEventListener("close", () => {
        closeEventCount++;
      });
      
      // Call close multiple times - should be idempotent
      simulatedWs.close(1000, "First close");
      expect(simulatedWs.readyState).toBe(CLOSING);
      
      simulatedWs.close(1001, "Second close - should be ignored");
      simulatedWs.close(1002, "Third close - should be ignored");
      
      // Wait for actual close
      await new Promise<void>((resolve) => {
        const checkClosed = () => {
          if (simulatedWs.readyState === CLOSED) {
            resolve();
          } else {
            setTimeout(checkClosed, 10);
          }
        };
        checkClosed();
      });
      
      // Should only receive one close event
      expect(closeEventCount).toBe(1);
      expect(simulatedWs.readyState).toBe(CLOSED);
      
      // Additional close calls should be no-ops
      simulatedWs.close(1003, "Close after closed - should be ignored");
      expect(closeEventCount).toBe(1); // Still just one event
      
    } finally {
      await testBackend.stop();
      await proxy.stop();
    }
  });

  it("should throw when calling send() on closed WebSocket", async () => {
    const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
    const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");
    
    const proxyPort = await getPort();
    const backendPort = await getPort();
    
    // Start a real backend and proxy
    const testBackend = await WSTestBackend.create({ port: backendPort });
    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `http://localhost:${backendPort}`,
    });
    
    await proxy.start();
    
    try {
      const backendUrl = `ws://localhost:${backendPort}`;
      
      // Wait for connection to be established and then closed
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);
      
      await new Promise<void>((resolve) => {
        simulatedWs.addEventListener("open", () => {
          // Close immediately after opening
          simulatedWs.close();
        });
        
        simulatedWs.addEventListener("close", () => {
          resolve();
        });
      });
      
      expect(simulatedWs.readyState).toBe(CLOSED);
      
      // Trying to send should throw an error
      expect(() => {
        simulatedWs.send("test message");
      }).toThrow("WebSocket is not open");
      
    } finally {
      await testBackend.stop();
      await proxy.stop();
    }
  });

  it("should cause proxy to clean up connection when client closes during CONNECTING", async () => {
    const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
    const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");
    
    const proxyPort = await getPort();
    const backendPort = await getPort();
    
    // Start a real backend and proxy
    const testBackend = await WSTestBackend.create({ port: backendPort });
    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `http://localhost:${backendPort}`,
    });
    
    await proxy.start();
    
    try {
      const backendUrl = `ws://localhost:${backendPort}`;
      
      // Start connection but close immediately (during CONNECTING state)
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);
      
      expect(simulatedWs.readyState).toBe(CONNECTING);
      
      // Close immediately while still connecting
      const closePromise = new Promise<void>((resolve) => {
        simulatedWs.addEventListener("close", () => {
          resolve();
        });
      });
      
      simulatedWs.close(1000, "Abort connection");
      expect(simulatedWs.readyState).toBe(CLOSED);
      
      await closePromise;
      expect(simulatedWs.readyState).toBe(CLOSED);
      
      // Give the proxy time to clean up
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check proxy health - should show no active connections
      const healthResponse = await fetch(`http://localhost:${proxyPort}/health`);
      const healthData = await healthResponse.json();
      
      expect(healthData.activeConnections).toBe(0);
      expect(healthData.connections).toHaveLength(0);
      
      // Check that backend never received a connection (or if it did, it was cleaned up)
      expect(testBackend.hasConnection()).toBe(false);
      
    } finally {
      await testBackend.stop();
      await proxy.stop();
    }
  });

  it("should properly handle race condition between open and close", async () => {
    const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
    const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");
    
    const proxyPort = await getPort();
    const backendPort = await getPort();
    
    // Start a real backend and proxy
    const testBackend = await WSTestBackend.create({ port: backendPort });
    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `http://localhost:${backendPort}`,
    });
    
    await proxy.start();
    
    try {
      const backendUrl = `ws://localhost:${backendPort}`;
      
      // Track all events
      let openEventReceived = false;
      let closeEventReceived = false;
      let closeEvent: any = null;
      
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);
      
      simulatedWs.addEventListener("open", () => {
        openEventReceived = true;
      });
      
      simulatedWs.addEventListener("close", (event: any) => {
        closeEventReceived = true;
        closeEvent = event;
      });
      
      // Wait a tiny bit for connection to start, then close
      await new Promise(resolve => setTimeout(resolve, 5));
      simulatedWs.close(1000, "Race condition test");
      
      // Wait for final state
      await new Promise<void>((resolve) => {
        const checkClosed = () => {
          if (simulatedWs.readyState === CLOSED) {
            resolve();
          } else {
            setTimeout(checkClosed, 10);
          }
        };
        checkClosed();
      });
      
      // Should always end up closed
      expect(simulatedWs.readyState).toBe(CLOSED);
      expect(closeEventReceived).toBe(true);
      expect(closeEvent).toBeDefined();
      
      // Open event may or may not have fired depending on timing
      // but close should always happen
      
      // Give proxy time to clean up
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Proxy should be clean
      const healthResponse = await fetch(`http://localhost:${proxyPort}/health`);
      const healthData = await healthResponse.json();
      expect(healthData.activeConnections).toBe(0);
      
    } finally {
      await testBackend.stop();
      await proxy.stop();
    }
  });
});