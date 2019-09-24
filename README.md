# unzipit.js

Random access unzip library for browser and node based JavaScript

# How to use

## without workers

```js
import {unzip} from 'unzipit';

async function readFiles(url) {
  const {entries} = await unzip(url);

  // print all entries and their sizes
  for (const [name, entry] in Object.entries(entries)) {
    console.log(name, entry.size);
  }
  
  // read an entry as an arraybuffer
  const arrayBuffer = await entries['path/to/file'].arrayBuffer();

  // read an entry as a blob and tag it with mime type 'image/png'
  const blob = await entries['path/to/otherFile'].blob('image/png');
}
```

## with workers

```js
import {unzip, setOptions} from 'unzipit';

setOptions({workerURL: 'path/to/unzipit-worker.module.js'});

async function readFiles(url) {
  const {entries} = await unzip(url);
  ...
}
```

or if you prefer

```js
import * as unzipit from 'unzipit';

unzipit.setOptions({workerURL: 'path/to/unzipit-worker.module.js'});

async function readFiles(url) {
  const {entries} = await unzipit.unzip(url);
  ...
}
```


You can also pass a [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob),
[`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer),
[`SharedArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer),
[`TypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray),
or your own `Reader`

## Node

For node you need to make your own `Reader` or pass in an
[`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer),
[`SharedArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer),
or [`TypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray).

### Load a file as an arraybuffer

```js
const unzipit = require('unzipit');
const fsPromises = require('fs').promises;

async function readFiles(filename) {
  const buf = await fsPromises.readFile(filename);
  const {zip, entries} = await unzipit.unzip(new Uint8Array(buf));
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
  const {zip, entries} = await unzipit.unzip(reader);
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
  const {zip, entries} = await unzipit.unzip(reader);

  // ... do stuff with entries ...

  // you must call reader.close for the file to close
  await reader.close();
}
```

### Workers in Node

```js
const unzipit = require('unzipit');

unzipit.setOptions({workerURL: require.resolve('unzipit/dist/unzipit-worker.js')});

...

// Only if you need node to exit you need to shut down the workers.
unzipit.cleanup();
```

## Why?

Most of the js libraries I looked at would decompress all files in the zip file.
That's probably the most common use case but it didn't fit my needs. I needed
to, as fast as possible, open a zip and read a specific file. The better libraries
only worked on node, I needed a browser based solution for Electron.

Note that to repo the behavior of most unzip libs would just be

```js
import {unzip} from 'unzipit';

async function readFiles(url) {
  const {entries} = await unzip(url);
  for (const entry of Object.values(entries)) {
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
const {zip, entriesArray} = await unzipit.unzipRaw(url);
// decode names as big5 (chinese)
const decoder = new TextDecoder('big5');
entriesArray.forEach(entry => {
  entry.name = decoder.decode(entry.nameBytes);
});
const entries = Object.fromEntries(entriesArray.map(v => [v.name, v]));
... // same as above beyond this point
```
    
So much easier than passing in functions to decode names or setting flags whether or not to decode them.

Same thing with filenames. If you care about slashes or backslashes do that yourself outside the library

```js
const {entries} = await unzipit(url);
// change slashes and backslashes into '-'
entries.forEach(entry => {
  entry.name = name.replace(/\\|\//g, '-');
});
```

Some libraries both zip and unzip.
IMO those should be separate libraries as there is little if any code to share between
both. Plenty of projects only need to do one or the other.

Similarly inflate and deflate libraries should be separate from zip, unzip libraries.
You need one or the other not both. See zlib as an example.

This library is ES6 based using async/await and import which makes the code
much simpler.

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
the browser can effectively virtualize access so it doesn't have to be in memory.
Only the entries you access use memory. As well, if you only need the data
for images or video or audio then you can do things like

```js
const {entries} = await unzip(url);
const blob = await entries['/some/image.jpg'].blob('image/jpeg');
const url = URL.createObjectURL(blob);
const img = new Image();
img.src = url;
```

Notice there is no access to the data using Blobs which means the browser
manages them. They don't count as part of the JavaScript heap.

In node, the examples with the file readers will only read the header and whatever entries contents
you ask for so similarly you can avoid having everything in memory except the things you read.


# API

```js
import { unzipit, unzipitRaw, setOptions } from 'unzipit';
```

## unzip
## unzipRaw

`unzip` and `unzipRaw` are async functions that take a url, `Blob`, `TypedArray`, or `ArrayBuffer`.
Both functions return an object with fields `zip` and `entries`.
The difference is with `unzip` the `entries` is an object mapping filenames to `ZipEntry`s where as `unzipRaw` it's
an array of `ZipEntry`s. The reason to use `unzipRaw` over `unzip` is if the filenames are not utf8
then the library can't make an object from the names. In that case you get an array of entries, use `entry.nameBytes`
and decode the names as you please.

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

## setOptions

The options are 

* `useWorkers`: true/false

* `workerURL`: string

  The URL to use to load the worker script. Note setting this automatically sets `useWorkers` to true

* `numWorkers`: number (default 1)

  How many workers to use. You can inflate more files in parallel with more workers.

# Notes:

## Caching

If you ask for the same entry twice it will be read twice and decompressed twice.
If you want to cache entires implement that at a level above unzipit

## SharedArrayBuffer

## Streaming

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
import {unzip} from 'unzipit';

async function readFiles(url) {
  const reader = new HTTPRangeReader(url);
  const {zip, entries} = await unzip(reader);
  for (const entry in entries) {
    const data = await entry.arrayBuffer();
  }
}
``` 

## Special headers and options for network requests

The library takes a URL but there are no options for cors, or credentials etc. 
If you need that pass in a Blob or ArrayBuffer you fetched yourself.

```js
import {unzip} from 'unzipit';

...

const req = await fetch(url, { mode: cors });
const blob = await req.blob();
const {entries} = await unzip(blob);
```

## Non UTF-8 Filenames

The zip standard predates unicode so it's possible and apparently not uncommon for files
to have non-unicode names. `entry.nameBytes` contains the raw bytes of the filename.
so you are free to decode the name using your own methods. See example above.

## ArrayBuffer and SharedArrayBuffer caveats

If you pass in an `ArrayBuffer` or `SharedArrayBuffer` you need to keep the data unchanged
until you're finished using the data. The library doesn't make a copy, it uses the buffer directly.

# Testing

When writing tests serve the folder with your favorite web server (recommend [`http-server`](https://www.npmjs.com/package/http-server))
then go to `http://localhost:8080/test/` to easily re-run the tests.

Of course you can also `npm test` to run them from the command line.

## Debugging 

Follow the instructions on testing but add  `?timeout=0` to the URL as in `http://localhost:8080/tests/?timeout=0`

# Acknowledgements

The code is **heavily** based on [yauzl](https://github.com/thejoshwolfe/yauzl)

# Licence

MIT
