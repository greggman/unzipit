import type { Reader } from './BlobReader.js';
export default class ArrayBufferReader implements Reader {
    private typedArray;
    constructor(arrayBufferOrView: ArrayBuffer | SharedArrayBuffer | ArrayBufferView);
    getLength(): Promise<number>;
    read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}
