/**
 * Catalog of on-device models users can download for local analysis.
 * Sizes are approximate (quantized ONNX weights from Hugging Face).
 */
export const LOCAL_MODELS = [
  {
    id: 'mobilebert-mnli',
    name: 'MobileBERT (zero-shot)',
    description: 'Fast classification for bias, scams, and toxicity.',
    pipeline: 'zero-shot-classification',
    huggingFaceId: 'Xenova/mobilebert-uncased-mnli',
    sizeBytes: 25_000_000,
  },
  {
    id: 'distilbert-mnli',
    name: 'DistilBERT (zero-shot)',
    description: 'More accurate zero-shot classification. Slower than MobileBERT but still runs well on-device.',
    pipeline: 'zero-shot-classification',
    huggingFaceId: 'Xenova/distilbert-base-uncased-mnli',
    sizeBytes: 67_000_000,
  },
  {
    id: 'flan-t5-small',
    name: 'FLAN-T5 Small',
    description: 'Generates quoted explanations. Recommended default.',
    pipeline: 'text2text-generation',
    huggingFaceId: 'Xenova/flan-t5-small',
    sizeBytes: 80_000_000,
    default: true,
  },
  {
    id: 'flan-t5-base',
    name: 'FLAN-T5 Base',
    description: 'Higher-quality generative explanations than Small. ~150 MB download; needs more RAM and time per analysis.',
    pipeline: 'text2text-generation',
    huggingFaceId: 'Xenova/flan-t5-base',
    sizeBytes: 150_000_000,
  },
  {
    id: 'gemma-3-270m-it',
    name: 'Gemma 3 270M',
    description: 'Google Gemma instruct model. Stronger reasoning than FLAN-T5; ~300 MB download and slower on CPU.',
    pipeline: 'text-generation',
    huggingFaceId: 'onnx-community/gemma-3-270m-it-ONNX',
    sizeBytes: 300_000_000,
    pipelineOptions: { dtype: 'q4f16' },
  },
];

/**
 * What a pipeline can be asked to do. Callers used to probe this themselves — one with
 * `model.pipeline === 'zero-shot-classification'`, another with `/generation/.test(...)` —
 * so a new pipeline name had to happen to match a regex to work.
 */
const PIPELINE_CAPABILITIES = {
  'zero-shot-classification': { classify: true, generate: false },
  'text2text-generation': { classify: false, generate: true },
  'text-generation': { classify: false, generate: true },
};

const NO_CAPABILITIES = { classify: false, generate: false };

export function capabilitiesOf(model) {
  return PIPELINE_CAPABILITIES[model?.pipeline] ?? NO_CAPABILITIES;
}

/** Can this model be asked for free text (a summary, an explanation)? */
export function canGenerate(model) {
  return capabilitiesOf(model).generate;
}

/** Can this model score text against candidate labels? */
export function canClassify(model) {
  return capabilitiesOf(model).classify;
}

export function getLocalModel(id) {
  return LOCAL_MODELS.find((m) => m.id === id) ?? LOCAL_MODELS.find((m) => m.default) ?? LOCAL_MODELS[0];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
