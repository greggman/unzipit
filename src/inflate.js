
import {isBlob} from './utils.js';

const config = {
  numWorkers: 1,
  workerURL: '',
  useWorkers: true,
};

let nextId = 0;

// Requests are put on a queue.
// We don't send the request to the worker until the worker
// is finished. This probably adds a small amount of latency
// but the issue is imagine you have 2 workers. You give worker
// A x seconds of work to do and worker B y seconds of work to
// do. You don't know which will finish first. If you give
// the worker with more work to do the request then you'll
// waste time.
const waitingForWorkerQueue = [];
const currentlyProcessingIdToRequestMap = new Map();

// class WorkerInfo {
//   worker,
//   busy,
// }

let numWorkers = 0;
const availableWorkers = [];

function handleResult(e) {
  availableWorkers.push(e.target);
  processWaitingForWorkerQueue();
  const {id, error, data} = e.data;
  const request = currentlyProcessingIdToRequestMap.get(id);
  currentlyProcessingIdToRequestMap.delete(id);
  if (error) {
    request.reject(error);
  } else {
    request.resolve(data);
  }
}

function getAvailableWorker() {
  if (availableWorkers.length === 0 && numWorkers < config.numWorkers) {
    ++numWorkers;
    const worker = new Worker(config.workerURL);
    worker.onmessage = handleResult;
    availableWorkers.push(worker);
  }
  return availableWorkers.pop();
}

function processWaitingForWorkerQueue() {
  if (waitingForWorkerQueue.length === 0) {
    return;
  }

  const worker = getAvailableWorker();
  if (worker) {
    const {id, src, uncompressedSize, type, resolve, reject} = waitingForWorkerQueue.shift();
    currentlyProcessingIdToRequestMap.set(id, {id, resolve, reject});
    const transferables = [];
    if (!isBlob(src)) {
      transferables.push(src);
    }
    worker.postMessage({
      type: 'inflate',
      data: {
        id,
        type,
        src,
        uncompressedSize,
      },
    }, transferables);
  }
}

export function setOptions(options) {
  config.workerURL = options.workerURL || config.workerURL;
  config.numWorkers = options.numWorkers || config.numWorkers;
}

// type: undefined or mimeType string (eg: 'image/png')
//
// if `type` is falsy then an ArrayBuffer is returned
//
//
// It has to take non-zero time to put a large typed array in a Blob since the very
// next instruction you could change the contents of the array. So, if you're reading
// the zip file for images/video/audio then all you want is a Blob on which to get a URL.
// so that operation of putting the data in a Blob should happen in the worker.
//
// Conversely if you want the data itself then you want an ArrayBuffer immediately
// since the worker can transfer its ArrayBuffer zero copy.
export function inflateRaw(src, uncompressedSize, type) {
  return new Promise((resolve, reject) => {
    waitingForWorkerQueue.push({src, uncompressedSize, type, resolve, reject, id: nextId++});
    processWaitingForWorkerQueue();
  });
}