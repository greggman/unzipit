import type { Reader } from './BlobReader.js';
export declare function readAsStream(reader: Reader, offset: number, length: number): Promise<ReadableStream<Uint8Array>>;
export declare function inflateRawStream(src: ReadableStream<Uint8Array>, uncompressedSize: number, decompress: boolean, chunkSize?: number): ReadableStream<Uint8Array>;
export declare function streamToArrayBuffer(stream: ReadableStream<Uint8Array>, size: number): Promise<ArrayBuffer>;
export declare function streamToBlob(stream: ReadableStream<Uint8Array>, type: string): Promise<Blob>;
export declare function inflateToResult(src: Uint8Array | Blob, uncompressedSize: number, type?: string): Promise<ArrayBuffer | Blob>;
