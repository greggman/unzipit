/* unzipit@2.0.0, license MIT */
var _a, _b;
function readBlobAsArrayBuffer(blob) {
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
async function readBlobAsUint8Array(blob) {
    const arrayBuffer = await readBlobAsArrayBuffer(blob);
    return new Uint8Array(arrayBuffer);
}
function isBlob(v) {
    return typeof Blob !== 'undefined' && v instanceof Blob;
}
const isNode = (typeof process !== 'undefined') &&
    !!(process === null || process === void 0 ? void 0 : process.versions) &&
    (typeof ((_a = process === null || process === void 0 ? void 0 : process.versions) === null || _a === void 0 ? void 0 : _a.node) !== 'undefined') &&
    (typeof ((_b = process === null || process === void 0 ? void 0 : process.versions) === null || _b === void 0 ? void 0 : _b.electron) === 'undefined');

/* global DecompressionStream */
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
async function decompressRaw(src) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(src).then(() => writer.close()).catch(() => { });
    const chunks = [];
    const reader = ds.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
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
async function inflate(req, postMessage) {
    const { id, src, type } = req;
    try {
        const srcData = isBlob(src)
            ? await readBlobAsUint8Array(src)
            : new Uint8Array(src);
        const dstData = await decompressRaw(srcData);
        const transferables = [];
        let data;
        if (type) {
            data = new Blob([dstData], { type });
        }
        else {
            data = dstData.buffer;
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
    import('worker_threads').then(({ parentPort }) => {
        parentPort.on('message', (msg) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleMessage(msg, (m, t) => parentPort.postMessage(m, t));
        });
    });
}
else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerSelf = self;
    workerSelf.addEventListener('message', (e) => {
        handleMessage(e.data, (m, t) => workerSelf.postMessage(m, t));
    });
    // needed for firefox AFAICT as there is no other
    // way to know a worker loaded successfully.
    workerSelf.postMessage('start');
}
