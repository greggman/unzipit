/* global SharedArrayBuffer, process */

export function readBlobAsArrayBuffer(blob) {
  if (blob.arrayBuffer) {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('loadend', () => {
      resolve(reader.result);
    });
    reader.addEventListener('error', reject);
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobAsUint8Array(blob) {
  const arrayBuffer = await readBlobAsArrayBuffer(blob);
  return new Uint8Array(arrayBuffer);
}

export function isBlob(v) {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

export function isSharedArrayBuffer(b) {
  return typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer;
}

export const isNode =
    (typeof process !== 'undefined') &&
    process.versions &&
    (typeof process.versions.node !== 'undefined') &&
    (typeof process.versions.electron === 'undefined');

export function isTypedArraySameAsArrayBuffer(typedArray) {
  return typedArray.byteOffset === 0 && typedArray.byteLength === typedArray.buffer.byteLength;
}