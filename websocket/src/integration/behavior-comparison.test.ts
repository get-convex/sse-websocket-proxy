import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProxiedWebSocketClass } from "../node.js";
import getPort from "get-port";

/**
 * Run the same test logic against both native and simulated WebSockets
 */
async function runBehaviorComparison(
  testName: string,
  testLogic: (
    WebSocketClass: any, 
    backendUrl: string, 
    isSimulated: boolean, 
    clientConnection: Promise<any>
  ) => Promise<void>,
): Promise<{ 
  nativeBackend: any; 
  simulatedBackend: any; 
}> {
  const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
  const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");

  // Always run native WebSocket first to establish the expected behavior
  
  const nativeBackendPort = await getPort();
  const nativeBackend = await WSTestBackend.create({ port: nativeBackendPort });
  
  const NativeWebSocketClass = createProxiedWebSocketClass(false);
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
    backendUrl: `http://localhost:${simulatedBackendPort}`,
  });
  await proxy.start();
  
  try {
    const SimulatedWebSocketClass = createProxiedWebSocketClass(
      true,
      `http://localhost:${proxyPort}`,
    );
    const simulatedBackendUrl = `ws://localhost:${simulatedBackendPort}`;
    
    // Get the connection promise for the simulated backend
    const simulatedConnectionPromise = simulatedBackend.wsConnection();
    
    await testLogic(SimulatedWebSocketClass, simulatedBackendUrl, true, simulatedConnectionPromise);

    return { 
      nativeBackend,
      simulatedBackend 
    };
  } finally {
    await proxy.stop();
    await simulatedBackend.stop();
    await nativeBackend.stop();
  }
}

