import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "../integration-test-helper.js";

describe("Messages Integration Test", () => {
  it("should send messages in both directions and close cleanly", async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      expect(testBackend.hasConnection()).toBe(true);

      // Wait for the WebSocket to be fully open
      await new Promise<void>((resolve) => {
        if (webSocket.readyState === 1) { // OPEN
          resolve();
        } else {
          webSocket.addEventListener("open", () => {
            resolve();
          });
        }
      });

      // 1. Send message from client to server
      const messageFromClient = JSON.stringify({ type: "greeting", text: "Hello from client" });
      
      const serverReceivedPromise = new Promise<any>((resolve) => {
        connection.onMessage((data) => {
          resolve(JSON.parse(data));
        });
      });

      webSocket.send(messageFromClient);
      const receivedByServer = await serverReceivedPromise;
      expect(receivedByServer.type).toBe("greeting");
      expect(receivedByServer.text).toBe("Hello from client");

      // 2. Send message from server to client
      const messageFromServer = JSON.stringify({ type: "response", text: "Hello from server" });

      const clientReceivedPromise = new Promise<any>((resolve) => {
        webSocket.addEventListener("message", (event: any) => {
          resolve(event.data);
        });
      });

      connection.send(messageFromServer);
      const receivedByClient = await clientReceivedPromise;
      expect(receivedByClient.type).toBe("response");
      expect(receivedByClient.text).toBe("Hello from server");

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