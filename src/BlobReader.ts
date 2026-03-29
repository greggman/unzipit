import { readBlobAsArrayBuffer } from './utils.js';

export interface Reader {
  getLength(): Promise<number>;
  read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>>;
  sliceAsBlob?(offset: number, length: number, type?: string): Promise<Blob>;
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
  async sliceAsBlob(offset: number, length: number, type = ''): Promise<Blob> {
    return this.blob.slice(offset, offset + length, type);
  }
}
