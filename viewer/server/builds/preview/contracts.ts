export type ImagePreviewMode = 'rerun' | 'edit' | 'camera';

export interface CameraParams {
  azimuth: number;
  elevation: number;
  distance: number;
  shotDescription: string;
}

export interface ArtifactPreviewGenerateRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  mode: ImagePreviewMode;
  prompt: string;
  promptArtifactId?: string;
  model?: {
    provider: string;
    model: string;
  };
  cameraParams?: CameraParams;
}

export interface ArtifactPreviewGenerateResponse {
  success: true;
  tempId: string;
  previewUrl: string;
  mimeType: string;
  estimatedCost: GenerationCostEstimate;
}

export interface ArtifactPreviewEstimateRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  mode: ImagePreviewMode;
  prompt: string;
  promptArtifactId?: string;
  model?: {
    provider: string;
    model: string;
  };
  cameraParams?: CameraParams;
}

export interface ArtifactPreviewEstimateResponse {
  success: true;
  estimatedCost: GenerationCostEstimate;
}

export interface PreviewModelOption {
  provider: string;
  model: string;
}

export interface ArtifactPreviewEditModelsResponse {
  success: true;
  models: PreviewModelOption[];
}

export interface ArtifactPreviewApplyRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
  tempId: string;
}

export interface ArtifactPreviewDeleteRequest {
  blueprintFolder: string;
  movieId: string;
  tempId: string;
}

export interface GenerationCostEstimate {
  cost: number;
  minCost: number;
  maxCost: number;
  isPlaceholder: boolean;
  note?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface PreviewGenerationResult {
  previewData: Buffer;
  mimeType: string;
  estimatedCost: GenerationCostEstimate;
}
