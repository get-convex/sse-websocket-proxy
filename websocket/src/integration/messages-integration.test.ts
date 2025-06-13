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
});