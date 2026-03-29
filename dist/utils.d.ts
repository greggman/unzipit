export declare function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer>;
export declare function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array<ArrayBuffer>>;
export declare function isBlob(v: unknown): v is Blob;
export declare function isSharedArrayBuffer(b: unknown): b is SharedArrayBuffer;
export declare const isNode: boolean;
export declare function isTypedArraySameAsArrayBuffer(typedArray: Uint8Array): boolean;
