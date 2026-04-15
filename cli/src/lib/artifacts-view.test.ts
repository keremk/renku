import { describe, expect, it } from 'vitest';
import { resolveMaterializedRootOutputs } from './artifacts-view.js';

describe('resolveMaterializedRootOutputs', () => {
	it('does not publish a root output when its input-gated binding is inactive', () => {
		const result = resolveMaterializedRootOutputs({
			rootOutputBindings: [
				{
					outputId: 'Output:PreviewVideo',
					sourceId: 'Artifact:PreviewProducer.GeneratedVideo',
					conditions: {
						when: 'Input:UsePreview',
						is: true,
					},
				},
			],
			artefacts: [
				{
					artefactId: 'Artifact:PreviewProducer.GeneratedVideo',
					artifactPath: '/tmp/preview.mp4',
					sourcePath: '/tmp/blob.mp4',
					hash: 'hash-1',
					producedBy: 'Producer:PreviewProducer',
					mimeType: 'video/mp4',
					kind: 'blob',
				},
			],
			resolvedInputs: {
				'Input:UsePreview': false,
			},
		});

		expect(result).toEqual([]);
	});

	it('publishes a root output when its input-gated binding is active', () => {
		const result = resolveMaterializedRootOutputs({
			rootOutputBindings: [
				{
					outputId: 'Output:PreviewVideo',
					sourceId: 'Artifact:PreviewProducer.GeneratedVideo',
					conditions: {
						when: 'Input:UsePreview',
						is: true,
					},
				},
			],
			artefacts: [
				{
					artefactId: 'Artifact:PreviewProducer.GeneratedVideo',
					artifactPath: '/tmp/preview.mp4',
					sourcePath: '/tmp/blob.mp4',
					hash: 'hash-1',
					producedBy: 'Producer:PreviewProducer',
					mimeType: 'video/mp4',
					kind: 'blob',
				},
			],
			resolvedInputs: {
				'Input:UsePreview': true,
			},
		});

		expect(result).toEqual([
			{
				outputId: 'Output:PreviewVideo',
				artifactId: 'Artifact:PreviewProducer.GeneratedVideo',
				artifactPath: '/tmp/preview.mp4',
				producedBy: 'Producer:PreviewProducer',
				mimeType: 'video/mp4',
			},
		]);
	});
});
