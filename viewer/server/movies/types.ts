/**
 * Type definitions for the movies module.
 */

/**
 * Pointer to the current manifest revision.
 */
export interface ManifestPointer {
  revision: string | null;
  manifestPath: string | null;
}

/**
 * Manifest file structure with artefact definitions.
 */
export interface ManifestFile {
  artefacts?: Record<
    string,
    {
      blob: {
        hash: string;
        size: number;
        mimeType?: string;
      };
    }
  >;
}

/**
 * Timeline artefact ID constant.
 */
export const TIMELINE_ARTEFACT_ID = "Artifact:TimelineComposer.Timeline";
