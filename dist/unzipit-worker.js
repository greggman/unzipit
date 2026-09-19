/* unzipit@2.0.3, license MIT */
(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
})((function () { 'use strict';

  var _a, _b;
  function isBlob(v) {
      return typeof Blob !== 'undefined' && v instanceof Blob;
  }
  function isSharedArrayBuffer(b) {
      return typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer;
  }
  const isNode = (typeof process !== 'undefined') &&
      !!(process === null || process === void 0 ? void 0 : process.versions) &&
      (typeof ((_a = process === null || process === void 0 ? void 0 : process.versions) === null || _a === void 0 ? void 0 : _a.node) !== 'undefined') &&
      (typeof ((_b = process === null || process === void 0 ? void 0 : process.versions) === null || _b === void 0 ? void 0 : _b.electron) === 'undefined');
  function isTypedArraySameAsArrayBuffer(typedArray) {
      return typedArray.byteOffset === 0 && typedArray.byteLength === typedArray.buffer.byteLength;
  }

  /* global DecompressionStream */
  // Streaming building blocks shared by ZipEntry.stream(), the non-worker
  // blob()/arrayBuffer() paths, and the worker. Everything here is a pipeline
  // of streams so memory use is bounded by a few chunks in flight, not by the
  // size of the entry.
  // Largest piece handed to the DecompressionStream in one write. Deflate can
  // expand about 1000:1 and a DecompressionStream may emit all the output for a
  // write before backpressure can stop it, so this bounds the burst from a
  // malicious zip to roughly 64MB.
  const kMaxInflateInputSize = 64 * 1024;
  // Returns a chunk that owns its own (non-shared) ArrayBuffer. Readers like
  // ArrayBufferReader return views into the user's buffer. We don't want to
  // hand those to a consumer who might transfer/detach them, and
  // DecompressionStream does not accept views on a SharedArrayBuffer.
  function ownChunk(chunk) {
      return isTypedArraySameAsArrayBuffer(chunk) && !isSharedArrayBuffer(chunk.buffer)
          ? chunk
          : chunk.slice();
  }
  function sourceToStream(src) {
      if (isBlob(src)) {
          return src.stream();
      }
      return new ReadableStream({
          start(controller) {
              controller.enqueue(ownChunk(src));
              controller.close();
          },
      });
  }
  // Splits chunks into views of at most `maxSize` bytes (no copying).
  function splitChunks(maxSize) {
      return new TransformStream({
          transform(chunk, controller) {
              for (let offset = 0; offset < chunk.byteLength; offset += maxSize) {
                  controller.enqueue(chunk.subarray(offset, offset + maxSize));
              }
          },
      });
  }
  // Errors the stream as soon as more than `expected` bytes pass through, and
  // at the end if fewer did. The declared size is metadata from the zip and
  // must be verified.
  function limitSize(expected) {
      let seen = 0;
      return new TransformStream({
          transform(chunk, controller) {
              seen += chunk.byteLength;
              if (seen > expected) {
                  throw new Error(`decompressed size exceeds limit: ${seen} > ${expected}`);
              }
              controller.enqueue(chunk);
          },
          flush() {
              if (seen !== expected) {
                  throw new Error(`decompressed size mismatch. declared: ${expected}, actual: ${seen}`);
              }
          },
      });
  }
  // Takes a stream of the entry's raw (possibly deflated) bytes and returns a
  // stream of its uncompressed bytes, verified against `uncompressedSize`.
  function inflateRawStream(src, uncompressedSize, decompress, chunkSize) {
      let stream = src;
      {
          stream = stream
              .pipeThrough(splitChunks(kMaxInflateInputSize))
              .pipeThrough(new DecompressionStream('deflate-raw'));
      }
      stream = stream.pipeThrough(limitSize(uncompressedSize));
      return stream;
  }
  // Reads the whole stream into a single ArrayBuffer. `size` is the exact
  // expected size (enforced by inflateRawStream) so we allocate once and copy
  // each chunk in, rather than collecting chunks and concatenating them which
  // would need twice the memory.
  async function streamToArrayBuffer(stream, size) {
      const result = new Uint8Array(size);
      let offset = 0;
      const reader = stream.getReader();
      for (;;) {
          const { done, value } = await reader.read();
          if (done) {
              break;
          }
          if (offset + value.byteLength > size) {
              // should not happen: inflateRawStream enforces the size.
              throw new Error(`decompressed size exceeds limit: ${offset + value.byteLength} > ${size}`);
          }
          result.set(value, offset);
          offset += value.byteLength;
      }
      return result.buffer;
  }
  // Collects the stream into a Blob without holding it in the JS heap. The
  // browser stores the data in its blob storage, which may page it to disk.
  async function streamToBlob(stream, type) {
      // Chrome rejects Response.blob() with "TypeError: Failed to fetch" instead
      // of the stream's error, so remember the real error to rethrow it.
      let streamError;
      const reader = stream.getReader();
      const tapped = new ReadableStream({
          async pull(controller) {
              try {
                  const { done, value } = await reader.read();
                  if (done) {
                      controller.close();
                  }
                  else {
                      controller.enqueue(value);
                  }
              }
              catch (e) {
                  streamError = e;
                  throw e;
              }
          },
          cancel(reason) {
              return reader.cancel(reason);
          },
      }, { highWaterMark: 0 });
      try {
          const blob = await new Response(tapped).blob();
          // slice does not copy, it just makes a new Blob with the requested type
          return blob.slice(0, blob.size, type);
      }
      catch (e) {
          throw streamError !== null && streamError !== void 0 ? streamError : e;
      }
  }
  // Inflates an in-memory or Blob source to an ArrayBuffer (no type) or a Blob
  // (type). Used by the worker and by the local fallback when workers fail.
  async function inflateToResult(src, uncompressedSize, type) {
      const stream = inflateRawStream(sourceToStream(src), uncompressedSize);
      return type
          ? await streamToBlob(stream, type)
          : await streamToArrayBuffer(stream, uncompressedSize);
  }

  async function inflate(req, postMessage) {
      const { id, src, type } = req;
      try {
          // inflateToResult enforces the declared uncompressedSize
          const data = await inflateToResult(src, req.uncompressedSize, type);
          const transferables = [];
          if (!type) {
              transferables.push(data);
          }
          postMessage({ id, data }, transferables);
      }
      catch (e) {
          console.error(e);
          postMessage({ id, error: `${e}` });
      }
  }
  function handleMessage(msg, postMessage) {
      const { type, data } = msg;
      if (type === 'inflate') {
          inflate(data, postMessage);
      }
      else {
          throw new Error('no handler for type: ' + type);
      }
  }
  if (isNode) {
      // Use dynamic import so this works in both CJS and ESM contexts.
      // The import of a built-in resolves before any messages can arrive.
      const moduleId = 'node:worker_threads';
      import(moduleId).then(({ parentPort }) => {
          parentPort.on('message', (msg) => {
              handleMessage(msg, (m, t) => parentPort.postMessage(m, t));
          });
      });
  }
  else {
      const workerSelf = self;
      workerSelf.addEventListener('message', (e) => {
          handleMessage(e.data, (m, t) => workerSelf.postMessage(m, t));
      });
      // needed for firefox AFAICT as there is no other
      // way to know a worker loaded successfully.
      workerSelf.postMessage('start');
  }

}));
