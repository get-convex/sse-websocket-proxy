import { describe, it, expect } from "vitest";
import { withWebsocketConnection } from "../integration-test-helper.js";

describe("Close Code Propagation", () => {
  it("should propagate close codes from client to backend", async () => {
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

      // Set up listener for backend close event
      let backendCloseCode: number | undefined;
      let backendCloseReason: string | undefined;
      const backendClosePromise = new Promise<void>((resolve) => {
        connection.onClose((code, reason) => {
          backendCloseCode = code;
          backendCloseReason = reason;
          resolve();
        });
      });

      // Client closes with specific code and reason
      const clientClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        webSocket.addEventListener("close", (event: any) => {
          resolve({ code: event.code, reason: event.reason });
        });
      });

      // Close with custom code
      webSocket.close(4001, "Custom close reason");
      
      // Wait for both close events
      const [clientCloseEvent] = await Promise.all([
        clientClosePromise,
        backendClosePromise
      ]);

      // Verify client received the correct close code
      expect(clientCloseEvent.code).toBe(4001);
      expect(clientCloseEvent.reason).toBe("Custom close reason");

      // Verify backend received the same close code (propagated through proxy)
      expect(backendCloseCode).toBe(4001);
      expect(backendCloseReason).toBe("Custom close reason");
      
      expect(testBackend.hasConnection()).toBe(false);
    });
  });

  it("should handle different close codes correctly", async () => {
    const testCases = [
      { code: 1000, reason: "Normal closure" },
      { code: 3000, reason: "Custom application close" },
      { code: 4999, reason: "Another custom close" }
    ];

    for (const testCase of testCases) {
      await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
        // Wait for connection to be ready
        await new Promise<void>((resolve) => {
          if (webSocket.readyState === 1) {
            resolve();
          } else {
            webSocket.addEventListener("open", resolve);
          }
        });

        // Set up backend close listener
        let backendCloseInfo: { code: number; reason: string } | undefined;
        const backendClosePromise = new Promise<void>((resolve) => {
          connection.onClose((code, reason) => {
            backendCloseInfo = { code, reason };
            resolve();
          });
        });

        // Set up client close listener
        const clientClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
          webSocket.addEventListener("close", (event: any) => {
            resolve({ code: event.code, reason: event.reason });
          });
        });

        // Close with test case code/reason
        webSocket.close(testCase.code, testCase.reason);
        
        // Wait for both events
        const [clientCloseEvent] = await Promise.all([
          clientClosePromise,
          backendClosePromise
        ]);

        // Verify propagation
        expect(clientCloseEvent.code).toBe(testCase.code);
        expect(clientCloseEvent.reason).toBe(testCase.reason);
        expect(backendCloseInfo?.code).toBe(testCase.code);
        expect(backendCloseInfo?.reason).toBe(testCase.reason);
      });
    }
  });

  it("should propagate close codes from backend to client", async () => {
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

      // Set up listener for client close event
      const clientClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        webSocket.addEventListener("close", (event: any) => {
          resolve({ code: event.code, reason: event.reason });
        });
      });

      // Backend/server closes the connection with specific code
      connection.close(4002, "Server-initiated close");
      
      // Wait for client to receive close event
      const clientCloseEvent = await clientClosePromise;

      // Verify client received the backend's close code
      expect(clientCloseEvent.code).toBe(4002);
      expect(clientCloseEvent.reason).toBe("Server-initiated close");
      
      expect(testBackend.hasConnection()).toBe(false);
    });
  });

  it("should handle various server-initiated close codes", async () => {
    const testCases = [
      { code: 1000, reason: "Normal closure from server" },
      { code: 1002, reason: "Protocol error" },
      { code: 4003, reason: "Custom server close" }
    ];

    for (const testCase of testCases) {
      await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
        // Wait for connection to be ready
        await new Promise<void>((resolve) => {
          if (webSocket.readyState === 1) {
            resolve();
          } else {
            webSocket.addEventListener("open", resolve);
          }
        });

        // Set up client close listener
        const clientClosePromise = new Promise<{ code: number; reason: string }>((resolve) => {
          webSocket.addEventListener("close", (event: any) => {
            resolve({ code: event.code, reason: event.reason });
          });
        });

        // Server closes with test case code/reason
        connection.close(testCase.code, testCase.reason);
        
        // Wait for client close event
        const clientCloseEvent = await clientClosePromise;

        // Verify propagation from server to client
        expect(clientCloseEvent.code).toBe(testCase.code);
        expect(clientCloseEvent.reason).toBe(testCase.reason);
        expect(testBackend.hasConnection()).toBe(false);
      });
    }
  });

  it("should correctly set wasClean property based on close codes", async () => {
    const testCases = [
      { code: 1000, reason: "Normal closure", expectedWasClean: true },
      { code: 1002, reason: "Protocol error", expectedWasClean: true },
      { code: 1003, reason: "Unsupported data", expectedWasClean: true },
      { code: 4000, reason: "Custom close", expectedWasClean: false },
      { code: 4999, reason: "Another custom close", expectedWasClean: false }
    ];

    for (const testCase of testCases) {
      await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
        // Wait for connection to be ready
        await new Promise<void>((resolve) => {
          if (webSocket.readyState === 1) {
            resolve();
          } else {
            webSocket.addEventListener("open", resolve);
          }
        });

        // Set up client close listener to check wasClean
        const clientClosePromise = new Promise<{ code: number; reason: string; wasClean: boolean }>((resolve) => {
          webSocket.addEventListener("close", (event: any) => {
            resolve({ 
              code: event.code, 
              reason: event.reason, 
              wasClean: event.wasClean 
            });
          });
        });

        // Server closes with test case code
        connection.close(testCase.code, testCase.reason);
        
        // Wait for client close event
        const clientCloseEvent = await clientClosePromise;

        // Verify wasClean is set correctly
        expect(clientCloseEvent.code).toBe(testCase.code);
        expect(clientCloseEvent.reason).toBe(testCase.reason);
        expect(clientCloseEvent.wasClean).toBe(testCase.expectedWasClean);
      });
    }
  });
});