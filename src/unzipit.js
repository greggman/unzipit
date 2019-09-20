import ArrayBufferReader from './ArrayBufferReader.js';
import BlobReader from './BlobReader.js';
//import { unzip } from 'zlib';

/* global UZIP, pako */
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
  constructor(reader, entry) {
    this._reader = reader;
    this._entry = entry;
    this.name = entry.name;
    this.nameBytes = entry.nameBytes;
    this.size = entry.uncompressedSize;
    this.compressedSize = entry.compressedSize;
    this.comment = entry.comment;
    this.commentBytes = entry.commentBytes;
    this.lastModDate = dosDateTimeToDate(entry.lastModFileDate, entry.lastModFileTime);
    this.isDirectory = !!(entry.externalFileAttributes & 0x10);
  }
  // returns a promise that returns a Blob for this entry
  async blob(type = '') {
    const buffer = await this.arrayBuffer();
    return new Blob([buffer], {type});
  }
  // returns a promise that returns an ArrayBuffer for this entry
  async arrayBuffer() {
    return await readEntryData(this._reader, this._entry);
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

async function readAs(reader, offset, length, ViewType = Uint8Array) {
  const buffer = await reader.read(offset, length);
  return new ViewType(buffer);
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


const decodeCP437 = (function() {
  const cp437 = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

  return function(uint8view) {
    return uint8view.map(v => cp437[v]).join('');
  };
}());

const utf8Decoder = new TextDecoder();
function decodeBuffer(uint8View, isUTF8) {
  return utf8Decoder.decode(uint8View);  
  return isUTF8
      ? utf8Decoder.decode(uint8View)
      : decodeCP437(uint8View);
}

async function findEndOfCentralDirector(reader) {
  const size = Math.min(EOCDR_WITHOUT_COMMENT_SIZE + MAX_COMMENT_SIZE, reader.length);
  const readStart = reader.length - size;
  const data = await readAs(reader, readStart, size);
  for (let i = size - EOCDR_WITHOUT_COMMENT_SIZE; i >= 0; --i) {
    if (getUint32LE(data, i) !== EOCDR_SIGNATURE) {
      continue;
    }

    // 0 - End of central directory signature
    const eocdr = new Uint8Array(data.buffer, i);
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
    const commentBytes = new Uint8Array(eocdr.buffer, 22, commentLength);
    const comment = decodeBuffer(commentBytes);

    if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) {
      return await readZip64CentralDirectory(reader, readStart + i, comment, commentBytes);
    } else {
      return await readEntries(reader, centralDirectoryOffset, entryCount, comment, commentBytes);
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
  const zip64Eocdr = readAs(reader, zip64EocdrOffset, 56);

  // 0 - zip64 end of central dir signature                           4 bytes  (0x06064b50)
  if (getUint32LE(zip64Eocdr, 0) !== EOCDR_SIGNATURE) {
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
  // 48 - offset of start of central directory with respect to the starting disk number     8 bytes
  const centralDirectoryOffset = getUint64LE(zip64Eocdr, 48);
  // 56 - zip64 extensible data sector                                (variable size)
  return readEntries(reader, centralDirectoryOffset, entryCount, comment, commentBytes);
}

const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;

async function readEntries(reader, centralDirectoryOffset, entryCount, comment, commentBytes) {
  let readEntryCursor = centralDirectoryOffset;
  const entries = [];

  for (let e = 0; e < entryCount; ++e) {
    const buffer = await readAs(reader, readEntryCursor, 46);
    // 0 - Central directory file header signature
    const signature = getUint32LE(buffer, 0);
    if (signature !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      throw new Error(`invalid central directory file header signature: 0x${signature.toString(16)}`);
    }
    const entry = {
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

    if (entry.generalPurposeBitFlag & 0x40) {
      throw new Error('strong encryption is not supported');
    }

    readEntryCursor += 46;

    const data = await readAs(reader, readEntryCursor, entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);

    // 46 - File name
    const isUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0;
    entry.nameBytes = data.slice(0, entry.fileNameLength);
    entry.name = decodeBuffer(entry.nameBytes, isUtf8);

    // 46+n - Extra field
    const fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
    const extraFieldBuffer = data.slice(entry.fileNameLength, fileCommentStart);
    entry.extraFields = [];
    let i = 0;
    while (i < extraFieldBuffer.length - 3) {
      const headerId = getUint16LE(extraFieldBuffer, i + 0);
      const dataSize = getUint16LE(extraFieldBuffer, i + 2);
      const dataStart = i + 4;
      const dataEnd = dataStart + dataSize;
      if (dataEnd > extraFieldBuffer.length) {
        throw new Error('extra field length exceeds extra field buffer size');
      }
      entry.extraFields.push({
        id: headerId,
        data: extraFieldBuffer.slice(dataStart, dataEnd),
      });
      i = dataEnd;
    }

    // 46+n+m - File comment
    entry.commentBytes = data.slice(fileCommentStart, fileCommentStart + entry.fileCommentLength);
    entry.comment = decodeBuffer(entry.commentBytes, isUtf8);

    readEntryCursor += data.length;

    if (entry.uncompressedSize            === 0xffffffff ||
        entry.compressedSize              === 0xffffffff ||
        entry.relativeOffsetOfLocalHeader === 0xffffffff) {
      // ZIP64 format
      // find the Zip64 Extended Information Extra Field
      const zip64ExtraField = entry.extraFields.find(e => e.id === 0x0001);
      if (!zip64ExtraField) {
        return new Error('expected zip64 extended information extra field');
      }
      const zip64EiefBuffer = zip64ExtraField.data;
      let index = 0;
      // 0 - Original Size          8 bytes
      if (entry.uncompressedSize === 0xffffffff) {
        if (index + 8 > zip64EiefBuffer.length) {
          throw new Error('zip64 extended information extra field does not include uncompressed size');
        }
        entry.uncompressedSize = getUint64LE(zip64EiefBuffer, index);
        index += 8;
      }
      // 8 - Compressed Size        8 bytes
      if (entry.compressedSize === 0xffffffff) {
        if (index + 8 > zip64EiefBuffer.length) {
          throw new Error('zip64 extended information extra field does not include compressed size');
        }
        entry.compressedSize = getUint64LE(zip64EiefBuffer, index);
        index += 8;
      }
      // 16 - Relative Header Offset 8 bytes
      if (entry.relativeOffsetOfLocalHeader === 0xffffffff) {
        if (index + 8 > zip64EiefBuffer.length) {
          throw new Error('zip64 extended information extra field does not include relative header offset');
        }
        entry.relativeOffsetOfLocalHeader = getUint64LE(zip64EiefBuffer, index);
        index += 8;
      }
      // 24 - Disk Start Number      4 bytes
    }

    // check for Info-ZIP Unicode Path Extra Field (0x7075)
    // see https://github.com/thejoshwolfe/yauzl/issues/33
    const nameField = entry.extraFields.find(e =>
        e.id === 0x7075 &&
        e.data.length >= 6 && // too short to be meaningful
        e.data[0] === 1 &&    // Version       1 byte      version of this extra field, currently 1
        getUint32LE(e.data, 1), crc.unsigned(entry.nameBytes)); // NameCRC32     4 bytes     File Name Field CRC32 Checksum
                                                            // > If the CRC check fails, this UTF-8 Path Extra Field should be
                                                            // > ignored and the File Name field in the header should be used instead.
    if (nameField) {
        // UnicodeName   Variable    UTF-8 version of the entry File Name
        entry.fileName = decodeBuffer(nameField.data.slice(5), true);
    }

    // validate file size
    if (self.validateEntrySizes && entry.compressionMethod === 0) {
      let expectedCompressedSize = entry.uncompressedSize;
      if (entry.isEncrypted()) {
        // traditional encryption prefixes the file data with a header
        expectedCompressedSize += 12;
      }
      if (entry.compressedSize !== expectedCompressedSize) {
        throw new Error(`compressed/uncompressed size mismatch for stored file: ${entry.compressedSize} != ${entry.uncompressedSize}`);
      }
    }
    entries.push(entry);
  }
  const zip = {
    comment,
    commentBytes,
  };
  return {
    zip,
    entries: entries.map(e => new ZipEntry(reader, e)),
  };
}

async function readEntryData(reader, entry) {
  const buffer = await readAs(reader, entry.relativeOffsetOfLocalHeader, 30);

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
  const localFileHeaderEnd = entry.relativeOffsetOfLocalHeader + buffer.length + fileNameLength + extraFieldLength;
  let decompress;
  if (entry.compressionMethod === 0) {
    // 0 - The file is stored (no compression)
    decompress = false;
  } else if (entry.compressionMethod === 8) {
    // 8 - The file is Deflated
    decompress = true;
  } else {
    throw new Error(`unsupported compression method: ${entry.compressionMethod}`);
  }
  const fileDataStart = localFileHeaderEnd;
  const fileDataEnd = fileDataStart + entry.compressedSize;
  if (entry.compressedSize !== 0) {
    // bounds check now, because the read streams will probably not complain loud enough.
    // since we're dealing with an unsigned offset plus an unsigned size,
    // we only have 1 thing to check for.
    if (fileDataEnd > reader.length) {
      throw new Error(`file data overflows file bounds: ${fileDataStart} +  ${entry.compressedSize}  > ${reader.length}`);
    }
  }
  const data = await readAs(reader, fileDataStart, entry.compressedSize);
  if (!decompress) {
    return data;
  }

  const dst = new Uint8Array(entry.uncompressedSize);
  UZIP.inflateRaw(data, dst);
  return dst;
}


export default async function open(source) {
  let reader;
  if (source instanceof Blob) {
    reader = new BlobReader(source);
  } else if (source instanceof ArrayBuffer || (source && source.buffer && source.buffer instanceof ArrayBuffer)) {
    reader = new ArrayBufferReader(source);
  } else if (typeof source === 'string') {
    const req = await fetch(source);
    const blob = await req.blob();
    reader = new BlobReader(blob);
  } else if (typeof source.length === 'number' && typeof source.read === 'function') {
    reader = source;
  } else {
    throw new Error('unsupported source type');
  }

  if (reader.length > Number.MAX_SAFE_INTEGER) {
    throw new Error(`file too large. size: ${reader.length}. Only file sizes up 4503599627370496 bytes are supported`);
  }

  return await findEndOfCentralDirector(reader);
}