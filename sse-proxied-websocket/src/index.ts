
/**
 * Behaves like a WebSocket but is powered by a proxy
 */
export class SimulatedWebsocket {
  constructor(url: string | URL, protocols?: string | string[]) {
  if (protocols) {
    throw new Error("Specifying protocols in the SimulatedWebsocket constructor is not supported supported");
  }
  }


}

