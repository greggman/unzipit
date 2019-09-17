# unzipit.js

Random access unzip library for browser based JavaScript

## How to use

```js
import unzipit from 'unzipit';

async function readFiles(url) {
  const {zip, entries} = await unzipit(url);

  // print all entries an their sizes
  for (const entry in entries) {
    console.log(entry.name, entry.size);
  }
  
  // read the 4th entry as an arraybuffer
  const arrayBuffer = await entries[3].arrayBuffer();

  // read the 9th entry as a blob and tag it with mime type 'image/png'
  const blob = await entries[8].blob('image/png');
}
```

You can also pass a Blob, ArrayBuffer, TypedArray, or your own Reader

## Why?

Most of the js libraries I looked at would decompress all files in the zip file.
That's probably the most common use case but it didn't fit my needs. I needed
to, as fast as possible, open a zip and read a specific file. The better libraries
only worked on node, I needed a browser based solution for Electron.

Note that to repo the behavior of most unzip libs would just be

```js
import unzipit from 'unzipit';

async function readFiles(url) {
  const {zip, entries} = await unzipit(url);
  for (const entry in entries) {
    const data = await entry.arrayBuffer();
  }
}
```

One other thing is that many libraries seem bloated. IMO the smaller the API the better.
I don't need a library to try to do 50 things via options and configuration. Rather I need
a library to handle the main task and make it possible to do the rest outside the library.
This makes a library far far more flexible.

As an example some libraries provide no raw data for filenames. Apparently many zip files
have non-utf8 filenames in them. The solution for this library is to do that on your own.

Example

    const {zip, entries} = await unzipit(url);
    // decode names as big5 (chinese)
    const decoder = new TextDecoder('big5');
    entries.forEach(entry => {
      entry.name = decoder.decode(entry.nameBytes);
    });
    
So much easier than passing in functions or decode names or setting flags whether or not to decode them.

Same thing with filenames. If you care about slashes or backslashes do that yourself outside the library

    const {zip, entries} = await unzipit(url);
    // change slashes and backslashes into -
    entries.forEach(entry => {
      entry.name = name.replace(/\\|\//g, '-');
    });

Finally this library is ES7 based.

## API

```js
const {zip, entries} = await unzipit(url/blob/arraybuffer/reader)
// note: If you need more options for your url then fetch your own blob and pass the blob in
```

```js
class Zip {
  comment,  // the comment for the zip file
  commentBytes,  // the raw data for comment, see nameBytes
}
```

```js
class ZipEntry {
  async blob(type)   // returns a Blob for this entry (optional type as in 'image/jpeg'
  async arrayBuffer() // returns an ArrayBuffer for this entry
  async text() // returns text, assumes the text is valid utf8. If you want more options decode arrayBuffer yourself
  async json() // returns text with JSON.parse called on it. If you want more options decode arrayBuffer yourself
  name,        // name of entry
  nameBytes,   // raw name of entry (see notes)
  size,    // size in bytes
  compressedSize, // size before decompressing
  comment,  // the comment for this entry
  commentBytes, // the raw comment for this entry
}
```

## Notes:

### Caching

If you ask for the same entry twice it will be read twice and decompressed twice.
If you want to cache entires implement that at a level above unzipit

### Streaming

You can't stream zip files. The only valid way to read a zip file is to read the
central directory which is at the end of the zip file. Sure there are zip files
where you can cheat and read the local headers of each file but that is an invalid
way to read a zip file and it's trivial to create zip files that will fail when
read that way but are perfectly valid zip files.

If your server had some kind of API that lets you randomly access parts of a file
then it would theoretically be possible. Unfortunately AFAIK there are no web standards
for remote random access file reading (WEBDAV?) so whatever proprietary protocol you use you'd
have to adapt on your own. To do this you'd make your own `Reader`. It just needs to support
a `length` property and a `read(offset, size)` method. You can imagine an class like

```
class NetworkReader {
  constructor(url) {
    this.url = url;
  }
  async init() {
    const req = await fetch(`${url}?cmd=length`);
    this.length = await req.json();
  }
  async read(offset, size) {
    const req = await fetch(`${url}?offset=${offset}&size=${size}`);
    const buffer = await req.arrayBuffer();
    return buffer;
  }
}
```

To use it you'd do something like

```
import unzipit from 'unzipit';

async function readFiles(url) {
  const reader = new NetworkReader(url);
  await reader.init();
  const {zip, entries} = await unzipit(reader);
  for (const entry in entries) {
    const data = await entry.arrayBuffer();
  }
}
``` 

### Non UTF-8 Filenames

The zip standard predates unicode so it's possible and apparently not uncommon for files
to have non-unicode names. `entry.nameBytes` contains the raw bytes of the filename.
so you are free to decode the name using your own methods.

## Acknowledgements

The code is **heavily** based on [yazul](https://github.com/thejoshwolfe/yauzl)

## Licence

MIT
