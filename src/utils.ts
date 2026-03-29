declare const process: {
  versions?: {
    node?: string;
    electron?: string;
  };
} | undefined;

export function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('loadend', () => {
      resolve(reader.result as ArrayBuffer);
    });
    reader.addEventListener('error', reject);
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  const arrayBuffer = await readBlobAsArrayBuffer(blob);
  return new Uint8Array(arrayBuffer);
}

export function isBlob(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

export function isSharedArrayBuffer(b: unknown): b is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer;
}

export const isNode: boolean =
    (typeof process !== 'undefined') &&
    !!(process?.versions) &&
    (typeof process?.versions?.node !== 'undefined') &&
    (typeof process?.versions?.electron === 'undefined');

export function isTypedArraySameAsArrayBuffer(typedArray: Uint8Array): boolean {
  return typedArray.byteOffset === 0 && typedArray.byteLength === typedArray.buffer.byteLength;
}
