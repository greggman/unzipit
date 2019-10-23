/* global require */

import {inflateRaw} from 'uzip-module';
import {readBlobAsUint8Array, isBlob, isNode} from './utils.js';

// note: we only handle the inflate portion in a worker
// every other part is already async and JavaScript
// is non blocking. I suppose if you had a million entry
// zip file then the loop going through the directory
// might take time but that's an unlikely situation.

const msgHelper = (function() {
  if (isNode) {
    const { parentPort } = require('worker_threads');

    return {
      postMessage: parentPort.postMessage.bind(parentPort),
      addEventListener: parentPort.on.bind(parentPort),
    };
  } else {
    return {
      postMessage: self.postMessage.bind(self),
      addEventListener(type, fn) {
        self.addEventListener(type, (e) => {
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
async function inflate(req) {
  const {id, src, uncompressedSize, type} = req;
  try {
    let srcData;
    if (isBlob(src)) {
      srcData = await readBlobAsUint8Array(src);
    } else {
      srcData = new Uint8Array(src);
    }
    const dstData = new Uint8Array(uncompressedSize);
    inflateRaw(srcData, dstData);
    const transferables = [];
    let data;
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
      error: `${e.toString()}`,
    });
  }
}

const handlers = {
  inflate,
};

msgHelper.addEventListener('message', function(e) {
  const {type, data} = e;
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