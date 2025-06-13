import { describe, it, expect, afterEach } from "vitest";
import { SimulatedWebsocket, createProxiedWebSocketClass } from "../node.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import getPort from "get-port";
import { SSEWebSocketProxy } from "sse-websocket-proxy";
import { WSTestBackend } from "sse-websocket-proxy/ws-test-backend";

describe("Proxy Error Handling", () => {
  let simulatedWs: SimulatedWebsocket;

  afterEach(() => {
    if (simulatedWs) {
      simulatedWs.close();
    }
  });

  it("should handle proxy not found (connection refused)", async () => {
    // Use a port that definitely won't have a proxy running
    const nonExistentPort = await getPort();
    const backendUrl = "ws://localhost:8999"; // Dummy backend

    // Set up error event listener
    let errorReceived = false;
    let errorEvent: any = null;
    const errorPromise = new Promise<void>((resolve) => {
      simulatedWs = new SimulatedWebsocket(
        backendUrl,
        undefined,
        `http://localhost:${nonExistentPort}`,
      );

      simulatedWs.addEventListener("error", (event: any) => {
        errorReceived = true;
        errorEvent = event;
        resolve();
      });
    });

    // Wait for error to occur
    await errorPromise;

    // Verify WebSocket state
    expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);

    // Verify error was fired
    expect(errorReceived).toBe(true);
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error).toBeInstanceOf(Error);

    // Verify close event was NOT fired (only error should fire for connection failures)
    let closeEventFired = false;
    simulatedWs.addEventListener("close", () => {
      closeEventFired = true;
    });

    // Wait a bit to see if close event fires
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closeEventFired).toBe(false);
  });

  it("should start in CONNECTING state before failure", async () => {
    const nonExistentPort = await getPort();
    const backendUrl = "ws://localhost:8999";

    simulatedWs = new SimulatedWebsocket(
      backendUrl,
      undefined,
      `http://localhost:${nonExistentPort}`,
    );

    // Should start in CONNECTING state
    expect(simulatedWs.readyState).toBe(WebSocket.CONNECTING);
  });

  it("should handle proxy returning 404", async () => {
    const mockProxyPort = await getPort();

    // Create a mock server that returns 404 for all requests
    const mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(mockProxyPort, resolve);
    });

    try {
      const backendUrl = "ws://localhost:8999"; // Dummy backend

      // Set up error event listener
      let errorReceived = false;
      let errorEvent: any = null;
      const errorPromise = new Promise<void>((resolve) => {
        simulatedWs = new SimulatedWebsocket(
          backendUrl,
          undefined,
          `http://localhost:${mockProxyPort}`,
        );

        simulatedWs.addEventListener("error", (event: any) => {
          errorReceived = true;
          errorEvent = event;
          resolve();
        });
      });

      // Wait for error to occur
      await errorPromise;

      // Verify WebSocket state and error handling
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
      expect(errorReceived).toBe(true);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBeInstanceOf(Error);
    } finally {
      mockServer.close();
    }
  });

  it("should handle proxy returning 500", async () => {
    const mockProxyPort = await getPort();

    // Create a mock server that returns 500 for all requests
    const mockServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(mockProxyPort, resolve);
    });

    try {
      const backendUrl = "ws://localhost:8999"; // Dummy backend

      // Set up error event listener
      let errorReceived = false;
      let errorEvent: any = null;
      const errorPromise = new Promise<void>((resolve) => {
        simulatedWs = new SimulatedWebsocket(
          backendUrl,
          undefined,
          `http://localhost:${mockProxyPort}`,
        );

        simulatedWs.addEventListener("error", (event: any) => {
          errorReceived = true;
          errorEvent = event;
          resolve();
        });
      });

      // Wait for error to occur
      await errorPromise;

      // Verify WebSocket state and error handling
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
      expect(errorReceived).toBe(true);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBeInstanceOf(Error);
    } finally {
      mockServer.close();
    }
  });

  it("should handle proxy reachable but backend WebSocket unreachable", async () => {
    const proxyPort = await getPort();
    const nonExistentBackendPort = await getPort(); // Port with no server

    // Start a real proxy pointing to non-existent backend
    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `ws://localhost:${nonExistentBackendPort}`, // This backend doesn't exist
    });

    await proxy.start();

    try {
      const backendUrl = `ws://localhost:${nonExistentBackendPort}`;

      // Set up error event listener
      let errorReceived = false;
      let errorEvent: any = null;
      const errorPromise = new Promise<void>((resolve) => {
        simulatedWs = new SimulatedWebsocket(
          backendUrl,
          undefined,
          `http://localhost:${proxyPort}`,
        );

        simulatedWs.addEventListener("error", (event: any) => {
          errorReceived = true;
          errorEvent = event;
          resolve();
        });
      });

      // Wait for error to occur (should happen when proxy tries to connect to backend)
      await errorPromise;

      // Verify WebSocket state and error handling
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
      expect(errorReceived).toBe(true);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBeInstanceOf(Error);
      // Note: WebSocket connection errors may have empty error messages
    } finally {
      await proxy.stop();
    }
  });

  it("should receive WebSocket errors forwarded from proxy", async () => {
    // This test verifies that WebSocket errors from the backend are properly
    // forwarded through the proxy to the SimulatedWebsocket as error events

    const proxyPort = await getPort();
    const nonExistentBackendPort = await getPort();

    const proxy = new SSEWebSocketProxy({
      port: proxyPort,
      backendUrl: `ws://localhost:${nonExistentBackendPort}`,
    });

    await proxy.start();

    try {
      const backendUrl = `ws://localhost:${nonExistentBackendPort}`;

      // Track all events
      let errorEventReceived = false;
      let openEventReceived = false;

      const allEventsPromise = new Promise<void>((resolve) => {
        simulatedWs = new SimulatedWebsocket(
          backendUrl,
          undefined,
          `http://localhost:${proxyPort}`,
        );

        simulatedWs.addEventListener("open", () => {
          openEventReceived = true;
        });

        simulatedWs.addEventListener("error", () => {
          errorEventReceived = true;
          // After error, check if we eventually get close too
          setTimeout(() => resolve(), 100);
        });

        simulatedWs.addEventListener("close", () => {
          // Close event may occur but we're primarily testing error events
        });
      });

      await allEventsPromise;

      // Verify correct event sequence for backend connection failure
      expect(openEventReceived).toBe(false); // Should never open since backend fails
      expect(errorEventReceived).toBe(true); // Should get error from WebSocket failure
      // Note: WebSocket connection to non-existent backend results in both error AND close events
      // because the WebSocket connection attempt completes but immediately fails
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
    } finally {
      await proxy.stop();
    }
  });

  it("should handle messages endpoint errors after connection is open (should be 1006)", async () => {
    // Test /messages returning 404/500 after WebSocket is already open

    const proxyPort = await getPort();
    const backendPort = await getPort();

    // Start a real backend
    const testBackend = await WSTestBackend.create({ port: backendPort });
    let proxy: SSEWebSocketProxy | null = null;

    try {
      // Start proxy pointing to real backend
      proxy = new SSEWebSocketProxy({
        port: proxyPort,
        backendUrl: `http://localhost:${backendPort}`,
      });

      await proxy.start();
      const backendUrl = `ws://localhost:${backendPort}`;

      // Wait for connection to be established
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);

      await new Promise<void>((resolve) => {
        simulatedWs.addEventListener("open", () => {
          resolve();
        });
      });

      // Connection should be open at this point
      expect(simulatedWs.readyState).toBe(WebSocket.OPEN);

      // Stop the proxy to make messages endpoint unavailable
      await proxy.stop();

      // Set up close event listener
      let closeEventReceived = false;
      let closeEvent: any = null;
      const closePromise = new Promise<void>((resolve) => {
        simulatedWs.addEventListener("close", (event: any) => {
          closeEventReceived = true;
          closeEvent = event;
          resolve();
        });
      });

      // Try to send a message - this should fail and trigger 1006 close
      simulatedWs.send(JSON.stringify({ type: "test", text: "hello" }));

      // Wait for close event
      await closePromise;

      // Should get 1006 close due to protocol error
      expect(closeEventReceived).toBe(true);
      expect(closeEvent.code).toBe(1006);
      expect(closeEvent.wasClean).toBe(false);
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
    } finally {
      if (proxy) {
        await proxy.stop();
      }
      await testBackend.stop();
    }
  });

  it("should handle close endpoint errors as unclean close (1006)", async () => {
    // Test /close returning errors - should be treated as unclean close

    const proxyPort = await getPort();
    const backendPort = await getPort();

    // Start a real backend
    const testBackend = await WSTestBackend.create({ port: backendPort });
    let proxy: SSEWebSocketProxy | null = null;

    try {
      // Start proxy pointing to real backend
      proxy = new SSEWebSocketProxy({
        port: proxyPort,
        backendUrl: `http://localhost:${backendPort}`,
      });

      await proxy.start();
      const backendUrl = `ws://localhost:${backendPort}`;

      // Wait for connection to be established
      simulatedWs = new SimulatedWebsocket(backendUrl, undefined, `http://localhost:${proxyPort}`);

      await new Promise<void>((resolve) => {
        simulatedWs.addEventListener("open", () => {
          resolve();
        });
      });

      // Connection should be open
      expect(simulatedWs.readyState).toBe(WebSocket.OPEN);

      // Stop the proxy to make close endpoint unavailable
      await proxy.stop();

      // Set up close event listener
      let closeEventReceived = false;
      let closeEvent: any = null;
      const closePromise = new Promise<void>((resolve) => {
        simulatedWs.addEventListener("close", (event: any) => {
          closeEventReceived = true;
          closeEvent = event;
          resolve();
        });
      });

      // Try to close - this should fail and trigger 1006 unclean close
      simulatedWs.close(1000, "Normal closure");

      // Wait for close event
      await closePromise;

      // Should get 1006 unclean close due to close request failure
      expect(closeEventReceived).toBe(true);
      expect(closeEvent.code).toBe(1006);
      expect(closeEvent.wasClean).toBe(false);
      expect(simulatedWs.readyState).toBe(WebSocket.CLOSED);
    } finally {
      if (proxy) {
        await proxy.stop();
      }
      await testBackend.stop();
    }
  });

  // SSE Protocol Error Handling Tests
  describe("SSE Protocol Errors", () => {
    it("should emit error event when receiving invalid JSON from proxy", async () => {
      // Set up infrastructure manually so we can send raw messages
      const backendPort = await getPort();
      const proxyPort = await getPort();

      const backend = await WSTestBackend.create({ port: backendPort });
      let proxy: SSEWebSocketProxy | null = null;

      try {
        proxy = new SSEWebSocketProxy({
          port: proxyPort,
          backendUrl: `http://localhost:${backendPort}`,
        });
        await proxy.start();
        const SimulatedWebSocketClass = createProxiedWebSocketClass(
          true,
          `http://localhost:${proxyPort}`,
        );

        const ws = new SimulatedWebSocketClass(`ws://localhost:${backendPort}`);

        // Wait for connection to be established
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);

          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };

          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(
              new Error(`WebSocket error during connection: ${error.message || "Unknown error"}`),
            );
          };
        });

        // Get the session ID to send raw messages
        const sessionId = ws.getSessionId();
        expect(sessionId).toBeTruthy();

        // Set up error event listener
        const errorPromise = new Promise<{ error: Error; wasClean: boolean }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Error event timeout")), 5000);

          ws.onerror = (errorEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: errorEvent.error || new Error(errorEvent.message || "Unknown error"),
              wasClean: false,
            });
          };

          // Also listen for close events in case the connection closes
          ws.onclose = (closeEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: new Error(`Connection closed: ${closeEvent.reason}`),
              wasClean: closeEvent.wasClean,
            });
          };
        });

        // Send invalid JSON through the raw message interface
        const invalidJson = "{ this is not valid JSON }";
        const sent = proxy.sendRawMessageToSession(sessionId!, invalidJson);
        expect(sent).toBe(true);

        // Should receive an error event
        const result = await errorPromise;
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toMatch(
          /malformed data from proxy|Failed to decode SSE message/i,
        );

        // Connection should be closed cleanly (proxy didn't mess up, it's a client-side validation error)
        expect(result.wasClean).toBe(false); // Error state, not clean close
      } finally {
        if (proxy) {
          await proxy.stop();
        }
        await backend.stop();
      }
    });

    it("should emit error event when receiving JSON with unexpected schema", async () => {
      // Set up infrastructure manually
      const backendPort = await getPort();
      const proxyPort = await getPort();

      const backend = await WSTestBackend.create({ port: backendPort });
      let proxy: SSEWebSocketProxy | null = null;

      try {
        proxy = new SSEWebSocketProxy({
          port: proxyPort,
          backendUrl: `http://localhost:${backendPort}`,
        });
        await proxy.start();
        const SimulatedWebSocketClass = createProxiedWebSocketClass(
          true,
          `http://localhost:${proxyPort}`,
        );

        const ws = new SimulatedWebSocketClass(`ws://localhost:${backendPort}`);

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);

          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };

          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(
              new Error(`WebSocket error during connection: ${error.message || "Unknown error"}`),
            );
          };
        });

        const sessionId = ws.getSessionId();
        expect(sessionId).toBeTruthy();

        // Set up error event listener
        const errorPromise = new Promise<{ error: Error; wasClean: boolean }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Error event timeout")), 5000);

          ws.onerror = (errorEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: errorEvent.error || new Error(errorEvent.message || "Unknown error"),
              wasClean: false,
            });
          };

          ws.onclose = (closeEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: new Error(`Connection closed: ${closeEvent.reason}`),
              wasClean: closeEvent.wasClean,
            });
          };
        });

        // Send valid JSON but with unexpected schema
        const unexpectedMessage = JSON.stringify({
          unknownType: "unexpected",
          randomField: 42,
          data: "this doesn't match our SSE protocol",
        });

        const sent = proxy.sendRawMessageToSession(sessionId!, unexpectedMessage);
        expect(sent).toBe(true);

        // Should receive an error event
        const result = await errorPromise;
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toMatch(
          /malformed data from proxy|Failed to decode SSE message|Invalid SSE message format/i,
        );
      } finally {
        if (proxy) {
          await proxy.stop();
        }
        await backend.stop();
      }
    });

    it("should emit error event when receiving empty or null messages", async () => {
      const backendPort = await getPort();
      const proxyPort = await getPort();

      const backend = await WSTestBackend.create({ port: backendPort });
      let proxy: SSEWebSocketProxy | null = null;

      try {
        proxy = new SSEWebSocketProxy({
          port: proxyPort,
          backendUrl: `http://localhost:${backendPort}`,
        });
        await proxy.start();
        const SimulatedWebSocketClass = createProxiedWebSocketClass(
          true,
          `http://localhost:${proxyPort}`,
        );

        const ws = new SimulatedWebSocketClass(`ws://localhost:${backendPort}`);

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);

          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };

          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(
              new Error(`WebSocket error during connection: ${error.message || "Unknown error"}`),
            );
          };
        });

        const sessionId = ws.getSessionId();
        expect(sessionId).toBeTruthy();

        // Test empty string
        const errorPromise1 = new Promise<{ error: Error }>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Error event timeout")), 5000);

          ws.onerror = (errorEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: errorEvent.error || new Error(errorEvent.message || "Unknown error"),
            });
          };

          ws.onclose = (closeEvent: any) => {
            clearTimeout(timeout);
            resolve({
              error: new Error(`Connection closed: ${closeEvent.reason}`),
            });
          };
        });

        const sent1 = proxy.sendRawMessageToSession(sessionId!, "");
        expect(sent1).toBe(true);

        const result1 = await errorPromise1;
        expect(result1.error).toBeInstanceOf(Error);
        expect(result1.error.message).toMatch(
          /malformed data from proxy|Failed to decode SSE message/i,
        );
      } finally {
        if (proxy) {
          await proxy.stop();
        }
        await backend.stop();
      }
    });
  });
});
