
import {assert} from 'chai';
import {Buffer} from 'buffer';
import {createHash} from 'crypto';
import {promises as fsPromises} from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {unzip, setOptions, cleanup} from '../dist/unzipit.module.js';
import {makeVirtualZipReader, chunkMatchesPattern, kBlockUncompressedSize} from './tests/virtual-zip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function sha256(uint8view) {
  return createHash('sha256').update(uint8view).digest('hex');
}

async function readStreamChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

async function assertRejects(fn, msg) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.instanceOf(error, Error, msg);
}

async function checkZipEntriesMatchExpected(entries, expectedFiles) {
  const expected = Object.assign({}, expectedFiles);
  for (const [name, entry] of Object.entries(entries)) {
    const expect = expected[name];
    assert.isOk(expect, name);
    delete expected[name];
    assert.equal(entry.isDirectory, !!expect.isDir, name);
    if (!expect.isDir) {
      if (expect.sha256) {
        const data = await entry.arrayBuffer();
        const sig = await sha256(new Uint8Array(data));
        assert.equal(sig, expect.sha256, name);
      } else {
        const data = await entry.text();
        assert.equal(data, expect.content, name);
      }
    }
  }
  assert.deepEqual(expected, {}, 'all content accounted for');
}

class StatelessFileReader {
  constructor(filename) {
    this.filename = filename;
  }
  async getLength() {
    if (this.length === undefined) {
      const stat = await fsPromises.stat(this.filename);
      this.length = stat.size;
    }
    return this.length;
  }
  async read(offset, length) {
    const fh = await fsPromises.open(this.filename);
    const data = new Uint8Array(length);
    await fh.read(data, 0, length, offset);
    await fh.close();
    return data;
  }
}

// It's up to you to call `close`
class FileReader {
  constructor(filename) {
    this.fhp = fsPromises.open(filename);
  }
  async close() {
    const fh = await this.fhp;
    await fh.close();
  }
  async getLength() {
    if (this.length === undefined) {
      const fh = await this.fhp;
      const stat = await fh.stat();
      this.length = stat.size;
    }
    return this.length;
  }
  async read(offset, length) {
    const fh = await this.fhp;
    const data = new Uint8Array(length);
    await fh.read(data, 0, length, offset);
    return data;
  }
}

