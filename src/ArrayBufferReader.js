import {isSharedArrayBuffer} from './utils.js';

export default class ArrayBufferReader {
  constructor(arrayBufferOrView) {
    this.typedArray = (arrayBufferOrView instanceof ArrayBuffer || isSharedArrayBuffer(arrayBufferOrView))
       ? new Uint8Array(arrayBufferOrView)
       : new Uint8Array(arrayBufferOrView.buffer, arrayBufferOrView.byteOffset, arrayBufferOrView.byteLength);
  }
  async getLength() {
    return this.typedArray.byteLength;
  }
  async read(offset, length) {
    return new Uint8Array(this.typedArray.buffer, this.typedArray.byteOffset + offset, length);
  }
}