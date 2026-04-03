/* unzipit@2.0.1, license MIT */
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

class ArrayBufferReader {
    constructor(arrayBufferOrView) {
        this.typedArray = (arrayBufferOrView instanceof ArrayBuffer || isSharedArrayBuffer(arrayBufferOrView))
            ? new Uint8Array(arrayBufferOrView)
            : new Uint8Array(arrayBufferOrView.buffer, arrayBufferOrView.byteOffset, arrayBufferOrView.byteLength);
    }
    async getLength() {
        return this.typedArray.byteLength;
    }
    async read(offset, length) {
        // Cast is necessary: backing buffer may be SharedArrayBuffer (ArrayBufferLike),
        // but callers need Uint8Array<ArrayBuffer>. The data is read-only view so this is safe.
        return new Uint8Array(this.typedArray.buffer, this.typedArray.byteOffset + offset, length);
    }
}

class BlobReader {
    constructor(blob) {
        this.blob = blob;
    }
    async getLength() {
        return this.blob.size;
    }
    async read(offset, length) {
        const blob = this.blob.slice(offset, offset + length);
        const arrayBuffer = await readBlobAsArrayBuffer(blob);
        return new Uint8Array(arrayBuffer);
    }
    async sliceAsBlob(offset, length, type = '') {
        return this.blob.slice(offset, offset + length, type);
    }
}

