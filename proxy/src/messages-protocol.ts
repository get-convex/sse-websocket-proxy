/**
 * Protocol definitions for /messages POST endpoint
 * Handles both text and binary message transmission from client to server
 */

// Message request types sent to /messages endpoint
export interface TextMessageRequest {
  type: 'text'
  data: string
}

export interface BinaryMessageRequest {
  type: 'binary'
  data: string // base64 encoded binary data
}

export type MessageRequest = TextMessageRequest | BinaryMessageRequest

// Encoding functions for different message types
export function encodeTextMessageRequest(data: string): string {
  const message: TextMessageRequest = {
    type: 'text',
    data,
  }
  return JSON.stringify(message)
}

export function encodeBinaryMessageRequest(binaryData: ArrayBuffer | ArrayBufferView | Uint8Array): string {
  // Convert to Uint8Array if needed
  let uint8Array: Uint8Array
  if (binaryData instanceof ArrayBuffer) {
    uint8Array = new Uint8Array(binaryData)
  } else if (binaryData instanceof Uint8Array) {
    uint8Array = binaryData
  } else {
    // ArrayBufferView (like DataView, typed arrays)
    uint8Array = new Uint8Array(binaryData.buffer, binaryData.byteOffset, binaryData.byteLength)
  }

  // Convert to base64
  const base64Data = Buffer.from(uint8Array).toString('base64')

  const message: BinaryMessageRequest = {
    type: 'binary',
    data: base64Data,
  }
  return JSON.stringify(message)
}

// Decoding function with validation
export function decodeMessageRequest(jsonData: string): MessageRequest {
  try {
    const parsed = JSON.parse(jsonData)

    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      throw new Error('Invalid message request format')
    }

    if (parsed.type === 'text') {
      if (typeof parsed.data !== 'string') {
        throw new Error('Text message data must be a string')
      }
      return parsed as TextMessageRequest
    } else if (parsed.type === 'binary') {
      if (typeof parsed.data !== 'string') {
        throw new Error('Binary message data must be a base64 string')
      }
      return parsed as BinaryMessageRequest
    } else {
      throw new Error(`Unknown message type: ${parsed.type}`)
    }
  } catch (error) {
    throw new Error(`Failed to decode message request: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Utility function to decode base64 binary data back to Buffer (Node.js only)
export function decodeBinaryData(base64Data: string): Buffer {
  try {
    return Buffer.from(base64Data, 'base64')
  } catch (error) {
    throw new Error(`Failed to decode base64 data: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Type guards for runtime checking
export function isTextMessageRequest(message: MessageRequest): message is TextMessageRequest {
  return message.type === 'text'
}

export function isBinaryMessageRequest(message: MessageRequest): message is BinaryMessageRequest {
  return message.type === 'binary'
}
