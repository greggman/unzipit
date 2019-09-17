/* global chai, describe, it */
const assert = chai.assert;

import open from '../../src/unzipit.js';

describe('unzipit', function() {
  describe('url', function() {
    it('has all entries', async() => {
      const {zip, entries} = await open('./data/stuff.zip');

      assert.typeOf(zip.comment, 'string');
      assert.instanceOf(zip.commentBytes, Uint8Array);

      for (const entry of entries) {
        console.log(entry.name, entry._entry);
      }
    });
  });
});


// const content = new Array(200).fill('compress').join('');
