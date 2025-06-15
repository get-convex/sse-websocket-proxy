import { createProxiedWebSocketClass } from "../node.js";
import getPort from "get-port";
import { SSEWebSocketProxy } from "sse-websocket-proxy";
import { WSTestBackend } from "sse-websocket-proxy/ws-test-backend";

/**
 * Run the same test logic against both native and simulated WebSockets
 */
export async function withWsAndReference(
  testName: string,
  testLogic: (
    WebSocketClass: any,
    backendUrl: string,
    isSimulated: boolean,
    clientConnection: Promise<any>,
  ) => Promise<void>,
): Promise<{
  nativeBackend: any;
  simulatedBackend: any;
}> {
  // Always run native WebSocket first to establish the expected behavior

  const nativeBackendPort = await getPort();
  const nativeBackend = await WSTestBackend.create({ port: nativeBackendPort });

  const NativeWebSocketClass = globalThis.WebSocket;
  const nativeBackendUrl = `ws://localhost:${nativeBackendPort}`;

  // Get the connection promise for the native backend
  const nativeConnectionPromise = nativeBackend.wsConnection();

  await testLogic(NativeWebSocketClass, nativeBackendUrl, false, nativeConnectionPromise);

  // Run test with simulated WebSocket using separate backend

  const simulatedBackendPort = await getPort();
  const proxyPort = await getPort();

  const simulatedBackend = await WSTestBackend.create({ port: simulatedBackendPort });
  const proxy = new SSEWebSocketProxy({
    port: proxyPort,
    allowedHosts: [`http://localhost:${simulatedBackendPort}`],
    allowAnyLocalhostPort: false,
  });
  await proxy.start();

  try {
    const SimulatedWebSocketClass = createProxiedWebSocketClass(
      `http://localhost:${proxyPort}`,
    );
    const simulatedBackendUrl = `ws://localhost:${simulatedBackendPort}`;

    // Get the connection promise for the simulated backend
    const simulatedConnectionPromise = simulatedBackend.wsConnection();

    await testLogic(SimulatedWebSocketClass, simulatedBackendUrl, true, simulatedConnectionPromise);

    return {
      nativeBackend,
      simulatedBackend,
    };
  } finally {
    await proxy.stop();
    await simulatedBackend.stop();
    await nativeBackend.stop();
  }
}

/**
 * Higher-level helper that provides connected WebSockets and backend connections
 */
export async function withConnectedWsAndReference(
  testName: string,
  testLogic: (ws: any, backendConnection: any, isSimulated: boolean) => Promise<void>,
): Promise<{
  nativeBackend: any;
  simulatedBackend: any;
}> {
  return await withWsAndReference(
    testName,
    async (WebSocketClass, backendUrl, isSimulated, clientConnection) => {
      const ws = new WebSocketClass(backendUrl);

      // Wait for WebSocket connection to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);

        if (ws.readyState === WebSocket.OPEN) {
          // Already open
          clearTimeout(timeout);
          resolve();
        } else {
          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };

          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${error.message || "Unknown error"}`));
          };
        }
      });

      // Get the backend connection
      const backendConnection = await clientConnection;

      try {
        await testLogic(ws, backendConnection, isSimulated);
      } finally {
        ws.close();
      }
    },
  );
}
