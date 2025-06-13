// WebSocket states
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

// Event types
interface WebSocketMessageEvent extends Event {
  data: any;
}

interface WebSocketErrorEvent extends Event {
  error: Error;
}

interface WebSocketCloseEvent extends Event {
  code: number;
  reason: string;
  wasClean: boolean;
}

let EventSource = globalThis.EventSource;
export function setEventSource(es: typeof EventSource) {
  EventSource = es;
}

/**
 * Behaves like a WebSocket but is powered by a proxy
 */
export class SimulatedWebsocket extends EventTarget {
  public readonly url: string;
  public readyState: number = CONNECTING;
  public readonly protocol: string = "";
  public readonly extensions: string = "";

  private proxyUrl: string;
  private sessionId: string | null = null;
  private eventSource: EventSource | null = null;
  private userInitiatedClose: boolean = false;
  private isWebSocketConnected: boolean = false;

  // Event handlers (WebSocket-style)
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: WebSocketMessageEvent) => void) | null = null;
  public onerror: ((event: WebSocketErrorEvent) => void) | null = null;
  public onclose: ((event: WebSocketCloseEvent) => void) | null = null;

  constructor(url: string | URL, protocols: undefined | string | string[], proxyUrl: string) {
    super();

    if (protocols && (!Array.isArray(protocols) || protocols.length !== 0)) {
      throw new Error(
        `Specifying protocols in the SimulatedWebsocket constructor is not supported, got ${protocols}`,
      );
    }

    if (!proxyUrl) {
      throw new Error("Must specify third argument to SimulatedWebsocket");
    }

    this.url = url.toString();
    this.proxyUrl = proxyUrl;

    // Start the connection process
    this.connect();
  }

  private async connect(): Promise<void> {
    // Generate a session ID
    this.sessionId = this.generateSessionId();

    // Construct the SSE URL
    const sseUrl = new URL("/sse", this.proxyUrl);
    sseUrl.searchParams.set("sessionId", this.sessionId);

    // Add the original WebSocket path to the SSE URL
    const originalUrl = new URL(this.url);
    if (originalUrl.pathname !== "/") {
      sseUrl.pathname = `/sse${originalUrl.pathname}`;
    }
    if (originalUrl.search) {
      // Merge search params
      for (const [key, value] of originalUrl.searchParams) {
        sseUrl.searchParams.set(key, value);
      }
    }

    try {
      this.eventSource = new EventSource(sseUrl.toString());

      this.setupEventSourceHandlers();
    } catch (error) {
      console.error("SimulatedWebsocket: Error in connect():", error);
      this.handleError(error as Error);
    }
  }

  private setupEventSourceHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      // SSE connection established, but we're not "open" until the WebSocket backend connects
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleProxyMessage(data);
      } catch (error) {
        console.error("SimulatedWebsocket: Failed to parse proxy message:", error);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error("SimulatedWebsocket: SSE connection error:", error);

      // If user initiated close, don't fire error events
      if (this.userInitiatedClose) {
        return;
      }

      if (this.readyState === OPEN) {
        // Connection was established but now has protocol error - close with 1006
        this.handleClose(1006, "SSE connection error", false);
      } else {
        // Connection establishment error - fire error event
        this.handleError(new Error("SSE connection error"));
      }
    };
  }

  private handleProxyMessage(data: any): void {
    switch (data.type) {
      case "connected":
        this.sessionId = data.sessionId;
        break;

      case "websocket-connected":
        this.isWebSocketConnected = true;
        this.readyState = OPEN;
        const openEvent = new Event("open");
        this.dispatchEvent(openEvent);
        if (this.onopen) this.onopen(openEvent);
        break;

      case "message":
        const messageEvent = new CustomEvent("message", {
          detail: { data: data.data },
        }) as WebSocketMessageEvent;
        messageEvent.data = data.data;
        this.dispatchEvent(messageEvent);
        if (this.onmessage) this.onmessage(messageEvent);
        break;

      case "websocket-error":
        this.handleError(new Error(data.error));
        break;

      case "websocket-closed":
        this.handleClose(data.code, data.reason, data.wasClean ?? true);
        break;

      case "ping":
        // Keepalive - no action needed
        break;

      default:
        console.warn("Unknown proxy message type:", data.type);
    }
  }

  private handleError(error: Error): void {
    // Set readyState to CLOSED (connection failed)
    this.readyState = CLOSED;

    // Close EventSource if it exists
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Fire error event
    const errorEvent = new CustomEvent("error", {
      detail: { error },
    }) as WebSocketErrorEvent;
    errorEvent.error = error;
    this.dispatchEvent(errorEvent);
    if (this.onerror) this.onerror(errorEvent);

    // Note: We do NOT fire a close event for connection errors
    // per WebSocket spec - close events are only for successful connections that then close
  }

  private handleClose(code: number, reason: string, wasClean: boolean): void {
    // Only fire close event if not already closed
    if (this.readyState === CLOSED) {
      return;
    }

    this.readyState = CLOSED;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const closeEvent = new CustomEvent("close", {
      detail: { code, reason, wasClean },
    }) as WebSocketCloseEvent;
    closeEvent.code = code;
    closeEvent.reason = reason;
    closeEvent.wasClean = wasClean;
    this.dispatchEvent(closeEvent);
    if (this.onclose) this.onclose(closeEvent);
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== OPEN) {
      throw new Error("WebSocket is not open");
    }

    if (!this.sessionId) {
      throw new Error("No session ID available");
    }

    // Convert data to string if needed
    let message: any;
    if (typeof data === "string") {
      try {
        message = JSON.parse(data);
      } catch {
        message = { text: data };
      }
    } else {
      // For binary data, we'd need to handle it differently
      // For now, convert to string
      message = { binary: data.toString() };
    }

    // Send via HTTP POST to the proxy
    fetch(`${this.proxyUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": this.sessionId,
      },
      body: JSON.stringify(message),
    }).catch((error) => {
      // Send errors after connection establishment are protocol errors - close with 1006
      this.handleClose(1006, `Failed to send message: ${error.message}`, false);
    });
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED || this.readyState === CLOSING) {
      return;
    }

    this.userInitiatedClose = true;
    this.readyState = CLOSING;

    if (!this.isWebSocketConnected) {
      // WebSocket connection hasn't been established yet, close locally
      this.handleClose(code || 1000, reason || "", true);
      return;
    }

    // Send close request to proxy to get proper close codes from backend
    this.sendCloseRequest(code || 1000, reason || "");
  }

  private async sendCloseRequest(code: number, reason: string): Promise<void> {
    if (!this.sessionId) {
      // No session - just close locally
      this.handleClose(1006, "No session available", false);
      return;
    }

    try {
      // Set up timeout in case the request fails or takes too long
      const timeoutId = setTimeout(() => {
        this.handleClose(1006, "Close request timeout", false);
        this.closeEventSource();
      }, 5000); // 5 second timeout

      const response = await fetch(`${this.proxyUrl}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": this.sessionId,
        },
        body: JSON.stringify({ code, reason }),
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const closeInfo = await response.json();
        this.handleClose(closeInfo.code, closeInfo.reason, closeInfo.wasClean);
      } else {
        // HTTP error - use 1006 abnormal close
        this.handleClose(1006, `Close request failed: ${response.status}`, false);
      }
    } catch (error) {
      // Network error - use 1006 abnormal close
      this.handleClose(1006, "Close request failed", false);
    } finally {
      // Always clean up SSE connection
      this.closeEventSource();
    }
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15);
    return `session-${timestamp}-${random}-${random2}`;
  }
}
