/* global chai, describe, it, before, SharedArrayBuffer */
const assert = chai.assert;

import {unzip, unzipRaw, setOptions} from '../../dist/unzipit.module.js';
import {readBlobAsArrayBuffer} from '../../src/utils.js';


async function readBlobAsUint8Array(blob) {
  const arrayBuffer = await readBlobAsArrayBuffer(blob);
  return new Uint8Array(arrayBuffer);
}

describe('unzipit', function() {

  const utf8Encoder = new TextEncoder();
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

  function addTests(loader) {
    it('has all entries', async() => {
      const {zip, entries} = await loader.loadStuffZip();

      assert.typeOf(zip.comment, 'string');
      assert.instanceOf(zip.commentBytes, Uint8Array);
      assert.equal(Object.entries(entries).length, Object.entries(expectedStuff).length);
    });

    it('entries are correct', async() => {
      const {entries} = await loader.loadStuffZip();
      await checkZipEntriesMatchExpected(entries, expectedStuff);
    });

    it('unzipRaw works', async() => {
      const {entries} = await loader.loadStuffZipRaw();
      await checkZipEntriesMatchExpected(Object.fromEntries(entries.map(v => [v.name, v])), expectedStuff);
    });

    it('works with zip64', async() => {
      const {entries} = await loader.loadTest64Zip();
      const expected = {
        'test64/': { isDir: true, },
        'test64/banana.txt': { content: '2 bananas\n', },
        'test64/オエムジ.txt': { content: 'マジ！', },
        'test64/pineapple.txt': { content: 'I have a pen. I have an apple.\n', },
      };
      await checkZipEntriesMatchExpected(entries, expected);
    });

    it('can get blob', async() => {
      const {entries} = await loader.loadStuffZip();
      const tests = [
        { name: 'stuff/dog.txt', compressionMethod: 0, expected: utf8Encoder.encode('german shepard\n'), },
        { name: 'stuff/long.txt', compressionMethod: 8, expected: utf8Encoder.encode(longContent), },
      ];
      for (const {name, expected, compressionMethod} of tests) {
        const entry = entries[name];
        assert.equal(entry.compressionMethod, compressionMethod, 'check that stuff.zip is built correctly for test');
        const blob = await entry.blob();
        const data = await readBlobAsUint8Array(blob);
        assert.deepEqual(data, expected);
      }
    });

    it('can get json', async() => {
      const {entries} = await loader.loadStuffZip();
      const data = await entries['stuff/json.txt'].json();
      assert.deepEqual(data, {name: 'homer', age: 50});
    });

    it('can get arrayBuffer', async() => {
      const {entries} = await loader.loadStuffZip();
      const tests = [
        { name: 'stuff/dog.txt', compressionMethod: 0, expected: utf8Encoder.encode('german shepard\n'), },
        { name: 'stuff/long.txt', compressionMethod: 8, expected: utf8Encoder.encode(longContent), },
      ];
      for (const {name, expected, compressionMethod} of tests) {
        const entry = entries[name];
        assert.equal(entry.compressionMethod, compressionMethod, 'check that stuff.zip is built correctly for test');
        const data = await entry.arrayBuffer();
        assert.deepEqual(new Uint8Array(data), expected);
      }
    });

  }

  function addTopTests(loader) {
    describe('without workers', function() {
      before(() => {
        setOptions({
          useWorkers: false,
        });
      });

      addTests(loader);

    });

    describe('with workers', function() {

      before(() => {
        setOptions({
          workerURL: '../../dist/unzipit-worker.module.js',
        });
      });

      addTests(loader);

      it('can accept SharedArrayBuffer', async() => {
        if (typeof SharedArrayBuffer === 'undefined') {
          return;
        }

        const req = await fetch('./data/stuff.zip');
        const arrayBuffer = await req.arrayBuffer();
        const sharedArrayBuffer = new SharedArrayBuffer(arrayBuffer.byteLength);
        const view = new Uint8Array(sharedArrayBuffer);
        view.set(new Uint8Array(arrayBuffer));
        const {entries} = await unzip(sharedArrayBuffer);
        await checkZipEntriesMatchExpected(entries, expectedStuff);
      });

      it('does not return the same buffer for uncompressed ArrayBuffer entries', async() => {
        // I'm not sure I should check this but given it has repercussions for using
        // arrayBuffers it seems like I should either check it's always true or never true.

        const req = await fetch('./data/stuff.zip');
        const arrayBuffer = await req.arrayBuffer();
        const {entries} = await unzip(arrayBuffer);
        assert.notStrictEqual(entries['stuff/dog.txt'].nameBytes.buffer, arrayBuffer);
        assert.notStrictEqual(entries['stuff/dog.txt'].commentBytes.buffer, arrayBuffer);
        const dataArrayBuffer = await entries['stuff/dog.txt'].arrayBuffer();
        assert.notStrictEqual(dataArrayBuffer, arrayBuffer);
      });

    });

  }

  describe('url', async() => {

    addTopTests({
      async loadStuffZip() { 
        return await unzip('./data/stuff.zip');
      },
      async loadStuffZipRaw() {
        return await unzipRaw('./data/stuff.zip');
      },
      async loadTest64Zip() {
        return await unzip('./data/test64.zip');
      },
    });

  });

  describe('ArrayBuffer', () => {

    let stuffZipArrayBuffer;
    let test64ZipArrayBuffer;

    async function getArrayBuffer(url) {
      const req = await fetch(url);
      return await req.arrayBuffer();
    }

    before(async() => {
      stuffZipArrayBuffer = await getArrayBuffer('./data/stuff.zip');
      test64ZipArrayBuffer = await getArrayBuffer('./data/test64.zip');
    });

    addTopTests({
      async loadStuffZip() { 
        return await unzip(stuffZipArrayBuffer);
      },
      async loadStuffZipRaw() {
        return await unzipRaw(stuffZipArrayBuffer);
      },
      async loadTest64Zip() {
        return await unzip(test64ZipArrayBuffer);
      },
    });

  });

  describe('Blob', () => {

    let stuffZipArrayBlob;
    let test64ZipArrayBlob;

    async function getBlob(url) {
      const req = await fetch(url);
      return await req.blob();
    }

    before(async() => {
      stuffZipArrayBlob = await getBlob('./data/stuff.zip');
      test64ZipArrayBlob = await getBlob('./data/test64.zip');
    });

    addTopTests({
      async loadStuffZip() { 
        return await unzip(stuffZipArrayBlob);
      },
      async loadStuffZipRaw() {
        return await unzipRaw(stuffZipArrayBlob);
      },
      async loadTest64Zip() {
        return await unzip(test64ZipArrayBlob);
      },
    });

  });

  if (typeof SharedArrayBuffer !== 'undefined') {

    describe('SharedArrayBuffer', () => {

      let stuffZipSharedArrayBuffer;
      let test64ZipSharedArrayBuffer;

      async function getSharedArrayBuffer(url) {
        const req = await fetch(url);
        const arrayBuffer = await req.arrayBuffer();
        const sharedArrayBuffer = new SharedArrayBuffer(arrayBuffer.byteLength);
        const view = new Uint8Array(sharedArrayBuffer);
        view.set(new Uint8Array(arrayBuffer));
        return sharedArrayBuffer;
      }

      before(async() => {
        stuffZipSharedArrayBuffer = await getSharedArrayBuffer('./data/stuff.zip');
        test64ZipSharedArrayBuffer = await getSharedArrayBuffer('./data/test64.zip');
      });

      addTopTests({
        async loadStuffZip() { 
          return await unzip(stuffZipSharedArrayBuffer);
        },
        async loadStuffZipRaw() {
          return await unzipRaw(stuffZipSharedArrayBuffer);
        },
        async loadTest64Zip() {
          return await unzip(test64ZipSharedArrayBuffer);
        },
      });

    });

  }

});
