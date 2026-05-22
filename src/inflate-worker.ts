/* global DecompressionStream */

import { readBlobAsUint8Array, isBlob, isNode } from './utils.js';
import type { InflateRequestData, InflateRequestMessage, InflateResultMessage } from './inflate-types.js';

// note: we only handle the inflate portion in a worker
// every other part is already async and JavaScript
// is non blocking. I suppose if you had a million entry
// zip file then the loop going through the directory
// might take time but that's an unlikely situation.

// class InflateRequest {
//   id: string,
//   src: ArrayBuffer, SharedArrayBuffer, blob
//   uncompressedSize: number,
//   type: string or undefined
// }
//
// Do we need to throttle? If you send 50 requests and they are each blobs
// then 50 blobs will be asked to be read at once.
// If feels like that should happen at a higher level (user code)
// or a lower level (the browser)?
async function decompressRaw(src: Uint8Array<ArrayBuffer>, maxLimit?: number): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(src).then(() => writer.close()).catch(() => {});
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  let seen = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    seen += value.byteLength;
    if (typeof maxLimit === 'number' && seen > maxLimit) {
      throw new Error(`decompressed size exceeds limit: ${seen} > ${maxLimit}`);
    }
  }
  const size = chunks.reduce((s, c) => s + c.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

type PostMessageFn = (msg: InflateResultMessage, transfer?: Transferable[]) => void;

async function inflate(req: InflateRequestData, postMessage: PostMessageFn): Promise<void> {
  const {id, src, type} = req;
  try {
    const srcData: Uint8Array<ArrayBuffer> = isBlob(src)
      ? await readBlobAsUint8Array(src)
      : new Uint8Array(src);
    // Enforce declared uncompressedSize as the streaming limit
    const limit = typeof req.uncompressedSize === 'number' ? req.uncompressedSize : undefined;
    const dstData = await decompressRaw(srcData, limit);
    const transferables: Transferable[] = [];
    let data: Blob | ArrayBuffer;
    if (type) {
      data = new Blob([dstData], {type});
    } else {
      data = dstData.buffer;
      transferables.push(data);
    }
    postMessage({ id, data }, transferables);
  } catch (e) {
    console.error(e);
    postMessage({ id, error: `${e}` });
  }
}

function handleMessage(msg: unknown, postMessage: PostMessageFn): void {
  const { type, data } = msg as InflateRequestMessage;
  if (type === 'inflate') {
    inflate(data, postMessage);
  } else {
    throw new Error('no handler for type: ' + type);
  }
}

if (isNode) {
  // Use dynamic import so this works in both CJS and ESM contexts.
  // The import of a built-in resolves before any messages can arrive.
  const moduleId = 'node:worker_threads';
  import(moduleId).then(({ parentPort }) => {
    parentPort!.on('message', (msg: unknown) => {
      handleMessage(msg, (m, t) => parentPort!.postMessage(m, t as Transferable[] | undefined));
    });
  });
} else {
  const workerSelf = self as unknown as {
    addEventListener(type: string, fn: (e: MessageEvent) => void): void;
    postMessage(msg: InflateResultMessage | 'start', transfer?: Transferable[]): void;
  };
  workerSelf.addEventListener('message', (e: MessageEvent) => {
    handleMessage(e.data, (m, t) => workerSelf.postMessage(m, t));
  });
  // needed for firefox AFAICT as there is no other
  // way to know a worker loaded successfully.
  workerSelf.postMessage('start');
}
