
/* eslint-env node, mocha */
const assert = require('chai').assert;
const unzip = require('../dist/unzipit.js').unzip;
const fsPromises = require('fs').promises;
const path = require('path');

async function checkZipEntriesMatchExpected(entries, expectedFiles) {
  const expected = Object.assign({}, expectedFiles);
  for (const [name, entry] of Object.entries(entries)) {
    const expect = expected[name];
    delete expected[name];
    assert.equal(entry.isDirectory, !!expect.isDir);
    if (!expect.isDir) {
      const data = await entry.text();
      assert.equal(data, expect.content);
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
});