/* global DecompressionStream */
const config$1 = {
    numWorkers: 1,
    workerURL: '',
    useWorkers: false,
};
let nextId = 0;
// Requests are put on a queue.
// We don't send the request to the worker until the worker
// is finished. This probably adds a small amount of latency
// but the issue is imagine you have 2 workers. You give worker
// A x seconds of work to do and worker B y seconds of work to
// do. You don't know which will finish first. If you give
// the worker with more work to do the request then you'll
// waste time.
// note: we can't check `workers.length` for deciding if
// we've reached `config.numWorkers` because creation the worker
// is async which means other requests to make workers might
// come in before a worker gets added to `workers`
let numWorkers = 0;
let canUseWorkers = true; // gets set to false if we can't start a worker
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const workers = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const availableWorkers = [];
const waitingForWorkerQueue = [];
const currentlyProcessingIdToRequestMap = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleResult(e) {
    makeWorkerAvailable(e.target);
    const { id, error, data } = e.data;
    const request = currentlyProcessingIdToRequestMap.get(id);
    currentlyProcessingIdToRequestMap.delete(id);
    if (error) {
        request.reject(error);
    }
    else {
        request.resolve(data);
    }
}
// Because Firefox uses non-standard onerror to signal an error.
function startWorker(url) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(url);
        worker.onmessage = (e) => {
            if (e.data === 'start') {
                worker.onerror = null;
                worker.onmessage = null;
                resolve(worker);
            }
            else {
                reject(new Error(`unexpected message: ${e.data}`));
            }
        };
        worker.onerror = reject;
    });
}
const workerHelper = (function () {
    if (isNode) {
        return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async createWorker(url) {
                const moduleId = 'node:worker_threads';
                const { Worker } = await import(moduleId);
                return new Worker(url);
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addEventListener(worker, fn) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                worker.on('message', (data) => {
                    fn({ target: worker, data });
                });
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async terminate(worker) {
                await worker.terminate();
            },
        };
    }
    else {
        return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async createWorker(url) {
                // I don't understand this security issue
                // Apparently there is some iframe setting or http header
                // that prevents cross domain workers. But, I can manually
                // download the text and do it. I reported this to Chrome
                // and they said it was fine so ¯\_(ツ)_/¯
                try {
                    const worker = await startWorker(url);
                    return worker;
                }
                catch (_e) {
                    console.warn('could not load worker:', url);
                }
                let text;
                try {
                    const req = await fetch(url, { mode: 'cors' });
                    if (!req.ok) {
                        throw new Error(`could not load: ${url}`);
                    }
                    text = await req.text();
                    url = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }));
                    const worker = await startWorker(url);
                    config$1.workerURL = url; // this is a hack. What's a better way to structure this code?
                    return worker;
                }
                catch (_e) {
                    console.warn('could not load worker via fetch:', url);
                }
                if (text !== undefined) {
                    try {
                        url = `data:application/javascript;base64,${btoa(text)}`;
                        const worker = await startWorker(url);
                        config$1.workerURL = url;
                        return worker;
                    }
                    catch (_e) {
                        console.warn('could not load worker via dataURI');
                    }
                }
                console.warn('workers will not be used');
                throw new Error('can not start workers');
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            addEventListener(worker, fn) {
                worker.addEventListener('message', fn);
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async terminate(worker) {
                worker.terminate();
            },
        };
    }
}());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeWorkerAvailable(worker) {
    availableWorkers.push(worker);
    processWaitingForWorkerQueue();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAvailableWorker() {
    if (availableWorkers.length === 0 && numWorkers < config$1.numWorkers) {
        ++numWorkers; // see comment at numWorkers declaration
        try {
            const worker = await workerHelper.createWorker(config$1.workerURL);
            workers.push(worker);
            availableWorkers.push(worker);
            workerHelper.addEventListener(worker, handleResult);
        }
        catch (_e) {
            // set this global out-of-band (needs refactor)
            canUseWorkers = false;
        }
    }
    return availableWorkers.pop();
}
async function decompressRaw(src) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    // Do not await the write — doing so before reading causes a deadlock when
    // the internal buffer fills due to backpressure.
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
// @param {Uint8Array} src
// @param {string} [type] mime-type
// @returns {ArrayBuffer|Blob} ArrayBuffer if type is falsy or Blob otherwise.
async function inflateRawLocal(src, type, resolve, reject) {
    try {
        const dst = await decompressRaw(src);
        resolve(type ? new Blob([dst], { type }) : dst.buffer);
    }
    catch (e) {
        reject(e);
    }
}
async function processWaitingForWorkerQueue() {
    if (waitingForWorkerQueue.length === 0) {
        return;
    }
    if (config$1.useWorkers && canUseWorkers) {
        const worker = await getAvailableWorker();
        // canUseWorkers might have been set out-of-band (need refactor)
        if (canUseWorkers) {
            if (worker) {
                if (waitingForWorkerQueue.length === 0) {
                    // the queue might be empty while we awaited for a worker.
                    makeWorkerAvailable(worker);
                    return;
                }
                const { id, src, uncompressedSize, type, resolve, reject } = waitingForWorkerQueue.shift();
                currentlyProcessingIdToRequestMap.set(id, { id, src, uncompressedSize, type, resolve, reject });
                const transferables = [];
                // NOTE: Originally I thought you could transfer an ArrayBuffer.
                // The code on this side is often using views into the entire file
                // which means if we transferred we'd lose the entire file. That sucks
                // because it means there's an expensive copy to send the uncompressed
                // data to the worker.
                //
                // Also originally I thought we could send a Blob but we'd need to refactor
                // the code in unzipit/readEntryData as currently it reads the uncompressed
                // bytes.
                //
                //if (!isBlob(src) && !isSharedArrayBuffer(src)) {
                //  transferables.push(src);
                //}
                worker.postMessage({
                    type: 'inflate',
                    data: {
                        id,
                        type,
                        src,
                        uncompressedSize,
                    },
                }, transferables);
            }
            return;
        }
    }
    // inflate locally
    // We loop here because what happens if many requests happen at once
    // the first N requests will try to async make a worker. Other requests
    // will then be on the queue. But if we fail to make workers then there
    // are pending requests.
    while (waitingForWorkerQueue.length) {
        const { src, type, resolve, reject } = waitingForWorkerQueue.shift();
        const data = isBlob(src) ? await readBlobAsUint8Array(src) : src;
        inflateRawLocal(data, type, resolve, reject);
    }
}
function setOptions$1(options) {
    config$1.workerURL = options.workerURL || config$1.workerURL;
    // there's no reason to set the workerURL if you're not going to use workers
    if (options.workerURL) {
        config$1.useWorkers = true;
    }
    config$1.useWorkers = options.useWorkers !== undefined ? options.useWorkers : config$1.useWorkers;
    config$1.numWorkers = options.numWorkers || config$1.numWorkers;
}
// It has to take non-zero time to put a large typed array in a Blob since the very
// next instruction you could change the contents of the array. So, if you're reading
// the zip file for images/video/audio then all you want is a Blob on which to get a URL.
// so that operation of putting the data in a Blob should happen in the worker.
//
// Conversely if you want the data itself then you want an ArrayBuffer immediately
// since the worker can transfer its ArrayBuffer zero copy.
//
// @param {Uint8Array|Blob} src
// @param {number} uncompressedSize
// @param {string} [type] falsy or mimeType string (eg: 'image/png')
// @returns {ArrayBuffer|Blob} ArrayBuffer if type is falsy or Blob otherwise.
function inflateRawAsync(src, uncompressedSize, type) {
    return new Promise((resolve, reject) => {
        // note: there is potential an expensive copy here. In order for the data
        // to make it into the worker we need to copy the data to the worker unless
        // it's a Blob or a SharedArrayBuffer.
        //
        // Solutions:
        //
        // 1. A minor enhancement, if `uncompressedSize` is small don't call the worker.
        //
        //    might be a win period as their is overhead calling the worker
        //
        // 2. Move the entire library to the worker
        //
        //    Good, Maybe faster if you pass a URL, Blob, or SharedArrayBuffer? Not sure about that
        //    as those are also easy to transfer. Still slow if you pass an ArrayBuffer
        //    as the ArrayBuffer has to be copied to the worker.
        //
        // I guess benchmarking is really the only thing to try.
        waitingForWorkerQueue.push({ src, uncompressedSize, type, resolve, reject, id: nextId++ });
        processWaitingForWorkerQueue();
    });
}

function dosDateTimeToDate(date, time) {
    const day = date & 0x1f; // 1-31
    const month = (date >> 5 & 0xf) - 1; // 1-12, 0-11
    const year = (date >> 9 & 0x7f) + 1980; // 0-128, 1980-2108
    const millisecond = 0;
    const second = (time & 0x1f) * 2; // 0-29, 0-58 (even numbers)
    const minute = time >> 5 & 0x3f; // 0-59
    const hour = time >> 11 & 0x1f; // 0-23
    return new Date(year, month, day, hour, minute, second, millisecond);
}
class ZipEntry {
    constructor(reader, rawEntry) {
        this._reader = reader;
        this._rawEntry = rawEntry;
        this.name = rawEntry.name;
        this.nameBytes = rawEntry.nameBytes;
        this.size = rawEntry.uncompressedSize;
        this.compressedSize = rawEntry.compressedSize;
        this.comment = rawEntry.comment;
        this.commentBytes = rawEntry.commentBytes;
        this.compressionMethod = rawEntry.compressionMethod;
        this.lastModDate = dosDateTimeToDate(rawEntry.lastModFileDate, rawEntry.lastModFileTime);
        this.isDirectory = rawEntry.uncompressedSize === 0 && rawEntry.name.endsWith('/');
        this.encrypted = !!(rawEntry.generalPurposeBitFlag & 0x1);
        this.externalFileAttributes = rawEntry.externalFileAttributes;
        this.versionMadeBy = rawEntry.versionMadeBy;
    }
    // returns a promise that returns a Blob for this entry
    async blob(type = 'application/octet-stream') {
        return await readEntryDataAsBlob(this._reader, this._rawEntry, type);
    }
    // returns a promise that returns an ArrayBuffer for this entry
    async arrayBuffer() {
        return await readEntryDataAsArrayBuffer(this._reader, this._rawEntry);
    }
    // returns text, assumes the text is valid utf8. If you want more options decode arrayBuffer yourself
    async text() {
        const buffer = await this.arrayBuffer();
        return decodeBuffer(new Uint8Array(buffer));
    }
    // returns text with JSON.parse called on it. If you want more options decode arrayBuffer yourself
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async json() {
        const text = await this.text();
        return JSON.parse(text);
    }
}
const EOCDR_WITHOUT_COMMENT_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff; // 2-byte size
const EOCDR_SIGNATURE = 0x06054b50;
const ZIP64_EOCDR_SIGNATURE = 0x06064b50;
async function readAs(reader, offset, length) {
    return await reader.read(offset, length);
}
// The point of this function is we want to be able to pass the data
// to a worker as fast as possible so when decompressing if the data
// is already a blob and we can get a blob then get a blob.
//
// I'm not sure what a better way to refactor this is. We've got examples
// of multiple readers. Ideally, for every type of reader we could ask
// it, "give me a type that is zero copy both locally and when sent to a worker".
//
// The problem is the worker would also have to know the how to handle this
// opaque type. I suppose the correct solution is to register different
// reader handlers in the worker so BlobReader would register some
// `handleZeroCopyType<BlobReader>`. At the moment I don't feel like
// refactoring. As it is you just pass in an instance of the reader
// but instead you'd have to register the reader and some how get the
// source for the `handleZeroCopyType` handler function into the worker.
// That sounds like a huge PITA, requiring you to put the implementation
// in a separate file so the worker can load it or some other workaround
// hack.
//
// For now this hack works even if it's not generic.
async function readAsBlobOrTypedArray(reader, offset, length, type) {
    if (reader.sliceAsBlob) {
        return await reader.sliceAsBlob(offset, length, type);
    }
    return await reader.read(offset, length);
}
const crc = {
    unsigned() {
        return 0;
    },
};
function getUint16LE(uint8View, offset) {
    return uint8View[offset] +
        uint8View[offset + 1] * 0x100;
}
function getUint32LE(uint8View, offset) {
    return uint8View[offset] +
        uint8View[offset + 1] * 0x100 +
        uint8View[offset + 2] * 0x10000 +
        uint8View[offset + 3] * 0x1000000;
}
function getUint64LE(uint8View, offset) {
    return getUint32LE(uint8View, offset) +
        getUint32LE(uint8View, offset + 4) * 0x100000000;
}
// const decodeCP437 = (function() {
//   const cp437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
//
//   return function(uint8view) {
//     return Array.from(uint8view).map(v => cp437[v]).join('');
//   };
// }());
const utf8Decoder = new TextDecoder();
function decodeBuffer(uint8View, _isUTF8) {
    if (isSharedArrayBuffer(uint8View.buffer)) {
        uint8View = new Uint8Array(uint8View);
    }
    return utf8Decoder.decode(uint8View);
    /*
    AFAICT the UTF8 flat is not set so it's 100% up to the user
    to self decode if their file is not utf8 filenames
    return isUTF8
        ? utf8Decoder.decode(uint8View)
        : decodeCP437(uint8View);
    */
}
async function findEndOfCentralDirector(reader, totalLength) {
    const size = Math.min(EOCDR_WITHOUT_COMMENT_SIZE + MAX_COMMENT_SIZE, totalLength);
    const readStart = totalLength - size;
    const data = await readAs(reader, readStart, size);
    for (let i = size - EOCDR_WITHOUT_COMMENT_SIZE; i >= 0; --i) {
        if (getUint32LE(data, i) !== EOCDR_SIGNATURE) {
            continue;
        }
        // 0 - End of central directory signature
        const eocdr = new Uint8Array(data.buffer, data.byteOffset + i, data.byteLength - i);
        // 4 - Number of this disk
        const diskNumber = getUint16LE(eocdr, 4);
        if (diskNumber !== 0) {
            throw new Error(`multi-volume zip files are not supported. This is volume: ${diskNumber}`);
        }
        // 6 - Disk where central directory starts
        // 8 - Number of central directory records on this disk
        // 10 - Total number of central directory records
        const entryCount = getUint16LE(eocdr, 10);
        // 12 - Size of central directory (bytes)
        const centralDirectorySize = getUint32LE(eocdr, 12);
        // 16 - Offset of start of central directory, relative to start of archive
        const centralDirectoryOffset = getUint32LE(eocdr, 16);
        // 20 - Comment length
        const commentLength = getUint16LE(eocdr, 20);
        const expectedCommentLength = eocdr.length - EOCDR_WITHOUT_COMMENT_SIZE;
        if (commentLength !== expectedCommentLength) {
            throw new Error(`invalid comment length. expected: ${expectedCommentLength}, actual: ${commentLength}`);
        }
        // 22 - Comment
        // the encoding is always cp437.
        const commentBytes = new Uint8Array(eocdr.buffer, eocdr.byteOffset + 22, commentLength);
        const comment = decodeBuffer(commentBytes);
        if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
            return await readZip64CentralDirectory(reader, readStart + i, comment, commentBytes);
        }
        else {
            return await readEntries(reader, centralDirectoryOffset, centralDirectorySize, entryCount, comment, commentBytes);
        }
    }
    throw new Error('could not find end of central directory. maybe not zip file');
}
const END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
async function readZip64CentralDirectory(reader, offset, comment, commentBytes) {
    // ZIP64 Zip64 end of central directory locator
    const zip64EocdlOffset = offset - 20;
    const eocdl = await readAs(reader, zip64EocdlOffset, 20);
    // 0 - zip64 end of central dir locator signature
    if (getUint32LE(eocdl, 0) !== END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
        throw new Error('invalid zip64 end of central directory locator signature');
    }
    // 4 - number of the disk with the start of the zip64 end of central directory
    // 8 - relative offset of the zip64 end of central directory record
    const zip64EocdrOffset = getUint64LE(eocdl, 8);
    // 16 - total number of disks
    // ZIP64 end of central directory record
    const zip64Eocdr = await readAs(reader, zip64EocdrOffset, 56);
    // 0 - zip64 end of central dir signature                           4 bytes  (0x06064b50)
    if (getUint32LE(zip64Eocdr, 0) !== ZIP64_EOCDR_SIGNATURE) {
        throw new Error('invalid zip64 end of central directory record signature');
    }
    // 4 - size of zip64 end of central directory record                8 bytes
    // 12 - version made by                                             2 bytes
    // 14 - version needed to extract                                   2 bytes
    // 16 - number of this disk                                         4 bytes
    // 20 - number of the disk with the start of the central directory  4 bytes
    // 24 - total number of entries in the central directory on this disk         8 bytes
    // 32 - total number of entries in the central directory            8 bytes
    const entryCount = getUint64LE(zip64Eocdr, 32);
    // 40 - size of the central directory                               8 bytes
    const centralDirectorySize = getUint64LE(zip64Eocdr, 40);
    // 48 - offset of start of central directory with respect to the starting disk number     8 bytes
    const centralDirectoryOffset = getUint64LE(zip64Eocdr, 48);
    // 56 - zip64 extensible data sector                                (variable size)
    return readEntries(reader, centralDirectoryOffset, centralDirectorySize, entryCount, comment, commentBytes);
}
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
async function readEntries(reader, centralDirectoryOffset, centralDirectorySize, rawEntryCount, comment, commentBytes) {
    let readEntryCursor = 0;
    const allEntriesBuffer = await readAs(reader, centralDirectoryOffset, centralDirectorySize);
    const rawEntries = [];
    for (let e = 0; e < rawEntryCount; ++e) {
        const buffer = allEntriesBuffer.subarray(readEntryCursor, readEntryCursor + 46);
        // 0 - Central directory file header signature
        const signature = getUint32LE(buffer, 0);
        if (signature !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
            throw new Error(`invalid central directory file header signature: 0x${signature.toString(16)}`);
        }
        const rawEntry = {
            // 4 - Version made by
            versionMadeBy: getUint16LE(buffer, 4),
            // 6 - Version needed to extract (minimum)
            versionNeededToExtract: getUint16LE(buffer, 6),
            // 8 - General purpose bit flag
            generalPurposeBitFlag: getUint16LE(buffer, 8),
            // 10 - Compression method
            compressionMethod: getUint16LE(buffer, 10),
            // 12 - File last modification time
            lastModFileTime: getUint16LE(buffer, 12),
            // 14 - File last modification date
            lastModFileDate: getUint16LE(buffer, 14),
            // 16 - CRC-32
            crc32: getUint32LE(buffer, 16),
            // 20 - Compressed size
            compressedSize: getUint32LE(buffer, 20),
            // 24 - Uncompressed size
            uncompressedSize: getUint32LE(buffer, 24),
            // 28 - File name length (n)
            fileNameLength: getUint16LE(buffer, 28),
            // 30 - Extra field length (m)
            extraFieldLength: getUint16LE(buffer, 30),
            // 32 - File comment length (k)
            fileCommentLength: getUint16LE(buffer, 32),
            // 34 - Disk number where file starts
            // 36 - Internal file attributes
            internalFileAttributes: getUint16LE(buffer, 36),
            // 38 - External file attributes
            externalFileAttributes: getUint32LE(buffer, 38),
            // 42 - Relative offset of local file header
            relativeOffsetOfLocalHeader: getUint32LE(buffer, 42),
        };
        if (rawEntry.generalPurposeBitFlag & 0x40) {
            throw new Error('strong encryption is not supported');
        }
        readEntryCursor += 46;
        const data = allEntriesBuffer.subarray(readEntryCursor, readEntryCursor + rawEntry.fileNameLength + rawEntry.extraFieldLength + rawEntry.fileCommentLength);
        // 46 - File name
        (rawEntry.generalPurposeBitFlag & 0x800) !== 0;
        rawEntry.nameBytes = data.slice(0, rawEntry.fileNameLength);
        rawEntry.name = decodeBuffer(rawEntry.nameBytes);
        // 46+n - Extra field
        const fileCommentStart = rawEntry.fileNameLength + rawEntry.extraFieldLength;
        const extraFieldBuffer = data.slice(rawEntry.fileNameLength, fileCommentStart);
        rawEntry.extraFields = [];
        let i = 0;
        while (i < extraFieldBuffer.length - 3) {
            const headerId = getUint16LE(extraFieldBuffer, i + 0);
            const dataSize = getUint16LE(extraFieldBuffer, i + 2);
            const dataStart = i + 4;
            const dataEnd = dataStart + dataSize;
            if (dataEnd > extraFieldBuffer.length) {
                throw new Error('extra field length exceeds extra field buffer size');
            }
            rawEntry.extraFields.push({
                id: headerId,
                data: extraFieldBuffer.slice(dataStart, dataEnd),
            });
            i = dataEnd;
        }
        // 46+n+m - File comment
        rawEntry.commentBytes = data.slice(fileCommentStart, fileCommentStart + rawEntry.fileCommentLength);
        rawEntry.comment = decodeBuffer(rawEntry.commentBytes);
        readEntryCursor += data.length;
        if (rawEntry.uncompressedSize === 0xffffffff ||
            rawEntry.compressedSize === 0xffffffff ||
            rawEntry.relativeOffsetOfLocalHeader === 0xffffffff) {
            // ZIP64 format
            // find the Zip64 Extended Information Extra Field
            const zip64ExtraField = rawEntry.extraFields.find(e => e.id === 0x0001);
            if (!zip64ExtraField) {
                throw new Error('expected zip64 extended information extra field');
            }
            const zip64EiefBuffer = zip64ExtraField.data;
            let index = 0;
            // 0 - Original Size          8 bytes
            if (rawEntry.uncompressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                    throw new Error('zip64 extended information extra field does not include uncompressed size');
                }
                rawEntry.uncompressedSize = getUint64LE(zip64EiefBuffer, index);
                index += 8;
            }
            // 8 - Compressed Size        8 bytes
            if (rawEntry.compressedSize === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                    throw new Error('zip64 extended information extra field does not include compressed size');
                }
                rawEntry.compressedSize = getUint64LE(zip64EiefBuffer, index);
                index += 8;
            }
            // 16 - Relative Header Offset 8 bytes
            if (rawEntry.relativeOffsetOfLocalHeader === 0xffffffff) {
                if (index + 8 > zip64EiefBuffer.length) {
                    throw new Error('zip64 extended information extra field does not include relative header offset');
                }
                rawEntry.relativeOffsetOfLocalHeader = getUint64LE(zip64EiefBuffer, index);
                index += 8;
            }
            // 24 - Disk Start Number      4 bytes
        }
        // check for Info-ZIP Unicode Path Extra Field (0x7075)
        // see https://github.com/thejoshwolfe/yauzl/issues/33
        const nameField = rawEntry.extraFields.find(e => e.id === 0x7075 &&
            e.data.length >= 6 && // too short to be meaningful
            e.data[0] === 1 && // Version       1 byte      version of this extra field, currently 1
            getUint32LE(e.data, 1), crc.unsigned()); // NameCRC32     4 bytes     File Name Field CRC32 Checksum
        // > If the CRC check fails, this UTF-8 Path Extra Field should be
        // > ignored and the File Name field in the header should be used instead.
        if (nameField) {
            // UnicodeName Variable UTF-8 version of the entry File Name
            rawEntry.fileName = decodeBuffer(nameField.data.slice(5));
        }
        // validate file size
        if (rawEntry.compressionMethod === 0) {
            let expectedCompressedSize = rawEntry.uncompressedSize;
            if ((rawEntry.generalPurposeBitFlag & 0x1) !== 0) {
                // traditional encryption prefixes the file data with a header
                expectedCompressedSize += 12;
            }
            if (rawEntry.compressedSize !== expectedCompressedSize) {
                throw new Error(`compressed size mismatch for stored file: ${rawEntry.compressedSize} != ${expectedCompressedSize}`);
            }
        }
        rawEntries.push(rawEntry);
    }
    const zip = {
        comment,
        commentBytes,
    };
    return {
        zip,
        entries: rawEntries.map(e => new ZipEntry(reader, e)),
    };
}
async function readEntryDataHeader(reader, rawEntry) {
    if (rawEntry.generalPurposeBitFlag & 0x1) {
        throw new Error('encrypted entries not supported');
    }
    const buffer = await readAs(reader, rawEntry.relativeOffsetOfLocalHeader, 30);
    // note: maybe this should be passed in or cached on entry
    // as it's async so there will be at least one tick (not sure about that)
    const totalLength = await reader.getLength();
    // 0 - Local file header signature = 0x04034b50
    const signature = getUint32LE(buffer, 0);
    if (signature !== 0x04034b50) {
        throw new Error(`invalid local file header signature: 0x${signature.toString(16)}`);
    }
    // all this should be redundant
    // 4 - Version needed to extract (minimum)
    // 6 - General purpose bit flag
    // 8 - Compression method
    // 10 - File last modification time
    // 12 - File last modification date
    // 14 - CRC-32
    // 18 - Compressed size
    // 22 - Uncompressed size
    // 26 - File name length (n)
    const fileNameLength = getUint16LE(buffer, 26);
    // 28 - Extra field length (m)
    const extraFieldLength = getUint16LE(buffer, 28);
    // 30 - File name
    // 30+n - Extra field
    const localFileHeaderEnd = rawEntry.relativeOffsetOfLocalHeader + buffer.length + fileNameLength + extraFieldLength;
    let decompress;
    if (rawEntry.compressionMethod === 0) {
        // 0 - The file is stored (no compression)
        decompress = false;
    }
    else if (rawEntry.compressionMethod === 8) {
        // 8 - The file is Deflated
        decompress = true;
    }
    else {
        throw new Error(`unsupported compression method: ${rawEntry.compressionMethod}`);
    }
    const fileDataStart = localFileHeaderEnd;
    const fileDataEnd = fileDataStart + rawEntry.compressedSize;
    if (rawEntry.compressedSize !== 0) {
        // bounds check now, because the read streams will probably not complain loud enough.
        // since we're dealing with an unsigned offset plus an unsigned size,
        // we only have 1 thing to check for.
        if (fileDataEnd > totalLength) {
            throw new Error(`file data overflows file bounds: ${fileDataStart} +  ${rawEntry.compressedSize}  > ${totalLength}`);
        }
    }
    return {
        decompress,
        fileDataStart,
    };
}
async function readEntryDataAsArrayBuffer(reader, rawEntry) {
    const { decompress, fileDataStart } = await readEntryDataHeader(reader, rawEntry);
    if (!decompress) {
        const dataView = await readAs(reader, fileDataStart, rawEntry.compressedSize);
        // make copy?
        //
        // 1. The source is a Blob/file. In this case we'll get back TypedArray we can just hand to the user
        // 2. The source is a TypedArray. In this case we'll get back TypedArray that is a view into a larger buffer
        //    but because ultimately this is used to return an ArrayBuffer to `someEntry.arrayBuffer()`
        //    we need to return copy since we need the `ArrayBuffer`, not the TypedArray to exactly match the data.
        //    Note: We could add another API function `bytes()` or something that returned a `Uint8Array`
        //    instead of an `ArrayBuffer`. This would let us skip a copy here. But this case only happens for uncompressed
        //    data. That seems like a rare enough case that adding a new API is not worth it? Or is it? A zip of jpegs or mp3s
        //    might not be compressed. For now that's a TBD.
        return isTypedArraySameAsArrayBuffer(dataView) ? dataView.buffer : dataView.slice().buffer;
    }
    // see comment in readEntryDateAsBlob
    const typedArrayOrBlob = await readAsBlobOrTypedArray(reader, fileDataStart, rawEntry.compressedSize);
    const result = await inflateRawAsync(typedArrayOrBlob instanceof Uint8Array ? typedArrayOrBlob : typedArrayOrBlob, rawEntry.uncompressedSize);
    return result;
}
async function readEntryDataAsBlob(reader, rawEntry, type) {
    const { decompress, fileDataStart } = await readEntryDataHeader(reader, rawEntry);
    if (!decompress) {
        const typedArrayOrBlob = await readAsBlobOrTypedArray(reader, fileDataStart, rawEntry.compressedSize, type);
        if (isBlob(typedArrayOrBlob)) {
            return typedArrayOrBlob;
        }
        return new Blob([typedArrayOrBlob], { type });
    }
    // Here's the issue with this mess (should refactor?)
    // if the source is a blob then we really want to pass a blob to inflateRawAsync to avoid a large
    // copy if we're going to a worker.
    const typedArrayOrBlob = await readAsBlobOrTypedArray(reader, fileDataStart, rawEntry.compressedSize);
    const result = await inflateRawAsync(typedArrayOrBlob instanceof Uint8Array ? typedArrayOrBlob : typedArrayOrBlob, rawEntry.uncompressedSize, type);
    return result;
}
function setOptions(options) {
    setOptions$1(options);
}
async function unzipRaw(source) {
    let reader;
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
        reader = new BlobReader(source);
    }
    else if (source instanceof ArrayBuffer || (source.buffer && source.buffer instanceof ArrayBuffer)) {
        reader = new ArrayBufferReader(source);
    }
    else if (isSharedArrayBuffer(source) || isSharedArrayBuffer(source.buffer)) {
        reader = new ArrayBufferReader(source);
    }
    else {
        const req = await fetch(source);
        if (!req.ok) {
            throw new Error(`failed http request ${source}, status: ${req.status}: ${req.statusText}`);
        }
        const blob = await req.blob();
        reader = new BlobReader(blob);
    }
    const totalLength = await reader.getLength();
    if (totalLength > Number.MAX_SAFE_INTEGER) {
        throw new Error(`file too large. size: ${totalLength}. Only file sizes up 4503599627370496 bytes are supported`);
    }
    return await findEndOfCentralDirector(reader, totalLength);
}
// If the names are not utf8 you should use unzipitRaw
async function unzip(source) {
    const { zip, entries } = await unzipRaw(source);
    return {
        zip,
        entries: Object.fromEntries(entries.map(v => [v.name, v])),
    };
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// lib/chai/utils/index.js
var utils_exports = {};
__export(utils_exports, {
  addChainableMethod: () => addChainableMethod,
  addLengthGuard: () => addLengthGuard,
  addMethod: () => addMethod,
  addProperty: () => addProperty,
  checkError: () => check_error_exports,
  compareByInspect: () => compareByInspect,
  eql: () => deep_eql_default,
  events: () => events,
  expectTypes: () => expectTypes,
  flag: () => flag,
  getActual: () => getActual,
  getMessage: () => getMessage2,
  getName: () => getName,
  getOperator: () => getOperator,
  getOwnEnumerableProperties: () => getOwnEnumerableProperties,
  getOwnEnumerablePropertySymbols: () => getOwnEnumerablePropertySymbols,
  getPathInfo: () => getPathInfo,
  hasProperty: () => hasProperty,
  inspect: () => inspect2,
  isNaN: () => isNaN2,
  isNumeric: () => isNumeric,
  isProxyEnabled: () => isProxyEnabled,
  isRegExp: () => isRegExp2,
  objDisplay: () => objDisplay,
  overwriteChainableMethod: () => overwriteChainableMethod,
  overwriteMethod: () => overwriteMethod,
  overwriteProperty: () => overwriteProperty,
  proxify: () => proxify,
  test: () => test,
  transferFlags: () => transferFlags,
  type: () => type
});

// node_modules/check-error/index.js
var check_error_exports = {};
__export(check_error_exports, {
  compatibleConstructor: () => compatibleConstructor,
  compatibleInstance: () => compatibleInstance,
  compatibleMessage: () => compatibleMessage,
  getConstructorName: () => getConstructorName,
  getMessage: () => getMessage
});
function isErrorInstance(obj) {
  return obj instanceof Error || Object.prototype.toString.call(obj) === "[object Error]";
}
__name(isErrorInstance, "isErrorInstance");
function isRegExp(obj) {
  return Object.prototype.toString.call(obj) === "[object RegExp]";
}
__name(isRegExp, "isRegExp");
function compatibleInstance(thrown, errorLike) {
  return isErrorInstance(errorLike) && thrown === errorLike;
}
__name(compatibleInstance, "compatibleInstance");
function compatibleConstructor(thrown, errorLike) {
  if (isErrorInstance(errorLike)) {
    return thrown.constructor === errorLike.constructor || thrown instanceof errorLike.constructor;
  } else if ((typeof errorLike === "object" || typeof errorLike === "function") && errorLike.prototype) {
    return thrown.constructor === errorLike || thrown instanceof errorLike;
  }
  return false;
}
__name(compatibleConstructor, "compatibleConstructor");
function compatibleMessage(thrown, errMatcher) {
  const comparisonString = typeof thrown === "string" ? thrown : thrown.message;
  if (isRegExp(errMatcher)) {
    return errMatcher.test(comparisonString);
  } else if (typeof errMatcher === "string") {
    return comparisonString.indexOf(errMatcher) !== -1;
  }
  return false;
}
__name(compatibleMessage, "compatibleMessage");
function getConstructorName(errorLike) {
  let constructorName = errorLike;
  if (isErrorInstance(errorLike)) {
    constructorName = errorLike.constructor.name;
  } else if (typeof errorLike === "function") {
    constructorName = errorLike.name;
    if (constructorName === "") {
      const newConstructorName = new errorLike().name;
      constructorName = newConstructorName || constructorName;
    }
  }
  return constructorName;
}
__name(getConstructorName, "getConstructorName");
function getMessage(errorLike) {
  let msg = "";
  if (errorLike && errorLike.message) {
    msg = errorLike.message;
  } else if (typeof errorLike === "string") {
    msg = errorLike;
  }
  return msg;
}
__name(getMessage, "getMessage");

// lib/chai/utils/flag.js
function flag(obj, key, value) {
  let flags = obj.__flags || (obj.__flags = /* @__PURE__ */ Object.create(null));
  if (arguments.length === 3) {
    flags[key] = value;
  } else {
    return flags[key];
  }
}
__name(flag, "flag");

// lib/chai/utils/test.js
function test(obj, args) {
  let negate = flag(obj, "negate"), expr = args[0];
  return negate ? !expr : expr;
}
__name(test, "test");

// lib/chai/utils/type-detect.js
function type(obj) {
  if (typeof obj === "undefined") {
    return "undefined";
  }
  if (obj === null) {
    return "null";
  }
  const stringTag = obj[Symbol.toStringTag];
  if (typeof stringTag === "string") {
    return stringTag;
  }
  const type3 = Object.prototype.toString.call(obj).slice(8, -1);
  return type3;
}
__name(type, "type");

// node_modules/assertion-error/index.js
var canElideFrames = "captureStackTrace" in Error;
var _AssertionError = class _AssertionError extends Error {
  constructor(message = "Unspecified AssertionError", props, ssf) {
    super(message);
    __publicField(this, "message");
    this.message = message;
    if (canElideFrames) {
      Error.captureStackTrace(this, ssf || _AssertionError);
    }
    for (const key in props) {
      if (!(key in this)) {
        this[key] = props[key];
      }
    }
  }
  get name() {
    return "AssertionError";
  }
  get ok() {
    return false;
  }
  toJSON(stack) {
    return {
      ...this,
      name: this.name,
      message: this.message,
      ok: false,
      stack: stack !== false ? this.stack : void 0
    };
  }
};
__name(_AssertionError, "AssertionError");
var AssertionError = _AssertionError;

// lib/chai/utils/expectTypes.js
function expectTypes(obj, types) {
  let flagMsg = flag(obj, "message");
  let ssfi = flag(obj, "ssfi");
  flagMsg = flagMsg ? flagMsg + ": " : "";
  obj = flag(obj, "object");
  types = types.map(function(t) {
    return t.toLowerCase();
  });
  types.sort();
  let str = types.map(function(t, index) {
    let art = ~["a", "e", "i", "o", "u"].indexOf(t.charAt(0)) ? "an" : "a";
    let or = types.length > 1 && index === types.length - 1 ? "or " : "";
    return or + art + " " + t;
  }).join(", ");
  let objType = type(obj).toLowerCase();
  if (!types.some(function(expected) {
    return objType === expected;
  })) {
    throw new AssertionError(
      flagMsg + "object tested must be " + str + ", but " + objType + " given",
      void 0,
      ssfi
    );
  }
}
__name(expectTypes, "expectTypes");

// lib/chai/utils/getActual.js
function getActual(obj, args) {
  return args.length > 4 ? args[4] : obj._obj;
}
__name(getActual, "getActual");

// node_modules/loupe/lib/helpers.js
var ansiColors = {
  bold: ["1", "22"],
  dim: ["2", "22"],
  italic: ["3", "23"],
  underline: ["4", "24"],
  // 5 & 6 are blinking
  inverse: ["7", "27"],
  hidden: ["8", "28"],
  strike: ["9", "29"],
  // 10-20 are fonts
  // 21-29 are resets for 1-9
  black: ["30", "39"],
  red: ["31", "39"],
  green: ["32", "39"],
  yellow: ["33", "39"],
  blue: ["34", "39"],
  magenta: ["35", "39"],
  cyan: ["36", "39"],
  white: ["37", "39"],
  brightblack: ["30;1", "39"],
  brightred: ["31;1", "39"],
  brightgreen: ["32;1", "39"],
  brightyellow: ["33;1", "39"],
  brightblue: ["34;1", "39"],
  brightmagenta: ["35;1", "39"],
  brightcyan: ["36;1", "39"],
  brightwhite: ["37;1", "39"],
  grey: ["90", "39"]
};
var styles = {
  special: "cyan",
  number: "yellow",
  bigint: "yellow",
  boolean: "yellow",
  undefined: "grey",
  null: "bold",
  string: "green",
  symbol: "green",
  date: "magenta",
  regexp: "red"
};
var truncator = "\u2026";
function colorise(value, styleType) {
  const color = ansiColors[styles[styleType]] || ansiColors[styleType] || "";
  if (!color) {
    return String(value);
  }
  return `\x1B[${color[0]}m${String(value)}\x1B[${color[1]}m`;
}
__name(colorise, "colorise");
function normaliseOptions({
  showHidden = false,
  depth = 2,
  colors = false,
  customInspect = true,
  showProxy = false,
  maxArrayLength = Infinity,
  breakLength = Infinity,
  seen = [],
  // eslint-disable-next-line no-shadow
  truncate: truncate2 = Infinity,
  stylize = String
} = {}, inspect3) {
  const options = {
    showHidden: Boolean(showHidden),
    depth: Number(depth),
    colors: Boolean(colors),
    customInspect: Boolean(customInspect),
    showProxy: Boolean(showProxy),
    maxArrayLength: Number(maxArrayLength),
    breakLength: Number(breakLength),
    truncate: Number(truncate2),
    seen,
    inspect: inspect3,
    stylize
  };
  if (options.colors) {
    options.stylize = colorise;
  }
  return options;
}
__name(normaliseOptions, "normaliseOptions");
function isHighSurrogate(char) {
  return char >= "\uD800" && char <= "\uDBFF";
}
__name(isHighSurrogate, "isHighSurrogate");
function truncate(string, length, tail = truncator) {
  string = String(string);
  const tailLength = tail.length;
  const stringLength = string.length;
  if (tailLength > length && stringLength > tailLength) {
    return tail;
  }
  if (stringLength > length && stringLength > tailLength) {
    let end = length - tailLength;
    if (end > 0 && isHighSurrogate(string[end - 1])) {
      end = end - 1;
    }
    return `${string.slice(0, end)}${tail}`;
  }
  return string;
}
__name(truncate, "truncate");
function inspectList(list, options, inspectItem, separator = ", ") {
  inspectItem = inspectItem || options.inspect;
  const size = list.length;
  if (size === 0)
    return "";
  const originalLength = options.truncate;
  let output = "";
  let peek = "";
  let truncated = "";
  for (let i = 0; i < size; i += 1) {
    const last = i + 1 === list.length;
    const secondToLast = i + 2 === list.length;
    truncated = `${truncator}(${list.length - i})`;
    const value = list[i];
    options.truncate = originalLength - output.length - (last ? 0 : separator.length);
    const string = peek || inspectItem(value, options) + (last ? "" : separator);
    const nextLength = output.length + string.length;
    const truncatedLength = nextLength + truncated.length;
    if (last && nextLength > originalLength && output.length + truncated.length <= originalLength) {
      break;
    }
    if (!last && !secondToLast && truncatedLength > originalLength) {
      break;
    }
    peek = last ? "" : inspectItem(list[i + 1], options) + (secondToLast ? "" : separator);
    if (!last && secondToLast && truncatedLength > originalLength && nextLength + peek.length > originalLength) {
      break;
    }
    output += string;
    if (!last && !secondToLast && nextLength + peek.length >= originalLength) {
      truncated = `${truncator}(${list.length - i - 1})`;
      break;
    }
    truncated = "";
  }
  return `${output}${truncated}`;
}
__name(inspectList, "inspectList");
function quoteComplexKey(key) {
  if (key.match(/^[a-zA-Z_][a-zA-Z_0-9]*$/)) {
    return key;
  }
  return JSON.stringify(key).replace(/'/g, "\\'").replace(/\\"/g, '"').replace(/(^"|"$)/g, "'");
}
__name(quoteComplexKey, "quoteComplexKey");
function inspectProperty([key, value], options) {
  options.truncate -= 2;
  if (typeof key === "string") {
    key = quoteComplexKey(key);
  } else if (typeof key !== "number") {
    key = `[${options.inspect(key, options)}]`;
  }
  options.truncate -= key.length;
  value = options.inspect(value, options);
  return `${key}: ${value}`;
}
__name(inspectProperty, "inspectProperty");

// node_modules/loupe/lib/array.js
function inspectArray(array, options) {
  const nonIndexProperties = Object.keys(array).slice(array.length);
  if (!array.length && !nonIndexProperties.length)
    return "[]";
  options.truncate -= 4;
  const listContents = inspectList(array, options);
  options.truncate -= listContents.length;
  let propertyContents = "";
  if (nonIndexProperties.length) {
    propertyContents = inspectList(nonIndexProperties.map((key) => [key, array[key]]), options, inspectProperty);
  }
  return `[ ${listContents}${propertyContents ? `, ${propertyContents}` : ""} ]`;
}
__name(inspectArray, "inspectArray");

// node_modules/loupe/lib/typedarray.js
var getArrayName = /* @__PURE__ */ __name((array) => {
  if (typeof Buffer === "function" && array instanceof Buffer) {
    return "Buffer";
  }
  if (array[Symbol.toStringTag]) {
    return array[Symbol.toStringTag];
  }
  return array.constructor.name;
}, "getArrayName");
function inspectTypedArray(array, options) {
  const name = getArrayName(array);
  options.truncate -= name.length + 4;
  const nonIndexProperties = Object.keys(array).slice(array.length);
  if (!array.length && !nonIndexProperties.length)
    return `${name}[]`;
  let output = "";
  for (let i = 0; i < array.length; i++) {
    const string = `${options.stylize(truncate(array[i], options.truncate), "number")}${i === array.length - 1 ? "" : ", "}`;
    options.truncate -= string.length;
    if (array[i] !== array.length && options.truncate <= 3) {
      output += `${truncator}(${array.length - array[i] + 1})`;
      break;
    }
    output += string;
  }
  let propertyContents = "";
  if (nonIndexProperties.length) {
    propertyContents = inspectList(nonIndexProperties.map((key) => [key, array[key]]), options, inspectProperty);
  }
  return `${name}[ ${output}${propertyContents ? `, ${propertyContents}` : ""} ]`;
}
__name(inspectTypedArray, "inspectTypedArray");

// node_modules/loupe/lib/date.js
function inspectDate(dateObject, options) {
  const stringRepresentation = dateObject.toJSON();
  if (stringRepresentation === null) {
    return "Invalid Date";
  }
  const split = stringRepresentation.split("T");
  const date = split[0];
  return options.stylize(`${date}T${truncate(split[1], options.truncate - date.length - 1)}`, "date");
}
__name(inspectDate, "inspectDate");

// node_modules/loupe/lib/function.js
function inspectFunction(func, options) {
  const functionType = func[Symbol.toStringTag] || "Function";
  const name = func.name;
  if (!name) {
    return options.stylize(`[${functionType}]`, "special");
  }
  return options.stylize(`[${functionType} ${truncate(name, options.truncate - 11)}]`, "special");
}
__name(inspectFunction, "inspectFunction");

// node_modules/loupe/lib/map.js
function inspectMapEntry([key, value], options) {
  options.truncate -= 4;
  key = options.inspect(key, options);
  options.truncate -= key.length;
  value = options.inspect(value, options);
  return `${key} => ${value}`;
}
__name(inspectMapEntry, "inspectMapEntry");
function mapToEntries(map) {
  const entries = [];
  map.forEach((value, key) => {
    entries.push([key, value]);
  });
  return entries;
}
__name(mapToEntries, "mapToEntries");
function inspectMap(map, options) {
  if (map.size === 0)
    return "Map{}";
  options.truncate -= 7;
  return `Map{ ${inspectList(mapToEntries(map), options, inspectMapEntry)} }`;
}
__name(inspectMap, "inspectMap");

// node_modules/loupe/lib/number.js
var isNaN = Number.isNaN || ((i) => i !== i);
function inspectNumber(number, options) {
  if (isNaN(number)) {
    return options.stylize("NaN", "number");
  }
  if (number === Infinity) {
    return options.stylize("Infinity", "number");
  }
  if (number === -Infinity) {
    return options.stylize("-Infinity", "number");
  }
  if (number === 0) {
    return options.stylize(1 / number === Infinity ? "+0" : "-0", "number");
  }
  return options.stylize(truncate(String(number), options.truncate), "number");
}
__name(inspectNumber, "inspectNumber");

// node_modules/loupe/lib/bigint.js
function inspectBigInt(number, options) {
  let nums = truncate(number.toString(), options.truncate - 1);
  if (nums !== truncator)
    nums += "n";
  return options.stylize(nums, "bigint");
}
__name(inspectBigInt, "inspectBigInt");

// node_modules/loupe/lib/regexp.js
function inspectRegExp(value, options) {
  const flags = value.toString().split("/")[2];
  const sourceLength = options.truncate - (2 + flags.length);
  const source = value.source;
  return options.stylize(`/${truncate(source, sourceLength)}/${flags}`, "regexp");
}
__name(inspectRegExp, "inspectRegExp");

// node_modules/loupe/lib/set.js
function arrayFromSet(set2) {
  const values = [];
  set2.forEach((value) => {
    values.push(value);
  });
  return values;
}
__name(arrayFromSet, "arrayFromSet");
function inspectSet(set2, options) {
  if (set2.size === 0)
    return "Set{}";
  options.truncate -= 7;
  return `Set{ ${inspectList(arrayFromSet(set2), options)} }`;
}
__name(inspectSet, "inspectSet");

// node_modules/loupe/lib/string.js
var stringEscapeChars = new RegExp("['\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u0600-\\u0604\\u070f\\u17b4\\u17b5\\u200c-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff\\ufff0-\\uffff]", "g");
var escapeCharacters = {
  "\b": "\\b",
  "	": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
  "'": "\\'",
  "\\": "\\\\"
};
var hex = 16;
function escape(char) {
  return escapeCharacters[char] || `\\u${`0000${char.charCodeAt(0).toString(hex)}`.slice(-4)}`;
}
__name(escape, "escape");
function inspectString(string, options) {
  if (stringEscapeChars.test(string)) {
    string = string.replace(stringEscapeChars, escape);
  }
  return options.stylize(`'${truncate(string, options.truncate - 2)}'`, "string");
}
__name(inspectString, "inspectString");

// node_modules/loupe/lib/symbol.js
function inspectSymbol(value) {
  if ("description" in Symbol.prototype) {
    return value.description ? `Symbol(${value.description})` : "Symbol()";
  }
  return value.toString();
}
__name(inspectSymbol, "inspectSymbol");

// node_modules/loupe/lib/promise.js
var getPromiseValue = /* @__PURE__ */ __name(() => "Promise{\u2026}", "getPromiseValue");
var promise_default = getPromiseValue;

// node_modules/loupe/lib/object.js
function inspectObject(object, options) {
  const properties = Object.getOwnPropertyNames(object);
  const symbols = Object.getOwnPropertySymbols ? Object.getOwnPropertySymbols(object) : [];
  if (properties.length === 0 && symbols.length === 0) {
    return "{}";
  }
  options.truncate -= 4;
  options.seen = options.seen || [];
  if (options.seen.includes(object)) {
    return "[Circular]";
  }
  options.seen.push(object);
  const propertyContents = inspectList(properties.map((key) => [key, object[key]]), options, inspectProperty);
  const symbolContents = inspectList(symbols.map((key) => [key, object[key]]), options, inspectProperty);
  options.seen.pop();
  let sep = "";
  if (propertyContents && symbolContents) {
    sep = ", ";
  }
  return `{ ${propertyContents}${sep}${symbolContents} }`;
}
__name(inspectObject, "inspectObject");

// node_modules/loupe/lib/class.js
var toStringTag = typeof Symbol !== "undefined" && Symbol.toStringTag ? Symbol.toStringTag : false;
function inspectClass(value, options) {
  let name = "";
  if (toStringTag && toStringTag in value) {
    name = value[toStringTag];
  }
  name = name || value.constructor.name;
  if (!name || name === "_class") {
    name = "<Anonymous Class>";
  }
  options.truncate -= name.length;
  return `${name}${inspectObject(value, options)}`;
}
__name(inspectClass, "inspectClass");

// node_modules/loupe/lib/arguments.js
function inspectArguments(args, options) {
  if (args.length === 0)
    return "Arguments[]";
  options.truncate -= 13;
  return `Arguments[ ${inspectList(args, options)} ]`;
}
__name(inspectArguments, "inspectArguments");

// node_modules/loupe/lib/error.js
var errorKeys = [
  "stack",
  "line",
  "column",
  "name",
  "message",
  "fileName",
  "lineNumber",
  "columnNumber",
  "number",
  "description",
  "cause"
];
function inspectObject2(error, options) {
  const properties = Object.getOwnPropertyNames(error).filter((key) => errorKeys.indexOf(key) === -1);
  const name = error.name;
  options.truncate -= name.length;
  let message = "";
  if (typeof error.message === "string") {
    message = truncate(error.message, options.truncate);
  } else {
    properties.unshift("message");
  }
  message = message ? `: ${message}` : "";
  options.truncate -= message.length + 5;
  options.seen = options.seen || [];
  if (options.seen.includes(error)) {
    return "[Circular]";
  }
  options.seen.push(error);
  const propertyContents = inspectList(properties.map((key) => [key, error[key]]), options, inspectProperty);
  return `${name}${message}${propertyContents ? ` { ${propertyContents} }` : ""}`;
}
__name(inspectObject2, "inspectObject");

// node_modules/loupe/lib/html.js
function inspectAttribute([key, value], options) {
  options.truncate -= 3;
  if (!value) {
    return `${options.stylize(String(key), "yellow")}`;
  }
  return `${options.stylize(String(key), "yellow")}=${options.stylize(`"${value}"`, "string")}`;
}
__name(inspectAttribute, "inspectAttribute");
function inspectNodeCollection(collection, options) {
  return inspectList(collection, options, inspectNode, "\n");
}
__name(inspectNodeCollection, "inspectNodeCollection");
function inspectNode(node, options) {
  switch (node.nodeType) {
    case 1:
      return inspectHTML(node, options);
    case 3:
      return options.inspect(node.data, options);
    default:
      return options.inspect(node, options);
  }
}
__name(inspectNode, "inspectNode");
function inspectHTML(element, options) {
  const properties = element.getAttributeNames();
  const name = element.tagName.toLowerCase();
  const head = options.stylize(`<${name}`, "special");
  const headClose = options.stylize(`>`, "special");
  const tail = options.stylize(`</${name}>`, "special");
  options.truncate -= name.length * 2 + 5;
  let propertyContents = "";
  if (properties.length > 0) {
    propertyContents += " ";
    propertyContents += inspectList(properties.map((key) => [key, element.getAttribute(key)]), options, inspectAttribute, " ");
  }
  options.truncate -= propertyContents.length;
  const truncate2 = options.truncate;
  let children = inspectNodeCollection(element.children, options);
  if (children && children.length > truncate2) {
    children = `${truncator}(${element.children.length})`;
  }
  return `${head}${propertyContents}${headClose}${children}${tail}`;
}
__name(inspectHTML, "inspectHTML");

// node_modules/loupe/lib/index.js
var symbolsSupported = typeof Symbol === "function" && typeof Symbol.for === "function";
var chaiInspect = symbolsSupported ? /* @__PURE__ */ Symbol.for("chai/inspect") : "@@chai/inspect";
var nodeInspect = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var constructorMap = /* @__PURE__ */ new WeakMap();
var stringTagMap = {};
var baseTypesMap = {
  undefined: /* @__PURE__ */ __name((value, options) => options.stylize("undefined", "undefined"), "undefined"),
  null: /* @__PURE__ */ __name((value, options) => options.stylize("null", "null"), "null"),
  boolean: /* @__PURE__ */ __name((value, options) => options.stylize(String(value), "boolean"), "boolean"),
  Boolean: /* @__PURE__ */ __name((value, options) => options.stylize(String(value), "boolean"), "Boolean"),
  number: inspectNumber,
  Number: inspectNumber,
  bigint: inspectBigInt,
  BigInt: inspectBigInt,
  string: inspectString,
  String: inspectString,
  function: inspectFunction,
  Function: inspectFunction,
  symbol: inspectSymbol,
  // A Symbol polyfill will return `Symbol` not `symbol` from typedetect
  Symbol: inspectSymbol,
  Array: inspectArray,
  Date: inspectDate,
  Map: inspectMap,
  Set: inspectSet,
  RegExp: inspectRegExp,
  Promise: promise_default,
  // WeakSet, WeakMap are totally opaque to us
  WeakSet: /* @__PURE__ */ __name((value, options) => options.stylize("WeakSet{\u2026}", "special"), "WeakSet"),
  WeakMap: /* @__PURE__ */ __name((value, options) => options.stylize("WeakMap{\u2026}", "special"), "WeakMap"),
  Arguments: inspectArguments,
  Int8Array: inspectTypedArray,
  Uint8Array: inspectTypedArray,
  Uint8ClampedArray: inspectTypedArray,
  Int16Array: inspectTypedArray,
  Uint16Array: inspectTypedArray,
  Int32Array: inspectTypedArray,
  Uint32Array: inspectTypedArray,
  Float32Array: inspectTypedArray,
  Float64Array: inspectTypedArray,
  Generator: /* @__PURE__ */ __name(() => "", "Generator"),
  DataView: /* @__PURE__ */ __name(() => "", "DataView"),
  ArrayBuffer: /* @__PURE__ */ __name(() => "", "ArrayBuffer"),
  Error: inspectObject2,
  HTMLCollection: inspectNodeCollection,
  NodeList: inspectNodeCollection
};
var inspectCustom = /* @__PURE__ */ __name((value, options, type3, inspectFn) => {
  if (chaiInspect in value && typeof value[chaiInspect] === "function") {
    return value[chaiInspect](options);
  }
  if (nodeInspect in value && typeof value[nodeInspect] === "function") {
    return value[nodeInspect](options.depth, options, inspectFn);
  }
  if ("inspect" in value && typeof value.inspect === "function") {
    return value.inspect(options.depth, options);
  }
  if ("constructor" in value && constructorMap.has(value.constructor)) {
    return constructorMap.get(value.constructor)(value, options);
  }
  if (stringTagMap[type3]) {
    return stringTagMap[type3](value, options);
  }
  return "";
}, "inspectCustom");
var toString = Object.prototype.toString;
function inspect(value, opts = {}) {
  const options = normaliseOptions(opts, inspect);
  const { customInspect } = options;
  let type3 = value === null ? "null" : typeof value;
  if (type3 === "object") {
    type3 = toString.call(value).slice(8, -1);
  }
  if (type3 in baseTypesMap) {
    return baseTypesMap[type3](value, options);
  }
  if (customInspect && value) {
    const output = inspectCustom(value, options, type3, inspect);
    if (output) {
      if (typeof output === "string")
        return output;
      return inspect(output, options);
    }
  }
  const proto = value ? Object.getPrototypeOf(value) : false;
  if (proto === Object.prototype || proto === null) {
    return inspectObject(value, options);
  }
  if (value && typeof HTMLElement === "function" && value instanceof HTMLElement) {
    return inspectHTML(value, options);
  }
  if ("constructor" in value) {
    if (value.constructor !== Object) {
      return inspectClass(value, options);
    }
    return inspectObject(value, options);
  }
  if (value === Object(value)) {
    return inspectObject(value, options);
  }
  return options.stylize(String(value), type3);
}
__name(inspect, "inspect");

// lib/chai/config.js
var config = {
  /**
   * ### config.includeStack
   *
   * User configurable property, influences whether stack trace
   * is included in Assertion error message. Default of false
   * suppresses stack trace in the error message.
   *
   *     chai.config.includeStack = true;  // enable stack on error
   *
   * @param {boolean}
   * @public
   */
  includeStack: false,
  /**
   * ### config.showDiff
   *
   * User configurable property, influences whether or not
   * the `showDiff` flag should be included in the thrown
   * AssertionErrors. `false` will always be `false`; `true`
   * will be true when the assertion has requested a diff
   * be shown.
   *
   * @param {boolean}
   * @public
   */
  showDiff: true,
  /**
   * ### config.truncateThreshold
   *
   * User configurable property, sets length threshold for actual and
   * expected values in assertion errors. If this threshold is exceeded, for
   * example for large data structures, the value is replaced with something
   * like `[ Array(3) ]` or `{ Object (prop1, prop2) }`.
   *
   * Set it to zero if you want to disable truncating altogether.
   *
   * This is especially userful when doing assertions on arrays: having this
   * set to a reasonable large value makes the failure messages readily
   * inspectable.
   *
   *     chai.config.truncateThreshold = 0;  // disable truncating
   *
   * @param {number}
   * @public
   */
  truncateThreshold: 40,
  /**
   * ### config.useProxy
   *
   * User configurable property, defines if chai will use a Proxy to throw
   * an error when a non-existent property is read, which protects users
   * from typos when using property-based assertions.
   *
   * Set it to false if you want to disable this feature.
   *
   *     chai.config.useProxy = false;  // disable use of Proxy
   *
   * This feature is automatically disabled regardless of this config value
   * in environments that don't support proxies.
   *
   * @param {boolean}
   * @public
   */
  useProxy: true,
  /**
   * ### config.proxyExcludedKeys
   *
   * User configurable property, defines which properties should be ignored
   * instead of throwing an error if they do not exist on the assertion.
   * This is only applied if the environment Chai is running in supports proxies and
   * if the `useProxy` configuration setting is enabled.
   * By default, `then` and `inspect` will not throw an error if they do not exist on the
   * assertion object because the `.inspect` property is read by `util.inspect` (for example, when
   * using `console.log` on the assertion object) and `.then` is necessary for promise type-checking.
   *
   *     // By default these keys will not throw an error if they do not exist on the assertion object
   *     chai.config.proxyExcludedKeys = ['then', 'inspect'];
   *
   * @param {Array}
   * @public
   */
  proxyExcludedKeys: ["then", "catch", "inspect", "toJSON"],
  /**
   * ### config.deepEqual
   *
   * User configurable property, defines which a custom function to use for deepEqual
   * comparisons.
   * By default, the function used is the one from the `deep-eql` package without custom comparator.
   *
   *     // use a custom comparator
   *     chai.config.deepEqual = (expected, actual) => {
   *         return chai.util.eql(expected, actual, {
   *             comparator: (expected, actual) => {
   *                 // for non number comparison, use the default behavior
   *                 if(typeof expected !== 'number') return null;
   *                 // allow a difference of 10 between compared numbers
   *                 return typeof actual === 'number' && Math.abs(actual - expected) < 10
   *             }
   *         })
   *     };
   *
   * @param {Function}
   * @public
   */
  deepEqual: null
};

// lib/chai/utils/inspect.js
function inspect2(obj, showHidden, depth, colors) {
  let options = {
    colors,
    depth: typeof depth === "undefined" ? 2 : depth,
    showHidden,
    truncate: config.truncateThreshold ? config.truncateThreshold : Infinity
  };
  return inspect(obj, options);
}
__name(inspect2, "inspect");

// lib/chai/utils/objDisplay.js
function objDisplay(obj) {
  let str = inspect2(obj), type3 = Object.prototype.toString.call(obj);
  if (config.truncateThreshold && str.length >= config.truncateThreshold) {
    if (type3 === "[object Function]") {
      return !obj.name || obj.name === "" ? "[Function]" : "[Function: " + obj.name + "]";
    } else if (type3 === "[object Array]") {
      return "[ Array(" + obj.length + ") ]";
    } else if (type3 === "[object Object]") {
      let keys = Object.keys(obj), kstr = keys.length > 2 ? keys.splice(0, 2).join(", ") + ", ..." : keys.join(", ");
      return "{ Object (" + kstr + ") }";
    } else {
      return str;
    }
  } else {
    return str;
  }
}
__name(objDisplay, "objDisplay");

// lib/chai/utils/getMessage.js
function getMessage2(obj, args) {
  let negate = flag(obj, "negate");
  let val = flag(obj, "object");
  let expected = args[3];
  let actual = getActual(obj, args);
  let msg = negate ? args[2] : args[1];
  let flagMsg = flag(obj, "message");
  if (typeof msg === "function") msg = msg();
  msg = msg || "";
  msg = msg.replace(/#\{this\}/g, function() {
    return objDisplay(val);
  }).replace(/#\{act\}/g, function() {
    return objDisplay(actual);
  }).replace(/#\{exp\}/g, function() {
    return objDisplay(expected);
  });
  return flagMsg ? flagMsg + ": " + msg : msg;
}
__name(getMessage2, "getMessage");

