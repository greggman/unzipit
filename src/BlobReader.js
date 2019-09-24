import {readBlobAsArrayBuffer} from './utils.js';

export default class BlobReader {
  constructor(blob) {
    this.blob = blob;
  }
  async getLength() {
    return this.blob.size;
  }
  async read(offset, length, ) {
    const blob = this.blob.slice(offset, offset + length);
    return await readBlobAsArrayBuffer(blob);
  }
}