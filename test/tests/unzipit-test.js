/* global chai, Mocha, describe, it, after, before, SharedArrayBuffer */
const assert = chai.assert;

import {unzip, unzipRaw, setOptions, cleanup, HTTPRangeReader} from '../../dist/unzipit.module.js';
import {readBlobAsArrayBuffer} from '../../src/utils.js';


async function readBlobAsUint8Array(blob) {
  const arrayBuffer = await readBlobAsArrayBuffer(blob);
  return new Uint8Array(arrayBuffer);
}

async function sha256(uint8View) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', uint8View);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const filesSHA256 = {
  './data/large.zip':  'c93b2587bf27b998887c9a281a6711ff4144047dcb6f10b1459bed9cfdaef377',
  './data/test64.zip': 'b2a15c3f415ba4f6386b840c6d82e5b70d32b554cb2dd070f588b52aac968ec9',
  './data/stuff.zip':  '5874f0e9c553daec6a1f2e49992d474353c52a73584317a7122de59e35554608',
};

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

  const expectedLarge = {
    'large/': { isDir: true, },
    'large/antwerp-central-station.jpg':   { sha256: '197246a6bba4570387bee455245a30c95329ed5538eaa2a3fec7df5e2aad53f7', },
    'large/phones-in-museum-in-milan.jpg': { sha256: '6465b0c16c76737bd0f74ab79d9b75fd7558f74364be422a37aec85c8612013c', },
    'large/colosseum.jpg':                 { sha256: '6081d144babcd0c2d3ea5c49de83811516148301d9afc6a83f5e63c3cd54d00a', },
    'large/chocolate-store-istanbul.jpg':  { sha256: '3ee7bc868e1bf1d647598a6e430d636424485f536fb50359e6f82ec24013308c', },
    'large/tokyo-from-skytree.jpg':        { sha256: 'd66f4ec1eef9bcf86371fe82f217cdd71e346c3e850b31d3e3c0c2f342af4ad2', },
    'large/LICENSE.txt':                   { sha256: '95be0160e771271be4015afc340ccf15f4e70e2581c5ca090d0a39be17395ac2', },
    'large/cherry-blossoms-tokyo.jpg':     { sha256: '07c398b3acc1edc5ef47bd7c1da2160d66f9c297d2967e30f2009f79b5e6eb0e', },
  };

  function onlyFiles(entries) {
    return Object.fromEntries(Object.entries(entries).filter(([, entry]) => !entry.isDirectory && !entry.isDir));
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

    it('works with large zip (not that large)', async() => {
      const {entries} = await loader.loadLargeZip();
      await checkZipEntriesMatchExpected(entries, expectedLarge);
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

    it('works with Promise.all()', async() => {
      const {entries} = await loader.loadLargeZip();
      await Promise.all(Object.values(entries).map(async(entry) => {
        entry.data = await entry.arrayBuffer();
      }));
      for (const entry of Object.values(entries)) {
        const expect = expectedLarge[entry.name];
        if (expect.sha256) {
          const sig = await sha256(new Uint8Array(entry.data));
          assert.equal(sig, expect.sha256, name);
        }
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

      after(() => {
        cleanup();
      });

      addTests(loader);

    });

    describe('with workers', function() {

      before(() => {
        setOptions({
          workerURL: '../dist/unzipit-worker.module.js',
          numWorkers: 2,
        });
      });

      after(() => {
        cleanup();
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

    describe('with bad worker url (expected can\'t load errors and maybe a SyntaxError)', function() {

      let oldErrorHandler;
      before(() => {
        // prevent Mocha from reacting to bad worker script
        oldErrorHandler = window.onerror;
        Mocha.process.removeListener('uncaughtException');
        setOptions({
          workerURL: '../dist/does-not-exist.js',
          numWorkers: 2,
        });
        console.log('VVVVVVV [ Expect Errors Below This Line ] VVVVVVV');
      });

      after(() => {
        cleanup();
        window.onerror = oldErrorHandler;
        console.log('^^^^^^^ [ Expect Errors Above This Line ] ^^^^^^^');
      });

      it('loaded all 6 files', async() => {
        const {entries} = await unzip('./data/large.zip');
        const files = onlyFiles(entries);
        // important: Must send all 6 requests at once to test issue
        const datas = await Promise.all(Object.values(files).map(entry => entry.arrayBuffer()));
        const expected = onlyFiles(expectedLarge);
        const filesAsArray = Object.entries(files);
        for (let ndx = 0; ndx < filesAsArray.length; ++ndx) {
          const [name] = filesAsArray[ndx];
          const data = datas[ndx];
          const expect = expected[name];
          assert.isOk(expect, name);
          delete expected[name];
          const sig = await sha256(new Uint8Array(data));
          assert.equal(sig, expect.sha256, name);
        }
        assert.deepEqual(expected, {}, 'all content accounted for');
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
      async loadLargeZip() {
        return await unzip('./data/large.zip');
      },
    });

  });

  describe('http range requests', async() => {

    async function unzipWithRangeReader(url) {
      const reader = new HTTPRangeReader(url);
      return await unzip(reader);
    }

    addTopTests({
      async loadStuffZip() {
        return await unzipWithRangeReader('./data/stuff.zip');
      },
      async loadStuffZipRaw() {
        const reader = new HTTPRangeReader('./data/stuff.zip');
        return await unzipRaw(reader);
      },
      async loadTest64Zip() {
        return await unzipWithRangeReader('./data/test64.zip');
      },
      async loadLargeZip() {
        return await unzipWithRangeReader('./data/large.zip');
      },
    });

  });

  describe('ArrayBuffer', () => {

    let stuffZipArrayBuffer;
    let test64ZipArrayBuffer;
    let largeZipArrayBuffer;

    async function getArrayBuffer(url) {
      const req = await fetch(url);
      const arrayBuffer = await req.arrayBuffer();
      const sig = await sha256(new Uint8Array(arrayBuffer));
      assert.equal(sig, filesSHA256[url]);
      return arrayBuffer;
    }

    before(async() => {
      stuffZipArrayBuffer = await getArrayBuffer('./data/stuff.zip');
      test64ZipArrayBuffer = await getArrayBuffer('./data/test64.zip');
      largeZipArrayBuffer = await getArrayBuffer('./data/large.zip');
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
      async loadLargeZip() {
        return await unzip(largeZipArrayBuffer);
      },
    });

  });

  describe('Blob', () => {

    let stuffZipBlob;
    let test64ZipBlob;
    let largeZipBlob;

    async function getBlob(url) {
      const req = await fetch(url);
      return await req.blob();
    }

    before(async() => {
      stuffZipBlob = await getBlob('./data/stuff.zip');
      test64ZipBlob = await getBlob('./data/test64.zip');
      largeZipBlob = await getBlob('./data/large.zip');
    });

    addTopTests({
      async loadStuffZip() {
        return await unzip(stuffZipBlob);
      },
      async loadStuffZipRaw() {
        return await unzipRaw(stuffZipBlob);
      },
      async loadTest64Zip() {
        return await unzip(test64ZipBlob);
      },
      async loadLargeZip() {
        return await unzip(largeZipBlob);
      },
    });

  });

  if (typeof SharedArrayBuffer !== 'undefined') {

    describe('SharedArrayBuffer', () => {

      let stuffZipSharedArrayBuffer;
      let test64ZipSharedArrayBuffer;
      let largeZipSharedArrayBuffer;

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
        largeZipSharedArrayBuffer = await getSharedArrayBuffer('./data/large.zip');
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
        async loadLargeZip() {
          return await unzip(largeZipSharedArrayBuffer);
        },
      });

    });

  }


});
