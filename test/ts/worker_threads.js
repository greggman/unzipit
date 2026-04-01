export const parentPort = undefined;
export class Worker {
  constructor() {
    throw new Error('worker_threads is not available in the browser test environment');
  }
}
