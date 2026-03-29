export interface Reader {
    getLength(): Promise<number>;
    read(offset: number, size: number): Promise<Uint8Array<ArrayBuffer>>;
    sliceAsBlob?(offset: number, length: number, type?: string): Promise<Blob>;
}
export default class BlobReader implements Reader {
    private blob;
    constructor(blob: Blob);
    getLength(): Promise<number>;
    read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
    sliceAsBlob(offset: number, length: number, type?: string): Promise<Blob>;
}
