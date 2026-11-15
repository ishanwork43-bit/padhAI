import { env, pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { LocalError, MODEL_NAME } from './constants';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = '/wasm/ort-1.22.0/';
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
let loading: Promise<FeatureExtractionPipeline> | undefined;
export async function loadModel(progress: (message: string) => void = () => {}) {
  if (typeof WebAssembly === 'undefined')
    throw new LocalError(
      'unsupported_browser',
      'Semantic search needs WebAssembly. Use a recent Chrome, Edge, Firefox, or Safari browser.',
    );
  if (!loading) {
    progress('Loading the local search model…');
    loading = pipeline('feature-extraction', MODEL_NAME, {
      device: 'wasm',
      dtype: 'q8',
      local_files_only: true,
      progress_callback: (event) => {
        if (event.status === 'progress' && event.file.endsWith('.onnx'))
          progress(`Downloading search model · ${Math.round(event.progress)}%`);
      },
    }).catch(() => {
      loading = undefined;
      throw new LocalError(
        'model_unavailable',
        'The local search model could not load. Check your connection and available memory, close other heavy tabs, then retry. Your notes are still saved.',
      );
    });
  }
  return loading;
}
/** Never silently truncate a passage: average normalized token-safe windows. */
export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await loadModel();
  const parts: { text: string; weight: number }[] = [];
  function split(value: string) {
    const tokens = extractor.tokenizer.encode(value);
    if (tokens.length <= 256) {
      parts.push({ text: value, weight: Math.max(1, tokens.length - 2) });
      return;
    }
    let middle = Math.floor(value.length / 2);
    if (/[\uD800-\uDBFF]/.test(value[middle - 1] ?? '')) middle--;
    if (!middle || middle === value.length)
      throw new LocalError(
        'token_limit',
        'This passage cannot fit the search model. Try a shorter note.',
      );
    split(value.slice(0, middle));
    split(value.slice(middle));
  }
  split(text);
  const vector = new Float32Array(384);
  for (const part of parts) {
    const output = await extractor(part.text, { pooling: 'mean', normalize: true });
    if (output.data.length !== 384)
      throw new LocalError(
        'invalid_embedding',
        'The search model returned an invalid vector. Reopen PadhAI and rebuild the index.',
      );
    for (let i = 0; i < vector.length; i++) vector[i] += Number(output.data[i]) * part.weight;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0)
    throw new LocalError(
      'invalid_embedding',
      'This text could not be embedded. Try a different question or note.',
    );
  return vector.map((value) => value / norm);
}
