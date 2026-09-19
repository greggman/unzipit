import type { Reader } from './BlobReader.js';

export class HTTPRangeReader implements Reader {
  private url: string;
  private length: number | undefined;

  constructor(url: string) {
    this.url = url;
  }
  async getLength(): Promise<number> {
    if (this.length === undefined) {
      const req = await fetch(this.url, { method: 'HEAD' });
      if (!req.ok) {
        throw new Error(`failed http request ${this.url}, status: ${req.status}: ${req.statusText}`);
      }
      this.length = parseInt(req.headers.get('content-length')!);
      if (Number.isNaN(this.length)) {
        throw Error('could not get length');
      }
    }
    return this.length;
  }
  async read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>> {
    if (size === 0) {
      return new Uint8Array(0);
    }
    const req = await fetch(this.url, {
      headers: {
        Range: `bytes=${offset}-${offset + size - 1}`,
      },
    });
    if (!req.ok) {
      throw new Error(`failed http request ${this.url}, status: ${req.status} offset: ${offset} size: ${size}: ${req.statusText}`);
    }
    const buffer = await req.arrayBuffer();
    return new Uint8Array(buffer);
  }
  async readStream(offset: number, size: number): Promise<ReadableStream<Uint8Array>> {
    if (size === 0) {
      return new Blob([]).stream();
    }
    const req = await fetch(this.url, {
      headers: {
        Range: `bytes=${offset}-${offset + size - 1}`,
      },
    });
    if (!req.ok) {
      throw new Error(`failed http request ${this.url}, status: ${req.status} offset: ${offset} size: ${size}: ${req.statusText}`);
    }
    // A server that ignores Range sends the whole file with a 200.
    // Streaming that would silently produce the wrong bytes.
    if (req.status !== 206) {
      throw new Error(`server did not honor range request for ${this.url}, status: ${req.status}`);
    }
    return req.body!;
  }
}
