/* global DecompressionStream */

// Streaming building blocks shared by ZipEntry.stream(), the non-worker
// blob()/arrayBuffer() paths, and the worker. Everything here is a pipeline
// of streams so memory use is bounded by a few chunks in flight, not by the
// size of the entry.

import { isBlob, isSharedArrayBuffer, isTypedArraySameAsArrayBuffer } from './utils.js';
import type { Reader } from './BlobReader.js';

// How much to ask a Reader for per `read` call when it has no `readStream`.
const kReadSize = 1024 * 1024;

// Largest piece handed to the DecompressionStream in one write. Deflate can
// expand about 1000:1 and a DecompressionStream may emit all the output for a
// write before backpressure can stop it, so this bounds the burst from a
// malicious zip to roughly 64MB.
const kMaxInflateInputSize = 64 * 1024;

// Returns a chunk that owns its own (non-shared) ArrayBuffer. Readers like
// ArrayBufferReader return views into the user's buffer. We don't want to
// hand those to a consumer who might transfer/detach them, and
// DecompressionStream does not accept views on a SharedArrayBuffer.
function ownChunk(chunk: Uint8Array): Uint8Array<ArrayBuffer> {
  return isTypedArraySameAsArrayBuffer(chunk) && !isSharedArrayBuffer(chunk.buffer)
      ? chunk as Uint8Array<ArrayBuffer>
      : chunk.slice();
}

// A stream of `length` bytes starting at `offset` from a Reader that only
// supports `read`. Nothing is read until the consumer pulls.
function readerToStream(reader: Reader, offset: number, length: number): ReadableStream<Uint8Array> {
  let pos = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pos >= length) {
        controller.close();
        return;
      }
      const size = Math.min(kReadSize, length - pos);
      const data = await reader.read(offset + pos, size);
      if (data.byteLength !== size) {
        throw new Error(`short read: expected ${size} bytes at offset ${offset + pos}, got ${data.byteLength}`);
      }
      pos += size;
      controller.enqueue(ownChunk(data));
    },
  }, { highWaterMark: 0 });
}

export async function readAsStream(reader: Reader, offset: number, length: number): Promise<ReadableStream<Uint8Array>> {
  return reader.readStream
      ? await reader.readStream(offset, length)
      : readerToStream(reader, offset, length);
}

function sourceToStream(src: Uint8Array | Blob): ReadableStream<Uint8Array> {
  if (isBlob(src)) {
    return src.stream();
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(ownChunk(src));
      controller.close();
    },
  });
}

// Splits chunks into views of at most `maxSize` bytes (no copying).
function splitChunks(maxSize: number): TransformStream<Uint8Array, Uint8Array> {
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
function limitSize(expected: number): TransformStream<Uint8Array, Uint8Array> {
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

// Re-chunks the stream so every chunk is exactly `chunkSize` bytes except the last.
function reChunk(chunkSize: number): TransformStream<Uint8Array, Uint8Array> {
  let buf: Uint8Array | undefined;
  let used = 0;
  return new TransformStream({
    transform(chunk, controller) {
      let offset = 0;
      while (offset < chunk.byteLength) {
        if (!buf) {
          buf = new Uint8Array(chunkSize);
          used = 0;
        }
        const n = Math.min(chunkSize - used, chunk.byteLength - offset);
        buf.set(chunk.subarray(offset, offset + n), used);
        used += n;
        offset += n;
        if (used === chunkSize) {
          controller.enqueue(buf);
          buf = undefined;
        }
      }
    },
    flush(controller) {
      if (buf) {
        controller.enqueue(buf.slice(0, used));
      }
    },
  });
}

// Takes a stream of the entry's raw (possibly deflated) bytes and returns a
// stream of its uncompressed bytes, verified against `uncompressedSize`.
export function inflateRawStream(
    src: ReadableStream<Uint8Array>,
    uncompressedSize: number,
    decompress: boolean,
    chunkSize?: number,
): ReadableStream<Uint8Array> {
  let stream = src;
  if (decompress) {
    stream = stream
        .pipeThrough(splitChunks(kMaxInflateInputSize))
        .pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  stream = stream.pipeThrough(limitSize(uncompressedSize));
  if (chunkSize) {
    stream = stream.pipeThrough(reChunk(chunkSize));
  }
  return stream;
}

// Reads the whole stream into a single ArrayBuffer. `size` is the exact
// expected size (enforced by inflateRawStream) so we allocate once and copy
// each chunk in, rather than collecting chunks and concatenating them which
// would need twice the memory.
export async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>, size: number): Promise<ArrayBuffer> {
  const result = new Uint8Array(size);
  let offset = 0;
  const reader = stream.getReader();
  for (;;) {
    const {done, value} = await reader.read();
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
export async function streamToBlob(stream: ReadableStream<Uint8Array>, type: string): Promise<Blob> {
  // Chrome rejects Response.blob() with "TypeError: Failed to fetch" instead
  // of the stream's error, so remember the real error to rethrow it.
  let streamError: unknown;
  const reader = stream.getReader();
  const tapped = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const {done, value} = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (e) {
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
  } catch (e) {
    throw streamError ?? e;
  }
}

// Inflates an in-memory or Blob source to an ArrayBuffer (no type) or a Blob
// (type). Used by the worker and by the local fallback when workers fail.
export async function inflateToResult(src: Uint8Array | Blob, uncompressedSize: number, type?: string): Promise<ArrayBuffer | Blob> {
  const stream = inflateRawStream(sourceToStream(src), uncompressedSize, true);
  return type
      ? await streamToBlob(stream, type)
      : await streamToArrayBuffer(stream, uncompressedSize);
}
