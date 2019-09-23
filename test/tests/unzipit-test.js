/* global chai, describe, it */
const assert = chai.assert;

import open from '../../dist/unzipit.module.js';

describe('unzipit', function() {
  describe('url', function() {
    it('has all entries', async() => {
      const {zip, entries} = await open('./data/stuff.zip');

      assert.typeOf(zip.comment, 'string');
      assert.instanceOf(zip.commentBytes, Uint8Array);
      assert.equal(entries.length, 7);
    });

    it('entries are correct', async() => {
      const {entries} = await open('./data/stuff.zip');
      const expected = [
        { name: 'stuff/', isDir: true, },
        { name: 'stuff/dog.txt', content: 'german shepard\n' },
        { name: 'stuff/birds/', isDir: true, },
        { name: 'stuff/birds/bird.txt', content: 'parrot\n' },
        { name: 'stuff/cat.txt', content: 'siamese\n', },
        { name: 'stuff/long.txt', content: `${new Array(200).fill('compress').join('')}\n`, },
        { name: 'stuff/ⓤⓝⓘⓒⓞⓓⓔ-𝖋𝖎𝖑𝖊𝖓𝖆𝖒𝖊-😱.txt', content: 'Lookma! Unicode 😜', },
      ];
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
    });

    /*
    it('works with zip64', async() => {
      const hashes = {
        'wavpack.zip': '55e5eef2d50d8adaa8235d4c7c386042d43a1458f952ef22bc992e50ca16579b',
        'source/1024kbps.wav': '3700808c95898567e49a746ab04feedf7aaef7c758b3dd8f3ff2f3cac07b2f5d',
        'source/128kbps.wav': '3f7760da7645c4ddb927284d01cbc75482e2f350b2ff65b7b235a8ed52574602',
        'source/12bit.wav': '06e24382018ff8d203e02f85cef3b09e1246197e2bcec03dca9a2af694bd791f',
        'source/160kbps.wav': '16fff31f2e92db8892c837f40a3ced5ea03e33203f4286bce91773976e52b7f8',
        'source/16bit.wav': '68e081e6bd1e4926d46025b3dfafac0939b24335c8cce68efbb4be70195ff18e',
        'source/20bit.wav': '2bffd56b3b4e0c5cb8b5ba6896be5343ef2f98e38b315828e71d8d741b027d3f',
        'source/24bit.wav': 'f961643d813ea97633ea761907047cf02dcfbfa3bc6582588afca138fdae78cc',
        'source/24kbps.wav': '713dda4255649114237d5e11b48ec206818ce3b8d57eb389ab96c78ca00bc25b',
        'source/256kbps.wav': '40a76f3f0e86febb61c970220b8455a4bb44659703e8453b4d82b814fd686dbe',
        'source/320kbps.wav': '439ac74ccd6dac5ffca0069513ca75ae22e20e15a12d5a0c524596be718c1add',
        'source/32bit_float.wav': 'f48fecbf5b848125e6c674565460fd7a9ed905c187fca62f07758740709dcbf7',
        'source/32bit_float_p.wav': '70f453393f49859a86f3cc145397028b496bed9be869e11a638c0945992308f0',
        'source/32bit_int.wav': '4057574ad944015a8e9611091bf893ea6467be8e5c124036805d97d6d310b3ae',
        'source/32bit_int_p.wav': '54700c353e4b95c87bf525339e57ef960b49fb47b294d9694f438086d3c9fd69',
        'source/32kbps.wav': '799968bb61c66282e4a76e018083396793a5879ddcc164ed5731444a0cf3e256',
        'source/384kbps.wav': '1cbc14de67dbe746a86442431a42e9c4ad7657d17a6859a00c211147cfedc1ba',
        'source/48kbps.wav': '978c4e0b5bea81f3738c9143c39809250a0225fc8574f8666c8a51db8dbee8ad',
        'source/512kbps.wav': '69d576ff843805eecfec838ebeedc0b23134c070b3633df8ca189276633a8c89',
        'source/64kbps.wav': '5bcba5e2351a8c9bb062f596e73462324de9c46478d8d4f0b68dddc7ca6ff5fb',
        'source/8bit.wav': '07540164cce8be16f9d2d1fca43d4efec3a987bf602334aeb65278c4f58ddaf4',
        'source/default.wav': '9b1f5f7ad0b6b00dc179db182b80260990b83492dc79465a9059ae69e8c26413',
        'source/false_stereo.wav': 'a0283afb27dff2830556fcd76bbd6014c78d5c10c74d8cbaaa12cd3b569dc82c',
        'source/fast.wav': '9b1f5f7ad0b6b00dc179db182b80260990b83492dc79465a9059ae69e8c26413',
        'source/high.wav': '9b1f5f7ad0b6b00dc179db182b80260990b83492dc79465a9059ae69e8c26413',
        'source/mono-1.wav': 'b789bbf815acbefab669e4a3d1b733c27705f071b39e5b5f967e8d9c9193e852',
        'source/stereo-2.wav': 'bb1f7d7c07199c1fe76d53f639f6a9b93d96878a9063359839ba74ed14c4432c',
        'source/vhigh.wav': '9b1f5f7ad0b6b00dc179db182b80260990b83492dc79465a9059ae69e8c26413',
        'source/win_executable.wav': 'a6241ba44cac98185cb06af1ed5bf6e71cd05d99f77a279497b5839d36d9aa4b',
        'source/zero_lsbs.wav': '6c58776e97695242d1cfedb07e698c5b43021fa5c87791bf2487551bd9609b5e',
      };

      const {entries} = await open('./data/Abbrevia_WavPack_test_data.zip');
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const data = await entry.arrayBuffer();
          const hash = await crypto.subtle.digest('SHA-256', data);
          const hashArray = Array.from(new Uint8Array(hash));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          assert.equal(hashHex, hashes[entry.name], entry.name);
        }
      }
    });
    */
  });
});
