/* global module */

import {inflateRaw} from 'uzip-module';
import {isNode, isBlob, readBlobAsUint8Array} from './utils';

const config = {
  numWorkers: 1,
  workerURL: '',
  useWorkers: false,
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

// note: we can't check `workers.length` for deciding if
// we've reached `config.numWorkers` because creation the worker
// is async which means other requests to make workers might
// come in before a worker gets added to `workers`
let numWorkers = 0;
let canUseWorkers = true;   // gets set to false if we can't start a worker
const workers = [];
const availableWorkers = [];
const waitingForWorkerQueue = [];
const currentlyProcessingIdToRequestMap = new Map();

function handleResult(e) {
  makeWorkerAvailable(e.target);
  const {id, error, data} = e.data;
  const request = currentlyProcessingIdToRequestMap.get(id);
  currentlyProcessingIdToRequestMap.delete(id);
  if (error) {
    request.reject(error);
  } else {
    request.resolve(data);
  }
}

// Because Firefox uses non-standard onerror to signal an error.
function startWorker(url) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    worker.onmessage = (e) => {
      if (e.data === 'start') {
        worker.onerror = undefined;
        worker.onmessage = undefined;
        resolve(worker);
      } else {
        reject(new Error(`unexpected message: ${e.data}`));
      }
    };
    worker.onerror = reject;
  });
}

function dynamicRequire(mod, request) {
  return mod.require ? mod.require(request) : {};
}

const workerHelper = (function() {
  if (isNode) {
    // We need to use `dynamicRequire` because `require` on it's own will be optimized by webpack.
    const {Worker} = dynamicRequire(module, 'worker_threads');
    return {
      async createWorker(url) {
        return new Worker(url);
      },
      addEventListener(worker, fn) {
        worker.on('message', (data) => {
          fn({target: worker, data});
        });
      },
      async terminate(worker) {
        await worker.terminate();
      },
    };
  } else {
    return {
      async createWorker(url) {
        // I don't understand this security issue
        // Apparently there is some iframe setting or http header
        // that prevents cross domain workers. But, I can manually
        // download the text and do it. I reported this to Chrome
        // and they said it was fine so ¯\_(ツ)_/¯
        try {
          const worker = await startWorker(url);
          return worker;
        } catch (e) {
          console.warn('could not load worker:', url);
        }

        let text;
        try {
          const req = await fetch(url, {mode: 'cors'});
          if (!req.ok) {
            throw new Error(`could not load: ${url}`);
          }
          text = await req.text();
          url = URL.createObjectURL(new Blob([text], {type: 'application/javascript'}));
          const worker = await startWorker(url);
          config.workerURL = url;  // this is a hack. What's a better way to structure this code?
          return worker;
        } catch (e) {
          console.warn('could not load worker via fetch:', url);
        }

        if (text !== undefined) {
          try {
            url = `data:application/javascript;base64,${btoa(text)}`;
            const worker = await startWorker(url);
            config.workerURL = url;
            return worker;
          } catch (e) {
            console.warn('could not load worker via dataURI');
          }
        }

        console.warn('workers will not be used');
        throw new Error('can not start workers');
      },
      addEventListener(worker, fn) {
        worker.addEventListener('message', fn);
      },
      async terminate(worker) {
        worker.terminate();
      },
    };
  }
}());

function makeWorkerAvailable(worker) {
  availableWorkers.push(worker);
  processWaitingForWorkerQueue();
}

async function getAvailableWorker() {
  if (availableWorkers.length === 0 && numWorkers < config.numWorkers) {
    ++numWorkers;  // see comment at numWorkers declaration
    try {
      const worker = await workerHelper.createWorker(config.workerURL);
      workers.push(worker);
      availableWorkers.push(worker);
      workerHelper.addEventListener(worker, handleResult);
    } catch (e) {
      // set this global out-of-band (needs refactor)
      canUseWorkers = false;
    }
  }
  return availableWorkers.pop();
}

// @param {Uint8Array} src
// @param {number} uncompressedSize
// @param {string} [type] mime-type
// @returns {ArrayBuffer|Blob} ArrayBuffer if type is falsy or Blob otherwise.
function inflateRawLocal(src, uncompressedSize, type, resolve) {
  const dst = new Uint8Array(uncompressedSize);
  inflateRaw(src, dst);
  resolve(type
     ? new Blob([dst], {type})
     : dst.buffer);
}

