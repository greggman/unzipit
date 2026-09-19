import { isNode } from './utils.js';
import { inflateToResult } from './inflate-stream.js';
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

type PostMessageFn = (msg: InflateResultMessage, transfer?: Transferable[]) => void;

async function inflate(req: InflateRequestData, postMessage: PostMessageFn): Promise<void> {
  const {id, src, type} = req;
  try {
    // inflateToResult enforces the declared uncompressedSize
    const data = await inflateToResult(src, req.uncompressedSize, type);
    const transferables: Transferable[] = [];
    if (!type) {
      transferables.push(data as ArrayBuffer);
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
