/* global atob */

// Makes a Reader for a zip file that is never stored anywhere. Its bytes are
// generated on demand as they are read, so tests can use entries of many
// gigabytes without a giant test file or the memory to hold one.
//
// The zip has one zip64 entry whose deflated data is `numBlocks` copies of
// the same deflate block followed by an empty final block. The block was
// made with zlib using Z_FULL_FLUSH so it is byte aligned and has no
// references to previous data, which means copies can simply be concatenated.
// Each block inflates to 64KiB where byte i is (i & 0xff), so byte p of the
// whole entry is (p & 0xff).
//
//   zlib.deflateRawSync(bytes, {finishFlush: zlib.constants.Z_FULL_FLUSH, level: 9})

const kBlockBase64 = '7M8DEhgGAACw2rZt27bN1bZt27a51Vpt27Ztu3d9R/KDBAgYKHCQoMGChwgZKnSYsOHCR4gYKXKUqNGix4gZK3acuPHiJ0iYKHGSpMmSp0iZKnWatOnSZ8iYKXOWrNmy58iZK3eevPnyFyhYqHCRosWKlyhZqnSZsuXKV6hYqXKVqtWq16j5T63aderWq9+gYaPGTZo2a96iZavWbdq2a9+hY6fOXbp2696jZ6/effr26z9g4KDBQ4YOGz5i5KjRY8aOGz9h4qTJU6ZOmz5j5qzZc+bOm79g4aLFS5YuW/7vfytWrlq9Zu269Rs2bvp/85at27bv2Llr9569+/YfOHjo8JGjx46fOHnq9Jmz585fuHjp8pWr167fuHnr9p279+4/ePjo8ZOnz56/ePnq9Zu3795/+Pjp85ev377/+PnrdwB/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f3//v/8/AAAA//8=';
export const kBlockUncompressedSize = 64 * 1024;

const kBlock = Uint8Array.from(atob(kBlockBase64), c => c.charCodeAt(0));
const kFinalBlock = new Uint8Array([3, 0]);  // empty fixed-huffman block with BFINAL set

class Writer {
  constructor(size) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }
  u16(v) {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }
  u32(v) {
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }
  u64(v) {
    this.u32(v % 2 ** 32);
    this.u32(Math.floor(v / 2 ** 32));
  }
  bytes_(b) {
    this.bytes.set(b, this.offset);
    this.offset += b.length;
  }
}

// @param {number} numBlocks number of 64KiB blocks in the entry
// @param {number} [declaredSize] uncompressed size to put in the zip. Defaults
//     to the actual size. Set it to something else to make a broken zip.
// @param {string} [name] name of the entry
export function makeVirtualZipReader({numBlocks, declaredSize, name = 'big.bin'}) {
  const nameBytes = new TextEncoder().encode(name);
  const actualSize = numBlocks * kBlockUncompressedSize;
  const uncompressedSize = declaredSize ?? actualSize;
  const compressedSize = numBlocks * kBlock.length + kFinalBlock.length;

  const zip64Extra = (w) => {
    w.u16(0x0001);  // zip64 extended information
    w.u16(16);
    w.u64(uncompressedSize);
    w.u64(compressedSize);
  };

  // local file header
  const head = new Writer(30 + nameBytes.length + 20);
  head.u32(0x04034b50);
  head.u16(45);          // version needed
  head.u16(0);           // flags
  head.u16(8);           // deflate
  head.u16(0);           // time
  head.u16(0);           // date
  head.u32(0);           // crc32 (unzipit does not check it)
  head.u32(0xffffffff);  // compressed size (in zip64 extra)
  head.u32(0xffffffff);  // uncompressed size (in zip64 extra)
  head.u16(nameBytes.length);
  head.u16(20);
  head.bytes_(nameBytes);
  zip64Extra(head);

  const dataStart = head.bytes.length;
  const centralDirectoryOffset = dataStart + compressedSize;
  const centralDirectorySize = 46 + nameBytes.length + 20;

  const tail = new Writer(centralDirectorySize + 56 + 20 + 22);
  // central directory file header
  tail.u32(0x02014b50);
  tail.u16(45);          // version made by
  tail.u16(45);          // version needed
  tail.u16(0);           // flags
  tail.u16(8);           // deflate
  tail.u16(0);           // time
  tail.u16(0);           // date
  tail.u32(0);           // crc32
  tail.u32(0xffffffff);  // compressed size (in zip64 extra)
  tail.u32(0xffffffff);  // uncompressed size (in zip64 extra)
  tail.u16(nameBytes.length);
  tail.u16(20);          // extra field length
  tail.u16(0);           // comment length
  tail.u16(0);           // disk number
  tail.u16(0);           // internal attributes
  tail.u32(0);           // external attributes
  tail.u32(0);           // local header offset
  tail.bytes_(nameBytes);
  zip64Extra(tail);
  // zip64 end of central directory record
  const zip64EocdrOffset = centralDirectoryOffset + centralDirectorySize;
  tail.u32(0x06064b50);
  tail.u64(44);          // size of the rest of this record
  tail.u16(45);
  tail.u16(45);
  tail.u32(0);
  tail.u32(0);
  tail.u64(1);           // entries on this disk
  tail.u64(1);           // total entries
  tail.u64(centralDirectorySize);
  tail.u64(centralDirectoryOffset);
  // zip64 end of central directory locator
  tail.u32(0x07064b50);
  tail.u32(0);
  tail.u64(zip64EocdrOffset);
  tail.u32(1);
  // end of central directory record
  tail.u32(0x06054b50);
  tail.u16(0);
  tail.u16(0);
  tail.u16(0xffff);
  tail.u16(0xffff);
  tail.u32(0xffffffff);
  tail.u32(0xffffffff);
  tail.u16(0);

  const totalLength = centralDirectoryOffset + tail.bytes.length;

  // returns the bytes that position `pos` of the file falls in and the offset into them.
  function locate(pos) {
    if (pos < dataStart) {
      return {src: head.bytes, at: pos};
    }
    if (pos < centralDirectoryOffset) {
      const dataPos = pos - dataStart;
      const blocksEnd = numBlocks * kBlock.length;
      return dataPos < blocksEnd
          ? {src: kBlock, at: dataPos % kBlock.length}
          : {src: kFinalBlock, at: dataPos - blocksEnd};
    }
    return {src: tail.bytes, at: pos - centralDirectoryOffset};
  }

  const reader = {
    name,
    actualSize,
    // the biggest `read` asked for, so tests can check nothing read the whole entry.
    maxReadSize: 0,
    async getLength() {
      return totalLength;
    },
    async read(offset, length) {
      reader.maxReadSize = Math.max(reader.maxReadSize, length);
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const {src, at} = locate(offset + done);
        const n = Math.min(src.length - at, length - done);
        out.set(src.subarray(at, at + n), done);
        done += n;
      }
      return out;
    },
  };
  return reader;
}

// Checks a chunk of the entry starting at `pos` has the expected pattern.
// Checks the first, middle, and last byte to keep this fast for huge entries.
export function chunkMatchesPattern(chunk, pos) {
  if (chunk.length === 0) {
    return true;
  }
  const check = i => chunk[i] === ((pos + i) & 0xff);
  return check(0) && check(chunk.length >> 1) && check(chunk.length - 1);
}
