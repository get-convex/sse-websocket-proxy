// Node.js-specific version that injects dependencies
import { EventSource } from "eventsource";
import { setEventSource, SimulatedWebsocket as BaseSimulatedWebsocket } from "./index.js";

setEventSource(EventSource);

// Re-export with same signature but required proxyUrl
export class SimulatedWebsocket extends BaseSimulatedWebsocket {
  constructor(url: string | URL, protocols: undefined | string | string[], proxyUrl: string) {
    super(url, protocols, proxyUrl);
  }
}

/**
 * Factory function that creates a WebSocket class configured to use the proxy.
 * Returns a constructor that creates SimulatedWebSocket instances with the 
 * specified proxy URL.
 *
 * @param proxyUrl - The proxy URL to use for all WebSocket connections
 * @returns A WebSocket class constructor
 */
export function createProxiedWebSocketClass(proxyUrl: string): any {
  if (!proxyUrl) {
    throw new Error("proxyUrl is required");
  }
  
  // Return a constructor function that creates SimulatedWebSocket instances
  const ProxiedConstructor = function (this: any, url: string, protocols?: string | string[]) {
    if (!(this instanceof ProxiedConstructor)) {
      return new (ProxiedConstructor as any)(url, protocols);
    }
    return new SimulatedWebsocket(url, protocols, proxyUrl);
  };

  // Copy static properties from SimulatedWebsocket if any
  Object.setPrototypeOf(ProxiedConstructor.prototype, SimulatedWebsocket.prototype);
  Object.setPrototypeOf(ProxiedConstructor, SimulatedWebsocket);

  return ProxiedConstructor;
}