async function processWaitingForWorkerQueue() {
  if (waitingForWorkerQueue.length === 0) {
    return;
  }

  if (config.useWorkers && canUseWorkers) {
    const worker = await getAvailableWorker();
    // canUseWorkers might have been set out-of-band (need refactor)
    if (canUseWorkers) {
      if (worker) {
        if (waitingForWorkerQueue.length === 0) {
          // the queue might be empty while we awaited for a worker.
          makeWorkerAvailable(worker);
          return;
        }
        const {id, src, uncompressedSize, type, resolve, reject} = waitingForWorkerQueue.shift();
        currentlyProcessingIdToRequestMap.set(id, {id, resolve, reject});
        const transferables = [];
        // NOTE: Originally I thought you could transfer an ArrayBuffer.
        // The code on this side is often using views into the entire file
        // which means if we transferred we'd lose the entire file. That sucks
        // because it means there's an expensive copy to send the uncompressed
        // data to the worker.
        //
        // Also originally I thought we could send a Blob but we'd need to refactor
        // the code in unzipit/readEntryData as currently it reads the uncompressed
        // bytes.
        //
        //if (!isBlob(src) && !isSharedArrayBuffer(src)) {
        //  transferables.push(src);
        //}
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
      return;
    }
  }

  // inflate locally
  // We loop here because what happens if many requests happen at once
  // the first N requests will try to async make a worker. Other requests
  // will then be on the queue. But if we fail to make workers then there
  // are pending requests.
  while (waitingForWorkerQueue.length) {
    const {src, uncompressedSize, type, resolve} = waitingForWorkerQueue.shift();
    let data = src;
    if (isBlob(src)) {
      data = await readBlobAsUint8Array(src);
    }
    inflateRawLocal(data, uncompressedSize, type, resolve);
  }
}

export function setOptions(options) {
  config.workerURL = options.workerURL || config.workerURL;
  // there's no reason to set the workerURL if you're not going to use workers
  if (options.workerURL) {
    config.useWorkers = true;
  }
  config.useWorkers = options.useWorkers !== undefined ? options.useWorkers : config.useWorkers;
  config.numWorkers = options.numWorkers || config.numWorkers;
}

// It has to take non-zero time to put a large typed array in a Blob since the very
// next instruction you could change the contents of the array. So, if you're reading
// the zip file for images/video/audio then all you want is a Blob on which to get a URL.
// so that operation of putting the data in a Blob should happen in the worker.
//
// Conversely if you want the data itself then you want an ArrayBuffer immediately
// since the worker can transfer its ArrayBuffer zero copy.
//
// @param {Uint8Array|Blob} src
// @param {number} uncompressedSize
// @param {string} [type] falsy or mimeType string (eg: 'image/png')
// @returns {ArrayBuffer|Blob} ArrayBuffer if type is falsy or Blob otherwise.
export function inflateRawAsync(src, uncompressedSize, type) {
  return new Promise((resolve, reject) => {
    // note: there is potential an expensive copy here. In order for the data
    // to make it into the worker we need to copy the data to the worker unless
    // it's a Blob or a SharedArrayBuffer.
    //
    // Solutions:
    //
    // 1. A minor enhancement, if `uncompressedSize` is small don't call the worker.
    //
    //    might be a win period as their is overhead calling the worker
    //
    // 2. Move the entire library to the worker
    //
    //    Good, Maybe faster if you pass a URL, Blob, or SharedArrayBuffer? Not sure about that
    //    as those are also easy to transfer. Still slow if you pass an ArrayBuffer
    //    as the ArrayBuffer has to be copied to the worker.
    //
    // I guess benchmarking is really the only thing to try.
    waitingForWorkerQueue.push({src, uncompressedSize, type, resolve, reject, id: nextId++});
    processWaitingForWorkerQueue();
  });
}

function clearArray(arr) {
  arr.splice(0, arr.length);
}

export async function cleanup() {
  for (const worker of workers) {
    await workerHelper.terminate(worker);
  }
  clearArray(workers);
  clearArray(availableWorkers);
  clearArray(waitingForWorkerQueue);
  currentlyProcessingIdToRequestMap.clear();
  numWorkers = 0;
  canUseWorkers = true;
}