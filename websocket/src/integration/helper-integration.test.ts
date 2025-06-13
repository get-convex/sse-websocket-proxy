import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "../integration-test-helper.js";

describe("Integration Test Helper", () => {
  it("should work with the helper function", async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      console.log("Using helper function for integration test...");

      expect(testBackend.hasConnection()).toBe(true);

      // Set up close event listener on the simulated websocket
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        webSocket.addEventListener("close", (event: any) => {
          console.log(
            `Helper test - SimulatedWebsocket received close event: code=${event.code}, reason=${event.reason}`,
          );
          resolve({ code: event.code, reason: event.reason });
        });
      });

      // Close the backend connection with special error code 4000
      console.log("Helper test - Closing backend connection with code 4000...");
      connection.close(4000, "Helper test close");

      // Wait for the simulated websocket to receive the close event
      console.log("Helper test - Waiting for simulated websocket to receive close event...");
      const closeEvent = await closePromise;

      expect(closeEvent.code).toBe(4000);
      expect(closeEvent.reason).toBe("Helper test close");
      expect(testBackend.hasConnection()).toBe(false);

      console.log("Helper function test completed successfully!");
    });
  });
});