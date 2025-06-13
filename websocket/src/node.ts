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
