import {inflateRaw} from 'uzip-module';
import {readBlobAsArrayBuffer, isBlob} from './utils.js';

// note: we only workerize the inflate portion.
// every other part is already async and JavaScript
// is non blocking. I suppose if you had a million entry
// zip file then the loop going through the directory
// might take time but that's an unlikely situation.

// class InflateRequest {
//   id: string,
//   data: arraybuffer, sharedarraybuffer, blob
//   uncompressedSize: // can be undefined
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
    if (isBlob(srcData)) {
      srcData = await readBlobAsArrayBuffer(src);
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
    self.postMessage({
      id,
      data,
    }, transferables);
  } catch (e) {
    console.error(e);
    self.postMessage({
      id,
      error: `${e.toString()}`,
    });
  }
}

const handlers = {
  inflate,
};

self.onmessage = function(e) {
  const {type, data} = e.data;
  const fn = handlers[type];
  if (!fn) {
    throw new Error('no handler for type: ' + type);
  }
  fn(data);
};