import { decodeSSEMessage, type SSEMessage, isSessionSecretMessage } from "@convex-dev/sse-websocket-proxy/sse-protocol";
import { encodeTextMessageRequest } from "@convex-dev/sse-websocket-proxy/messages-protocol";

let EventSource = globalThis.EventSource;
export function setEventSource(es: typeof EventSource) {
  EventSource = es;
}

function isVerboseMode(): boolean {
  // Check for verbose mode in browser environment
  if (typeof window !== "undefined" && !!(window as any).SSE_WS_VERBOSE) {
    return true;
  }

  // Check for verbose mode in Node.js environment
  if (typeof process !== "undefined" && process.env && !!process.env.SSE_WS_VERBOSE) {
    return true;
  }

  return false;
}

function verboseLog(...args: any[]): void {
  if (isVerboseMode()) {
    console.log("[SSE-WS-VERBOSE]", ...args);
  }
}

/**
 * Behaves like a WebSocket but is powered by a proxy
 */
export class SimulatedWebsocket extends EventTarget {
  public readonly url: string;
  public readyState: number = WebSocket.CONNECTING;
  public readonly protocol: string = "";
  public readonly extensions: string = "";

  private proxyUrl: string;
  private sessionId: string | null = null;
  private sessionSecret: string | null = null;
  private eventSource: EventSource | null = null;
  private userInitiatedClose: boolean = false;
  private isWebSocketConnected: boolean = false;
  private pageUnloading: boolean = false;
  private pageUnloadTracker: (() => void) | undefined;

  public binaryType: "blob" | "arraybuffer";

  // Event handlers (WebSocket-style)
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onclose: ((event: Event) => void) | null = null;

