import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "./connection-helper.js";

describe("Integration Test Helper", () => {
  it("should work with the helper function", async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      // WebSocket is already connected when passed to callback
      expect(testBackend.hasConnection()).toBe(true);
      expect(webSocket.readyState).toBe(1); // OPEN

      // Set up close event listener on the simulated websocket
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        webSocket.addEventListener("close", (event: any) => {
          resolve({ code: event.code, reason: event.reason });
        });
      });

      // Close the backend connection with special error code 4000
      connection.close(4000, "Helper test close");

      // Wait for the simulated websocket to receive the close event
      const closeEvent = await closePromise;

      expect(closeEvent.code).toBe(4000);
      expect(closeEvent.reason).toBe("Helper test close");
      expect(testBackend.hasConnection()).toBe(false);
    });
  });
});