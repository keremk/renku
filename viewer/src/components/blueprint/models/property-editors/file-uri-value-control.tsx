/* eslint-disable react-refresh/only-export-components */

import { useCallback, useMemo, useState } from 'react';
import {
  FileText,
  ImageIcon,
  Music,
  Pencil,
  Upload,
  Video,
} from 'lucide-react';
import {
  buildInputFileUrl,
  parseFileRef,
  type MediaInputType,
} from '@/data/blueprint-client';
import type {
  ConfigFieldDescriptor,
  SchemaProperty,
} from '@/types/blueprint-graph';
import { uploadAndValidate } from '@/lib/panel-utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  FileUploadDialog,
  type UploadDialogMediaType,
} from '../../inputs/file-upload-dialog';
import {
  useFileUriUploadContext,
  type FileUriUploadContextValue,
} from './file-uri-upload-context';

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'heic',
  'heif',
]);

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'm4v',
  'avi',
  'mkv',
  'mpeg',
  'mpg',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'aiff',
  'wma',
]);

const FAL_UI_FIELDS = new Set<MediaInputType>(['image', 'video', 'audio']);

export interface FileUriValueControlProps {
  field: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  onChange: (value: unknown) => void;
  onRemove: () => void;
  removeLabel?: string;
}

export function FileUriValueControl({
  field,
  value,
  isEditable,
  onChange,
  onRemove,
  removeLabel = 'Remove file',
}: FileUriValueControlProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const uploadContext = useFileUriUploadContext();

  const editableUploadContext = useMemo(
    () =>
      getEditableUploadContext(uploadContext, {
        fieldKeyPath: field.keyPath,
        isEditable,
      }),
    [field.keyPath, isEditable, uploadContext]
  );

  const uploadMediaType = useMemo(
    () => resolveFileUriUploadMediaType(field),
    [field]
  );

  const valueText = typeof value === 'string' ? value.trim() : '';
  const hasValue = valueText.length > 0;

  const resolvedValue = useMemo(() => {
    if (!hasValue) {
      return null;
    }
    return resolveCurrentValue(valueText, uploadContext);
  }, [hasValue, uploadContext, valueText]);

  const previewMediaType = useMemo(() => {
    if (!resolvedValue) {
      return uploadMediaType;
    }

    return resolvePreviewMediaType({
      displayName: resolvedValue.displayName,
      originalValue: valueText,
      fallbackType: uploadMediaType,
    });
  }, [resolvedValue, uploadMediaType, valueText]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (!editableUploadContext) {
        throw new Error(
          `Cannot upload for field "${field.keyPath}" without editable upload context.`
        );
      }

      const result = await uploadAndValidate(
        editableUploadContext,
        files,
        toUploadInputType(uploadMediaType)
      );

      const uploaded = result.files[0];
      if (!uploaded) {
        throw new Error(
          `Upload did not return a file reference for field "${field.keyPath}".`
        );
      }

      onChange(uploaded.fileRef);
    },
    [editableUploadContext, field.keyPath, onChange, uploadMediaType]
  );

  return (
    <>
      <div className='flex w-full min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5'>
        <MediaPreviewBadge
          mediaType={previewMediaType}
          previewUrl={resolvedValue?.previewUrl ?? null}
          filename={resolvedValue?.displayName ?? 'File preview'}
        />

        <div className='min-w-0 flex-1'>
          {resolvedValue ? (
            <p
              className='truncate text-xs font-medium text-foreground'
              title={resolvedValue.displayName}
            >
              {resolvedValue.displayName}
            </p>
          ) : (
            <p className='text-xs text-muted-foreground'>&nbsp;</p>
          )}
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-7 shrink-0 text-muted-foreground hover:text-foreground'
                disabled={!isEditable}
                onClick={() => setIsDialogOpen(true)}
                aria-label={hasValue ? 'Change file' : 'Upload file'}
              >
                {hasValue ? (
                  <Pencil className='size-3.5' />
                ) : (
                  <Upload className='size-3.5' />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side='top' sideOffset={6}>
              {hasValue ? 'change file' : 'upload file'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <FileUploadDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        mediaType={uploadMediaType}
        multiple={false}
        onConfirm={handleUpload}
        onRemoveExisting={hasValue ? onRemove : undefined}
        removeButtonLabel={removeLabel}
        removeButtonDisabled={!isEditable}
      />
    </>
  );
}

export function resolveFileUriUploadMediaType(
  field: ConfigFieldDescriptor
): UploadDialogMediaType {
  const hints = new Set<MediaInputType>();

  addTextHints(field.keyPath, hints);
  addTextHints(field.label, hints);

  collectSchemaMediaHints(field.schema, hints);
  collectSchemaMediaHints(field.item?.schema, hints);

  if (hints.size === 1) {
    return [...hints][0];
  }

  return 'file';
}

export function getEditableUploadContext(
  context: FileUriUploadContextValue | null,
  args: {
    fieldKeyPath: string;
    isEditable: boolean;
  }
): {
  blueprintFolder: string;
  movieId: string;
} | null {
  if (!args.isEditable) {
    return null;
  }

  if (!context?.blueprintFolder || !context.movieId) {
    throw new Error(
      `Editable file-uri field "${args.fieldKeyPath}" requires blueprintFolder and movieId upload context.`
    );
  }

  return {
    blueprintFolder: context.blueprintFolder,
    movieId: context.movieId,
  };
}

export function toUploadInputType(
  mediaType: UploadDialogMediaType
): MediaInputType | undefined {
  switch (mediaType) {
    case 'image':
    case 'video':
    case 'audio':
      return mediaType;
    case 'file':
      return undefined;
    default:
      return assertNever(mediaType);
  }
}

function resolveCurrentValue(
  value: string,
  context: FileUriUploadContextValue | null
): {
  displayName: string;
  previewUrl: string | null;
} {
  const localFilename = parseFileRef(value);
  if (localFilename) {
    const previewUrl =
      context?.blueprintFolder && context.movieId
        ? buildInputFileUrl(
            context.blueprintFolder,
            context.movieId,
            localFilename
          )
        : null;

    return {
      displayName: localFilename,
      previewUrl,
    };
  }

  return {
    displayName: extractDisplayNameFromUri(value),
    previewUrl: canPreviewDirectly(value) ? value : null,
  };
}

function resolvePreviewMediaType(args: {
  displayName: string;
  originalValue: string;
  fallbackType: UploadDialogMediaType;
}): UploadDialogMediaType {
  const fromDisplayName = resolveMediaTypeFromExtension(args.displayName);
  if (fromDisplayName) {
    return fromDisplayName;
  }

  const fromDetail = resolveMediaTypeFromExtension(args.originalValue);
  if (fromDetail) {
    return fromDetail;
  }

  return args.fallbackType;
}

function resolveMediaTypeFromExtension(
  input: string
): UploadDialogMediaType | null {
  const clean = input.toLowerCase().split('?')[0].split('#')[0];
  const extension = clean.split('.').pop();
  if (!extension || extension === clean) {
    return null;
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }

  return null;
}

function extractDisplayNameFromUri(uri: string): string {
  if (uri.startsWith('data:')) {
    return 'embedded-file';
  }

  try {
    const parsed = new URL(uri);
    const filename = parsed.pathname.split('/').filter(Boolean).pop();
    if (filename) {
      return decodeURIComponent(filename);
    }
  } catch {
    // Keep original URI if parsing fails.
  }

  return uri;
}

function canPreviewDirectly(uri: string): boolean {
  if (uri.startsWith('data:')) {
    return true;
  }

  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function collectSchemaMediaHints(
  schema: SchemaProperty | undefined,
  hints: Set<MediaInputType>
) {
  if (!schema) {
    return;
  }

  const falUiField = readFalUiField(schema);
  if (falUiField) {
    hints.add(falUiField);
  }

  addTextHints(schema.title, hints);
  addTextHints(schema.description, hints);

  if (schema.items) {
    collectSchemaMediaHints(schema.items, hints);
  }
}

function addTextHints(text: string | undefined, hints: Set<MediaInputType>) {
  if (!text) {
    return;
  }

  const normalized = text.toLowerCase();

  if (
    normalized.includes('image') ||
    normalized.includes('mask') ||
    /(^|_|\b)img(_|\b)/.test(normalized)
  ) {
    hints.add('image');
  }

  if (normalized.includes('video')) {
    hints.add('video');
  }

  if (normalized.includes('audio') || normalized.includes('music')) {
    hints.add('audio');
  }
}

function readFalUiField(schema: SchemaProperty): MediaInputType | null {
  const candidate = (schema as Record<string, unknown>)['_fal_ui_field'];
  if (typeof candidate !== 'string') {
    return null;
  }

  if (FAL_UI_FIELDS.has(candidate as MediaInputType)) {
    return candidate as MediaInputType;
  }

  return null;
}

function MediaPreviewBadge(args: {
  mediaType: UploadDialogMediaType;
  previewUrl: string | null;
  filename: string;
}) {
  const [previewError, setPreviewError] = useState(false);
  const canRenderMediaPreview = Boolean(args.previewUrl) && !previewError;

  if (args.mediaType === 'image' && canRenderMediaPreview) {
    return (
      <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background'>
        <img
          src={args.previewUrl ?? undefined}
          alt={args.filename}
          className='size-full object-cover'
          loading='lazy'
          onError={() => setPreviewError(true)}
        />
      </div>
    );
  }

  if (args.mediaType === 'video' && canRenderMediaPreview) {
    return (
      <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-background'>
        <video
          src={args.previewUrl ?? undefined}
          muted
          playsInline
          preload='metadata'
          className='size-full object-cover'
          onError={() => setPreviewError(true)}
        />
      </div>
    );
  }

  if (args.mediaType === 'audio') {
    return (
      <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-linear-to-br from-muted to-muted/60'>
        <div className='flex size-full items-center justify-center'>
          <Music className='size-4 text-primary' />
        </div>
      </div>
    );
  }

  if (args.mediaType === 'video') {
    return (
      <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/50'>
        <div className='flex size-full items-center justify-center'>
          <Video className='size-4 text-muted-foreground' />
        </div>
      </div>
    );
  }

  if (args.mediaType === 'image') {
    return (
      <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/50'>
        <div className='flex size-full items-center justify-center'>
          <ImageIcon className='size-4 text-muted-foreground' />
        </div>
      </div>
    );
  }

  return (
    <div className='size-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted/50'>
      <div className='flex size-full items-center justify-center'>
        <FileText className='size-4 text-muted-foreground' />
      </div>
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported upload media type: ${String(value)}`);
}
