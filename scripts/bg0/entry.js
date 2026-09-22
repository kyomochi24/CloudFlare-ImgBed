import { env } from '@huggingface/transformers';
import { removeBackground as runBg0 } from '@bg0/browser';
import * as ort from 'onnxruntime-web';

// Keep every model and runtime request on the user's own domain. The Pages
// Function fetches the pinned weights once and caches them in the existing R2.
env.remoteHost = `${location.origin}/api/studio/bg0-model/`;
env.remotePathTemplate = '{model}/resolve/{revision}/';
ort.env.wasm.wasmPaths = '/studio/vendor/bg0/';
ort.env.wasm.numThreads = 1;

export async function removeBackground(file, onProgress) {
  const result = await runBg0(file, { quality: 'quality', onProgress });
  return result.blob;
}
