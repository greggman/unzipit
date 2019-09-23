# unzipit.js

Random access unzip library for browser and node based JavaScript

## How to use

### Browser

```js
import unzipit from 'unzipit';

async function readFiles(url) {
  const {zip, entries} = await unzipit(url);

  // print all entries and their sizes
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

### Node

I'm not quite sure if I should expose node readers or let you do your
own but here's 3 examples

#### Load a file as an arraybuffer

```js
const unzipit = require('unzipit');
const fsPromises = require('fs').promises;

async function readFiles(filename) {
  const buf = await fsPromises.readFile(filename);
  const {zip, entries} = await unzipit(new Uint8Array(buf));
  ... (see code above)
}
```

You can also pass your own reader. Here's 2 examples. This first one
is stateless. That means there is never anything to clean up. But,
it has the overhead of opening the source file once for each time
you get the contents of an entry. I have no idea what the overhead
of that is. 

```js
const unzipit = require('unzipit');
const fsPromises = require('fs').promises;

class StatelessFileReader {
  constructor(filename) {
    this.filename = filename;
  }
  async getLength() {
    if (this.length === undefined) {
      const stat = await fsPromises.stat(this.filename);
      this.length = stat.size;
    }
    return this.length;
  }
  async read(offset, length) {
    const fh = await fsPromises.open(this.filename);
    const data = new Uint8Array(length);
    await fh.read(data, 0, length, offset);
    await fh.close();
    return data;
  }
}

async function readFiles(filename) {
  const reader = new StatelessFileReader(filename);
  const {zip, entries} = await unzipit(reader);
  ... (see code above)
}
```

Here's also an example of one that only opens the file a single time
but that means the file stays open until you manually call close.

```js
class FileReader {
  constructor(filename) {
    this.fhp = fsPromises.open(filename);
  }
  async close() {
    const fh = await this.fhp;
    await fh.close();
  }
  async getLength() {
    if (this.length === undefined) {
      const fh = await this.fhp;
      const stat = await fh.stat();
      this.length = stat.size;
    }
    return this.length;
  }
  async read(offset, length) {
    const fh = await this.fhp;
    const data = new Uint8Array(length);
    await fh.read(data, 0, length, offset);
    return data;
  }
}

async function doStuff() {
  // ...

  const reader = new FileReader(filename);
  const {zip, entries} = await unzipit(reader);

  // ... do stuff with entries ...

  // you must call reader.close for the file to close
  await reader.close();
}
```

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
    if (!entry.isDirectory) {
      const data = await entry.arrayBuffer();
    }
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

```js
const {zip, entries} = await unzipit(url);
// decode names as big5 (chinese)
const decoder = new TextDecoder('big5');
entries.forEach(entry => {
  entry.name = decoder.decode(entry.nameBytes);
});
```
    
So much easier than passing in functions to decode names or setting flags whether or not to decode them.

Same thing with filenames. If you care about slashes or backslashes do that yourself outside the library

```js
const {zip, entries} = await unzipit(url);
// change slashes and backslashes into -
entries.forEach(entry => {
  entry.name = name.replace(/\\|\//g, '-');
});
```

Some libraries both zip and unzip.
IMO those should be separate libraries as there is little if any code to share between
both. Plenty of projects only need to do one or the other.

Similarly inflate and deflate libraries should be separate from zip, unzip libraries.
You need one or the other not both. See zlib as an example.

Finally this library is ES7 based.

One area I'm not sure about is worker support. I want this code to be able
to inflate in a worker but the question is at what level should that happen.
Should I wrap an inflate library in a worker interface an use it here?
Or should I make the user wrap this library at a higher level?

Advantages over other libraries. 

* JSZIP requires the entire compressed file in memory. 
  It also requires reading through all entries in order. 

* UZIP requires the entire compressed file to be in memory and 
  the entire uncompressed contents of all the files to be in memory.
  
* Yauzl does not require all the files to be in memory but
  they do have to be read in order and it has very peculiar API where 
  you still have to manually go through all the entries even if
  you don't choose to read their contents. Further it's node only.
  
This library does not require all content to be in memory. If you use a Blob
te browser effectively virtualizes access so it doesn't have to be in memory.
Only the entries you access use memory. Similarly in node, the examples with
the file readers will only read the header and whatever entries contents
you ask for.

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
  lastModDate, // a Date
  isDirectory,
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

If your server supports http range requests you could maybe do something like this.

```js
// PS: un-tested!
class HTTPRangeReader {
  constructor(url) {
    this.url = url;
  }
  async getLength() {
    if (this.length === undefined) {
      const req = await fetch(this.url, { method: 'HEAD' });
      const headers = Object.fromEntries(req.headers.entries());
      this.length = parseInt(headers['content-length']);
      if (Number.isNaN(this.length)) {
        throw Error('could not get length');
      }
    }
    return this.length;
  }
  async read(offset, size) {
    const req = await fetch(this.url, {
      headers: {
        Range: `bytes=${offset}-${offset + size - 1}`,
      },
    });
    const buffer = await req.arrayBuffer();
    return buffer;
  }
}
```

To use it you'd do something like

```js
import unzipit from 'unzipit';

async function readFiles(url) {
  const reader = new HTTPRangeReader(url);
  const {zip, entries} = await unzipit(reader);
  for (const entry in entries) {
    const data = await entry.arrayBuffer();
  }
}
``` 

### Special headers and options for network requests

The library takes a URL but there are no options for cors, or credentials etc. 
If you need that pass in a Blob or ArrayBuffer you fetched yourself.

```js
const req = await fetch(url, { mode: cors });
const blob = await req.blob();
const {entries} = await unzipit(blob);
```

### Non UTF-8 Filenames

The zip standard predates unicode so it's possible and apparently not uncommon for files
to have non-unicode names. `entry.nameBytes` contains the raw bytes of the filename.
so you are free to decode the name using your own methods.

### An Object instead of an array

`entries` in all the examples above is an array. To turn it into an object of entries
by filename in 1 line

```js
const {entries} = await unzipit(blob);
const files = Object.fromEntries(entries.map(e => [e.name, e])); 
```

## Testing

When writing tests serve the folder with your favorite web server (recommend [`http-server`](https://www.npmjs.com/package/http-server))
then go to `http://localhost:8080/test/` to easily re-run the tests.

Of course you can also `npm test` to run them from the command line.

### Debugging 

Follow the instructions on testing but add  `?timeout=0` to the URL as in `http://localhost:8080/tests/?timeout=0`

## Acknowledgements

The code is **heavily** based on [yauzl](https://github.com/thejoshwolfe/yauzl)

## Licence

MIT
