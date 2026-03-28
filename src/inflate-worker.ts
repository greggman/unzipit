/* global require, DecompressionStream */

import { readBlobAsUint8Array, isBlob, isNode } from './utils.js';

// Available as a global in CJS/Node.js worker_threads context
declare function require(id: string): any;  // eslint-disable-line @typescript-eslint/no-explicit-any

interface MsgHelper {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, fn: (data: unknown) => void): void;
}

// note: we only handle the inflate portion in a worker
// every other part is already async and JavaScript
// is non blocking. I suppose if you had a million entry
// zip file then the loop going through the directory
// might take time but that's an unlikely situation.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorkerSelf = { postMessage(msg: unknown, transfer?: Transferable[]): void; addEventListener(type: string, fn: (e: any) => void): void };

const msgHelper: MsgHelper = (function(): MsgHelper {
  if (isNode) {
    const { parentPort } = require('worker_threads');

    return {
      postMessage: parentPort.postMessage.bind(parentPort),
      addEventListener: parentPort.on.bind(parentPort),
    };
  } else {
    const workerSelf = self as unknown as AnyWorkerSelf;
    return {
      postMessage(msg: unknown, transfer?: Transferable[]): void {
        workerSelf.postMessage(msg, transfer);
      },
      addEventListener(type: string, fn: (data: unknown) => void): void {
        workerSelf.addEventListener(type, (e: MessageEvent) => {
          fn(e.data);
        });
      },
    };
  }
}());

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

async function inflate(req: InflateReq): Promise<void> {
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
    msgHelper.postMessage({
      id,
      data,
    }, transferables);
  } catch (e) {
    console.error(e);
    msgHelper.postMessage({
      id,
      error: `${e}`,
    });
  }
}

const handlers: Record<string, (req: InflateReq) => Promise<void>> = {
  inflate,
};

msgHelper.addEventListener('message', function(e: unknown) {
  const msg = e as { type: string; data: InflateReq };
  const {type, data} = msg;
  const fn = handlers[type];
  if (!fn) {
    throw new Error('no handler for type: ' + type);
  }
  fn(data);
});

if (!isNode) {
  // needed for firefox AFAICT as there so no other
  // way to know a worker loaded successfully.?
  msgHelper.postMessage('start');
}