// lib/chai/utils/transferFlags.js
function transferFlags(assertion, object, includeAll) {
  let flags = assertion.__flags || (assertion.__flags = /* @__PURE__ */ Object.create(null));
  if (!object.__flags) {
    object.__flags = /* @__PURE__ */ Object.create(null);
  }
  includeAll = arguments.length === 3 ? includeAll : true;
  for (let flag3 in flags) {
    if (includeAll || flag3 !== "object" && flag3 !== "ssfi" && flag3 !== "lockSsfi" && flag3 != "message") {
      object.__flags[flag3] = flags[flag3];
    }
  }
}
__name(transferFlags, "transferFlags");

// node_modules/deep-eql/index.js
function type2(obj) {
  if (typeof obj === "undefined") {
    return "undefined";
  }
  if (obj === null) {
    return "null";
  }
  const stringTag = obj[Symbol.toStringTag];
  if (typeof stringTag === "string") {
    return stringTag;
  }
  const sliceStart = 8;
  const sliceEnd = -1;
  return Object.prototype.toString.call(obj).slice(sliceStart, sliceEnd);
}
__name(type2, "type");
function FakeMap() {
  this._key = "chai/deep-eql__" + Math.random() + Date.now();
}
__name(FakeMap, "FakeMap");
FakeMap.prototype = {
  get: /* @__PURE__ */ __name(function get(key) {
    return key[this._key];
  }, "get"),
  set: /* @__PURE__ */ __name(function set(key, value) {
    if (Object.isExtensible(key)) {
      Object.defineProperty(key, this._key, {
        value,
        configurable: true
      });
    }
  }, "set")
};
var MemoizeMap = typeof WeakMap === "function" ? WeakMap : FakeMap;
function memoizeCompare(leftHandOperand, rightHandOperand, memoizeMap) {
  if (!memoizeMap || isPrimitive(leftHandOperand) || isPrimitive(rightHandOperand)) {
    return null;
  }
  var leftHandMap = memoizeMap.get(leftHandOperand);
  if (leftHandMap) {
    var result = leftHandMap.get(rightHandOperand);
    if (typeof result === "boolean") {
      return result;
    }
  }
  return null;
}
__name(memoizeCompare, "memoizeCompare");
function memoizeSet(leftHandOperand, rightHandOperand, memoizeMap, result) {
  if (!memoizeMap || isPrimitive(leftHandOperand) || isPrimitive(rightHandOperand)) {
    return;
  }
  var leftHandMap = memoizeMap.get(leftHandOperand);
  if (leftHandMap) {
    leftHandMap.set(rightHandOperand, result);
  } else {
    leftHandMap = new MemoizeMap();
    leftHandMap.set(rightHandOperand, result);
    memoizeMap.set(leftHandOperand, leftHandMap);
  }
}
__name(memoizeSet, "memoizeSet");
var deep_eql_default = deepEqual;
function deepEqual(leftHandOperand, rightHandOperand, options) {
  if (options && options.comparator) {
    return extensiveDeepEqual(leftHandOperand, rightHandOperand, options);
  }
  var simpleResult = simpleEqual(leftHandOperand, rightHandOperand);
  if (simpleResult !== null) {
    return simpleResult;
  }
  return extensiveDeepEqual(leftHandOperand, rightHandOperand, options);
}
__name(deepEqual, "deepEqual");
function simpleEqual(leftHandOperand, rightHandOperand) {
  if (leftHandOperand === rightHandOperand) {
    return leftHandOperand !== 0 || 1 / leftHandOperand === 1 / rightHandOperand;
  }
  if (leftHandOperand !== leftHandOperand && // eslint-disable-line no-self-compare
  rightHandOperand !== rightHandOperand) {
    return true;
  }
  if (isPrimitive(leftHandOperand) || isPrimitive(rightHandOperand)) {
    return false;
  }
  return null;
}
__name(simpleEqual, "simpleEqual");
function extensiveDeepEqual(leftHandOperand, rightHandOperand, options) {
  options = options || {};
  options.memoize = options.memoize === false ? false : options.memoize || new MemoizeMap();
  var comparator = options && options.comparator;
  var memoizeResultLeft = memoizeCompare(leftHandOperand, rightHandOperand, options.memoize);
  if (memoizeResultLeft !== null) {
    return memoizeResultLeft;
  }
  var memoizeResultRight = memoizeCompare(rightHandOperand, leftHandOperand, options.memoize);
  if (memoizeResultRight !== null) {
    return memoizeResultRight;
  }
  if (comparator) {
    var comparatorResult = comparator(leftHandOperand, rightHandOperand);
    if (comparatorResult === false || comparatorResult === true) {
      memoizeSet(leftHandOperand, rightHandOperand, options.memoize, comparatorResult);
      return comparatorResult;
    }
    var simpleResult = simpleEqual(leftHandOperand, rightHandOperand);
    if (simpleResult !== null) {
      return simpleResult;
    }
  }
  var leftHandType = type2(leftHandOperand);
  if (leftHandType !== type2(rightHandOperand)) {
    memoizeSet(leftHandOperand, rightHandOperand, options.memoize, false);
    return false;
  }
  memoizeSet(leftHandOperand, rightHandOperand, options.memoize, true);
  var result = extensiveDeepEqualByType(leftHandOperand, rightHandOperand, leftHandType, options);
  memoizeSet(leftHandOperand, rightHandOperand, options.memoize, result);
  return result;
}
__name(extensiveDeepEqual, "extensiveDeepEqual");
function extensiveDeepEqualByType(leftHandOperand, rightHandOperand, leftHandType, options) {
  switch (leftHandType) {
    case "String":
    case "Number":
    case "Boolean":
    case "Date":
      return deepEqual(leftHandOperand.valueOf(), rightHandOperand.valueOf());
    case "Promise":
    case "Symbol":
    case "function":
    case "WeakMap":
    case "WeakSet":
      return leftHandOperand === rightHandOperand;
    case "Error":
      return keysEqual(leftHandOperand, rightHandOperand, ["name", "message", "code"], options);
    case "Arguments":
    case "Int8Array":
    case "Uint8Array":
    case "Uint8ClampedArray":
    case "Int16Array":
    case "Uint16Array":
    case "Int32Array":
    case "Uint32Array":
    case "Float32Array":
    case "Float64Array":
    case "Array":
      return iterableEqual(leftHandOperand, rightHandOperand, options);
    case "RegExp":
      return regexpEqual(leftHandOperand, rightHandOperand);
    case "Generator":
      return generatorEqual(leftHandOperand, rightHandOperand, options);
    case "DataView":
      return iterableEqual(new Uint8Array(leftHandOperand.buffer), new Uint8Array(rightHandOperand.buffer), options);
    case "ArrayBuffer":
      return iterableEqual(new Uint8Array(leftHandOperand), new Uint8Array(rightHandOperand), options);
    case "Set":
      return entriesEqual(leftHandOperand, rightHandOperand, options);
    case "Map":
      return entriesEqual(leftHandOperand, rightHandOperand, options);
    case "Temporal.PlainDate":
    case "Temporal.PlainTime":
    case "Temporal.PlainDateTime":
    case "Temporal.Instant":
    case "Temporal.ZonedDateTime":
    case "Temporal.PlainYearMonth":
    case "Temporal.PlainMonthDay":
      return leftHandOperand.equals(rightHandOperand);
    case "Temporal.Duration":
      return leftHandOperand.total("nanoseconds") === rightHandOperand.total("nanoseconds");
    case "Temporal.TimeZone":
    case "Temporal.Calendar":
      return leftHandOperand.toString() === rightHandOperand.toString();
    default:
      return objectEqual(leftHandOperand, rightHandOperand, options);
  }
}
__name(extensiveDeepEqualByType, "extensiveDeepEqualByType");
function regexpEqual(leftHandOperand, rightHandOperand) {
  return leftHandOperand.toString() === rightHandOperand.toString();
}
__name(regexpEqual, "regexpEqual");
function entriesEqual(leftHandOperand, rightHandOperand, options) {
  try {
    if (leftHandOperand.size !== rightHandOperand.size) {
      return false;
    }
    if (leftHandOperand.size === 0) {
      return true;
    }
  } catch (sizeError) {
    return false;
  }
  var leftHandItems = [];
  var rightHandItems = [];
  leftHandOperand.forEach(/* @__PURE__ */ __name(function gatherEntries(key, value) {
    leftHandItems.push([key, value]);
  }, "gatherEntries"));
  rightHandOperand.forEach(/* @__PURE__ */ __name(function gatherEntries(key, value) {
    rightHandItems.push([key, value]);
  }, "gatherEntries"));
  return iterableEqual(leftHandItems.sort(), rightHandItems.sort(), options);
}
__name(entriesEqual, "entriesEqual");
function iterableEqual(leftHandOperand, rightHandOperand, options) {
  var length = leftHandOperand.length;
  if (length !== rightHandOperand.length) {
    return false;
  }
  if (length === 0) {
    return true;
  }
  var index = -1;
  while (++index < length) {
    if (deepEqual(leftHandOperand[index], rightHandOperand[index], options) === false) {
      return false;
    }
  }
  return true;
}
__name(iterableEqual, "iterableEqual");
function generatorEqual(leftHandOperand, rightHandOperand, options) {
  return iterableEqual(getGeneratorEntries(leftHandOperand), getGeneratorEntries(rightHandOperand), options);
}
__name(generatorEqual, "generatorEqual");
function hasIteratorFunction(target) {
  return typeof Symbol !== "undefined" && typeof target === "object" && typeof Symbol.iterator !== "undefined" && typeof target[Symbol.iterator] === "function";
}
__name(hasIteratorFunction, "hasIteratorFunction");
function getIteratorEntries(target) {
  if (hasIteratorFunction(target)) {
    try {
      return getGeneratorEntries(target[Symbol.iterator]());
    } catch (iteratorError) {
      return [];
    }
  }
  return [];
}
__name(getIteratorEntries, "getIteratorEntries");
function getGeneratorEntries(generator) {
  var generatorResult = generator.next();
  var accumulator = [generatorResult.value];
  while (generatorResult.done === false) {
    generatorResult = generator.next();
    accumulator.push(generatorResult.value);
  }
  return accumulator;
}
__name(getGeneratorEntries, "getGeneratorEntries");
function getEnumerableKeys(target) {
  var keys = [];
  for (var key in target) {
    keys.push(key);
  }
  return keys;
}
__name(getEnumerableKeys, "getEnumerableKeys");
function getEnumerableSymbols(target) {
  var keys = [];
  var allKeys = Object.getOwnPropertySymbols(target);
  for (var i = 0; i < allKeys.length; i += 1) {
    var key = allKeys[i];
    if (Object.getOwnPropertyDescriptor(target, key).enumerable) {
      keys.push(key);
    }
  }
  return keys;
}
__name(getEnumerableSymbols, "getEnumerableSymbols");
function keysEqual(leftHandOperand, rightHandOperand, keys, options) {
  var length = keys.length;
  if (length === 0) {
    return true;
  }
  for (var i = 0; i < length; i += 1) {
    if (deepEqual(leftHandOperand[keys[i]], rightHandOperand[keys[i]], options) === false) {
      return false;
    }
  }
  return true;
}
__name(keysEqual, "keysEqual");
function objectEqual(leftHandOperand, rightHandOperand, options) {
  var leftHandKeys = getEnumerableKeys(leftHandOperand);
  var rightHandKeys = getEnumerableKeys(rightHandOperand);
  var leftHandSymbols = getEnumerableSymbols(leftHandOperand);
  var rightHandSymbols = getEnumerableSymbols(rightHandOperand);
  leftHandKeys = leftHandKeys.concat(leftHandSymbols);
  rightHandKeys = rightHandKeys.concat(rightHandSymbols);
  if (leftHandKeys.length && leftHandKeys.length === rightHandKeys.length) {
    if (iterableEqual(mapSymbols(leftHandKeys).sort(), mapSymbols(rightHandKeys).sort()) === false) {
      return false;
    }
    return keysEqual(leftHandOperand, rightHandOperand, leftHandKeys, options);
  }
  var leftHandEntries = getIteratorEntries(leftHandOperand);
  var rightHandEntries = getIteratorEntries(rightHandOperand);
  if (leftHandEntries.length && leftHandEntries.length === rightHandEntries.length) {
    leftHandEntries.sort();
    rightHandEntries.sort();
    return iterableEqual(leftHandEntries, rightHandEntries, options);
  }
  if (leftHandKeys.length === 0 && leftHandEntries.length === 0 && rightHandKeys.length === 0 && rightHandEntries.length === 0) {
    return true;
  }
  return false;
}
__name(objectEqual, "objectEqual");
function isPrimitive(value) {
  return value === null || typeof value !== "object";
}
__name(isPrimitive, "isPrimitive");
function mapSymbols(arr) {
  return arr.map(/* @__PURE__ */ __name(function mapSymbol(entry) {
    if (typeof entry === "symbol") {
      return entry.toString();
    }
    return entry;
  }, "mapSymbol"));
}
__name(mapSymbols, "mapSymbols");

