import { SSEWebSocketProxy } from "sse-websocket-proxy";
import { WSTestBackend, type WSConnection } from "sse-websocket-proxy/ws-test-backend";
import { SimulatedWebsocket } from "../node.js";
import getPort from "get-port";

// Helper function for WebSocket integration tests
export interface WebSocketConnectionContext {
  webSocket: SimulatedWebsocket;
  connection: WSConnection;
  proxy: SSEWebSocketProxy;
  testBackend: WSTestBackend;
}


export async function withWebsocketConnection<T>(
  callback: (context: WebSocketConnectionContext) => Promise<T>
): Promise<T> {
  // Get available ports dynamically
  const BACKEND_PORT = await getPort();
  const PROXY_PORT = await getPort();

  // Start the test WebSocket backend
  const testBackend = await WSTestBackend.create({ port: BACKEND_PORT });

  // Start the proxy that connects to the test backend
  const proxy = new SSEWebSocketProxy({
    port: PROXY_PORT,
    backendUrl: `http://localhost:${BACKEND_PORT}`,
  });
  await proxy.start();

  // Get the backend connection promise first
  const backendConnectionPromise = testBackend.wsConnection();

  // Create simulated websocket that connects to the backend via the proxy
  const webSocket = new SimulatedWebsocket(
    `ws://localhost:${BACKEND_PORT}`,
    undefined,
    `http://localhost:${PROXY_PORT}`
  );

  try {
    // Wait for the WebSocket to be fully connected on both ends
    await Promise.all([
      // Wait for backend to receive the connection
      backendConnectionPromise,
      // Wait for WebSocket to be open
      new Promise<void>((resolve, reject) => {
        if (webSocket.readyState === WebSocket.OPEN) { // OPEN
          resolve();
        } else {
          const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
          webSocket.addEventListener("open", () => {
            clearTimeout(timeout);
            resolve();
          });
          webSocket.addEventListener("error", (error: any) => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket connection error: ${error.message || 'Unknown error'}`));
          });
        }
      })
    ]);

    const connection = await backendConnectionPromise;

    // Execute the test callback with fully connected WebSocket
    const result = await callback({ webSocket, connection, proxy, testBackend });

    return result;
  } finally {
    // Clean up all resources
    webSocket.close();
    
    await proxy.stop();
    
    await testBackend.stop();
  }
}