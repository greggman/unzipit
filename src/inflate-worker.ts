/* global DecompressionStream */

import { readBlobAsUint8Array, isBlob, isNode } from './utils.js';

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
async function decompressRaw(src: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(src).then(() => writer.close()).catch(() => {});
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
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

interface InflateReq {
  id: number;
  src: Blob | ArrayBuffer;  // worker receives ArrayBuffer (not SharedArrayBuffer) over postMessage
  type?: string;
}

type PostMessageFn = (msg: unknown, transfer?: Transferable[]) => void;

async function inflate(req: InflateReq, postMessage: PostMessageFn): Promise<void> {
  const {id, src, type} = req;
  try {
    const srcData: Uint8Array<ArrayBuffer> = isBlob(src)
      ? await readBlobAsUint8Array(src)
      : new Uint8Array(src);
    const dstData = await decompressRaw(srcData);
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
  const { type, data } = msg as { type: string; data: InflateReq };
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handleMessage(msg, (m, t) => parentPort!.postMessage(m, t as any));
    });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workerSelf = self as any;
  workerSelf.addEventListener('message', (e: MessageEvent) => {
    handleMessage(e.data, (m, t) => workerSelf.postMessage(m, t));
  });
  // needed for firefox AFAICT as there is no other
  // way to know a worker loaded successfully.
  workerSelf.postMessage('start');
}
