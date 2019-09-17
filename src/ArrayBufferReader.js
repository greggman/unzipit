export default class ArrayBufferReader {
  constructor(arrayBufferOrView) {
    this.buffer = arrayBufferOrView instanceof ArrayBuffer
       ? arrayBufferOrView
       : arrayBufferOrView.buffer;
  }
  get length() {
    return this.buffer.byteLength;
  }
  async read(offset, length) {
    return this.buffer.slice(offset, offset + length);
  }
}