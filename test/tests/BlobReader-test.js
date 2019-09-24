/* global chai, describe, it */
const assert = chai.assert;

import BlobReader from '../../src/BlobReader.js';

describe('BlobReader', function() {
  describe('Blob', function() {
    const ab = new ArrayBuffer(100);
    const f = new Uint8Array(ab);
    f.set([11, 22, 33], 0);
    f.set([44, 55, 66], 97);
    const blob = new Blob([ab]);
    const reader = new BlobReader(blob);

    it('should have the correct length', async() => {
      const length = await reader.getLength();
      assert.equal(length, ab.byteLength);
    });

    it('should work at 0 offset', async() => {
      const view = await reader.read(0, 3);
      assert.deepEqual(view, new Uint8Array([11, 22, 33]));
    });

    it('should work at non 0 offset', async() => {
      const view = await reader.read(97, 3);
      assert.deepEqual(view, new Uint8Array([44, 55, 66]));
    });
  });
});
