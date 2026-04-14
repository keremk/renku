import type { ProducerInvokeArgs } from '../../sdk/types.js';
import type { ProviderResult } from '../../types.js';

export interface CustomFfmpegConfig {
  ffmpegPath?: string;
  preset?: string;
  crf?: number;
  audioBitrate?: string;
}

export interface CustomFfmpegOperation {
  invoke(args: ProducerInvokeArgs): Promise<ProviderResult>;
}
