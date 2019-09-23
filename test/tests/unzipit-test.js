/* global chai, describe, it */
const assert = chai.assert;

import unzipit from '../../dist/unzipit.module.js';

describe('unzipit', function() {
  describe('url', function() {
    it('has all entries', async() => {
      const {zip, entries} = await unzipit('./data/stuff.zip');

      assert.typeOf(zip.comment, 'string');
      assert.instanceOf(zip.commentBytes, Uint8Array);
      assert.equal(entries.length, 7);
    });

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

    it('entries are correct', async() => {
      const {entries} = await unzipit('./data/stuff.zip');
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
  });
});
