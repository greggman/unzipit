import ArrayBufferReader from './ArrayBufferReader.js';
import BlobReader from './BlobReader.js';
export { ArrayBufferReader, BlobReader };
export * from './HTTPRangeReader.js';
export type { Reader } from './BlobReader.js';
export type { UnzipitOptions } from './inflate.js';
import type { Reader } from './BlobReader.js';
export interface Zip {
    comment: string;
    commentBytes: Uint8Array;
}
export interface ZipInfoRaw {
    zip: Zip;
    entries: ZipEntry[];
}
export interface ZipInfo {
    zip: Zip;
    entries: {
        [key: string]: ZipEntry;
    };
}
export type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array;
interface ExtraField {
    id: number;
    data: Uint8Array;
}
interface RawEntry {
    versionMadeBy: number;
    versionNeededToExtract: number;
    generalPurposeBitFlag: number;
    compressionMethod: number;
    lastModFileTime: number;
    lastModFileDate: number;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    fileNameLength: number;
    extraFieldLength: number;
    fileCommentLength: number;
    internalFileAttributes: number;
    externalFileAttributes: number;
    relativeOffsetOfLocalHeader: number;
    nameBytes: Uint8Array;
    name: string;
    extraFields: ExtraField[];
    commentBytes: Uint8Array;
    comment: string;
    fileName?: string;
}
export declare class ZipEntry {
    private _reader;
    private _rawEntry;
    name: string;
    nameBytes: Uint8Array;
    size: number;
    compressedSize: number;
    comment: string;
    commentBytes: Uint8Array;
    compressionMethod: number;
    lastModDate: Date;
    isDirectory: boolean;
    encrypted: boolean;
    externalFileAttributes: number;
    versionMadeBy: number;
    constructor(reader: Reader, rawEntry: RawEntry);
    blob(type?: string): Promise<Blob>;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json(): Promise<any>;
}
export declare function setOptions(options: import('./inflate').UnzipitOptions): void;
export declare function unzipRaw(source: string | ArrayBuffer | TypedArray | SharedArrayBuffer | Blob | Reader): Promise<ZipInfoRaw>;
export declare function unzip(source: string | ArrayBuffer | TypedArray | SharedArrayBuffer | Blob | Reader): Promise<ZipInfo>;
export declare function cleanup(): void;
