/**
 * Catalog of on-device models users can download for local analysis.
 * Sizes are approximate (quantized ONNX weights from Hugging Face).
 */
export const LOCAL_MODELS = [
  {
    id: 'mobilebert-mnli',
    name: 'MobileBERT (zero-shot)',
    description: 'Fast classification for bias, scams, and toxicity. Recommended default.',
    pipeline: 'zero-shot-classification',
    huggingFaceId: 'Xenova/mobilebert-uncased-mnli',
    sizeBytes: 25_000_000,
    default: true,
  },
  {
    id: 'flan-t5-small',
    name: 'FLAN-T5 Small',
    description: 'Generates detailed JSON explanations. Slower and uses more memory.',
    pipeline: 'text2text-generation',
    huggingFaceId: 'Xenova/flan-t5-small',
    sizeBytes: 80_000_000,
  },
];

export function getLocalModel(id) {
  return LOCAL_MODELS.find((m) => m.id === id) ?? LOCAL_MODELS.find((m) => m.default) ?? LOCAL_MODELS[0];
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
