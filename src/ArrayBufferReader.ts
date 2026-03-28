import { isSharedArrayBuffer } from './utils.js';
import type { Reader } from './BlobReader.js';

export default class ArrayBufferReader implements Reader {
  private typedArray: Uint8Array;

  constructor(arrayBufferOrView: ArrayBuffer | SharedArrayBuffer | ArrayBufferView) {
    this.typedArray = (arrayBufferOrView instanceof ArrayBuffer || isSharedArrayBuffer(arrayBufferOrView))
       ? new Uint8Array(arrayBufferOrView as ArrayBufferLike)
       : new Uint8Array(
           (arrayBufferOrView as ArrayBufferView).buffer,
           (arrayBufferOrView as ArrayBufferView).byteOffset,
           (arrayBufferOrView as ArrayBufferView).byteLength,
         );
  }
  async getLength(): Promise<number> {
    return this.typedArray.byteLength;
  }
  async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    // Cast is necessary: backing buffer may be SharedArrayBuffer (ArrayBufferLike),
    // but callers need Uint8Array<ArrayBuffer>. The data is read-only view so this is safe.
    return new Uint8Array(this.typedArray.buffer, this.typedArray.byteOffset + offset, length) as Uint8Array<ArrayBuffer>;
  }
}
