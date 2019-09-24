import {isSharedArrayBuffer} from './utils.js';

export default class ArrayBufferReader {
  constructor(arrayBufferOrView) {
    this.buffer = (arrayBufferOrView instanceof ArrayBuffer || isSharedArrayBuffer(arrayBufferOrView))
       ? arrayBufferOrView
       : arrayBufferOrView.buffer;
  }
  async getLength() {
    return this.buffer.byteLength;
  }
  async read(offset, length) {
    return new Uint8Array(this.buffer, offset, length);
  }
}