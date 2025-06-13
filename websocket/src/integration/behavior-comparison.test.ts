import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProxiedWebSocketClass } from "../node.js";
import getPort from "get-port";

/**
 * Helper function to run the same test logic against both native and simulated WebSockets
 */
async function runBehaviorComparison<T>(
  testName: string,
  testLogic: (WebSocketClass: any, backendUrl: string, isSimulated: boolean) => Promise<T>,
): Promise<{ native: T; simulated: T }> {
  const { SSEWebSocketProxy } = await import("sse-websocket-proxy");
  const { WSTestBackend } = await import("sse-websocket-proxy/ws-test-backend");

  const proxyPort = await getPort();
  const backendPort = await getPort();

  // Start backend and proxy
  const testBackend = await WSTestBackend.create({ port: backendPort });
  const proxy = new SSEWebSocketProxy({
    port: proxyPort,
    backendUrl: `http://localhost:${backendPort}`,
  });
  await proxy.start();

  try {
    // Create WebSocket classes
    const NativeWebSocketClass = createProxiedWebSocketClass(false);
    const SimulatedWebSocketClass = createProxiedWebSocketClass(
      true,
      `http://localhost:${proxyPort}`,
    );

    const backendUrl = `ws://localhost:${backendPort}`;

    console.log(`\n=== Running behavior comparison: ${testName} ===`);

    // Run test with native WebSocket
    console.log("Testing with native WebSocket...");
    const nativeResult = await testLogic(NativeWebSocketClass, backendUrl, false);

    // Run test with simulated WebSocket
    console.log("Testing with SimulatedWebSocket...");
    const simulatedResult = await testLogic(SimulatedWebSocketClass, backendUrl, true);

    console.log("=== Behavior comparison complete ===\n");

    return { native: nativeResult, simulated: simulatedResult };
  } finally {
    await proxy.stop();
    await testBackend.stop();
  }
}

describe("WebSocket Behavior Comparison", () => {
  it("should throw identical errors for close(1001) between native and simulated WebSocket", async () => {
    const results = await runBehaviorComparison(
      "close(1001) validation",
      async (WebSocketClass, backendUrl, isSimulated) => {
        // We don't actually need to connect to test close code validation
        // since the error should be thrown immediately in the close() method
        return new Promise<{ errorType: string; errorMessage: string } | null>((resolve) => {
          try {
            const ws = new WebSocketClass(backendUrl);

            // Try to close with 1001 immediately - this should throw
            try {
              ws.close(1001, "Page unloading");
              resolve(null); // No error thrown
            } catch (error: any) {
              resolve({
                errorType: error.constructor.name,
                errorMessage: error.message,
              });
            }
          } catch (constructorError: any) {
            resolve({
              errorType: constructorError.constructor.name,
              errorMessage: constructorError.message,
            });
          }
        });
      },
    );

    // Both should throw errors
    expect(results.native).not.toBeNull();
    expect(results.simulated).not.toBeNull();

    // Error types should match
    expect(results.simulated!.errorType).toBe(results.native!.errorType);

    // Error messages should both indicate it's not a valid close code
    const nativeMsg = results.native!.errorMessage.toLowerCase();
    const simulatedMsg = results.simulated!.errorMessage.toLowerCase();

    // Both should indicate it's not a valid close code (but messages may vary)
    expect(nativeMsg).toMatch(/(invalid|neither|must be|code)/);
    expect(simulatedMsg).toMatch(/(invalid|neither|must be|code)/);

    console.log(
      `Native WebSocket error: ${results.native!.errorType}: ${results.native!.errorMessage}`,
    );
    console.log(
      `Simulated WebSocket error: ${results.simulated!.errorType}: ${results.simulated!.errorMessage}`,
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
      const results = await runBehaviorComparison(
        `close(${testCase.code}) validation`,
        async (WebSocketClass, backendUrl, isSimulated) => {
          return new Promise<{ errorType: string; errorMessage: string } | null>((resolve) => {
            try {
              const ws = new WebSocketClass(backendUrl);

              try {
                ws.close(testCase.code, testCase.reason);
                resolve(null); // No error thrown
              } catch (error: any) {
                resolve({
                  errorType: error.constructor.name,
                  errorMessage: error.message,
                });
              }
            } catch (constructorError: any) {
              resolve({
                errorType: constructorError.constructor.name,
                errorMessage: constructorError.message,
              });
            }
          });
        },
      );

      // Check if behaviors match
      if (results.native === null && results.simulated === null) {
        // Both allow this code - that's fine
        console.log(`Code ${testCase.code}: Both implementations allow this code`);
      } else if (results.native !== null && results.simulated !== null) {
        // Both throw errors - error types should match
        expect(results.simulated.errorType).toBe(results.native.errorType);
        console.log(`Code ${testCase.code}: Both throw ${results.native.errorType}`);
      } else {
        // One throws, one doesn't - this is a mismatch
        throw new Error(
          `Behavior mismatch for close code ${testCase.code}: ` +
            `Native: ${results.native ? `${results.native.errorType}: ${results.native.errorMessage}` : "No error"}, ` +
            `Simulated: ${results.simulated ? `${results.simulated.errorType}: ${results.simulated.errorMessage}` : "No error"}`,
        );
      }
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
      const results = await runBehaviorComparison(
        `close(${testCase.code}) validation`,
        async (WebSocketClass, backendUrl, isSimulated) => {
          return new Promise<{ errorType: string; errorMessage: string } | null>((resolve) => {
            try {
              const ws = new WebSocketClass(backendUrl);

              try {
                ws.close(testCase.code, testCase.reason);
                resolve(null); // No error thrown - this is expected
              } catch (error: any) {
                resolve({
                  errorType: error.constructor.name,
                  errorMessage: error.message,
                });
              }
            } catch (constructorError: any) {
              resolve({
                errorType: constructorError.constructor.name,
                errorMessage: constructorError.message,
              });
            }
          });
        },
      );

      // Both should allow valid codes without throwing
      expect(results.native).toBeNull();
      expect(results.simulated).toBeNull();

      console.log(`Code ${testCase.code}: Both implementations allow this valid code`);
    }
  });
});