// node_modules/pathval/index.js
function hasProperty(obj, name) {
  if (typeof obj === "undefined" || obj === null) {
    return false;
  }
  return name in Object(obj);
}
__name(hasProperty, "hasProperty");
function parsePath(path) {
  const str = path.replace(/([^\\])\[/g, "$1.[");
  const parts = str.match(/(\\\.|[^.]+?)+/g);
  return parts.map((value) => {
    if (value === "constructor" || value === "__proto__" || value === "prototype") {
      return {};
    }
    const regexp = /^\[(\d+)\]$/;
    const mArr = regexp.exec(value);
    let parsed = null;
    if (mArr) {
      parsed = { i: parseFloat(mArr[1]) };
    } else {
      parsed = { p: value.replace(/\\([.[\]])/g, "$1") };
    }
    return parsed;
  });
}
__name(parsePath, "parsePath");
function internalGetPathValue(obj, parsed, pathDepth) {
  let temporaryValue = obj;
  let res = null;
  pathDepth = typeof pathDepth === "undefined" ? parsed.length : pathDepth;
  for (let i = 0; i < pathDepth; i++) {
    const part = parsed[i];
    if (temporaryValue) {
      if (typeof part.p === "undefined") {
        temporaryValue = temporaryValue[part.i];
      } else {
        temporaryValue = temporaryValue[part.p];
      }
      if (i === pathDepth - 1) {
        res = temporaryValue;
      }
    }
  }
  return res;
}
__name(internalGetPathValue, "internalGetPathValue");
function getPathInfo(obj, path) {
  const parsed = parsePath(path);
  const last = parsed[parsed.length - 1];
  const info = {
    parent: parsed.length > 1 ? internalGetPathValue(obj, parsed, parsed.length - 1) : obj,
    name: last.p || last.i,
    value: internalGetPathValue(obj, parsed)
  };
  info.exists = hasProperty(info.parent, info.name);
  return info;
}
__name(getPathInfo, "getPathInfo");

// lib/chai/assertion.js
var _Assertion = class _Assertion {
  /**
   * Creates object for chaining.
   * `Assertion` objects contain metadata in the form of flags. Three flags can
   * be assigned during instantiation by passing arguments to this constructor:
   *
   * - `object`: This flag contains the target of the assertion. For example, in
   * the assertion `expect(numKittens).to.equal(7);`, the `object` flag will
   * contain `numKittens` so that the `equal` assertion can reference it when
   * needed.
   *
   * - `message`: This flag contains an optional custom error message to be
   * prepended to the error message that's generated by the assertion when it
   * fails.
   *
   * - `ssfi`: This flag stands for "start stack function indicator". It
   * contains a function reference that serves as the starting point for
   * removing frames from the stack trace of the error that's created by the
   * assertion when it fails. The goal is to provide a cleaner stack trace to
   * end users by removing Chai's internal functions. Note that it only works
   * in environments that support `Error.captureStackTrace`, and only when
   * `Chai.config.includeStack` hasn't been set to `false`.
   *
   * - `lockSsfi`: This flag controls whether or not the given `ssfi` flag
   * should retain its current value, even as assertions are chained off of
   * this object. This is usually set to `true` when creating a new assertion
   * from within another assertion. It's also temporarily set to `true` before
   * an overwritten assertion gets called by the overwriting assertion.
   *
   * - `eql`: This flag contains the deepEqual function to be used by the assertion.
   *
   * @param {unknown} obj target of the assertion
   * @param {string} [msg] (optional) custom error message
   * @param {Function} [ssfi] (optional) starting point for removing stack frames
   * @param {boolean} [lockSsfi] (optional) whether or not the ssfi flag is locked
   */
  constructor(obj, msg, ssfi, lockSsfi) {
    /** @type {{}} */
    __publicField(this, "__flags", {});
    flag(this, "ssfi", ssfi || _Assertion);
    flag(this, "lockSsfi", lockSsfi);
    flag(this, "object", obj);
    flag(this, "message", msg);
    flag(this, "eql", config.deepEqual || deep_eql_default);
    return proxify(this);
  }
  /** @returns {boolean} */
  static get includeStack() {
    console.warn(
      "Assertion.includeStack is deprecated, use chai.config.includeStack instead."
    );
    return config.includeStack;
  }
  /** @param {boolean} value */
  static set includeStack(value) {
    console.warn(
      "Assertion.includeStack is deprecated, use chai.config.includeStack instead."
    );
    config.includeStack = value;
  }
  /** @returns {boolean} */
  static get showDiff() {
    console.warn(
      "Assertion.showDiff is deprecated, use chai.config.showDiff instead."
    );
    return config.showDiff;
  }
  /** @param {boolean} value */
  static set showDiff(value) {
    console.warn(
      "Assertion.showDiff is deprecated, use chai.config.showDiff instead."
    );
    config.showDiff = value;
  }
  /**
   * @param {string} name
   * @param {Function} fn
   */
  static addProperty(name, fn) {
    addProperty(this.prototype, name, fn);
  }
  /**
   * @param {string} name
   * @param {Function} fn
   */
  static addMethod(name, fn) {
    addMethod(this.prototype, name, fn);
  }
  /**
   * @param {string} name
   * @param {Function} fn
   * @param {Function} chainingBehavior
   */
  static addChainableMethod(name, fn, chainingBehavior) {
    addChainableMethod(this.prototype, name, fn, chainingBehavior);
  }
  /**
   * @param {string} name
   * @param {Function} fn
   */
  static overwriteProperty(name, fn) {
    overwriteProperty(this.prototype, name, fn);
  }
  /**
   * @param {string} name
   * @param {Function} fn
   */
  static overwriteMethod(name, fn) {
    overwriteMethod(this.prototype, name, fn);
  }
  /**
   * @param {string} name
   * @param {Function} fn
   * @param {Function} chainingBehavior
   */
  static overwriteChainableMethod(name, fn, chainingBehavior) {
    overwriteChainableMethod(this.prototype, name, fn, chainingBehavior);
  }
  /**
   * ### .assert(expression, message, negateMessage, expected, actual, showDiff)
   *
   * Executes an expression and check expectations. Throws AssertionError for reporting if test doesn't pass.
   *
   * @name assert
   * @param {unknown} _expr to be tested
   * @param {string | Function} msg or function that returns message to display if expression fails
   * @param {string | Function} _negateMsg or function that returns negatedMessage to display if negated expression fails
   * @param {unknown} expected value (remember to check for negation)
   * @param {unknown} _actual (optional) will default to `this.obj`
   * @param {boolean} showDiff (optional) when set to `true`, assert will display a diff in addition to the message if expression fails
   * @returns {void}
   */
  assert(_expr, msg, _negateMsg, expected, _actual, showDiff) {
    const ok = test(this, arguments);
    if (false !== showDiff) showDiff = true;
    if (void 0 === expected && void 0 === _actual) showDiff = false;
    if (true !== config.showDiff) showDiff = false;
    if (!ok) {
      msg = getMessage2(this, arguments);
      const actual = getActual(this, arguments);
      const assertionErrorObjectProperties = {
        actual,
        expected,
        showDiff
      };
      const operator = getOperator(this, arguments);
      if (operator) {
        assertionErrorObjectProperties.operator = operator;
      }
      throw new AssertionError(
        msg,
        assertionErrorObjectProperties,
        // @ts-expect-error Not sure what to do about these types yet
        config.includeStack ? this.assert : flag(this, "ssfi")
      );
    }
  }
  /**
   * Quick reference to stored `actual` value for plugin developers.
   *
   * @returns {unknown}
   */
  get _obj() {
    return flag(this, "object");
  }
  /**
   * Quick reference to stored `actual` value for plugin developers.
   *
   * @param {unknown} val
   */
  set _obj(val) {
    flag(this, "object", val);
  }
};
__name(_Assertion, "Assertion");
var Assertion = _Assertion;

// lib/chai/utils/events.js
var events = new EventTarget();
var _PluginEvent = class _PluginEvent extends Event {
  constructor(type3, name, fn) {
    super(type3);
    this.name = String(name);
    this.fn = fn;
  }
};
__name(_PluginEvent, "PluginEvent");
var PluginEvent = _PluginEvent;

// lib/chai/utils/isProxyEnabled.js
function isProxyEnabled() {
  return config.useProxy && typeof Proxy !== "undefined" && typeof Reflect !== "undefined";
}
__name(isProxyEnabled, "isProxyEnabled");

// lib/chai/utils/addProperty.js
function addProperty(ctx, name, getter) {
  getter = getter === void 0 ? function() {
  } : getter;
  Object.defineProperty(ctx, name, {
    get: /* @__PURE__ */ __name(function propertyGetter() {
      if (!isProxyEnabled() && !flag(this, "lockSsfi")) {
        flag(this, "ssfi", propertyGetter);
      }
      let result = getter.call(this);
      if (result !== void 0) return result;
      let newAssertion = new Assertion();
      transferFlags(this, newAssertion);
      return newAssertion;
    }, "propertyGetter"),
    configurable: true
  });
  events.dispatchEvent(new PluginEvent("addProperty", name, getter));
}
__name(addProperty, "addProperty");

// lib/chai/utils/addLengthGuard.js
var fnLengthDesc = Object.getOwnPropertyDescriptor(function() {
}, "length");
function addLengthGuard(fn, assertionName, isChainable) {
  if (!fnLengthDesc.configurable) return fn;
  Object.defineProperty(fn, "length", {
    get: /* @__PURE__ */ __name(function() {
      if (isChainable) {
        throw Error(
          "Invalid Chai property: " + assertionName + '.length. Due to a compatibility issue, "length" cannot directly follow "' + assertionName + '". Use "' + assertionName + '.lengthOf" instead.'
        );
      }
      throw Error(
        "Invalid Chai property: " + assertionName + '.length. See docs for proper usage of "' + assertionName + '".'
      );
    }, "get")
  });
  return fn;
}
__name(addLengthGuard, "addLengthGuard");

// lib/chai/utils/getProperties.js
function getProperties(object) {
  let result = Object.getOwnPropertyNames(object);
  function addProperty2(property) {
    if (result.indexOf(property) === -1) {
      result.push(property);
    }
  }
  __name(addProperty2, "addProperty");
  let proto = Object.getPrototypeOf(object);
  while (proto !== null) {
    Object.getOwnPropertyNames(proto).forEach(addProperty2);
    proto = Object.getPrototypeOf(proto);
  }
  return result;
}
__name(getProperties, "getProperties");

// lib/chai/utils/proxify.js
var builtins = ["__flags", "__methods", "_obj", "assert"];
function proxify(obj, nonChainableMethodName) {
  if (!isProxyEnabled()) return obj;
  return new Proxy(obj, {
    get: /* @__PURE__ */ __name(function proxyGetter(target, property) {
      if (typeof property === "string" && config.proxyExcludedKeys.indexOf(property) === -1 && !Reflect.has(target, property)) {
        if (nonChainableMethodName) {
          throw Error(
            "Invalid Chai property: " + nonChainableMethodName + "." + property + '. See docs for proper usage of "' + nonChainableMethodName + '".'
          );
        }
        let suggestion = null;
        let suggestionDistance = 4;
        getProperties(target).forEach(function(prop) {
          if (
            // we actually mean to check `Object.prototype` here
            // eslint-disable-next-line no-prototype-builtins
            !Object.prototype.hasOwnProperty(prop) && builtins.indexOf(prop) === -1
          ) {
            let dist = stringDistanceCapped(property, prop, suggestionDistance);
            if (dist < suggestionDistance) {
              suggestion = prop;
              suggestionDistance = dist;
            }
          }
        });
        if (suggestion !== null) {
          throw Error(
            "Invalid Chai property: " + property + '. Did you mean "' + suggestion + '"?'
          );
        } else {
          throw Error("Invalid Chai property: " + property);
        }
      }
      if (builtins.indexOf(property) === -1 && !flag(target, "lockSsfi")) {
        flag(target, "ssfi", proxyGetter);
      }
      return Reflect.get(target, property);
    }, "proxyGetter")
  });
}
__name(proxify, "proxify");
function stringDistanceCapped(strA, strB, cap) {
  if (Math.abs(strA.length - strB.length) >= cap) {
    return cap;
  }
  let memo = [];
  for (let i = 0; i <= strA.length; i++) {
    memo[i] = Array(strB.length + 1).fill(0);
    memo[i][0] = i;
  }
  for (let j = 0; j < strB.length; j++) {
    memo[0][j] = j;
  }
  for (let i = 1; i <= strA.length; i++) {
    let ch = strA.charCodeAt(i - 1);
    for (let j = 1; j <= strB.length; j++) {
      if (Math.abs(i - j) >= cap) {
        memo[i][j] = cap;
        continue;
      }
      memo[i][j] = Math.min(
        memo[i - 1][j] + 1,
        memo[i][j - 1] + 1,
        memo[i - 1][j - 1] + (ch === strB.charCodeAt(j - 1) ? 0 : 1)
      );
    }
  }
  return memo[strA.length][strB.length];
}
__name(stringDistanceCapped, "stringDistanceCapped");

// lib/chai/utils/addMethod.js
function addMethod(ctx, name, method) {
  let methodWrapper = /* @__PURE__ */ __name(function() {
    if (!flag(this, "lockSsfi")) {
      flag(this, "ssfi", methodWrapper);
    }
    let result = method.apply(this, arguments);
    if (result !== void 0) return result;
    let newAssertion = new Assertion();
    transferFlags(this, newAssertion);
    return newAssertion;
  }, "methodWrapper");
  addLengthGuard(methodWrapper, name, false);
  ctx[name] = proxify(methodWrapper, name);
  events.dispatchEvent(new PluginEvent("addMethod", name, method));
}
__name(addMethod, "addMethod");

// lib/chai/utils/overwriteProperty.js
function overwriteProperty(ctx, name, getter) {
  let _get = Object.getOwnPropertyDescriptor(ctx, name), _super = /* @__PURE__ */ __name(function() {
  }, "_super");
  if (_get && "function" === typeof _get.get) _super = _get.get;
  Object.defineProperty(ctx, name, {
    get: /* @__PURE__ */ __name(function overwritingPropertyGetter() {
      if (!isProxyEnabled() && !flag(this, "lockSsfi")) {
        flag(this, "ssfi", overwritingPropertyGetter);
      }
      let origLockSsfi = flag(this, "lockSsfi");
      flag(this, "lockSsfi", true);
      let result = getter(_super).call(this);
      flag(this, "lockSsfi", origLockSsfi);
      if (result !== void 0) {
        return result;
      }
      let newAssertion = new Assertion();
      transferFlags(this, newAssertion);
      return newAssertion;
    }, "overwritingPropertyGetter"),
    configurable: true
  });
}
__name(overwriteProperty, "overwriteProperty");

// lib/chai/utils/overwriteMethod.js
function overwriteMethod(ctx, name, method) {
  let _method = ctx[name], _super = /* @__PURE__ */ __name(function() {
    throw new Error(name + " is not a function");
  }, "_super");
  if (_method && "function" === typeof _method) _super = _method;
  let overwritingMethodWrapper = /* @__PURE__ */ __name(function() {
    if (!flag(this, "lockSsfi")) {
      flag(this, "ssfi", overwritingMethodWrapper);
    }
    let origLockSsfi = flag(this, "lockSsfi");
    flag(this, "lockSsfi", true);
    let result = method(_super).apply(this, arguments);
    flag(this, "lockSsfi", origLockSsfi);
    if (result !== void 0) {
      return result;
    }
    let newAssertion = new Assertion();
    transferFlags(this, newAssertion);
    return newAssertion;
  }, "overwritingMethodWrapper");
  addLengthGuard(overwritingMethodWrapper, name, false);
  ctx[name] = proxify(overwritingMethodWrapper, name);
}
__name(overwriteMethod, "overwriteMethod");

// lib/chai/utils/addChainableMethod.js
var canSetPrototype = typeof Object.setPrototypeOf === "function";
var testFn = /* @__PURE__ */ __name(function() {
}, "testFn");
var excludeNames = Object.getOwnPropertyNames(testFn).filter(function(name) {
  let propDesc = Object.getOwnPropertyDescriptor(testFn, name);
  if (typeof propDesc !== "object") return true;
  return !propDesc.configurable;
});
var call = Function.prototype.call;
var apply = Function.prototype.apply;
var _PluginAddChainableMethodEvent = class _PluginAddChainableMethodEvent extends PluginEvent {
  constructor(type3, name, fn, chainingBehavior) {
    super(type3, name, fn);
    this.chainingBehavior = chainingBehavior;
  }
};
__name(_PluginAddChainableMethodEvent, "PluginAddChainableMethodEvent");
var PluginAddChainableMethodEvent = _PluginAddChainableMethodEvent;
function addChainableMethod(ctx, name, method, chainingBehavior) {
  if (typeof chainingBehavior !== "function") {
    chainingBehavior = /* @__PURE__ */ __name(function() {
    }, "chainingBehavior");
  }
  let chainableBehavior = {
    method,
    chainingBehavior
  };
  if (!ctx.__methods) {
    ctx.__methods = {};
  }
  ctx.__methods[name] = chainableBehavior;
  Object.defineProperty(ctx, name, {
    get: /* @__PURE__ */ __name(function chainableMethodGetter() {
      chainableBehavior.chainingBehavior.call(this);
      let chainableMethodWrapper = /* @__PURE__ */ __name(function() {
        if (!flag(this, "lockSsfi")) {
          flag(this, "ssfi", chainableMethodWrapper);
        }
        let result = chainableBehavior.method.apply(this, arguments);
        if (result !== void 0) {
          return result;
        }
        let newAssertion = new Assertion();
        transferFlags(this, newAssertion);
        return newAssertion;
      }, "chainableMethodWrapper");
      addLengthGuard(chainableMethodWrapper, name, true);
      if (canSetPrototype) {
        let prototype = Object.create(this);
        prototype.call = call;
        prototype.apply = apply;
        Object.setPrototypeOf(chainableMethodWrapper, prototype);
      } else {
        let asserterNames = Object.getOwnPropertyNames(ctx);
        asserterNames.forEach(function(asserterName) {
          if (excludeNames.indexOf(asserterName) !== -1) {
            return;
          }
          let pd = Object.getOwnPropertyDescriptor(ctx, asserterName);
          Object.defineProperty(chainableMethodWrapper, asserterName, pd);
        });
      }
      transferFlags(this, chainableMethodWrapper);
      return proxify(chainableMethodWrapper);
    }, "chainableMethodGetter"),
    configurable: true
  });
  events.dispatchEvent(
    new PluginAddChainableMethodEvent(
      "addChainableMethod",
      name,
      method,
      chainingBehavior
    )
  );
}
__name(addChainableMethod, "addChainableMethod");

// lib/chai/utils/overwriteChainableMethod.js
function overwriteChainableMethod(ctx, name, method, chainingBehavior) {
  let chainableBehavior = ctx.__methods[name];
  let _chainingBehavior = chainableBehavior.chainingBehavior;
  chainableBehavior.chainingBehavior = /* @__PURE__ */ __name(function overwritingChainableMethodGetter() {
    let result = chainingBehavior(_chainingBehavior).call(this);
    if (result !== void 0) {
      return result;
    }
    let newAssertion = new Assertion();
    transferFlags(this, newAssertion);
    return newAssertion;
  }, "overwritingChainableMethodGetter");
  let _method = chainableBehavior.method;
  chainableBehavior.method = /* @__PURE__ */ __name(function overwritingChainableMethodWrapper() {
    let result = method(_method).apply(this, arguments);
    if (result !== void 0) {
      return result;
    }
    let newAssertion = new Assertion();
    transferFlags(this, newAssertion);
    return newAssertion;
  }, "overwritingChainableMethodWrapper");
}
__name(overwriteChainableMethod, "overwriteChainableMethod");

// lib/chai/utils/compareByInspect.js
function compareByInspect(a, b) {
  return inspect2(a) < inspect2(b) ? -1 : 1;
}
__name(compareByInspect, "compareByInspect");

// lib/chai/utils/getOwnEnumerablePropertySymbols.js
function getOwnEnumerablePropertySymbols(obj) {
  if (typeof Object.getOwnPropertySymbols !== "function") return [];
  return Object.getOwnPropertySymbols(obj).filter(function(sym) {
    return Object.getOwnPropertyDescriptor(obj, sym).enumerable;
  });
}
__name(getOwnEnumerablePropertySymbols, "getOwnEnumerablePropertySymbols");

// lib/chai/utils/getOwnEnumerableProperties.js
function getOwnEnumerableProperties(obj) {
  return Object.keys(obj).concat(getOwnEnumerablePropertySymbols(obj));
}
__name(getOwnEnumerableProperties, "getOwnEnumerableProperties");

// lib/chai/utils/isNaN.js
var isNaN2 = Number.isNaN;

// lib/chai/utils/getOperator.js
function isObjectType(obj) {
  let objectType = type(obj);
  let objectTypes = ["Array", "Object", "Function"];
  return objectTypes.indexOf(objectType) !== -1;
}
__name(isObjectType, "isObjectType");
function getOperator(obj, args) {
  let operator = flag(obj, "operator");
  let negate = flag(obj, "negate");
  let expected = args[3];
  let msg = negate ? args[2] : args[1];
  if (operator) {
    return operator;
  }
  if (typeof msg === "function") msg = msg();
  msg = msg || "";
  if (!msg) {
    return void 0;
  }
  if (/\shave\s/.test(msg)) {
    return void 0;
  }
  let isObject = isObjectType(expected);
  if (/\snot\s/.test(msg)) {
    return isObject ? "notDeepStrictEqual" : "notStrictEqual";
  }
  return isObject ? "deepStrictEqual" : "strictEqual";
}
__name(getOperator, "getOperator");

// lib/chai/utils/index.js
function getName(fn) {
  return fn.name;
}
__name(getName, "getName");
function isRegExp2(obj) {
  return Object.prototype.toString.call(obj) === "[object RegExp]";
}
__name(isRegExp2, "isRegExp");
function isNumeric(obj) {
  return ["Number", "BigInt"].includes(type(obj));
}
__name(isNumeric, "isNumeric");

// lib/chai/core/assertions.js
var { flag: flag2 } = utils_exports;
[
  "to",
  "be",
  "been",
  "is",
  "and",
  "has",
  "have",
  "with",
  "that",
  "which",
  "at",
  "of",
  "same",
  "but",
  "does",
  "still",
  "also"
].forEach(function(chain) {
  Assertion.addProperty(chain);
});
Assertion.addProperty("not", function() {
  flag2(this, "negate", true);
});
Assertion.addProperty("deep", function() {
  flag2(this, "deep", true);
});
Assertion.addProperty("nested", function() {
  flag2(this, "nested", true);
});
Assertion.addProperty("own", function() {
  flag2(this, "own", true);
});
Assertion.addProperty("ordered", function() {
  flag2(this, "ordered", true);
});
Assertion.addProperty("any", function() {
  flag2(this, "any", true);
  flag2(this, "all", false);
});
Assertion.addProperty("all", function() {
  flag2(this, "all", true);
  flag2(this, "any", false);
});
var functionTypes = {
  function: [
    "function",
    "asyncfunction",
    "generatorfunction",
    "asyncgeneratorfunction"
  ],
  asyncfunction: ["asyncfunction", "asyncgeneratorfunction"],
  generatorfunction: ["generatorfunction", "asyncgeneratorfunction"],
  asyncgeneratorfunction: ["asyncgeneratorfunction"]
};
function an(type3, msg) {
  if (msg) flag2(this, "message", msg);
  type3 = type3.toLowerCase();
  let obj = flag2(this, "object"), article = ~["a", "e", "i", "o", "u"].indexOf(type3.charAt(0)) ? "an " : "a ";
  const detectedType = type(obj).toLowerCase();
  if (functionTypes["function"].includes(type3)) {
    this.assert(
      functionTypes[type3].includes(detectedType),
      "expected #{this} to be " + article + type3,
      "expected #{this} not to be " + article + type3
    );
  } else {
    this.assert(
      type3 === detectedType,
      "expected #{this} to be " + article + type3,
      "expected #{this} not to be " + article + type3
    );
  }
}
__name(an, "an");
Assertion.addChainableMethod("an", an);
Assertion.addChainableMethod("a", an);
function SameValueZero(a, b) {
  return isNaN2(a) && isNaN2(b) || a === b;
}
__name(SameValueZero, "SameValueZero");
function includeChainingBehavior() {
  flag2(this, "contains", true);
}
__name(includeChainingBehavior, "includeChainingBehavior");
function include(val, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), objType = type(obj).toLowerCase(), flagMsg = flag2(this, "message"), negate = flag2(this, "negate"), ssfi = flag2(this, "ssfi"), isDeep = flag2(this, "deep"), descriptor = isDeep ? "deep " : "", isEql = isDeep ? flag2(this, "eql") : SameValueZero;
  flagMsg = flagMsg ? flagMsg + ": " : "";
  let included = false;
  switch (objType) {
    case "string":
      included = obj.indexOf(val) !== -1;
      break;
    case "weakset":
      if (isDeep) {
        throw new AssertionError(
          flagMsg + "unable to use .deep.include with WeakSet",
          void 0,
          ssfi
        );
      }
      included = obj.has(val);
      break;
    case "map":
      obj.forEach(function(item) {
        included = included || isEql(item, val);
      });
      break;
    case "set":
      if (isDeep) {
        obj.forEach(function(item) {
          included = included || isEql(item, val);
        });
      } else {
        included = obj.has(val);
      }
      break;
    case "array":
      if (isDeep) {
        included = obj.some(function(item) {
          return isEql(item, val);
        });
      } else {
        included = obj.indexOf(val) !== -1;
      }
      break;
    default: {
      if (val !== Object(val)) {
        throw new AssertionError(
          flagMsg + "the given combination of arguments (" + objType + " and " + type(val).toLowerCase() + ") is invalid for this assertion. You can use an array, a map, an object, a set, a string, or a weakset instead of a " + type(val).toLowerCase(),
          void 0,
          ssfi
        );
      }
      let props = Object.keys(val);
      let firstErr = null;
      let numErrs = 0;
      props.forEach(function(prop) {
        let propAssertion = new Assertion(obj);
        transferFlags(this, propAssertion, true);
        flag2(propAssertion, "lockSsfi", true);
        if (!negate || props.length === 1) {
          propAssertion.property(prop, val[prop]);
          return;
        }
        try {
          propAssertion.property(prop, val[prop]);
        } catch (err) {
          if (!check_error_exports.compatibleConstructor(err, AssertionError)) {
            throw err;
          }
          if (firstErr === null) firstErr = err;
          numErrs++;
        }
      }, this);
      if (negate && props.length > 1 && numErrs === props.length) {
        throw firstErr;
      }
      return;
    }
  }
  this.assert(
    included,
    "expected #{this} to " + descriptor + "include " + inspect2(val),
    "expected #{this} to not " + descriptor + "include " + inspect2(val)
  );
}
__name(include, "include");
Assertion.addChainableMethod("include", include, includeChainingBehavior);
Assertion.addChainableMethod("contain", include, includeChainingBehavior);
Assertion.addChainableMethod("contains", include, includeChainingBehavior);
Assertion.addChainableMethod("includes", include, includeChainingBehavior);
Assertion.addProperty("ok", function() {
  this.assert(
    flag2(this, "object"),
    "expected #{this} to be truthy",
    "expected #{this} to be falsy"
  );
});
Assertion.addProperty("true", function() {
  this.assert(
    true === flag2(this, "object"),
    "expected #{this} to be true",
    "expected #{this} to be false",
    flag2(this, "negate") ? false : true
  );
});
Assertion.addProperty("numeric", function() {
  const object = flag2(this, "object");
  this.assert(
    ["Number", "BigInt"].includes(type(object)),
    "expected #{this} to be numeric",
    "expected #{this} to not be numeric",
    flag2(this, "negate") ? false : true
  );
});
Assertion.addProperty("callable", function() {
  const val = flag2(this, "object");
  const ssfi = flag2(this, "ssfi");
  const message = flag2(this, "message");
  const msg = message ? `${message}: ` : "";
  const negate = flag2(this, "negate");
  const assertionMessage = negate ? `${msg}expected ${inspect2(val)} not to be a callable function` : `${msg}expected ${inspect2(val)} to be a callable function`;
  const isCallable = [
    "Function",
    "AsyncFunction",
    "GeneratorFunction",
    "AsyncGeneratorFunction"
  ].includes(type(val));
  if (isCallable && negate || !isCallable && !negate) {
    throw new AssertionError(assertionMessage, void 0, ssfi);
  }
});
Assertion.addProperty("false", function() {
  this.assert(
    false === flag2(this, "object"),
    "expected #{this} to be false",
    "expected #{this} to be true",
    flag2(this, "negate") ? true : false
  );
});
Assertion.addProperty("null", function() {
  this.assert(
    null === flag2(this, "object"),
    "expected #{this} to be null",
    "expected #{this} not to be null"
  );
});
Assertion.addProperty("undefined", function() {
  this.assert(
    void 0 === flag2(this, "object"),
    "expected #{this} to be undefined",
    "expected #{this} not to be undefined"
  );
});
Assertion.addProperty("NaN", function() {
  this.assert(
    isNaN2(flag2(this, "object")),
    "expected #{this} to be NaN",
    "expected #{this} not to be NaN"
  );
});
function assertExist() {
  let val = flag2(this, "object");
  this.assert(
    val !== null && val !== void 0,
    "expected #{this} to exist",
    "expected #{this} to not exist"
  );
}
__name(assertExist, "assertExist");
Assertion.addProperty("exist", assertExist);
Assertion.addProperty("exists", assertExist);
Assertion.addProperty("empty", function() {
  let val = flag2(this, "object"), ssfi = flag2(this, "ssfi"), flagMsg = flag2(this, "message"), itemsCount;
  flagMsg = flagMsg ? flagMsg + ": " : "";
  switch (type(val).toLowerCase()) {
    case "array":
    case "string":
      itemsCount = val.length;
      break;
    case "map":
    case "set":
      itemsCount = val.size;
      break;
    case "weakmap":
    case "weakset":
      throw new AssertionError(
        flagMsg + ".empty was passed a weak collection",
        void 0,
        ssfi
      );
    case "function": {
      const msg = flagMsg + ".empty was passed a function " + getName(val);
      throw new AssertionError(msg.trim(), void 0, ssfi);
    }
    default:
      if (val !== Object(val)) {
        throw new AssertionError(
          flagMsg + ".empty was passed non-string primitive " + inspect2(val),
          void 0,
          ssfi
        );
      }
      itemsCount = Object.keys(val).length;
  }
  this.assert(
    0 === itemsCount,
    "expected #{this} to be empty",
    "expected #{this} not to be empty"
  );
});
function checkArguments() {
  let obj = flag2(this, "object"), type3 = type(obj);
  this.assert(
    "Arguments" === type3,
    "expected #{this} to be arguments but got " + type3,
    "expected #{this} to not be arguments"
  );
}
__name(checkArguments, "checkArguments");
Assertion.addProperty("arguments", checkArguments);
Assertion.addProperty("Arguments", checkArguments);
function assertEqual(val, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object");
  if (flag2(this, "deep")) {
    let prevLockSsfi = flag2(this, "lockSsfi");
    flag2(this, "lockSsfi", true);
    this.eql(val);
    flag2(this, "lockSsfi", prevLockSsfi);
  } else {
    this.assert(
      val === obj,
      "expected #{this} to equal #{exp}",
      "expected #{this} to not equal #{exp}",
      val,
      this._obj,
      true
    );
  }
}
__name(assertEqual, "assertEqual");
Assertion.addMethod("equal", assertEqual);
Assertion.addMethod("equals", assertEqual);
Assertion.addMethod("eq", assertEqual);
function assertEql(obj, msg) {
  if (msg) flag2(this, "message", msg);
  let eql = flag2(this, "eql");
  this.assert(
    eql(obj, flag2(this, "object")),
    "expected #{this} to deeply equal #{exp}",
    "expected #{this} to not deeply equal #{exp}",
    obj,
    this._obj,
    true
  );
}
__name(assertEql, "assertEql");
Assertion.addMethod("eql", assertEql);
Assertion.addMethod("eqls", assertEql);
function assertAbove(n, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), doLength = flag2(this, "doLength"), flagMsg = flag2(this, "message"), msgPrefix = flagMsg ? flagMsg + ": " : "", ssfi = flag2(this, "ssfi"), objType = type(obj).toLowerCase(), nType = type(n).toLowerCase();
  if (doLength && objType !== "map" && objType !== "set") {
    new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
  }
  if (!doLength && objType === "date" && nType !== "date") {
    throw new AssertionError(
      msgPrefix + "the argument to above must be a date",
      void 0,
      ssfi
    );
  } else if (!isNumeric(n) && (doLength || isNumeric(obj))) {
    throw new AssertionError(
      msgPrefix + "the argument to above must be a number",
      void 0,
      ssfi
    );
  } else if (!doLength && objType !== "date" && !isNumeric(obj)) {
    let printObj = objType === "string" ? "'" + obj + "'" : obj;
    throw new AssertionError(
      msgPrefix + "expected " + printObj + " to be a number or a date",
      void 0,
      ssfi
    );
  }
  if (doLength) {
    let descriptor = "length", itemsCount;
    if (objType === "map" || objType === "set") {
      descriptor = "size";
      itemsCount = obj.size;
    } else {
      itemsCount = obj.length;
    }
    this.assert(
      itemsCount > n,
      "expected #{this} to have a " + descriptor + " above #{exp} but got #{act}",
      "expected #{this} to not have a " + descriptor + " above #{exp}",
      n,
      itemsCount
    );
  } else {
    this.assert(
      obj > n,
      "expected #{this} to be above #{exp}",
      "expected #{this} to be at most #{exp}",
      n
    );
  }
}
__name(assertAbove, "assertAbove");
Assertion.addMethod("above", assertAbove);
Assertion.addMethod("gt", assertAbove);
Assertion.addMethod("greaterThan", assertAbove);
function assertLeast(n, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), doLength = flag2(this, "doLength"), flagMsg = flag2(this, "message"), msgPrefix = flagMsg ? flagMsg + ": " : "", ssfi = flag2(this, "ssfi"), objType = type(obj).toLowerCase(), nType = type(n).toLowerCase(), errorMessage, shouldThrow = true;
  if (doLength && objType !== "map" && objType !== "set") {
    new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
  }
  if (!doLength && objType === "date" && nType !== "date") {
    errorMessage = msgPrefix + "the argument to least must be a date";
  } else if (!isNumeric(n) && (doLength || isNumeric(obj))) {
    errorMessage = msgPrefix + "the argument to least must be a number";
  } else if (!doLength && objType !== "date" && !isNumeric(obj)) {
    let printObj = objType === "string" ? "'" + obj + "'" : obj;
    errorMessage = msgPrefix + "expected " + printObj + " to be a number or a date";
  } else {
    shouldThrow = false;
  }
  if (shouldThrow) {
    throw new AssertionError(errorMessage, void 0, ssfi);
  }
  if (doLength) {
    let descriptor = "length", itemsCount;
    if (objType === "map" || objType === "set") {
      descriptor = "size";
      itemsCount = obj.size;
    } else {
      itemsCount = obj.length;
    }
    this.assert(
      itemsCount >= n,
      "expected #{this} to have a " + descriptor + " at least #{exp} but got #{act}",
      "expected #{this} to have a " + descriptor + " below #{exp}",
      n,
      itemsCount
    );
  } else {
    this.assert(
      obj >= n,
      "expected #{this} to be at least #{exp}",
      "expected #{this} to be below #{exp}",
      n
    );
  }
}
__name(assertLeast, "assertLeast");
Assertion.addMethod("least", assertLeast);
Assertion.addMethod("gte", assertLeast);
Assertion.addMethod("greaterThanOrEqual", assertLeast);
function assertBelow(n, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), doLength = flag2(this, "doLength"), flagMsg = flag2(this, "message"), msgPrefix = flagMsg ? flagMsg + ": " : "", ssfi = flag2(this, "ssfi"), objType = type(obj).toLowerCase(), nType = type(n).toLowerCase(), errorMessage, shouldThrow = true;
  if (doLength && objType !== "map" && objType !== "set") {
    new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
  }
  if (!doLength && objType === "date" && nType !== "date") {
    errorMessage = msgPrefix + "the argument to below must be a date";
  } else if (!isNumeric(n) && (doLength || isNumeric(obj))) {
    errorMessage = msgPrefix + "the argument to below must be a number";
  } else if (!doLength && objType !== "date" && !isNumeric(obj)) {
    let printObj = objType === "string" ? "'" + obj + "'" : obj;
    errorMessage = msgPrefix + "expected " + printObj + " to be a number or a date";
  } else {
    shouldThrow = false;
  }
  if (shouldThrow) {
    throw new AssertionError(errorMessage, void 0, ssfi);
  }
  if (doLength) {
    let descriptor = "length", itemsCount;
    if (objType === "map" || objType === "set") {
      descriptor = "size";
      itemsCount = obj.size;
    } else {
      itemsCount = obj.length;
    }
    this.assert(
      itemsCount < n,
      "expected #{this} to have a " + descriptor + " below #{exp} but got #{act}",
      "expected #{this} to not have a " + descriptor + " below #{exp}",
      n,
      itemsCount
    );
  } else {
    this.assert(
      obj < n,
      "expected #{this} to be below #{exp}",
      "expected #{this} to be at least #{exp}",
      n
    );
  }
}
__name(assertBelow, "assertBelow");
Assertion.addMethod("below", assertBelow);
Assertion.addMethod("lt", assertBelow);
Assertion.addMethod("lessThan", assertBelow);
function assertMost(n, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), doLength = flag2(this, "doLength"), flagMsg = flag2(this, "message"), msgPrefix = flagMsg ? flagMsg + ": " : "", ssfi = flag2(this, "ssfi"), objType = type(obj).toLowerCase(), nType = type(n).toLowerCase(), errorMessage, shouldThrow = true;
  if (doLength && objType !== "map" && objType !== "set") {
    new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
  }
  if (!doLength && objType === "date" && nType !== "date") {
    errorMessage = msgPrefix + "the argument to most must be a date";
  } else if (!isNumeric(n) && (doLength || isNumeric(obj))) {
    errorMessage = msgPrefix + "the argument to most must be a number";
  } else if (!doLength && objType !== "date" && !isNumeric(obj)) {
    let printObj = objType === "string" ? "'" + obj + "'" : obj;
    errorMessage = msgPrefix + "expected " + printObj + " to be a number or a date";
  } else {
    shouldThrow = false;
  }
  if (shouldThrow) {
    throw new AssertionError(errorMessage, void 0, ssfi);
  }
  if (doLength) {
    let descriptor = "length", itemsCount;
    if (objType === "map" || objType === "set") {
      descriptor = "size";
      itemsCount = obj.size;
    } else {
      itemsCount = obj.length;
    }
    this.assert(
      itemsCount <= n,
      "expected #{this} to have a " + descriptor + " at most #{exp} but got #{act}",
      "expected #{this} to have a " + descriptor + " above #{exp}",
      n,
      itemsCount
    );
  } else {
    this.assert(
      obj <= n,
      "expected #{this} to be at most #{exp}",
      "expected #{this} to be above #{exp}",
      n
    );
  }
}
__name(assertMost, "assertMost");
Assertion.addMethod("most", assertMost);
Assertion.addMethod("lte", assertMost);
Assertion.addMethod("lessThanOrEqual", assertMost);
Assertion.addMethod("within", function(start, finish, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), doLength = flag2(this, "doLength"), flagMsg = flag2(this, "message"), msgPrefix = flagMsg ? flagMsg + ": " : "", ssfi = flag2(this, "ssfi"), objType = type(obj).toLowerCase(), startType = type(start).toLowerCase(), finishType = type(finish).toLowerCase(), errorMessage, shouldThrow = true, range = startType === "date" && finishType === "date" ? start.toISOString() + ".." + finish.toISOString() : start + ".." + finish;
  if (doLength && objType !== "map" && objType !== "set") {
    new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
  }
  if (!doLength && objType === "date" && (startType !== "date" || finishType !== "date")) {
    errorMessage = msgPrefix + "the arguments to within must be dates";
  } else if ((!isNumeric(start) || !isNumeric(finish)) && (doLength || isNumeric(obj))) {
    errorMessage = msgPrefix + "the arguments to within must be numbers";
  } else if (!doLength && objType !== "date" && !isNumeric(obj)) {
    let printObj = objType === "string" ? "'" + obj + "'" : obj;
    errorMessage = msgPrefix + "expected " + printObj + " to be a number or a date";
  } else {
    shouldThrow = false;
  }
  if (shouldThrow) {
    throw new AssertionError(errorMessage, void 0, ssfi);
  }
  if (doLength) {
    let descriptor = "length", itemsCount;
    if (objType === "map" || objType === "set") {
      descriptor = "size";
      itemsCount = obj.size;
    } else {
      itemsCount = obj.length;
    }
    this.assert(
      itemsCount >= start && itemsCount <= finish,
      "expected #{this} to have a " + descriptor + " within " + range,
      "expected #{this} to not have a " + descriptor + " within " + range
    );
  } else {
    this.assert(
      obj >= start && obj <= finish,
      "expected #{this} to be within " + range,
      "expected #{this} to not be within " + range
    );
  }
});
function assertInstanceOf(constructor, msg) {
  if (msg) flag2(this, "message", msg);
  let target = flag2(this, "object");
  let ssfi = flag2(this, "ssfi");
  let flagMsg = flag2(this, "message");
  let isInstanceOf;
  try {
    isInstanceOf = target instanceof constructor;
  } catch (err) {
    if (err instanceof TypeError) {
      flagMsg = flagMsg ? flagMsg + ": " : "";
      throw new AssertionError(
        flagMsg + "The instanceof assertion needs a constructor but " + type(constructor) + " was given.",
        void 0,
        ssfi
      );
    }
    throw err;
  }
  let name = getName(constructor);
  if (name == null) {
    name = "an unnamed constructor";
  }
  this.assert(
    isInstanceOf,
    "expected #{this} to be an instance of " + name,
    "expected #{this} to not be an instance of " + name
  );
}
__name(assertInstanceOf, "assertInstanceOf");
Assertion.addMethod("instanceof", assertInstanceOf);
Assertion.addMethod("instanceOf", assertInstanceOf);
function assertProperty(name, val, msg) {
  if (msg) flag2(this, "message", msg);
  let isNested = flag2(this, "nested"), isOwn = flag2(this, "own"), flagMsg = flag2(this, "message"), obj = flag2(this, "object"), ssfi = flag2(this, "ssfi"), nameType = typeof name;
  flagMsg = flagMsg ? flagMsg + ": " : "";
  if (isNested) {
    if (nameType !== "string") {
      throw new AssertionError(
        flagMsg + "the argument to property must be a string when using nested syntax",
        void 0,
        ssfi
      );
    }
  } else {
    if (nameType !== "string" && nameType !== "number" && nameType !== "symbol") {
      throw new AssertionError(
        flagMsg + "the argument to property must be a string, number, or symbol",
        void 0,
        ssfi
      );
    }
  }
  if (isNested && isOwn) {
    throw new AssertionError(
      flagMsg + 'The "nested" and "own" flags cannot be combined.',
      void 0,
      ssfi
    );
  }
  if (obj === null || obj === void 0) {
    throw new AssertionError(
      flagMsg + "Target cannot be null or undefined.",
      void 0,
      ssfi
    );
  }
  let isDeep = flag2(this, "deep"), negate = flag2(this, "negate"), pathInfo = isNested ? getPathInfo(obj, name) : null, value = isNested ? pathInfo.value : obj[name], isEql = isDeep ? flag2(this, "eql") : (val1, val2) => val1 === val2;
  let descriptor = "";
  if (isDeep) descriptor += "deep ";
  if (isOwn) descriptor += "own ";
  if (isNested) descriptor += "nested ";
  descriptor += "property ";
  let hasProperty2;
  if (isOwn) hasProperty2 = Object.prototype.hasOwnProperty.call(obj, name);
  else if (isNested) hasProperty2 = pathInfo.exists;
  else hasProperty2 = hasProperty(obj, name);
  if (!negate || arguments.length === 1) {
    this.assert(
      hasProperty2,
      "expected #{this} to have " + descriptor + inspect2(name),
      "expected #{this} to not have " + descriptor + inspect2(name)
    );
  }
  if (arguments.length > 1) {
    this.assert(
      hasProperty2 && isEql(val, value),
      "expected #{this} to have " + descriptor + inspect2(name) + " of #{exp}, but got #{act}",
      "expected #{this} to not have " + descriptor + inspect2(name) + " of #{act}",
      val,
      value
    );
  }
  flag2(this, "object", value);
}
__name(assertProperty, "assertProperty");
Assertion.addMethod("property", assertProperty);
function assertOwnProperty(_name, _value, _msg) {
  flag2(this, "own", true);
  assertProperty.apply(this, arguments);
}
__name(assertOwnProperty, "assertOwnProperty");
Assertion.addMethod("ownProperty", assertOwnProperty);
Assertion.addMethod("haveOwnProperty", assertOwnProperty);
function assertOwnPropertyDescriptor(name, descriptor, msg) {
  if (typeof descriptor === "string") {
    msg = descriptor;
    descriptor = null;
  }
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object");
  let actualDescriptor = Object.getOwnPropertyDescriptor(Object(obj), name);
  let eql = flag2(this, "eql");
  if (actualDescriptor && descriptor) {
    this.assert(
      eql(descriptor, actualDescriptor),
      "expected the own property descriptor for " + inspect2(name) + " on #{this} to match " + inspect2(descriptor) + ", got " + inspect2(actualDescriptor),
      "expected the own property descriptor for " + inspect2(name) + " on #{this} to not match " + inspect2(descriptor),
      descriptor,
      actualDescriptor,
      true
    );
  } else {
    this.assert(
      actualDescriptor,
      "expected #{this} to have an own property descriptor for " + inspect2(name),
      "expected #{this} to not have an own property descriptor for " + inspect2(name)
    );
  }
  flag2(this, "object", actualDescriptor);
}
__name(assertOwnPropertyDescriptor, "assertOwnPropertyDescriptor");
Assertion.addMethod("ownPropertyDescriptor", assertOwnPropertyDescriptor);
Assertion.addMethod("haveOwnPropertyDescriptor", assertOwnPropertyDescriptor);
function assertLengthChain() {
  flag2(this, "doLength", true);
}
__name(assertLengthChain, "assertLengthChain");
function assertLength(n, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), objType = type(obj).toLowerCase(), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi"), descriptor = "length", itemsCount;
  switch (objType) {
    case "map":
    case "set":
      descriptor = "size";
      itemsCount = obj.size;
      break;
    default:
      new Assertion(obj, flagMsg, ssfi, true).to.have.property("length");
      itemsCount = obj.length;
  }
  this.assert(
    itemsCount == n,
    "expected #{this} to have a " + descriptor + " of #{exp} but got #{act}",
    "expected #{this} to not have a " + descriptor + " of #{act}",
    n,
    itemsCount
  );
}
__name(assertLength, "assertLength");
Assertion.addChainableMethod("length", assertLength, assertLengthChain);
Assertion.addChainableMethod("lengthOf", assertLength, assertLengthChain);
function assertMatch(re, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object");
  this.assert(
    re.exec(obj),
    "expected #{this} to match " + re,
    "expected #{this} not to match " + re
  );
}
__name(assertMatch, "assertMatch");
Assertion.addMethod("match", assertMatch);
Assertion.addMethod("matches", assertMatch);
Assertion.addMethod("string", function(str, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(obj, flagMsg, ssfi, true).is.a("string");
  this.assert(
    ~obj.indexOf(str),
    "expected #{this} to contain " + inspect2(str),
    "expected #{this} to not contain " + inspect2(str)
  );
});
function assertKeys(keys) {
  let obj = flag2(this, "object"), objType = type(obj), keysType = type(keys), ssfi = flag2(this, "ssfi"), isDeep = flag2(this, "deep"), str, deepStr = "", actual, ok = true, flagMsg = flag2(this, "message");
  flagMsg = flagMsg ? flagMsg + ": " : "";
  let mixedArgsMsg = flagMsg + "when testing keys against an object or an array you must give a single Array|Object|String argument or multiple String arguments";
  if (objType === "Map" || objType === "Set") {
    deepStr = isDeep ? "deeply " : "";
    actual = [];
    obj.forEach(function(val, key) {
      actual.push(key);
    });
    if (keysType !== "Array") {
      keys = Array.prototype.slice.call(arguments);
    }
  } else {
    actual = getOwnEnumerableProperties(obj);
    switch (keysType) {
      case "Array":
        if (arguments.length > 1) {
          throw new AssertionError(mixedArgsMsg, void 0, ssfi);
        }
        break;
      case "Object":
        if (arguments.length > 1) {
          throw new AssertionError(mixedArgsMsg, void 0, ssfi);
        }
        keys = Object.keys(keys);
        break;
      default:
        keys = Array.prototype.slice.call(arguments);
    }
    keys = keys.map(function(val) {
      return typeof val === "symbol" ? val : String(val);
    });
  }
  if (!keys.length) {
    throw new AssertionError(flagMsg + "keys required", void 0, ssfi);
  }
  let len = keys.length, any = flag2(this, "any"), all = flag2(this, "all"), expected = keys, isEql = isDeep ? flag2(this, "eql") : (val1, val2) => val1 === val2;
  if (!any && !all) {
    all = true;
  }
  if (any) {
    ok = expected.some(function(expectedKey) {
      return actual.some(function(actualKey) {
        return isEql(expectedKey, actualKey);
      });
    });
  }
  if (all) {
    ok = expected.every(function(expectedKey) {
      return actual.some(function(actualKey) {
        return isEql(expectedKey, actualKey);
      });
    });
    if (!flag2(this, "contains")) {
      ok = ok && keys.length == actual.length;
    }
  }
  if (len > 1) {
    keys = keys.map(function(key) {
      return inspect2(key);
    });
    let last = keys.pop();
    if (all) {
      str = keys.join(", ") + ", and " + last;
    }
    if (any) {
      str = keys.join(", ") + ", or " + last;
    }
  } else {
    str = inspect2(keys[0]);
  }
  str = (len > 1 ? "keys " : "key ") + str;
  str = (flag2(this, "contains") ? "contain " : "have ") + str;
  this.assert(
    ok,
    "expected #{this} to " + deepStr + str,
    "expected #{this} to not " + deepStr + str,
    expected.slice(0).sort(compareByInspect),
    actual.sort(compareByInspect),
    true
  );
}
__name(assertKeys, "assertKeys");
Assertion.addMethod("keys", assertKeys);
Assertion.addMethod("key", assertKeys);
function assertThrows(errorLike, errMsgMatcher, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), ssfi = flag2(this, "ssfi"), flagMsg = flag2(this, "message"), negate = flag2(this, "negate") || false;
  new Assertion(obj, flagMsg, ssfi, true).is.a("function");
  if (isRegExp2(errorLike) || typeof errorLike === "string") {
    errMsgMatcher = errorLike;
    errorLike = null;
  }
  let caughtErr;
  let errorWasThrown = false;
  try {
    obj();
  } catch (err) {
    errorWasThrown = true;
    caughtErr = err;
  }
  let everyArgIsUndefined = errorLike === void 0 && errMsgMatcher === void 0;
  let everyArgIsDefined = Boolean(errorLike && errMsgMatcher);
  let errorLikeFail = false;
  let errMsgMatcherFail = false;
  if (everyArgIsUndefined || !everyArgIsUndefined && !negate) {
    let errorLikeString = "an error";
    if (errorLike instanceof Error) {
      errorLikeString = "#{exp}";
    } else if (errorLike) {
      errorLikeString = check_error_exports.getConstructorName(errorLike);
    }
    let actual = caughtErr;
    if (caughtErr instanceof Error) {
      actual = caughtErr.toString();
    } else if (typeof caughtErr === "string") {
      actual = caughtErr;
    } else if (caughtErr && (typeof caughtErr === "object" || typeof caughtErr === "function")) {
      try {
        actual = check_error_exports.getConstructorName(caughtErr);
      } catch (_err) {
      }
    }
    this.assert(
      errorWasThrown,
      "expected #{this} to throw " + errorLikeString,
      "expected #{this} to not throw an error but #{act} was thrown",
      errorLike && errorLike.toString(),
      actual
    );
  }
  if (errorLike && caughtErr) {
    if (errorLike instanceof Error) {
      let isCompatibleInstance = check_error_exports.compatibleInstance(
        caughtErr,
        errorLike
      );
      if (isCompatibleInstance === negate) {
        if (everyArgIsDefined && negate) {
          errorLikeFail = true;
        } else {
          this.assert(
            negate,
            "expected #{this} to throw #{exp} but #{act} was thrown",
            "expected #{this} to not throw #{exp}" + (caughtErr && !negate ? " but #{act} was thrown" : ""),
            errorLike.toString(),
            caughtErr.toString()
          );
        }
      }
    }
    let isCompatibleConstructor = check_error_exports.compatibleConstructor(
      caughtErr,
      errorLike
    );
    if (isCompatibleConstructor === negate) {
      if (everyArgIsDefined && negate) {
        errorLikeFail = true;
      } else {
        this.assert(
          negate,
          "expected #{this} to throw #{exp} but #{act} was thrown",
          "expected #{this} to not throw #{exp}" + (caughtErr ? " but #{act} was thrown" : ""),
          errorLike instanceof Error ? errorLike.toString() : errorLike && check_error_exports.getConstructorName(errorLike),
          caughtErr instanceof Error ? caughtErr.toString() : caughtErr && check_error_exports.getConstructorName(caughtErr)
        );
      }
    }
  }
  if (caughtErr && errMsgMatcher !== void 0 && errMsgMatcher !== null) {
    let placeholder = "including";
    if (isRegExp2(errMsgMatcher)) {
      placeholder = "matching";
    }
    let isCompatibleMessage = check_error_exports.compatibleMessage(
      caughtErr,
      errMsgMatcher
    );
    if (isCompatibleMessage === negate) {
      if (everyArgIsDefined && negate) {
        errMsgMatcherFail = true;
      } else {
        this.assert(
          negate,
          "expected #{this} to throw error " + placeholder + " #{exp} but got #{act}",
          "expected #{this} to throw error not " + placeholder + " #{exp}",
          errMsgMatcher,
          check_error_exports.getMessage(caughtErr)
        );
      }
    }
  }
  if (errorLikeFail && errMsgMatcherFail) {
    this.assert(
      negate,
      "expected #{this} to throw #{exp} but #{act} was thrown",
      "expected #{this} to not throw #{exp}" + (caughtErr ? " but #{act} was thrown" : ""),
      errorLike instanceof Error ? errorLike.toString() : errorLike && check_error_exports.getConstructorName(errorLike),
      caughtErr instanceof Error ? caughtErr.toString() : caughtErr && check_error_exports.getConstructorName(caughtErr)
    );
  }
  flag2(this, "object", caughtErr);
}
__name(assertThrows, "assertThrows");
Assertion.addMethod("throw", assertThrows);
Assertion.addMethod("throws", assertThrows);
Assertion.addMethod("Throw", assertThrows);
function respondTo(method, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), itself = flag2(this, "itself"), context = "function" === typeof obj && !itself ? obj.prototype[method] : obj[method];
  this.assert(
    "function" === typeof context,
    "expected #{this} to respond to " + inspect2(method),
    "expected #{this} to not respond to " + inspect2(method)
  );
}
__name(respondTo, "respondTo");
Assertion.addMethod("respondTo", respondTo);
Assertion.addMethod("respondsTo", respondTo);
Assertion.addProperty("itself", function() {
  flag2(this, "itself", true);
});
function satisfy(matcher, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object");
  let result = matcher(obj);
  this.assert(
    result,
    "expected #{this} to satisfy " + objDisplay(matcher),
    "expected #{this} to not satisfy" + objDisplay(matcher),
    flag2(this, "negate") ? false : true,
    result
  );
}
__name(satisfy, "satisfy");
Assertion.addMethod("satisfy", satisfy);
Assertion.addMethod("satisfies", satisfy);
function closeTo(expected, delta, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(obj, flagMsg, ssfi, true).is.numeric;
  let message = "A `delta` value is required for `closeTo`";
  if (delta == void 0) {
    throw new AssertionError(
      flagMsg ? `${flagMsg}: ${message}` : message,
      void 0,
      ssfi
    );
  }
  new Assertion(delta, flagMsg, ssfi, true).is.numeric;
  message = "A `expected` value is required for `closeTo`";
  if (expected == void 0) {
    throw new AssertionError(
      flagMsg ? `${flagMsg}: ${message}` : message,
      void 0,
      ssfi
    );
  }
  new Assertion(expected, flagMsg, ssfi, true).is.numeric;
  const abs = /* @__PURE__ */ __name((x) => x < 0 ? -x : x, "abs");
  const strip = /* @__PURE__ */ __name((number) => parseFloat(parseFloat(number).toPrecision(12)), "strip");
  this.assert(
    strip(abs(obj - expected)) <= delta,
    "expected #{this} to be close to " + expected + " +/- " + delta,
    "expected #{this} not to be close to " + expected + " +/- " + delta
  );
}
__name(closeTo, "closeTo");
Assertion.addMethod("closeTo", closeTo);
Assertion.addMethod("approximately", closeTo);
function isSubsetOf(_subset, _superset, cmp, contains, ordered) {
  let superset = Array.from(_superset);
  let subset = Array.from(_subset);
  if (!contains) {
    if (subset.length !== superset.length) return false;
    superset = superset.slice();
  }
  return subset.every(function(elem, idx) {
    if (ordered) return cmp ? cmp(elem, superset[idx]) : elem === superset[idx];
    if (!cmp) {
      let matchIdx = superset.indexOf(elem);
      if (matchIdx === -1) return false;
      if (!contains) superset.splice(matchIdx, 1);
      return true;
    }
    return superset.some(function(elem2, matchIdx) {
      if (!cmp(elem, elem2)) return false;
      if (!contains) superset.splice(matchIdx, 1);
      return true;
    });
  });
}
__name(isSubsetOf, "isSubsetOf");
Assertion.addMethod("members", function(subset, msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(obj, flagMsg, ssfi, true).to.be.iterable;
  new Assertion(subset, flagMsg, ssfi, true).to.be.iterable;
  let contains = flag2(this, "contains");
  let ordered = flag2(this, "ordered");
  let subject, failMsg, failNegateMsg;
  if (contains) {
    subject = ordered ? "an ordered superset" : "a superset";
    failMsg = "expected #{this} to be " + subject + " of #{exp}";
    failNegateMsg = "expected #{this} to not be " + subject + " of #{exp}";
  } else {
    subject = ordered ? "ordered members" : "members";
    failMsg = "expected #{this} to have the same " + subject + " as #{exp}";
    failNegateMsg = "expected #{this} to not have the same " + subject + " as #{exp}";
  }
  let cmp = flag2(this, "deep") ? flag2(this, "eql") : void 0;
  this.assert(
    isSubsetOf(subset, obj, cmp, contains, ordered),
    failMsg,
    failNegateMsg,
    subset,
    obj,
    true
  );
});
Assertion.addProperty("iterable", function(msg) {
  if (msg) flag2(this, "message", msg);
  let obj = flag2(this, "object");
  this.assert(
    obj != void 0 && obj[Symbol.iterator],
    "expected #{this} to be an iterable",
    "expected #{this} to not be an iterable",
    obj
  );
});
function oneOf(list, msg) {
  if (msg) flag2(this, "message", msg);
  let expected = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi"), contains = flag2(this, "contains"), isDeep = flag2(this, "deep"), eql = flag2(this, "eql");
  new Assertion(list, flagMsg, ssfi, true).to.be.an("array");
  if (contains) {
    this.assert(
      list.some(function(possibility) {
        return expected.indexOf(possibility) > -1;
      }),
      "expected #{this} to contain one of #{exp}",
      "expected #{this} to not contain one of #{exp}",
      list,
      expected
    );
  } else {
    if (isDeep) {
      this.assert(
        list.some(function(possibility) {
          return eql(expected, possibility);
        }),
        "expected #{this} to deeply equal one of #{exp}",
        "expected #{this} to deeply equal one of #{exp}",
        list,
        expected
      );
    } else {
      this.assert(
        list.indexOf(expected) > -1,
        "expected #{this} to be one of #{exp}",
        "expected #{this} to not be one of #{exp}",
        list,
        expected
      );
    }
  }
}
__name(oneOf, "oneOf");
Assertion.addMethod("oneOf", oneOf);
function assertChanges(subject, prop, msg) {
  if (msg) flag2(this, "message", msg);
  let fn = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(fn, flagMsg, ssfi, true).is.a("function");
  let initial;
  if (!prop) {
    new Assertion(subject, flagMsg, ssfi, true).is.a("function");
    initial = subject();
  } else {
    new Assertion(subject, flagMsg, ssfi, true).to.have.property(prop);
    initial = subject[prop];
  }
  fn();
  let final = prop === void 0 || prop === null ? subject() : subject[prop];
  let msgObj = prop === void 0 || prop === null ? initial : "." + prop;
  flag2(this, "deltaMsgObj", msgObj);
  flag2(this, "initialDeltaValue", initial);
  flag2(this, "finalDeltaValue", final);
  flag2(this, "deltaBehavior", "change");
  flag2(this, "realDelta", final !== initial);
  this.assert(
    initial !== final,
    "expected " + msgObj + " to change",
    "expected " + msgObj + " to not change"
  );
}
__name(assertChanges, "assertChanges");
Assertion.addMethod("change", assertChanges);
Assertion.addMethod("changes", assertChanges);
function assertIncreases(subject, prop, msg) {
  if (msg) flag2(this, "message", msg);
  let fn = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(fn, flagMsg, ssfi, true).is.a("function");
  let initial;
  if (!prop) {
    new Assertion(subject, flagMsg, ssfi, true).is.a("function");
    initial = subject();
  } else {
    new Assertion(subject, flagMsg, ssfi, true).to.have.property(prop);
    initial = subject[prop];
  }
  new Assertion(initial, flagMsg, ssfi, true).is.a("number");
  fn();
  let final = prop === void 0 || prop === null ? subject() : subject[prop];
  let msgObj = prop === void 0 || prop === null ? initial : "." + prop;
  flag2(this, "deltaMsgObj", msgObj);
  flag2(this, "initialDeltaValue", initial);
  flag2(this, "finalDeltaValue", final);
  flag2(this, "deltaBehavior", "increase");
  flag2(this, "realDelta", final - initial);
  this.assert(
    final - initial > 0,
    "expected " + msgObj + " to increase",
    "expected " + msgObj + " to not increase"
  );
}
__name(assertIncreases, "assertIncreases");
Assertion.addMethod("increase", assertIncreases);
Assertion.addMethod("increases", assertIncreases);
function assertDecreases(subject, prop, msg) {
  if (msg) flag2(this, "message", msg);
  let fn = flag2(this, "object"), flagMsg = flag2(this, "message"), ssfi = flag2(this, "ssfi");
  new Assertion(fn, flagMsg, ssfi, true).is.a("function");
  let initial;
  if (!prop) {
    new Assertion(subject, flagMsg, ssfi, true).is.a("function");
    initial = subject();
  } else {
    new Assertion(subject, flagMsg, ssfi, true).to.have.property(prop);
    initial = subject[prop];
  }
  new Assertion(initial, flagMsg, ssfi, true).is.a("number");
  fn();
  let final = prop === void 0 || prop === null ? subject() : subject[prop];
  let msgObj = prop === void 0 || prop === null ? initial : "." + prop;
  flag2(this, "deltaMsgObj", msgObj);
  flag2(this, "initialDeltaValue", initial);
  flag2(this, "finalDeltaValue", final);
  flag2(this, "deltaBehavior", "decrease");
  flag2(this, "realDelta", initial - final);
  this.assert(
    final - initial < 0,
    "expected " + msgObj + " to decrease",
    "expected " + msgObj + " to not decrease"
  );
}
__name(assertDecreases, "assertDecreases");
Assertion.addMethod("decrease", assertDecreases);
Assertion.addMethod("decreases", assertDecreases);
function assertDelta(delta, msg) {
  if (msg) flag2(this, "message", msg);
  let msgObj = flag2(this, "deltaMsgObj");
  let initial = flag2(this, "initialDeltaValue");
  let final = flag2(this, "finalDeltaValue");
  let behavior = flag2(this, "deltaBehavior");
  let realDelta = flag2(this, "realDelta");
  let expression;
  if (behavior === "change") {
    expression = Math.abs(final - initial) === Math.abs(delta);
  } else {
    expression = realDelta === Math.abs(delta);
  }
  this.assert(
    expression,
    "expected " + msgObj + " to " + behavior + " by " + delta,
    "expected " + msgObj + " to not " + behavior + " by " + delta
  );
}
__name(assertDelta, "assertDelta");
Assertion.addMethod("by", assertDelta);
Assertion.addProperty("extensible", function() {
  let obj = flag2(this, "object");
  let isExtensible = obj === Object(obj) && Object.isExtensible(obj);
  this.assert(
    isExtensible,
    "expected #{this} to be extensible",
    "expected #{this} to not be extensible"
  );
});
Assertion.addProperty("sealed", function() {
  let obj = flag2(this, "object");
  let isSealed = obj === Object(obj) ? Object.isSealed(obj) : true;
  this.assert(
    isSealed,
    "expected #{this} to be sealed",
    "expected #{this} to not be sealed"
  );
});
Assertion.addProperty("frozen", function() {
  let obj = flag2(this, "object");
  let isFrozen = obj === Object(obj) ? Object.isFrozen(obj) : true;
  this.assert(
    isFrozen,
    "expected #{this} to be frozen",
    "expected #{this} to not be frozen"
  );
});
Assertion.addProperty("finite", function(_msg) {
  let obj = flag2(this, "object");
  this.assert(
    typeof obj === "number" && isFinite(obj),
    "expected #{this} to be a finite number",
    "expected #{this} to not be a finite number"
  );
});
function compareSubset(expected, actual) {
  if (expected === actual) {
    return true;
  }
  if (typeof actual !== typeof expected) {
    return false;
  }
  if (typeof expected !== "object" || expected === null) {
    return expected === actual;
  }
  if (!actual) {
    return false;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return false;
    }
    return expected.every(function(exp) {
      return actual.some(function(act) {
        return compareSubset(exp, act);
      });
    });
  }
  if (expected instanceof Date) {
    if (actual instanceof Date) {
      return expected.getTime() === actual.getTime();
    } else {
      return false;
    }
  }
  return Object.keys(expected).every(function(key) {
    let expectedValue = expected[key];
    let actualValue = actual[key];
    if (typeof expectedValue === "object" && expectedValue !== null && actualValue !== null) {
      return compareSubset(expectedValue, actualValue);
    }
    if (typeof expectedValue === "function") {
      return expectedValue(actualValue);
    }
    return actualValue === expectedValue;
  });
}
__name(compareSubset, "compareSubset");
Assertion.addMethod("containSubset", function(expected) {
  const actual = flag(this, "object");
  const showDiff = config.showDiff;
  this.assert(
    compareSubset(expected, actual),
    "expected #{act} to contain subset #{exp}",
    "expected #{act} to not contain subset #{exp}",
    expected,
    actual,
    showDiff
  );
});