describe('unzipit', function() {

  const longContent = `${new Array(200).fill('compress').join('')}\n`;
  const expectedStuff = {
    'stuff/': { isDir: true },
    'stuff/dog.txt': { content: 'german shepard\n' },
    'stuff/birds/': { isDir: true },
    'stuff/birds/bird.txt': { content: 'parrot\n' },
    'stuff/cat.txt': { content: 'siamese\n' },
    'stuff/json.txt': { content: '{"name":"homer","age":50}' },
    'stuff/long.txt': { content: longContent },
    'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt': { content: 'Lookma! Unicode 😜' },
  };

  function addTests() {
    it('entries are correct', async() => {
      const buf = await fsPromises.readFile(path.join(__dirname, 'data', 'stuff.zip'));
      const {entries} = await unzip(new Uint8Array(buf));
      await checkZipEntriesMatchExpected(entries, expectedStuff);
    });

    it('use StatelessFileReader', async() => {
      const reader = new StatelessFileReader(path.join(__dirname, 'data', 'stuff.zip'));
      const {entries} = await unzip(reader);
      await checkZipEntriesMatchExpected(entries, expectedStuff);
    });

    it('use FileReader', async() => {
      const reader = new FileReader(path.join(__dirname, 'data', 'stuff.zip'));
      const {entries} = await unzip(reader);
      await checkZipEntriesMatchExpected(entries, expectedStuff);
      reader.close();
    });

    it('use FileReader Large', async() => {
      const reader = new FileReader(path.join(__dirname, 'data', 'large.zip'));
      const {entries} = await unzip(reader);

      const expected = {
        'large/': { isDir: true },
        'large/antwerp-central-station.jpg':   { sha256: '197246a6bba4570387bee455245a30c95329ed5538eaa2a3fec7df5e2aad53f7' },
        'large/phones-in-museum-in-milan.jpg': { sha256: '6465b0c16c76737bd0f74ab79d9b75fd7558f74364be422a37aec85c8612013c' },
        'large/colosseum.jpg':                 { sha256: '6081d144babcd0c2d3ea5c49de83811516148301d9afc6a83f5e63c3cd54d00a' },
        'large/chocolate-store-istanbul.jpg':  { sha256: '3ee7bc868e1bf1d647598a6e430d636424485f536fb50359e6f82ec24013308c' },
        'large/tokyo-from-skytree.jpg':        { sha256: 'd66f4ec1eef9bcf86371fe82f217cdd71e346c3e850b31d3e3c0c2f342af4ad2' },
        'large/LICENSE.txt':                   { sha256: '95be0160e771271be4015afc340ccf15f4e70e2581c5ca090d0a39be17395ac2' },
        'large/cherry-blossoms-tokyo.jpg':     { sha256: '07c398b3acc1edc5ef47bd7c1da2160d66f9c297d2967e30f2009f79b5e6eb0e' },
      };

      await checkZipEntriesMatchExpected(entries, expected);
      reader.close();
    });

    it('can stream entries', async() => {
      const reader = new FileReader(path.join(__dirname, 'data', 'large.zip'));
      const {entries} = await unzip(reader);
      const entry = entries['large/colosseum.jpg'];
      const chunks = await readStreamChunks(await entry.stream({chunkSize: 100000}));
      assert.equal(chunks.length, Math.ceil(entry.size / 100000));
      const sig = await sha256(Buffer.concat(chunks));
      assert.equal(sig, '6081d144babcd0c2d3ea5c49de83811516148301d9afc6a83f5e63c3cd54d00a');
      reader.close();
    });

    for (const [desc, delta] of [['larger', 1], ['smaller', -1]]) {
      it(`rejects when declared uncompressedSize is ${desc} than actual`, async() => {
        const numBlocks = 48;
        const makeEntry = async() => {
          const reader = makeVirtualZipReader({numBlocks, declaredSize: numBlocks * kBlockUncompressedSize + delta});
          const {entries} = await unzip(reader);
          return entries[reader.name];
        };
        await assertRejects(async() => (await makeEntry()).arrayBuffer(), 'arrayBuffer');
        await assertRejects(async() => (await makeEntry()).blob(), 'blob');
        await assertRejects(async() => readStreamChunks(await (await makeEntry()).stream()), 'stream');
      });
    }

    it('rejects when declared uncompressedSize is smaller than actual (size-mismatch)', async() => {
      const zip = await fsPromises.readFile(path.join(__dirname, 'data', 'deflate-size-larger-than-entry.zip'));
      const { entries } = await unzip(new Uint8Array(zip));
      const entry = entries['bomb.txt'];
      try {
        await entry.arrayBuffer();
        throw new Error('Expected arrayBuffer to reject for size mismatch');
      } catch {
        // success: rejection expected
      }
    });
  }

  describe('without workers', () => {

    before(() => {
      setOptions({useWorkers: false});
    });

    addTests();

  });

  describe('streaming', () => {

    it('streams a 4.5GiB zip64 entry without holding it in memory', async function() {
      this.timeout(5 * 60 * 1000);
      setOptions({useWorkers: false});
      const reader = makeVirtualZipReader({numBlocks: 4608 * 16});
      const {entries} = await unzip(reader);
      const entry = entries[reader.name];
      assert.isAbove(entry.size, 2 ** 32, 'needs zip64');

      const chunkSize = 16 * 1024 * 1024;
      const baseRSS = process.memoryUsage().rss;
      let peakRSS = baseRSS;
      let pos = 0;
      for await (const chunk of await entry.stream({chunkSize})) {
        if (pos + chunk.byteLength < entry.size) {
          assert.equal(chunk.byteLength, chunkSize);
        }
        assert.isTrue(chunkMatchesPattern(chunk, pos), `data at ${pos}`);
        pos += chunk.byteLength;
        peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
      }
      assert.equal(pos, entry.size);
      assert.isAtMost(reader.maxReadSize, 1024 * 1024, 'reads are made in small pieces');
      // The entry is 4.5GiB. Holding it (or its 43MB of compressed data) would blow way past this.
      const growthMB = (peakRSS - baseRSS) / 1024 / 1024;
      assert.isBelow(growthMB, 512, `memory grew by ${growthMB.toFixed(0)}MB`);
    });

  });

  describe('with workers', () => {

    before(() => {
      setOptions({workerURL: path.join(__dirname, '..', 'dist', 'unzipit-worker.js')});
    });

    addTests();

    after(() => {
      cleanup();
    });

  });

});
