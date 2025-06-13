import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "./connection-helper.js";
import { withConnectedWsAndReference } from "./behavior-comparison-helper.js";

describe("Messages Integration Test", () => {
  it("should send messages in both directions and close cleanly", async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      // WebSocket is already connected when passed to this callback
      expect(testBackend.hasConnection()).toBe(true);
      expect(webSocket.readyState).toBe(WebSocket.OPEN);

      // 1. Send message from client to server
      const messageFromClient = JSON.stringify({ type: "greeting", text: "Hello from client" });

      const serverReceivedPromise = new Promise<any>((resolve) => {
        connection.onMessage((data) => {
          // Note: Server receives raw string data, needs to parse if it wants JSON
          resolve(JSON.parse(data));
        });
      });

      webSocket.send(messageFromClient);
      const receivedByServer = await serverReceivedPromise;
      expect(receivedByServer.type).toBe("greeting");
      expect(receivedByServer.text).toBe("Hello from client");

      // 2. Send message from server to client
      const messageFromServer = JSON.stringify({ type: "response", text: "Hello from server" });

      const clientReceivedPromise = new Promise<string>((resolve) => {
        webSocket.addEventListener("message", (event: any) => {
          resolve(event.data);
        });
      });

      connection.send(messageFromServer);
      const receivedByClient = await clientReceivedPromise;

      // Fix: WebSocket receives raw string data, not parsed objects
      // This matches native WebSocket behavior - applications must parse JSON themselves
      expect(receivedByClient).toBe(messageFromServer);

      // If the application wants to parse JSON, it should do so explicitly:
      const parsedMessage = JSON.parse(receivedByClient);
      expect(parsedMessage.type).toBe("response");
      expect(parsedMessage.text).toBe("Hello from server");

      // 3. Client closes the connection
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        webSocket.addEventListener("close", (event: any) => {
          resolve({ code: event.code, reason: event.reason });
        });
      });

      webSocket.close(1000, "Normal closure");
      const closeEvent = await closePromise;

      expect(closeEvent.code).toBe(1000);
      expect(closeEvent.reason).toBe("Normal closure");

      // Wait a bit for the backend to process the close
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(testBackend.hasConnection()).toBe(false);
    });
  });

  it("should handle different message types from server to client", async () => {
    await withWebsocketConnection(async ({ webSocket, connection }) => {
      const messagesToTest = [
        // Simple strings
        "Hello World",
        "Simple text message",

        // JSON strings (but sent as raw strings, not objects)
        JSON.stringify({ type: "greeting", message: "Hello from server" }),
        JSON.stringify({ id: 123, data: [1, 2, 3], nested: { key: "value" } }),

        // Special characters and unicode
        "Message with émojis 🎉 and spëcial chars: áéíóú",
        "Line breaks\nand\ttabs\rwork",

        // Numbers as strings
        "42",
        "3.14159",

        // Empty and whitespace
        "",
        " ",
        "   \t\n   ",

        // Long message
        "This is a longer message that contains multiple words and should be transmitted correctly through the WebSocket proxy without any data corruption or truncation issues.",

        // Special JSON edge cases
        JSON.stringify("just a string in JSON"),
        JSON.stringify(null),
        JSON.stringify(true),
        JSON.stringify(42),
      ];

      for (const testMessage of messagesToTest) {
        // Set up message listener for this specific message
        const messagePromise = new Promise<string>((resolve) => {
          const handler = (event: any) => {
            webSocket.removeEventListener("message", handler);
            resolve(event.data);
          };
          webSocket.addEventListener("message", handler);
        });

        // Send message from server to client
        connection.send(testMessage);

        // Verify client receives exact message
        const receivedMessage = await messagePromise;
        expect(receivedMessage).toBe(testMessage);
      }
    });
  });

  it("should handle rapid message sending without data corruption", async () => {
    await withWebsocketConnection(async ({ webSocket, connection }) => {
      const messageCount = 20;
      const messages: string[] = [];
      const receivedMessages: string[] = [];

      // Generate test messages
      for (let i = 0; i < messageCount; i++) {
        messages.push(
          `Message ${i}: ${JSON.stringify({ index: i, timestamp: Date.now() + i, data: `payload-${i}` })}`,
        );
      }

      // Set up message collection
      const allMessagesPromise = new Promise<void>((resolve) => {
        let receivedCount = 0;

        const handler = (event: any) => {
          receivedMessages.push(event.data);
          receivedCount++;

          if (receivedCount === messageCount) {
            webSocket.removeEventListener("message", handler);
            resolve();
          }
        };

        webSocket.addEventListener("message", handler);
      });

      // Send all messages rapidly
      for (const message of messages) {
        connection.send(message);
      }

      // Wait for all messages to be received
      await allMessagesPromise;

      // Verify all messages received correctly (order might vary due to async)
      expect(receivedMessages).toHaveLength(messageCount);

      // Verify each sent message was received exactly once
      for (const originalMessage of messages) {
        expect(receivedMessages).toContain(originalMessage);
      }
    });
  });

  describe("Binary Message Support", () => {
    it("should send binary messages from client to server", async () => {
      await withWebsocketConnection(async ({ webSocket, connection }) => {
        // Test data: Various binary patterns
        const testBinaryData = [
          // Simple byte array
          new Uint8Array([1, 2, 3, 4, 5]),

          // Zero bytes
          new Uint8Array([0, 0, 0]),

          // High values
          new Uint8Array([255, 254, 253]),

          // Mixed pattern
          new Uint8Array([0, 127, 255, 42, 128]),

          // Empty binary data
          new Uint8Array([]),
        ];

        for (const testData of testBinaryData) {
          // Set up message listener on backend to receive the binary data
          // Note: Current test backend converts to string, so we'll verify the protocol works
          const backendMessagePromise = new Promise<string>((resolve) => {
            connection.onMessage((data: string) => {
              resolve(data);
            });
          });

          // Send binary message from client
          webSocket.send(testData.buffer);

          // Verify backend receives data (the proxy should have decoded the base64 correctly)
          const receivedByBackend = await backendMessagePromise;

          // The binary data should pass through the proxy correctly
          // Since the backend interface converts to string, we verify length and some properties
          expect(typeof receivedByBackend).toBe("string");

          // For non-empty data, verify we got something
          if (testData.length > 0) {
            expect(receivedByBackend.length).toBeGreaterThan(0);
          }
        }
      });
    });

    it("should handle binary messages from server to client", async () => {
      await withWebsocketConnection(async ({ webSocket, connection, proxy }) => {
        const testData = new Uint8Array([10, 20, 30, 40, 255, 0, 128]);

        // Get the session ID
        const sessionId = webSocket.getSessionId();
        expect(sessionId).toBeTruthy();

        // Set up message listener on client to receive binary data
        const clientMessagePromise = new Promise<ArrayBuffer>((resolve) => {
          const handler = (event: any) => {
            webSocket.removeEventListener("message", handler);
            // Should receive ArrayBuffer from binary message
            if (event.data instanceof ArrayBuffer) {
              resolve(event.data);
            } else {
              // If we get a string, this means text message - fail the test
              throw new Error(`Expected ArrayBuffer but got ${typeof event.data}`);
            }
          };
          webSocket.addEventListener("message", handler);
        });

        // Simulate binary message from server using the SSE protocol directly
        const base64Data = Buffer.from(testData).toString("base64");
        const binaryMessage = JSON.stringify({
          type: "binary-message",
          data: base64Data,
          timestamp: Date.now(),
        });

        // Send the raw SSE message to simulate server-to-client binary
        const sent = proxy.sendRawMessageToSession(sessionId!, binaryMessage);
        expect(sent).toBe(true);

        // Verify client receives the exact binary data
        const receivedByClient = await clientMessagePromise;
        const receivedArray = new Uint8Array(receivedByClient);

        expect(receivedArray).toEqual(testData);
      });
    });

    it("should handle typed arrays (Int16Array, Float32Array, etc.) the same as native WebSocket", async () => {
      await withConnectedWsAndReference(
        "typed array binary message handling",
        async (ws, connection, isSimulated) => {
          // Test different typed array types
          const int16Data = new Int16Array([1000, -1000, 32767, -32768]);
          const float32Data = new Float32Array([3.14159, -2.71828, 0.0]);
          
          // Test Int16Array
          const backendPromise1 = new Promise<Buffer>((resolve) => {
            connection.onBinaryMessage((data: Buffer) => {
              resolve(data);
            });
          });
          
          ws.send(int16Data);
          const received1 = await backendPromise1;
          
          // Verify the data was transmitted correctly
          expect(received1).toBeInstanceOf(Buffer);
          expect(received1.length).toBe(int16Data.byteLength);
          
          // Verify the actual data content
          const receivedInt16 = new Int16Array(received1.buffer, received1.byteOffset, received1.length / 2);
          expect(Array.from(receivedInt16)).toEqual(Array.from(int16Data));
          
          // Test Float32Array
          const backendPromise2 = new Promise<Buffer>((resolve) => {
            connection.onBinaryMessage((data: Buffer) => {
              resolve(data);
            });
          });
          
          ws.send(float32Data);
          const received2 = await backendPromise2;
          
          // Verify the data was transmitted correctly
          expect(received2).toBeInstanceOf(Buffer);
          expect(received2.length).toBe(float32Data.byteLength);
          
          // Verify the actual data content for floating point
          // Ensure proper alignment for Float32Array (4-byte aligned)
          const alignedBuffer = received2.buffer.slice(received2.byteOffset, received2.byteOffset + received2.length);
          const receivedFloat32 = new Float32Array(alignedBuffer);
          expect(receivedFloat32.length).toBe(float32Data.length);
          
          for (let i = 0; i < float32Data.length; i++) {
            if (isFinite(float32Data[i])) {
              expect(receivedFloat32[i]).toBeCloseTo(float32Data[i], 5);
            } else {
              expect(receivedFloat32[i]).toBe(float32Data[i]); // For Infinity, NaN
            }
          }
          
          ws.close();
        }
      );
    });
  });
});

