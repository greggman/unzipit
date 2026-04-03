import {unzip, setOptions} from 'unzipit';
import * as chai from 'chai';

interface TestPromiseInfo {
  resolve(failures: number): void; 
};

declare global {
  interface Window {
    testsPromiseInfo: TestPromiseInfo;
  }
}

const assert: Chai.Assert = chai.assert;

describe('typescript', () => {
  before(() => {
    setOptions({useWorkers: false});  // this the default
  });

  const longContent = `${new Array(200).fill('compress').join('')}\n`;
  const expectedStuff: {[name: string]: any} = {
    'stuff/': { isDir: true, },
    'stuff/dog.txt': { content: 'german shepard\n' },
    'stuff/birds/': { isDir: true, },
    'stuff/birds/bird.txt': { content: 'parrot\n' },
    'stuff/cat.txt': { content: 'siamese\n', },
    'stuff/json.txt': { content: '{"name":"homer","age":50}', },
    'stuff/long.txt': { content: longContent, },
    'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt': { content: 'Lookma! Unicode 😜', },
  };

  it('unzips', async() => {
    const utf8Encoder = new TextEncoder();
    const {zip, entries} = await unzip('../data/stuff.zip');
    
    assert.isString(zip.comment);

    for (const [name, entry] of Object.entries(entries)) {
      const expected = expectedStuff[name];
      assert.isOk(expected, name);
      if (expected.isDir) {
        assert.isTrue(entry.isDirectory);
      } else {
        const content = await entry.text();
        assert.equal(content, expected.content);
        const arrayBuffer = await entry.arrayBuffer();
        const expectedBytes = utf8Encoder.encode(content);
        assert.deepEqual(new Uint8Array(arrayBuffer,), expectedBytes);
      }
    }
  });
});

const settings = Object.fromEntries(new URLSearchParams(window.location.search).entries());
if (settings.reporter) {
  mocha.reporter(settings.reporter);
}
mocha.run((failures) => {
  window.testsPromiseInfo.resolve(failures);
});
