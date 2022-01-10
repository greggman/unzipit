import ArrayBufferReader from './ArrayBufferReader.js';
import BlobReader from './BlobReader.js';
export * from './HTTPRangeReader.js';

import {
  inflateRawAsync,
  setOptions as setWorkerOptions,
  cleanup as cleanupInflate,
} from './inflate.js';
import {
  isBlob,
  isSharedArrayBuffer,
  isTypedArraySameAsArrayBuffer,
} from './utils.js';

/*
class Zip {
  constructor(reader) {
    comment,  // the comment for this entry
    commentBytes, // the raw comment for this entry
  }
}
*/

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
    return decodeBuffer(new Uint8Array(buffer), true);
  }
  // returns text with JSON.parse called on it. If you want more options decode arrayBuffer yourself
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
  return uint8View[offset    ] +
         uint8View[offset + 1] * 0x100;
}

function getUint32LE(uint8View, offset) {
  return uint8View[offset    ] +
         uint8View[offset + 1] * 0x100 +
         uint8View[offset + 2] * 0x10000 +
         uint8View[offset + 3] * 0x1000000;
}

function getUint64LE(uint8View, offset) {
  return getUint32LE(uint8View, offset) +
         getUint32LE(uint8View, offset + 4) * 0x100000000;
}

/* eslint-disable no-irregular-whitespace */
// const decodeCP437 = (function() {
//   const cp437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
//
//   return function(uint8view) {
//     return Array.from(uint8view).map(v => cp437[v]).join('');
//   };
// }());
/* eslint-enable no-irregular-whitespace */

const utf8Decoder = new TextDecoder();
function decodeBuffer(uint8View, isUTF8) {  /* eslint-disable-line no-unused-vars */ /* lgtm [js/superfluous-trailing-arguments] */
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
    } else {
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
    const isUTF8 = (rawEntry.generalPurposeBitFlag & 0x800) !== 0;
    rawEntry.nameBytes = data.slice(0, rawEntry.fileNameLength);
    rawEntry.name = decodeBuffer(rawEntry.nameBytes, isUTF8);

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
    rawEntry.comment = decodeBuffer(rawEntry.commentBytes, isUTF8);

    readEntryCursor += data.length;

    if (rawEntry.uncompressedSize            === 0xffffffff ||
        rawEntry.compressedSize              === 0xffffffff ||
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
    const nameField = rawEntry.extraFields.find(e =>
        e.id === 0x7075 &&
        e.data.length >= 6 && // too short to be meaningful
        e.data[0] === 1 &&    // Version       1 byte      version of this extra field, currently 1
        getUint32LE(e.data, 1), crc.unsigned(rawEntry.nameBytes)); // NameCRC32     4 bytes     File Name Field CRC32 Checksum
                                                                   // > If the CRC check fails, this UTF-8 Path Extra Field should be
                                                                   // > ignored and the File Name field in the header should be used instead.
    if (nameField) {
        // UnicodeName Variable UTF-8 version of the entry File Name
        rawEntry.fileName = decodeBuffer(nameField.data.slice(5), true);
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
  } else if (rawEntry.compressionMethod === 8) {
    // 8 - The file is Deflated
    decompress = true;
  } else {
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
  const {decompress, fileDataStart} = await readEntryDataHeader(reader, rawEntry);
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
  const result = await inflateRawAsync(typedArrayOrBlob, rawEntry.uncompressedSize);
  return result;
}

async function readEntryDataAsBlob(reader, rawEntry, type) {
  const {decompress, fileDataStart} = await readEntryDataHeader(reader, rawEntry);
  if (!decompress) {
    const typedArrayOrBlob = await readAsBlobOrTypedArray(reader, fileDataStart, rawEntry.compressedSize, type);
    if (isBlob(typedArrayOrBlob)) {
      return typedArrayOrBlob;
    }
    return new Blob([isSharedArrayBuffer(typedArrayOrBlob.buffer) ? new Uint8Array(typedArrayOrBlob) : typedArrayOrBlob], {type});
  }
  // Here's the issue with this mess (should refactor?)
  // if the source is a blob then we really want to pass a blob to inflateRawAsync to avoid a large
  // copy if we're going to a worker.
  const typedArrayOrBlob = await readAsBlobOrTypedArray(reader, fileDataStart, rawEntry.compressedSize);
  const result = await inflateRawAsync(typedArrayOrBlob, rawEntry.uncompressedSize, type);
  return result;
}

export function setOptions(options) {
  setWorkerOptions(options);
}

export async function unzipRaw(source) {
  let reader;
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    reader = new BlobReader(source);
  } else if (source instanceof ArrayBuffer || (source && source.buffer && source.buffer instanceof ArrayBuffer)) {
    reader = new ArrayBufferReader(source);
  } else if (isSharedArrayBuffer(source) || isSharedArrayBuffer(source.buffer)) {
    reader = new ArrayBufferReader(source);
  } else if (typeof source === 'string') {
    const req = await fetch(source);
    if (!req.ok) {
      throw new Error(`failed http request ${source}, status: ${req.status}: ${req.statusText}`);
    }
    const blob = await req.blob();
    reader = new BlobReader(blob);
  } else if (typeof source.getLength === 'function' && typeof source.read === 'function') {
    reader = source;
  } else {
    throw new Error('unsupported source type');
  }

  const totalLength = await reader.getLength();

  if (totalLength > Number.MAX_SAFE_INTEGER) {
    throw new Error(`file too large. size: ${totalLength}. Only file sizes up 4503599627370496 bytes are supported`);
  }

  return await findEndOfCentralDirector(reader, totalLength);
}

// If the names are not utf8 you should use unzipitRaw
export async function unzip(source) {
  const {zip, entries} = await unzipRaw(source);
  return {
    zip,
    entries: Object.fromEntries(entries.map(v => [v.name, v])),
  };
}

export function cleanup() {
  cleanupInflate();
}