// lib/chai/interface/expect.js
function expect(val, message) {
  return new Assertion(val, message);
}
__name(expect, "expect");
expect.fail = function(actual, expected, message, operator) {
  if (arguments.length < 2) {
    message = actual;
    actual = void 0;
  }
  message = message || "expect.fail()";
  throw new AssertionError(
    message,
    {
      actual,
      expected,
      operator
    },
    expect.fail
  );
};

// lib/chai/interface/should.js
var should_exports = {};
__export(should_exports, {
  Should: () => Should,
  should: () => should
});
function loadShould() {
  function shouldGetter() {
    if (this instanceof String || this instanceof Number || this instanceof Boolean || typeof Symbol === "function" && this instanceof Symbol || typeof BigInt === "function" && this instanceof BigInt) {
      return new Assertion(this.valueOf(), null, shouldGetter);
    }
    return new Assertion(this, null, shouldGetter);
  }
  __name(shouldGetter, "shouldGetter");
  function shouldSetter(value) {
    Object.defineProperty(this, "should", {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  __name(shouldSetter, "shouldSetter");
  Object.defineProperty(Object.prototype, "should", {
    set: shouldSetter,
    get: shouldGetter,
    configurable: true
  });
  let should2 = {};
  should2.fail = function(actual, expected, message, operator) {
    if (arguments.length < 2) {
      message = actual;
      actual = void 0;
    }
    message = message || "should.fail()";
    throw new AssertionError(
      message,
      {
        actual,
        expected,
        operator
      },
      should2.fail
    );
  };
  should2.equal = function(actual, expected, message) {
    new Assertion(actual, message).to.equal(expected);
  };
  should2.Throw = function(fn, errt, errs, msg) {
    new Assertion(fn, msg).to.Throw(errt, errs);
  };
  should2.exist = function(val, msg) {
    new Assertion(val, msg).to.exist;
  };
  should2.not = {};
  should2.not.equal = function(actual, expected, msg) {
    new Assertion(actual, msg).to.not.equal(expected);
  };
  should2.not.Throw = function(fn, errt, errs, msg) {
    new Assertion(fn, msg).to.not.Throw(errt, errs);
  };
  should2.not.exist = function(val, msg) {
    new Assertion(val, msg).to.not.exist;
  };
  should2["throw"] = should2["Throw"];
  should2.not["throw"] = should2.not["Throw"];
  return should2;
}
__name(loadShould, "loadShould");
var should = loadShould;
var Should = loadShould;

// lib/chai/interface/assert.js
function assert$1(express, errmsg) {
  let test2 = new Assertion(null, null, assert$1, true);
  test2.assert(express, errmsg, "[ negation message unavailable ]");
}
__name(assert$1, "assert");
assert$1.fail = function(actual, expected, message, operator) {
  if (arguments.length < 2) {
    message = actual;
    actual = void 0;
  }
  message = message || "assert.fail()";
  throw new AssertionError(
    message,
    {
      actual,
      expected,
      operator
    },
    assert$1.fail
  );
};
assert$1.isOk = function(val, msg) {
  new Assertion(val, msg, assert$1.isOk, true).is.ok;
};
assert$1.isNotOk = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotOk, true).is.not.ok;
};
assert$1.equal = function(act, exp, msg) {
  let test2 = new Assertion(act, msg, assert$1.equal, true);
  test2.assert(
    exp == flag(test2, "object"),
    "expected #{this} to equal #{exp}",
    "expected #{this} to not equal #{act}",
    exp,
    act,
    true
  );
};
assert$1.notEqual = function(act, exp, msg) {
  let test2 = new Assertion(act, msg, assert$1.notEqual, true);
  test2.assert(
    exp != flag(test2, "object"),
    "expected #{this} to not equal #{exp}",
    "expected #{this} to equal #{act}",
    exp,
    act,
    true
  );
};
assert$1.strictEqual = function(act, exp, msg) {
  new Assertion(act, msg, assert$1.strictEqual, true).to.equal(exp);
};
assert$1.notStrictEqual = function(act, exp, msg) {
  new Assertion(act, msg, assert$1.notStrictEqual, true).to.not.equal(exp);
};
assert$1.deepEqual = assert$1.deepStrictEqual = function(act, exp, msg) {
  new Assertion(act, msg, assert$1.deepEqual, true).to.eql(exp);
};
assert$1.notDeepEqual = function(act, exp, msg) {
  new Assertion(act, msg, assert$1.notDeepEqual, true).to.not.eql(exp);
};
assert$1.isAbove = function(val, abv, msg) {
  new Assertion(val, msg, assert$1.isAbove, true).to.be.above(abv);
};
assert$1.isAtLeast = function(val, atlst, msg) {
  new Assertion(val, msg, assert$1.isAtLeast, true).to.be.least(atlst);
};
assert$1.isBelow = function(val, blw, msg) {
  new Assertion(val, msg, assert$1.isBelow, true).to.be.below(blw);
};
assert$1.isAtMost = function(val, atmst, msg) {
  new Assertion(val, msg, assert$1.isAtMost, true).to.be.most(atmst);
};
assert$1.isTrue = function(val, msg) {
  new Assertion(val, msg, assert$1.isTrue, true).is["true"];
};
assert$1.isNotTrue = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotTrue, true).to.not.equal(true);
};
assert$1.isFalse = function(val, msg) {
  new Assertion(val, msg, assert$1.isFalse, true).is["false"];
};
assert$1.isNotFalse = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotFalse, true).to.not.equal(false);
};
assert$1.isNull = function(val, msg) {
  new Assertion(val, msg, assert$1.isNull, true).to.equal(null);
};
assert$1.isNotNull = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotNull, true).to.not.equal(null);
};
assert$1.isNaN = function(val, msg) {
  new Assertion(val, msg, assert$1.isNaN, true).to.be.NaN;
};
assert$1.isNotNaN = function(value, message) {
  new Assertion(value, message, assert$1.isNotNaN, true).not.to.be.NaN;
};
assert$1.exists = function(val, msg) {
  new Assertion(val, msg, assert$1.exists, true).to.exist;
};
assert$1.notExists = function(val, msg) {
  new Assertion(val, msg, assert$1.notExists, true).to.not.exist;
};
assert$1.isUndefined = function(val, msg) {
  new Assertion(val, msg, assert$1.isUndefined, true).to.equal(void 0);
};
assert$1.isDefined = function(val, msg) {
  new Assertion(val, msg, assert$1.isDefined, true).to.not.equal(void 0);
};
assert$1.isCallable = function(value, message) {
  new Assertion(value, message, assert$1.isCallable, true).is.callable;
};
assert$1.isNotCallable = function(value, message) {
  new Assertion(value, message, assert$1.isNotCallable, true).is.not.callable;
};
assert$1.isObject = function(val, msg) {
  new Assertion(val, msg, assert$1.isObject, true).to.be.a("object");
};
assert$1.isNotObject = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotObject, true).to.not.be.a("object");
};
assert$1.isArray = function(val, msg) {
  new Assertion(val, msg, assert$1.isArray, true).to.be.an("array");
};
assert$1.isNotArray = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotArray, true).to.not.be.an("array");
};
assert$1.isString = function(val, msg) {
  new Assertion(val, msg, assert$1.isString, true).to.be.a("string");
};
assert$1.isNotString = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotString, true).to.not.be.a("string");
};
assert$1.isNumber = function(val, msg) {
  new Assertion(val, msg, assert$1.isNumber, true).to.be.a("number");
};
assert$1.isNotNumber = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotNumber, true).to.not.be.a("number");
};
assert$1.isNumeric = function(val, msg) {
  new Assertion(val, msg, assert$1.isNumeric, true).is.numeric;
};
assert$1.isNotNumeric = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotNumeric, true).is.not.numeric;
};
assert$1.isFinite = function(val, msg) {
  new Assertion(val, msg, assert$1.isFinite, true).to.be.finite;
};
assert$1.isBoolean = function(val, msg) {
  new Assertion(val, msg, assert$1.isBoolean, true).to.be.a("boolean");
};
assert$1.isNotBoolean = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotBoolean, true).to.not.be.a("boolean");
};
assert$1.typeOf = function(val, type3, msg) {
  new Assertion(val, msg, assert$1.typeOf, true).to.be.a(type3);
};
assert$1.notTypeOf = function(value, type3, message) {
  new Assertion(value, message, assert$1.notTypeOf, true).to.not.be.a(type3);
};
assert$1.instanceOf = function(val, type3, msg) {
  new Assertion(val, msg, assert$1.instanceOf, true).to.be.instanceOf(type3);
};
assert$1.notInstanceOf = function(val, type3, msg) {
  new Assertion(val, msg, assert$1.notInstanceOf, true).to.not.be.instanceOf(
    type3
  );
};
assert$1.include = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.include, true).include(inc);
};
assert$1.notInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.notInclude, true).not.include(inc);
};
assert$1.deepInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.deepInclude, true).deep.include(inc);
};
assert$1.notDeepInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.notDeepInclude, true).not.deep.include(inc);
};
assert$1.nestedInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.nestedInclude, true).nested.include(inc);
};
assert$1.notNestedInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.notNestedInclude, true).not.nested.include(
    inc
  );
};
assert$1.deepNestedInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.deepNestedInclude, true).deep.nested.include(
    inc
  );
};
assert$1.notDeepNestedInclude = function(exp, inc, msg) {
  new Assertion(
    exp,
    msg,
    assert$1.notDeepNestedInclude,
    true
  ).not.deep.nested.include(inc);
};
assert$1.ownInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.ownInclude, true).own.include(inc);
};
assert$1.notOwnInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.notOwnInclude, true).not.own.include(inc);
};
assert$1.deepOwnInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.deepOwnInclude, true).deep.own.include(inc);
};
assert$1.notDeepOwnInclude = function(exp, inc, msg) {
  new Assertion(exp, msg, assert$1.notDeepOwnInclude, true).not.deep.own.include(
    inc
  );
};
assert$1.match = function(exp, re, msg) {
  new Assertion(exp, msg, assert$1.match, true).to.match(re);
};
assert$1.notMatch = function(exp, re, msg) {
  new Assertion(exp, msg, assert$1.notMatch, true).to.not.match(re);
};
assert$1.property = function(obj, prop, msg) {
  new Assertion(obj, msg, assert$1.property, true).to.have.property(prop);
};
assert$1.notProperty = function(obj, prop, msg) {
  new Assertion(obj, msg, assert$1.notProperty, true).to.not.have.property(prop);
};
assert$1.propertyVal = function(obj, prop, val, msg) {
  new Assertion(obj, msg, assert$1.propertyVal, true).to.have.property(prop, val);
};
assert$1.notPropertyVal = function(obj, prop, val, msg) {
  new Assertion(obj, msg, assert$1.notPropertyVal, true).to.not.have.property(
    prop,
    val
  );
};
assert$1.deepPropertyVal = function(obj, prop, val, msg) {
  new Assertion(obj, msg, assert$1.deepPropertyVal, true).to.have.deep.property(
    prop,
    val
  );
};
assert$1.notDeepPropertyVal = function(obj, prop, val, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notDeepPropertyVal,
    true
  ).to.not.have.deep.property(prop, val);
};
assert$1.ownProperty = function(obj, prop, msg) {
  new Assertion(obj, msg, assert$1.ownProperty, true).to.have.own.property(prop);
};
assert$1.notOwnProperty = function(obj, prop, msg) {
  new Assertion(obj, msg, assert$1.notOwnProperty, true).to.not.have.own.property(
    prop
  );
};
assert$1.ownPropertyVal = function(obj, prop, value, msg) {
  new Assertion(obj, msg, assert$1.ownPropertyVal, true).to.have.own.property(
    prop,
    value
  );
};
assert$1.notOwnPropertyVal = function(obj, prop, value, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notOwnPropertyVal,
    true
  ).to.not.have.own.property(prop, value);
};
assert$1.deepOwnPropertyVal = function(obj, prop, value, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.deepOwnPropertyVal,
    true
  ).to.have.deep.own.property(prop, value);
};
assert$1.notDeepOwnPropertyVal = function(obj, prop, value, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notDeepOwnPropertyVal,
    true
  ).to.not.have.deep.own.property(prop, value);
};
assert$1.nestedProperty = function(obj, prop, msg) {
  new Assertion(obj, msg, assert$1.nestedProperty, true).to.have.nested.property(
    prop
  );
};
assert$1.notNestedProperty = function(obj, prop, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notNestedProperty,
    true
  ).to.not.have.nested.property(prop);
};
assert$1.nestedPropertyVal = function(obj, prop, val, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.nestedPropertyVal,
    true
  ).to.have.nested.property(prop, val);
};
assert$1.notNestedPropertyVal = function(obj, prop, val, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notNestedPropertyVal,
    true
  ).to.not.have.nested.property(prop, val);
};
assert$1.deepNestedPropertyVal = function(obj, prop, val, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.deepNestedPropertyVal,
    true
  ).to.have.deep.nested.property(prop, val);
};
assert$1.notDeepNestedPropertyVal = function(obj, prop, val, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.notDeepNestedPropertyVal,
    true
  ).to.not.have.deep.nested.property(prop, val);
};
assert$1.lengthOf = function(exp, len, msg) {
  new Assertion(exp, msg, assert$1.lengthOf, true).to.have.lengthOf(len);
};
assert$1.hasAnyKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.hasAnyKeys, true).to.have.any.keys(keys);
};
assert$1.hasAllKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.hasAllKeys, true).to.have.all.keys(keys);
};
assert$1.containsAllKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.containsAllKeys, true).to.contain.all.keys(
    keys
  );
};
assert$1.doesNotHaveAnyKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.doesNotHaveAnyKeys, true).to.not.have.any.keys(
    keys
  );
};
assert$1.doesNotHaveAllKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.doesNotHaveAllKeys, true).to.not.have.all.keys(
    keys
  );
};
assert$1.hasAnyDeepKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.hasAnyDeepKeys, true).to.have.any.deep.keys(
    keys
  );
};
assert$1.hasAllDeepKeys = function(obj, keys, msg) {
  new Assertion(obj, msg, assert$1.hasAllDeepKeys, true).to.have.all.deep.keys(
    keys
  );
};
assert$1.containsAllDeepKeys = function(obj, keys, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.containsAllDeepKeys,
    true
  ).to.contain.all.deep.keys(keys);
};
assert$1.doesNotHaveAnyDeepKeys = function(obj, keys, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.doesNotHaveAnyDeepKeys,
    true
  ).to.not.have.any.deep.keys(keys);
};
assert$1.doesNotHaveAllDeepKeys = function(obj, keys, msg) {
  new Assertion(
    obj,
    msg,
    assert$1.doesNotHaveAllDeepKeys,
    true
  ).to.not.have.all.deep.keys(keys);
};
assert$1.throws = function(fn, errorLike, errMsgMatcher, msg) {
  if ("string" === typeof errorLike || errorLike instanceof RegExp) {
    errMsgMatcher = errorLike;
    errorLike = null;
  }
  let assertErr = new Assertion(fn, msg, assert$1.throws, true).to.throw(
    errorLike,
    errMsgMatcher
  );
  return flag(assertErr, "object");
};
assert$1.doesNotThrow = function(fn, errorLike, errMsgMatcher, message) {
  if ("string" === typeof errorLike || errorLike instanceof RegExp) {
    errMsgMatcher = errorLike;
    errorLike = null;
  }
  new Assertion(fn, message, assert$1.doesNotThrow, true).to.not.throw(
    errorLike,
    errMsgMatcher
  );
};
assert$1.operator = function(val, operator, val2, msg) {
  let ok;
  switch (operator) {
    case "==":
      ok = val == val2;
      break;
    case "===":
      ok = val === val2;
      break;
    case ">":
      ok = val > val2;
      break;
    case ">=":
      ok = val >= val2;
      break;
    case "<":
      ok = val < val2;
      break;
    case "<=":
      ok = val <= val2;
      break;
    case "!=":
      ok = val != val2;
      break;
    case "!==":
      ok = val !== val2;
      break;
    default:
      msg = msg ? msg + ": " : msg;
      throw new AssertionError(
        msg + 'Invalid operator "' + operator + '"',
        void 0,
        assert$1.operator
      );
  }
  let test2 = new Assertion(ok, msg, assert$1.operator, true);
  test2.assert(
    true === flag(test2, "object"),
    "expected " + inspect2(val) + " to be " + operator + " " + inspect2(val2),
    "expected " + inspect2(val) + " to not be " + operator + " " + inspect2(val2)
  );
};
assert$1.closeTo = function(act, exp, delta, msg) {
  new Assertion(act, msg, assert$1.closeTo, true).to.be.closeTo(exp, delta);
};
assert$1.approximately = function(act, exp, delta, msg) {
  new Assertion(act, msg, assert$1.approximately, true).to.be.approximately(
    exp,
    delta
  );
};
assert$1.sameMembers = function(set1, set2, msg) {
  new Assertion(set1, msg, assert$1.sameMembers, true).to.have.same.members(set2);
};
assert$1.notSameMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.notSameMembers,
    true
  ).to.not.have.same.members(set2);
};
assert$1.sameDeepMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.sameDeepMembers,
    true
  ).to.have.same.deep.members(set2);
};
assert$1.notSameDeepMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.notSameDeepMembers,
    true
  ).to.not.have.same.deep.members(set2);
};
assert$1.sameOrderedMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.sameOrderedMembers,
    true
  ).to.have.same.ordered.members(set2);
};
assert$1.notSameOrderedMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.notSameOrderedMembers,
    true
  ).to.not.have.same.ordered.members(set2);
};
assert$1.sameDeepOrderedMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.sameDeepOrderedMembers,
    true
  ).to.have.same.deep.ordered.members(set2);
};
assert$1.notSameDeepOrderedMembers = function(set1, set2, msg) {
  new Assertion(
    set1,
    msg,
    assert$1.notSameDeepOrderedMembers,
    true
  ).to.not.have.same.deep.ordered.members(set2);
};
assert$1.includeMembers = function(superset, subset, msg) {
  new Assertion(superset, msg, assert$1.includeMembers, true).to.include.members(
    subset
  );
};
assert$1.notIncludeMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.notIncludeMembers,
    true
  ).to.not.include.members(subset);
};
assert$1.includeDeepMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.includeDeepMembers,
    true
  ).to.include.deep.members(subset);
};
assert$1.notIncludeDeepMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.notIncludeDeepMembers,
    true
  ).to.not.include.deep.members(subset);
};
assert$1.includeOrderedMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.includeOrderedMembers,
    true
  ).to.include.ordered.members(subset);
};
assert$1.notIncludeOrderedMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.notIncludeOrderedMembers,
    true
  ).to.not.include.ordered.members(subset);
};
assert$1.includeDeepOrderedMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.includeDeepOrderedMembers,
    true
  ).to.include.deep.ordered.members(subset);
};
assert$1.notIncludeDeepOrderedMembers = function(superset, subset, msg) {
  new Assertion(
    superset,
    msg,
    assert$1.notIncludeDeepOrderedMembers,
    true
  ).to.not.include.deep.ordered.members(subset);
};
assert$1.oneOf = function(inList, list, msg) {
  new Assertion(inList, msg, assert$1.oneOf, true).to.be.oneOf(list);
};
assert$1.isIterable = function(obj, msg) {
  if (obj == void 0 || !obj[Symbol.iterator]) {
    msg = msg ? `${msg} expected ${inspect2(obj)} to be an iterable` : `expected ${inspect2(obj)} to be an iterable`;
    throw new AssertionError(msg, void 0, assert$1.isIterable);
  }
};
assert$1.changes = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.changes, true).to.change(obj, prop);
};
assert$1.changesBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.changesBy, true).to.change(obj, prop).by(delta);
};
assert$1.doesNotChange = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.doesNotChange, true).to.not.change(
    obj,
    prop
  );
};
assert$1.changesButNotBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.changesButNotBy, true).to.change(obj, prop).but.not.by(delta);
};
assert$1.increases = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.increases, true).to.increase(obj, prop);
};
assert$1.increasesBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.increasesBy, true).to.increase(obj, prop).by(delta);
};
assert$1.doesNotIncrease = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.doesNotIncrease, true).to.not.increase(
    obj,
    prop
  );
};
assert$1.increasesButNotBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.increasesButNotBy, true).to.increase(obj, prop).but.not.by(delta);
};
assert$1.decreases = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.decreases, true).to.decrease(obj, prop);
};
assert$1.decreasesBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.decreasesBy, true).to.decrease(obj, prop).by(delta);
};
assert$1.doesNotDecrease = function(fn, obj, prop, msg) {
  if (arguments.length === 3 && typeof obj === "function") {
    msg = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.doesNotDecrease, true).to.not.decrease(
    obj,
    prop
  );
};
assert$1.doesNotDecreaseBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  return new Assertion(fn, msg, assert$1.doesNotDecreaseBy, true).to.not.decrease(obj, prop).by(delta);
};
assert$1.decreasesButNotBy = function(fn, obj, prop, delta, msg) {
  if (arguments.length === 4 && typeof obj === "function") {
    let tmpMsg = delta;
    delta = prop;
    msg = tmpMsg;
  } else if (arguments.length === 3) {
    delta = prop;
    prop = null;
  }
  new Assertion(fn, msg, assert$1.decreasesButNotBy, true).to.decrease(obj, prop).but.not.by(delta);
};
assert$1.ifError = function(val) {
  if (val) {
    throw val;
  }
};
assert$1.isExtensible = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isExtensible, true).to.be.extensible;
};
assert$1.isNotExtensible = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isNotExtensible, true).to.not.be.extensible;
};
assert$1.isSealed = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isSealed, true).to.be.sealed;
};
assert$1.isNotSealed = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isNotSealed, true).to.not.be.sealed;
};
assert$1.isFrozen = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isFrozen, true).to.be.frozen;
};
assert$1.isNotFrozen = function(obj, msg) {
  new Assertion(obj, msg, assert$1.isNotFrozen, true).to.not.be.frozen;
};
assert$1.isEmpty = function(val, msg) {
  new Assertion(val, msg, assert$1.isEmpty, true).to.be.empty;
};
assert$1.isNotEmpty = function(val, msg) {
  new Assertion(val, msg, assert$1.isNotEmpty, true).to.not.be.empty;
};
assert$1.containsSubset = function(val, exp, msg) {
  new Assertion(val, msg).to.containSubset(exp);
};
assert$1.doesNotContainSubset = function(val, exp, msg) {
  new Assertion(val, msg).to.not.containSubset(exp);
};
var aliases = [
  ["isOk", "ok"],
  ["isNotOk", "notOk"],
  ["throws", "throw"],
  ["throws", "Throw"],
  ["isExtensible", "extensible"],
  ["isNotExtensible", "notExtensible"],
  ["isSealed", "sealed"],
  ["isNotSealed", "notSealed"],
  ["isFrozen", "frozen"],
  ["isNotFrozen", "notFrozen"],
  ["isEmpty", "empty"],
  ["isNotEmpty", "notEmpty"],
  ["isCallable", "isFunction"],
  ["isNotCallable", "isNotFunction"],
  ["containsSubset", "containSubset"]
];
for (const [name, as] of aliases) {
  assert$1[as] = assert$1[name];
}

