import type { Reader } from './BlobReader.js';
export declare class HTTPRangeReader implements Reader {
    private url;
    private length;
    constructor(url: string);
    getLength(): Promise<number>;
    read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>>;
}
