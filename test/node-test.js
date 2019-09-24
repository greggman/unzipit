
/* eslint-env node, mocha */
const assert = require('chai').assert;
const {unzip, setOptions, cleanup} = require('../dist/unzipit.js');
const fsPromises = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

async function sha256(uint8view) {
  return crypto.createHash('sha256').update(uint8view).digest('hex');
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
    'stuff/': { isDir: true, },
    'stuff/dog.txt': { content: 'german shepard\n' },
    'stuff/birds/': { isDir: true, },
    'stuff/birds/bird.txt': { content: 'parrot\n' },
    'stuff/cat.txt': { content: 'siamese\n', },
    'stuff/json.txt': { content: '{"name":"homer","age":50}', },
    'stuff/long.txt': { content: longContent, },
    'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt': { content: 'Lookma! Unicode 😜', },
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
        'large/': { isDir: true, },
        'large/antwerp-central-station.jpg':   { sha256: '197246a6bba4570387bee455245a30c95329ed5538eaa2a3fec7df5e2aad53f7', },
        'large/phones-in-museum-in-milan.jpg': { sha256: '6465b0c16c76737bd0f74ab79d9b75fd7558f74364be422a37aec85c8612013c', },
        'large/colosseum.jpg':                 { sha256: '6081d144babcd0c2d3ea5c49de83811516148301d9afc6a83f5e63c3cd54d00a', },
        'large/chocolate-store-istanbul.jpg':  { sha256: '3ee7bc868e1bf1d647598a6e430d636424485f536fb50359e6f82ec24013308c', },
        'large/tokyo-from-skytree.jpg':        { sha256: 'd66f4ec1eef9bcf86371fe82f217cdd71e346c3e850b31d3e3c0c2f342af4ad2', },
        'large/LICENSE.txt':                   { sha256: '95be0160e771271be4015afc340ccf15f4e70e2581c5ca090d0a39be17395ac2', },
        'large/cherry-blossoms-tokyo.jpg':     { sha256: '07c398b3acc1edc5ef47bd7c1da2160d66f9c297d2967e30f2009f79b5e6eb0e', },
      };

      await checkZipEntriesMatchExpected(entries, expected);
      reader.close();
    });
  }

  describe('without workers', () => {

    before(() => {
      setOptions({useWorkers: false});
    });

    addTests();

  });

  describe('without workers', () => {

    before(() => {
      setOptions({workerURL: path.join(__dirname, '..', 'dist', 'unzipit-worker.js')});
    });

    addTests();

    after(() => {
      cleanup();
    });

  });
});