// lib/chai.js
var used = [];
function use(fn) {
  const exports$1 = {
    use,
    AssertionError,
    util: utils_exports,
    config,
    expect,
    assert: assert$1,
    Assertion,
    ...should_exports
  };
  if (!~used.indexOf(fn)) {
    fn(exports$1, utils_exports);
    used.push(fn);
  }
  return exports$1;
}
__name(use, "use");

const assert = assert$1;
describe('typescript', () => {
    before(() => {
        setOptions({ useWorkers: false }); // this the default
    });
    const longContent = `${new Array(200).fill('compress').join('')}\n`;
    const expectedStuff = {
        'stuff/': { isDir: true, },
        'stuff/dog.txt': { content: 'german shepard\n' },
        'stuff/birds/': { isDir: true, },
        'stuff/birds/bird.txt': { content: 'parrot\n' },
        'stuff/cat.txt': { content: 'siamese\n', },
        'stuff/json.txt': { content: '{"name":"homer","age":50}', },
        'stuff/long.txt': { content: longContent, },
        'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt': { content: 'Lookma! Unicode 😜', },
    };
    it('unzips', async () => {
        const utf8Encoder = new TextEncoder();
        const { zip, entries } = await unzip('../data/stuff.zip');
        assert.isString(zip.comment);
        for (const [name, entry] of Object.entries(entries)) {
            const expected = expectedStuff[name];
            assert.isOk(expected, name);
            if (expected.isDir) {
                assert.isTrue(entry.isDirectory);
            }
            else {
                const content = await entry.text();
                assert.equal(content, expected.content);
                const arrayBuffer = await entry.arrayBuffer();
                const expectedBytes = utf8Encoder.encode(content);
                assert.deepEqual(new Uint8Array(arrayBuffer), expectedBytes);
            }
        }
    });
});
const settings = Object.fromEntries(new URLSearchParams(window.location.search).entries());
if (settings.reporter) {
    mocha.reporter(settings.reporter);
}
mocha.run((failures) => {
    window.testsPromiseInfo.resolve(failures);
});
