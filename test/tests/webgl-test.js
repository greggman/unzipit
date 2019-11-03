/* global chai, describe, it */
const assert = chai.assert;

describe('webgl', () => {
  it('can create a webgl context and render', () => {
    const gl = document.createElement('canvas').getContext('webgl');
    assert.isOk(gl);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const expected = new Uint8Array([255, 0, 0, 255]);
    const actual = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
    assert.deepEqual(actual, expected);
  });
});
