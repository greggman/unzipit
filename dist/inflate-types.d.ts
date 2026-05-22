export interface InflateRequestData {
    id: number;
    type?: string;
    src: Uint8Array<ArrayBuffer> | Blob;
    uncompressedSize: number;
}
export interface InflateRequestMessage {
    type: 'inflate';
    data: InflateRequestData;
}
export interface InflateResultMessage {
    id: number;
    data?: ArrayBuffer | Blob;
    error?: string;
}