  constructor(url: string | URL, protocols: undefined | string | string[], proxyUrl: string) {
    super();
    this.binaryType = "blob";

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
    console.log("proxy url:", this.proxyUrl);
    console.log("backend url:", this.url);

    // Construct the SSE URL with backend parameter
    const sseUrl = new URL("/sse", this.proxyUrl);
    sseUrl.searchParams.set("sessionId", this.sessionId);
    sseUrl.searchParams.set("backend", this.url); // Pass the full WebSocket URL to the proxy

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

    if (typeof window !== "undefined") {
      this.pageUnloadTracker = () => {
        this.pageUnloading = true;
        if (this.eventSource) {
          this.eventSource.close();
        }
      };
      window.addEventListener("beforeunload", this.pageUnloadTracker);
    }

    this.eventSource.onopen = () => {
      // SSE connection established, but we're not "open" until the WebSocket backend connects
    };

    this.eventSource.onmessage = (event) => {
      let message: SSEMessage;
      try {
        message = decodeSSEMessage(event.data);
      } catch (error) {
        console.error("SimulatedWebsocket: Failed to decode SSE message:", error);
        // Malformed data from proxy should trigger an error event
        this.handleError(
          new Error(
            `Malformed data from proxy: ${error instanceof Error ? error.message : "Unknown decoding error"}`,
          ),
        );
        return;
      }
      this.handleProxyMessage(message);
    };

    this.eventSource.onerror = (error) => {
      // If we're not closed,
      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        // EventSource is now closed - clean up listeners
        if (this.pageUnloadTracker) {
          window.removeEventListener("unload", this.pageUnloadTracker);
        }
      }

      // If user initiated close, don't fire error events
      if (this.userInitiatedClose) {
        return;
      }
      if (this.pageUnloading) {
        return;
      }

      console.error("SimulatedWebsocket: SSE connection error:", error);

      if (this.readyState === WebSocket.OPEN) {
        // Connection was established but now has protocol error - close with 1006
        this.handleClose(1006, "SSE connection error", false);
      } else {
        // Connection establishment error - fire error event
        this.handleError(new Error("SSE connection error"));
      }
    };
  }

  private handleProxyMessage(message: SSEMessage): void {
    switch (message.type) {
      case "session-secret":
        // Store session secret for authentication
        this.sessionSecret = message.secret;
        verboseLog(`Received session secret for authentication`);
        break;

      case "websocket-connected":
        this.isWebSocketConnected = true;
        this.readyState = WebSocket.OPEN;
        const openEvent = new Event("open");
        verboseLog(`Firing 'open' event - WebSocket connection established`);
        this.dispatchEvent(openEvent);
        if (this.onopen) this.onopen(openEvent);
        break;

      case "message":
        const messageEvent = new MessageEvent("message", {
          data: message.data,
        });
        verboseLog(
          `Firing 'message' event - received text data:`,
          typeof message.data,
          message.data.length > 100 ? `${message.data.slice(0, 100)}...` : message.data,
        );
        this.dispatchEvent(messageEvent);
        if (this.onmessage) this.onmessage(messageEvent);
        break;

      case "binary-message":
        // Decode base64 data back to ArrayBuffer or Blob based on binaryType
        const arrayBuffer = this.decodeBinaryDataBrowser(message.data);
        let binaryData: ArrayBuffer | Blob;

        if (this.binaryType === "blob") {
          binaryData = new Blob([arrayBuffer]);
        } else {
          binaryData = arrayBuffer;
        }

        const binaryMessageEvent = new MessageEvent("message", {
          data: binaryData,
        });
        verboseLog(
          `Firing 'message' event - received binary data (${this.binaryType}):`,
          binaryData instanceof Blob
            ? `Blob(${binaryData.size} bytes)`
            : `ArrayBuffer(${arrayBuffer.byteLength} bytes)`,
        );
        this.dispatchEvent(binaryMessageEvent);
        if (this.onmessage) this.onmessage(binaryMessageEvent);
        break;

      case "websocket-error":
        this.handleError(new Error(message.error));
        break;

      case "websocket-closed":
        this.handleClose(message.code, message.reason, message.wasClean);
        break;

      case "ping":
        // Keepalive - no action needed
        break;

      default:
        console.warn("Unknown proxy message type:", (message as any).type);
    }
  }

  private handleError(error: Error): void {
    // Set readyState to CLOSED (connection failed)
    this.readyState = WebSocket.CLOSED;

    // Close EventSource if it exists
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Fire error event
    const errorEvent = Object.assign(new Event("error"), {
      error: error,
    });
    verboseLog(`Firing 'error' event - error:`, error.message);
    this.dispatchEvent(errorEvent);
    if (this.onerror) this.onerror(errorEvent);

    // Note: We do NOT fire a close event for connection errors
    // per WebSocket spec - close events are only for successful connections that then close
  }

  private handleClose(code: number, reason: string, wasClean: boolean): void {
    // Only fire close event if not already closed
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }

    this.readyState = WebSocket.CLOSED;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const closeEvent = Object.assign(new Event("close"), {
      code: code,
      reason: reason,
      wasClean: wasClean,
    });
    verboseLog(`Firing 'close' event - code: ${code}, reason: "${reason}", wasClean: ${wasClean}`);
    this.dispatchEvent(closeEvent);
    if (this.onclose) this.onclose(closeEvent);
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    if (!this.sessionId) {
      throw new Error("No session ID available");
    }

    // Handle Blob data asynchronously
    if (data instanceof Blob) {
      this.sendBlob(data);
      return;
    }

    // Prepare message based on data type
    let messageToSend: string;
    if (typeof data === "string") {
      // Text message
      messageToSend = encodeTextMessageRequest(data);
    } else {
      // Binary data - need to convert to base64
      messageToSend = this.handleBinaryData(data);
    }

    // Send via HTTP POST to the proxy using the new protocol
    this.sendMessage(messageToSend);
  }

  private async sendBlob(blob: Blob): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    const messageToSend = this.handleBinaryData(arrayBuffer);
    this.sendMessage(messageToSend);
  }

  private sendMessage(messageToSend: string): void {
    if (!this.sessionSecret) {
      this.handleClose(1006, "No session secret available", false);
      return;
    }

    fetch(`${this.proxyUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": this.sessionId!,
        "X-Session-Secret": this.sessionSecret,
      },
      body: messageToSend,
    }).catch((error) => {
      // Send errors after connection establishment are protocol errors - close with 1006
      this.handleClose(1006, `Failed to send message: ${error.message}`, false);
    });
  }

  private handleBinaryData(data: ArrayBufferLike | ArrayBufferView): string {
    // Convert to Uint8Array for consistent handling
    let uint8Array: Uint8Array;
    if (data instanceof ArrayBuffer) {
      uint8Array = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      uint8Array = data;
    } else {
      // ArrayBufferView (like DataView, typed arrays) or SharedArrayBuffer
      if ("buffer" in data && "byteOffset" in data && "byteLength" in data) {
        // ArrayBufferView
        uint8Array = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else {
        // SharedArrayBuffer or other ArrayBufferLike
        uint8Array = new Uint8Array(data);
      }
    }

    // Use browser-compatible base64 encoding
    return this.encodeBinaryMessageRequestBrowser(uint8Array);
  }

  private encodeBinaryMessageRequestBrowser(uint8Array: Uint8Array): string {
    // Convert Uint8Array to base64 using browser-compatible method
    let binaryString = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binaryString);

    const message = {
      type: "binary",
      data: base64Data,
    };
    return JSON.stringify(message);
  }

  private decodeBinaryDataBrowser(base64Data: string): ArrayBuffer {
    // Decode base64 to binary string using browser-compatible method
    const binaryString = atob(base64Data);

    // Convert binary string to Uint8Array
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Return ArrayBuffer
    return uint8Array.buffer;
  }

  // Test utility to get the session ID
  public getSessionId(): string | null {
    return this.sessionId;
  }

  public close(code?: number, reason?: string): void {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
      return;
    }

    // Validate close code per WebSocket specification to match native Node.js behavior
    if (code !== undefined) {
      if (code === 1001) {
        // 1001 is reserved for "Going away" and cannot be used by clients
        throw new DOMException("invalid code", "InvalidAccessError");
      }
      if (code !== 1000 && (code < 3000 || code > 4999)) {
        throw new DOMException("invalid code", "InvalidAccessError");
      }
    }

    this.userInitiatedClose = true;
    this.readyState = WebSocket.CLOSING;

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

    if (!this.sessionSecret) {
      // No session secret - just close locally
      this.handleClose(1006, "No session secret available", false);
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
          "X-Session-Secret": this.sessionSecret,
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
