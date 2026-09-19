import { readBlobAsArrayBuffer } from './utils.js';

export interface Reader {
  getLength(): Promise<number>;
  read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>>;
  sliceAsBlob?(offset: number, length: number, type?: string): Promise<Blob>;
  // Optional. Returns a stream of `size` bytes starting at `offset`. If not
  // provided, `entry.stream()` calls `read` repeatedly in smaller pieces.
  readStream?(offset: number, size: number): Promise<ReadableStream<Uint8Array>>;
}

export default class BlobReader implements Reader {
  private blob: Blob;

  constructor(blob: Blob) {
    this.blob = blob;
  }
  async getLength(): Promise<number> {
    return this.blob.size;
  }
  async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    const blob = this.blob.slice(offset, offset + length);
    const arrayBuffer = await readBlobAsArrayBuffer(blob);
    return new Uint8Array(arrayBuffer);
  }
  async readStream(offset: number, length: number): Promise<ReadableStream<Uint8Array>> {
    return this.blob.slice(offset, offset + length).stream();
  }
  async sliceAsBlob(offset: number, length: number, type = ''): Promise<Blob> {
    return this.blob.slice(offset, offset + length, type);
  }
}
