/**
 * SSE Protocol for WebSocket-over-SSE communication
 * 
 * This file defines the message types and encoding/decoding functions
 * for the Server-Sent Events protocol used between the proxy and SimulatedWebSocket.
 */

// Message type definitions
export interface ConnectedMessage {
  type: 'connected';
  sessionId: string;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface WebSocketConnectedMessage {
  type: 'websocket-connected';
  sessionId: string;
  timestamp: number;
}

export interface DataMessage {
  type: 'message';
  data: string; // Raw WebSocket data as string
  timestamp: number;
}

export interface BinaryDataMessage {
  type: 'binary-message';
  data: string; // Base64 encoded binary data
  timestamp: number;
}

export interface WebSocketErrorMessage {
  type: 'websocket-error';
  error: string; // Error message
  timestamp: number;
}

export interface WebSocketClosedMessage {
  type: 'websocket-closed';
  code: number; // WebSocket close code
  reason: string; // Close reason
  wasClean: boolean; // Whether the close was clean
  timestamp: number;
}

// Union type of all possible SSE messages
export type SSEMessage = 
  | ConnectedMessage
  | PingMessage
  | WebSocketConnectedMessage
  | DataMessage
  | BinaryDataMessage
  | WebSocketErrorMessage
  | WebSocketClosedMessage;

// Encoding functions (for proxy to create messages)
export function encodeConnectedMessage(sessionId: string): string {
  const message: ConnectedMessage = {
    type: 'connected',
    sessionId
  };
  return JSON.stringify(message);
}

export function encodePingMessage(timestamp: number): string {
  const message: PingMessage = {
    type: 'ping',
    timestamp
  };
  return JSON.stringify(message);
}

export function encodeWebSocketConnectedMessage(sessionId: string, timestamp: number): string {
  const message: WebSocketConnectedMessage = {
    type: 'websocket-connected',
    sessionId,
    timestamp
  };
  return JSON.stringify(message);
}

export function encodeDataMessage(data: string, timestamp: number): string {
  const message: DataMessage = {
    type: 'message',
    data,
    timestamp
  };
  return JSON.stringify(message);
}

export function encodeBinaryDataMessage(base64Data: string, timestamp: number): string {
  const message: BinaryDataMessage = {
    type: 'binary-message',
    data: base64Data,
    timestamp
  };
  return JSON.stringify(message);
}

export function encodeWebSocketErrorMessage(error: string, timestamp: number): string {
  const message: WebSocketErrorMessage = {
    type: 'websocket-error',
    error,
    timestamp
  };
  return JSON.stringify(message);
}

export function encodeWebSocketClosedMessage(
  code: number, 
  reason: string, 
  wasClean: boolean, 
  timestamp: number
): string {
  const message: WebSocketClosedMessage = {
    type: 'websocket-closed',
    code,
    reason,
    wasClean,
    timestamp
  };
  return JSON.stringify(message);
}

// Decoding function (for SimulatedWebSocket to parse messages)
export function decodeSSEMessage(data: string): SSEMessage {
  try {
    const parsed = JSON.parse(data);
    
    // Basic validation that it's an SSE message
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      throw new Error('Invalid SSE message format');
    }
    
    // TODO: Could add more specific validation here if needed
    return parsed as SSEMessage;
  } catch (error) {
    throw new Error(`Failed to decode SSE message: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Type guard functions for runtime type checking
export function isConnectedMessage(msg: SSEMessage): msg is ConnectedMessage {
  return msg.type === 'connected';
}

export function isPingMessage(msg: SSEMessage): msg is PingMessage {
  return msg.type === 'ping';
}

export function isWebSocketConnectedMessage(msg: SSEMessage): msg is WebSocketConnectedMessage {
  return msg.type === 'websocket-connected';
}

export function isDataMessage(msg: SSEMessage): msg is DataMessage {
  return msg.type === 'message';
}

export function isBinaryDataMessage(msg: SSEMessage): msg is BinaryDataMessage {
  return msg.type === 'binary-message';
}

export function isWebSocketErrorMessage(msg: SSEMessage): msg is WebSocketErrorMessage {
  return msg.type === 'websocket-error';
}

export function isWebSocketClosedMessage(msg: SSEMessage): msg is WebSocketClosedMessage {
  return msg.type === 'websocket-closed';
}