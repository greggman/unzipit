/* global chai, describe, it */
const assert = chai.assert;

import {unzipit, setOptions} from '../../dist/unzipit.module.js';
import {readBlobAsArrayBuffer} from '../../src/utils.js';

setOptions({workerURL: '../../dist/unzipit-worker.module.js'});

async function readBlobAsUint8Array(blob) {
  const arrayBuffer = await readBlobAsArrayBuffer(blob);
  return new Uint8Array(arrayBuffer);
}

describe('unzipit', function() {
  describe('url', function() {

    const utf8Encoder = new TextEncoder();
    const longContent = `${new Array(200).fill('compress').join('')}\n`;
    const expectedStuff = [
      { name: 'stuff/', isDir: true, },
      { name: 'stuff/dog.txt', content: 'german shepard\n' },
      { name: 'stuff/birds/', isDir: true, },
      { name: 'stuff/birds/bird.txt', content: 'parrot\n' },
      { name: 'stuff/cat.txt', content: 'siamese\n', },
      { name: 'stuff/json.txt', content: '{"name":"homer","age":50}', },
      { name: 'stuff/long.txt', content: longContent, },
      { name: 'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt', content: 'Lookma! Unicode 😜', },
    ];

    it('has all entries', async() => {
      const {zip, entries} = await unzipit('./data/stuff.zip');

      assert.typeOf(zip.comment, 'string');
      assert.instanceOf(zip.commentBytes, Uint8Array);
      assert.equal(entries.length, expectedStuff.length);
    });

    async function checkZipEntriesMatchExpected(entries, expectedFiles) {
      const expected = expectedFiles.slice();
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

    it('entries are correct', async() => {
      const {entries} = await unzipit('./data/stuff.zip');
      await checkZipEntriesMatchExpected(entries, expectedStuff);
    });

    it('works with zip64', async() => {
      const {entries} = await unzipit('./data/test64.zip');
      const expected = [
        { name: 'test64/', isDir: true, },
        { name: 'test64/banana.txt', content: '2 bananas\n', },
        { name: 'test64/オエムジ.txt', content: 'マジ！', },
        { name: 'test64/pineapple.txt', content: 'I have a pen. I have an apple.\n', },
      ];
      await checkZipEntriesMatchExpected(entries, expected);
    });

    it('can get blob', async() => {
      const {entries} = await unzipit('./data/stuff.zip');
      const files = Object.fromEntries(entries.map(v => [v.name, v]));
      const tests = [
        { name: 'stuff/dog.txt', compressionMethod: 0, expected: utf8Encoder.encode('german shepard\n'), },
        { name: 'stuff/long.txt', compressionMethod: 8, expected: utf8Encoder.encode(longContent), },
      ];
      for (const {name, expected, compressionMethod} of tests) {
        const entry = files[name];
        assert.equal(entry.compressionMethod, compressionMethod, 'check that stuff.zip is built correctly for test');
        const blob = await entry.blob();
        const data = await readBlobAsUint8Array(blob);
        assert.deepEqual(data, expected);
      }
    });

    it('can get json', async() => {
      const {entries} = await unzipit('./data/stuff.zip');
      const files = Object.fromEntries(entries.map(v => [v.name, v]));
      const data = await files['stuff/json.txt'].json();
      assert.deepEqual(data, {name: 'homer', age: 50});
    });

    it('can get arrayBuffer', async() => {
      const {entries} = await unzipit('./data/stuff.zip');
      const files = Object.fromEntries(entries.map(v => [v.name, v]));
      const tests = [
        { name: 'stuff/dog.txt', compressionMethod: 0, expected: utf8Encoder.encode('german shepard\n'), },
        { name: 'stuff/long.txt', compressionMethod: 8, expected: utf8Encoder.encode(longContent), },
      ];
      for (const {name, expected, compressionMethod} of tests) {
        const entry = files[name];
        assert.equal(entry.compressionMethod, compressionMethod, 'check that stuff.zip is built correctly for test');
        const data = await entry.arrayBuffer();
        assert.deepEqual(new Uint8Array(data), expected);
      }
    });
  });
});
