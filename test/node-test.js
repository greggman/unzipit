
/* eslint-env node, mocha */
const assert = require('chai').assert;
const unzipit = require('../dist/unzipit.js');
const fsPromises = require('fs').promises;
const path = require('path');

async function checkZipEntriesMatchExpected(entries, expected) {
  assert.equal(entries.length, expected.length);
  for (const entry of entries) {
    const expectNdx = expected.findIndex(v => v.name === entry.name);
    const expect = expected.splice(expectNdx, 1)[0];
    assert.equal(entry.name, expect.name);
    assert.equal(entry.isDirectory, !!expect.isDir);
    if (!expect.isDir) {
      const data = await entry.text();
      assert.equal(data, expect.content);
    }
  }
  assert.equal(expected.length, 0);
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
  it('entries are correct', async() => {
    const buf = await fsPromises.readFile(path.join(__dirname, 'data', 'stuff.zip'));
    const {entries} = await unzipit(new Uint8Array(buf));
    const expected = [
      { name: 'stuff/', isDir: true, },
      { name: 'stuff/dog.txt', content: 'german shepard\n' },
      { name: 'stuff/birds/', isDir: true, },
      { name: 'stuff/birds/bird.txt', content: 'parrot\n' },
      { name: 'stuff/cat.txt', content: 'siamese\n', },
      { name: 'stuff/long.txt', content: `${new Array(200).fill('compress').join('')}\n`, },
      { name: 'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt', content: 'Lookma! Unicode 😜', },
    ];
    await checkZipEntriesMatchExpected(entries, expected);
  });

  it('use StatelessFileReader', async() => {
    const reader = new StatelessFileReader(path.join(__dirname, 'data', 'stuff.zip'));
    const {entries} = await unzipit(reader);
    const expected = [
      { name: 'stuff/', isDir: true, },
      { name: 'stuff/dog.txt', content: 'german shepard\n' },
      { name: 'stuff/birds/', isDir: true, },
      { name: 'stuff/birds/bird.txt', content: 'parrot\n' },
      { name: 'stuff/cat.txt', content: 'siamese\n', },
      { name: 'stuff/long.txt', content: `${new Array(200).fill('compress').join('')}\n`, },
      { name: 'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt', content: 'Lookma! Unicode 😜', },
    ];
    await checkZipEntriesMatchExpected(entries, expected);
  });

  it('use FileReader', async() => {
    const reader = new FileReader(path.join(__dirname, 'data', 'stuff.zip'));
    const {entries} = await unzipit(reader);
    const expected = [
      { name: 'stuff/', isDir: true, },
      { name: 'stuff/dog.txt', content: 'german shepard\n' },
      { name: 'stuff/birds/', isDir: true, },
      { name: 'stuff/birds/bird.txt', content: 'parrot\n' },
      { name: 'stuff/cat.txt', content: 'siamese\n', },
      { name: 'stuff/long.txt', content: `${new Array(200).fill('compress').join('')}\n`, },
      { name: 'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt', content: 'Lookma! Unicode 😜', },
    ];
    await checkZipEntriesMatchExpected(entries, expected);
    reader.close();
  });
});
