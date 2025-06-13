import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "../integration-test-helper.js";

describe("Messages Integration Test", () => {
  it("should send messages in both directions and close cleanly", async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      // WebSocket is already connected when passed to this callback
      expect(testBackend.hasConnection()).toBe(true);
      expect(webSocket.readyState).toBe(1); // OPEN

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
      await new Promise(resolve => setTimeout(resolve, 50));
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
        JSON.stringify(42)
      ];

      for (const [index, testMessage] of messagesToTest.entries()) {
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
        messages.push(`Message ${i}: ${JSON.stringify({ index: i, timestamp: Date.now() + i, data: `payload-${i}` })}`);
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
});