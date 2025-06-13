import { describe, it, expect } from 'vitest';
import { withWebsocketConnection } from './connection-helper.js';

describe('Tab Close Simulation', () => {

  it('should send 1001 close code when client "goes away" (tab close)', async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend, proxy }) => {
      console.log('Testing simulated tab close scenario...');
      
      // Wait for connection to be ready
      await new Promise<void>((resolve) => {
        if (webSocket.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          webSocket.addEventListener("open", () => resolve());
        }
      });

      // Set up backend close listener to capture the close code
      let backendCloseInfo: { code: number; reason: string } | undefined;
      const backendClosePromise = new Promise<void>((resolve) => {
        connection.onClose((code, reason) => {
          console.log(`Backend received close: code=${code}, reason="${reason}"`);
          backendCloseInfo = { code, reason };
          resolve();
        });
      });

      // Simulate tab close by accessing the internal EventSource and closing it
      // This mimics what happens when a browser tab closes
      console.log('Simulating tab close by terminating SSE connection...');
      
      // Get the EventSource from the SimulatedWebSocket
      const eventSource = (webSocket as any).eventSource;
      if (eventSource) {
        // Close the EventSource to simulate tab closing
        eventSource.close();
        console.log('EventSource closed (simulating tab close)');
      }

      // Wait for backend to receive the close event
      await backendClosePromise;

      // Verify that the backend received a 1001 "Going away" close code
      // This is what should happen when the SSE connection is terminated
      expect(backendCloseInfo?.code).toBe(1001);
      expect(backendCloseInfo?.reason).toBe('Client going away');
      
      console.log('✅ Test passed: Backend correctly received 1001 close code when SSE connection terminated');
    });
  });

  it('should differentiate between normal WebSocket close and SSE termination', async () => {
    await withWebsocketConnection(async ({ webSocket, connection, testBackend }) => {
      console.log('Testing normal WebSocket close vs SSE termination...');
      
      // Wait for connection to be ready
      await new Promise<void>((resolve) => {
        if (webSocket.readyState === WebSocket.OPEN) {
          resolve();
        } else {
          webSocket.addEventListener("open", () => resolve());
        }
      });

      // Set up backend close listener
      let backendCloseInfo: { code: number; reason: string } | undefined;
      const backendClosePromise = new Promise<void>((resolve) => {
        connection.onClose((code, reason) => {
          console.log(`Backend received close: code=${code}, reason="${reason}"`);
          backendCloseInfo = { code, reason };
          resolve();
        });
      });

      // Normal WebSocket close (not tab close) - should use the requested code
      console.log('Performing normal WebSocket close with custom code...');
      webSocket.close(4000, 'Normal application close');

      // Wait for backend to receive the close event
      await backendClosePromise;

      // Should receive the exact code we requested, not 1001
      expect(backendCloseInfo?.code).toBe(4000);
      expect(backendCloseInfo?.reason).toBe('Normal application close');
      
      console.log('✅ Test passed: Normal close properly uses requested close code');
    });
  });
});