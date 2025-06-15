import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SSEWebSocketProxy } from "@convex-dev/sse-websocket-proxy";
import { WSTestBackend } from "@convex-dev/sse-websocket-proxy/ws-test-backend";
import { SimulatedWebsocket } from "../node.js";
import getPort from "get-port";

describe("Simple Integration Test", () => {
  let testBackend: WSTestBackend;
  let proxy: SSEWebSocketProxy;
  let simulatedWs: SimulatedWebsocket;
  let BACKEND_PORT: number;
  let PROXY_PORT: number;

  beforeEach(async () => {
    console.log("Setting up test environment...");

    // Get available ports dynamically
    BACKEND_PORT = await getPort();
    PROXY_PORT = await getPort();

    // 1. Start the test WebSocket backend
    console.log(`Starting WSTestBackend on port ${BACKEND_PORT}...`);
    testBackend = await WSTestBackend.create({ port: BACKEND_PORT });
    console.log("WSTestBackend ready");

    // 2. Start the proxy that connects to the test backend
    console.log(`Starting SSEWebSocketProxy on port ${PROXY_PORT}...`);
    proxy = new SSEWebSocketProxy({
      port: PROXY_PORT,
      allowedHosts: [`http://localhost:${BACKEND_PORT}`],
      allowAnyLocalhostPort: false,
    });
    await proxy.start();
    console.log("SSEWebSocketProxy ready");
  });

  afterEach(async () => {
    console.log("Cleaning up test environment...");

    if (simulatedWs) {
      simulatedWs.close();
    }
    if (proxy) {
      await proxy.stop();
    }
    if (testBackend) {
      await testBackend.stop();
    }

    console.log("Cleanup complete");
  });

  it("should establish connection and handle close with special error code", async () => {
    // Get the backend connection promise first
    const backendConnectionPromise = testBackend.wsConnection();

    // Create simulated websocket that connects to the backend via the proxy
    simulatedWs = new SimulatedWebsocket(
      `ws://localhost:${BACKEND_PORT}`,
      undefined,
      `http://localhost:${PROXY_PORT}`,
    );

    // Wait for the backend to receive the WebSocket connection
    const backendConnection = await backendConnectionPromise;

    expect(testBackend.hasConnection()).toBe(true);

    // Set up close event listener on the simulated websocket
    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      simulatedWs.addEventListener("close", (event: any) => {
        resolve({ code: event.code, reason: event.reason });
      });
    });

    // Close the backend connection with special error code 4000
    backendConnection.close(4000, "Test close");

    // Wait for the simulated websocket to receive the close event
    const closeEvent = await closePromise;

    expect(closeEvent.code).toBe(4000);
    expect(closeEvent.reason).toBe("Test close");
    expect(testBackend.hasConnection()).toBe(false);
  });
});
