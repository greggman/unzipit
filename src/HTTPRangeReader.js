    export class HTTPRangeReader {
      constructor(url) {
        this.url = url;
      }
      async getLength() {
        if (this.length === undefined) {
          const req = await fetch(this.url, { method: 'HEAD' });
          this.length = parseInt(req.headers.get('content-length'));
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
        return new Uint8Array(buffer);
      }
    }