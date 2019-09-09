# unzipit.js

Random access unzip library for JavaScript

## How to use

```js
import unzipit from 'unzipit';

async function readFiles(url) {
  const {zip, entries} = await unzipit.openURL(url);

  // print all entries an their sizes
  for (const entry in entries) {
    console.log(entry.name, entry.size);
  }
  
  // read the 4th entry as an arraybuffer
  const arrayBuffer = await entries[3].arrayBuffer();

  // read the 9th entry as a blob
  const blob = await entries[8].blob({type: 'image/png'});

  // close the zip so resources can be freed
  zip.close();
}
```

You can also pass a Blob or ArrayBuffer

## Why?

All the js libraries I looked at would decompress all files in the zip file.
That's probably the most common use case but it didn't fit my needs. I needed
to, as fast as possible, open a zip and read a specific file.

Note that to repo the behavior of most unzip libs would just be

```js
async function readFiles(url) {
  const {zip, entries} = await unzipit.open(url);
  for (const entry in entries) {
    const data = await entry.arrayBuffer();
  }

  zip.close();
}
```

## API

```js
unzipit.open(url/blob/arraybuffer/reader)
```

```js
class Zip {
  close()   // free resources
  comment,  // the comment for the zip file
  commentBytes:  // the raw data for comment, see nameBytes
}
```

```js
class ZipEntry {
  blob()   // returns a promise that returns a Blob for this entry
  arrayBuffer() // returns a promise that returns an ArrayBuffer for this entry
  text() // returns text, assumes the text is valid utf8. If you want more options decode arrayBuffer yourself
  json() // returns text with JSON.parse called on it. If you want more options decode arrayBuffer yourself
  name,        // name of entry
  nameBytes,   // raw name of entry (see notes)
  size,    // size in bytes
  compressedSize: // size before decompressing
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
have to adapt on your own.

### Non UTF-8 Filenames

The zip standard predates unicode so it's possible and apparently not uncommon for files
to have non-unicode names. `entry.nameBytes` contains the raw bytes of the filename.
so you are free to decode the name using your own methods.

## Licence

MIT
