// Shared types describing the messages exchanged between the main thread
// (inflate.ts) and the inflate worker (inflate-worker.ts) over postMessage.

// The payload of an 'inflate' request.
export interface InflateRequestData {
  id: number;
  type?: string;          // mime-type; falsy means return an ArrayBuffer
  src: Uint8Array<ArrayBuffer> | Blob;
  uncompressedSize: number;
}

// Message posted to the worker.
export interface InflateRequestMessage {
  type: 'inflate';
  data: InflateRequestData;
}

// Message posted back from the worker.
export interface InflateResultMessage {
  id: number;
  data?: ArrayBuffer | Blob;
  error?: string;
}
