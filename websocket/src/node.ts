// Node.js-specific version that injects dependencies
import { EventSource } from "eventsource";
import {
  setEventSource,
  SimulatedWebsocket as BaseSimulatedWebsocket,
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
} from "./index.js";

setEventSource(EventSource);

export { CONNECTING, OPEN, CLOSING, CLOSED };

// Re-export with same signature but required proxyUrl
export class SimulatedWebsocket extends BaseSimulatedWebsocket {
  constructor(url: string | URL, protocols: string | string[], proxyUrl: string) {
    super(url, protocols, proxyUrl);
  }
}

/**
 * Factory function that creates WebSocket classes with consistent interfaces.
 * This is useful for testing or situations where you want to switch between
 * native WebSocket and proxied WebSocket implementations.
 * 
 * @param useProxy - Whether to return a proxied WebSocket class or native WebSocket
 * @param proxyUrl - The proxy URL (required if useProxy is true)
 * @returns A WebSocket class constructor
 */
export function createProxiedWebSocketClass(useProxy: boolean, proxyUrl?: string): any {
  if (useProxy) {
    if (!proxyUrl) {
      throw new Error("proxyUrl is required when useProxy is true");
    }
    // Return a constructor function that creates SimulatedWebSocket instances
    const ProxiedConstructor = function(this: any, url: string, protocols?: string | string[]) {
      if (!(this instanceof ProxiedConstructor)) {
        return new (ProxiedConstructor as any)(url, protocols);
      }
      return new SimulatedWebsocket(url, protocols, proxyUrl);
    };
    
    // Copy static properties from SimulatedWebsocket if any
    Object.setPrototypeOf(ProxiedConstructor.prototype, SimulatedWebsocket.prototype);
    Object.setPrototypeOf(ProxiedConstructor, SimulatedWebsocket);
    
    return ProxiedConstructor;
  } else {
    // Return the native Node.js WebSocket class (global)
    return globalThis.WebSocket;
  }
}
