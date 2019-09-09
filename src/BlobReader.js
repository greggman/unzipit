function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('loadend', () => {
      resolve(reader.result);
    });
    reader.addEventListener('error', reject);
    reader.readAsArrayBuffer(blob);
  });
}

export default class BlobReader {
  constructor(blob) {
    this.blob = blob;
  }
  get length() {
    return this.blob.size;
  }
  async read(offset, length) {
    const blob = this.blob.slice(offset, offset + length);
    return readBlobAsArrayBuffer();
  }
}