export {
  collectCanonicalInputs,
  createInputIdResolver,
  formatCanonicalInputId,
  formatCanonicalArtifactId,
  formatCanonicalProducerName,
  formatCanonicalProducerId,
  formatProducerScopedInputId,
  isCanonicalInputId,
  isCanonicalArtifactId,
  parseQualifiedProducerName,
} from './parsing/canonical-ids.js';
export type {
  CanonicalInputEntry,
  InputIdResolver,
} from './parsing/canonical-ids.js';
