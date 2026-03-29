export interface UnzipitOptions {
    useWorkers?: boolean;
    workerURL?: string;
    numWorkers?: number;
}
export declare function setOptions(options: UnzipitOptions): void;
export declare function inflateRawAsync(src: Uint8Array<ArrayBuffer> | Blob, uncompressedSize: number, type?: string): Promise<ArrayBuffer | Blob>;
export declare function cleanup(): Promise<void>;