describe("WebSocket Behavior Comparison", () => {
  it("should connect, send message, receive it on backend, then throw identical errors for close(1001)", async () => {
    await runBehaviorComparison(
      "connect → send → close(1001) validation",
      async (WebSocketClass, backendUrl, isSimulated, clientConnection) => {
        const ws = new WebSocketClass(backendUrl);
        
        // Wait for connection to open
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
          
          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          
          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${error.message || 'Unknown error'}`));
          };
        });

        // Get the backend connection and send a test message
        const backendConn = await clientConnection;
        const testMessage = `Hello from ${isSimulated ? 'simulated' : 'native'} WebSocket!`;
        ws.send(testMessage);

        // Verify the message is received on the backend
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Message receive timeout')), 5000);
          
          backendConn.onMessage((receivedData: string) => {
            clearTimeout(timeout);
            expect(receivedData).toBe(testMessage);
            resolve();
          });
        });

        // Test close(1001) - this should throw immediately
        let thrownError: any = null;
        try {
          ws.close(1001, "Page unloading");
        } catch (error: any) {
          thrownError = error;
        }

        // Verify that an error was thrown
        expect(thrownError).not.toBeNull();
        expect(thrownError.constructor.name).toBe('DOMException');
        expect(thrownError.message.toLowerCase()).toMatch(/(invalid|code)/);
      },
    );
  });

  it("should throw identical errors for other invalid close codes", async () => {
    const invalidCodes = [
      { code: 999, reason: "Below valid range" },
      { code: 1004, reason: "Reserved code" },
      { code: 1005, reason: "Reserved code" },
      { code: 1006, reason: "Reserved code" },
      { code: 1015, reason: "Reserved code" },
      { code: 2999, reason: "Between ranges" },
      { code: 5000, reason: "Above valid range" },
    ];

    for (const testCase of invalidCodes) {
      await runBehaviorComparison(
        `close(${testCase.code}) validation`,
        async (WebSocketClass, backendUrl, isSimulated, clientConnection) => {
          const ws = new WebSocketClass(backendUrl);

          let thrownError: any = null;
          try {
            ws.close(testCase.code, testCase.reason);
          } catch (error: any) {
            thrownError = error;
          }

          // Both implementations should throw the same type of error for invalid codes
          expect(thrownError).not.toBeNull();
          expect(thrownError.constructor.name).toBe('DOMException');
          expect(thrownError.message.toLowerCase()).toMatch(/(invalid|code)/);
        },
      );
    }
  });

  it("should allow identical valid close codes", async () => {
    const validCodes = [
      { code: 1000, reason: "Normal closure" },
      { code: 3000, reason: "Custom application close" },
      { code: 4000, reason: "Custom close" },
      { code: 4999, reason: "Another custom close" },
    ];

    for (const testCase of validCodes) {
      await runBehaviorComparison(
        `close(${testCase.code}) validation`,
        async (WebSocketClass, backendUrl, isSimulated, clientConnection) => {
          const ws = new WebSocketClass(backendUrl);

          let thrownError: any = null;
          try {
            ws.close(testCase.code, testCase.reason);
          } catch (error: any) {
            thrownError = error;
          }

          // Both implementations should allow valid codes without throwing
          expect(thrownError).toBeNull();
        },
      );
    }
  });

  it("should handle identical message transmission for various data types", async () => {
    const messagesToTest = [
      // Simple strings
      "Hello World",
      "Simple text message",
      
      // JSON strings
      JSON.stringify({ type: "test", message: "Hello from client" }),
      JSON.stringify({ id: 42, data: [1, 2, 3], nested: { key: "value" } }),
      
      // Special characters and unicode
      "Message with émojis 🎉 and spëcial chars: áéíóú",
      "Line breaks\nand\ttabs\rwork",
      
      // Edge cases
      "",
      " ",
      "42",
      "3.14159",
      JSON.stringify("just a string in JSON"),
      JSON.stringify(null),
      JSON.stringify(true),
      
      // Long message
      "This is a longer message that contains multiple words and should be transmitted correctly through the WebSocket proxy without any data corruption or truncation issues."
    ];

    await runBehaviorComparison(
      "message transmission for various data types",
      async (WebSocketClass, backendUrl, isSimulated, clientConnection) => {
        const ws = new WebSocketClass(backendUrl);
        
        // Wait for connection to open
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
          
          ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          
          ws.onerror = (error: any) => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${error.message || 'Unknown error'}`));
          };
        });

        // Get the backend connection
        const backendConn = await clientConnection;
        
        // Set up a message queue to handle sequential message verification
        const receivedMessages: string[] = [];
        let messageIndex = 0;
        let currentResolve: (() => void) | null = null;
        let currentReject: ((error: Error) => void) | null = null;
        let currentTimeout: NodeJS.Timeout | null = null;
        
        // Single message handler that processes messages in order
        backendConn.onMessage((receivedData: string) => {
          receivedMessages.push(receivedData);
          
          // If we're waiting for a message, check if this is the expected one
          if (currentResolve && messageIndex < messagesToTest.length) {
            const expectedMessage = messagesToTest[messageIndex];
            const actualMessage = receivedMessages[messageIndex];
            
            if (actualMessage !== undefined) {
              if (currentTimeout) {
                clearTimeout(currentTimeout);
                currentTimeout = null;
              }
              
              try {
                expect(actualMessage).toBe(expectedMessage);
                messageIndex++;
                const resolve = currentResolve;
                currentResolve = null;
                currentReject = null;
                resolve();
              } catch (error) {
                const reject = currentReject;
                currentResolve = null;
                currentReject = null;
                reject?.(error as Error);
              }
            }
          }
        });
        
        // Send all messages and verify them sequentially
        for (let i = 0; i < messagesToTest.length; i++) {
          const testMessage = messagesToTest[i];
          
          // Send the test message
          ws.send(testMessage);

          // Wait for this specific message to be received and verified
          await new Promise<void>((resolve, reject) => {
            // If we already received this message, verify it immediately
            if (receivedMessages[i] !== undefined) {
              try {
                expect(receivedMessages[i]).toBe(testMessage);
                messageIndex = Math.max(messageIndex, i + 1);
                resolve();
              } catch (error) {
                reject(error as Error);
              }
              return;
            }
            
            // Otherwise, wait for the message handler to process it
            currentResolve = resolve;
            currentReject = reject;
            currentTimeout = setTimeout(() => {
              currentResolve = null;
              currentReject = null;
              currentTimeout = null;
              reject(new Error(`Message receive timeout for: "${testMessage.slice(0, 30)}${testMessage.length > 30 ? '...' : ''}"`));
            }, 5000);
          });
        }
      },
    );
  });
});
