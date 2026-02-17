import type { TextEffectTransition } from '@gorenku/compositions';
import type { OverlayPosition, TextConfig } from './types.js';

export interface TextRenderEntry {
  text: string;
  startTime: number;
  duration: number;
  transition: TextEffectTransition;
}

export interface TextRenderOptions {
  width: number;
  height: number;
  text?: TextConfig;
}

const DEFAULT_FONT_NAME = 'Arial';
const DEFAULT_FONT_SIZE = 56;
const DEFAULT_FONT_BASE_COLOR = '#FFFFFF';
const DEFAULT_BACKGROUND_COLOR = '#000000';
const DEFAULT_BACKGROUND_OPACITY = 0.35;
const DEFAULT_POSITION: OverlayPosition = 'middle-center';
const DEFAULT_EDGE_PADDING_PERCENT = 8;
const DEFAULT_BOX_BORDER_WIDTH = 16;

export function buildTextFilterChain(
  inputLabel: string,
  entries: TextRenderEntry[],
  options: TextRenderOptions,
  outputLabel: string
): string {
  if (entries.length === 0) {
    return `${inputLabel}null[${outputLabel}]`;
  }

  const sortedEntries = [...entries].sort((a, b) => a.startTime - b.startTime);
  const filters = sortedEntries.map((entry) =>
    buildSingleTextFilter(entry, options)
  );

  return `${inputLabel}${filters.join(',')}[${outputLabel}]`;
}

function buildSingleTextFilter(
  entry: TextRenderEntry,
  options: TextRenderOptions
): string {
  const style = options.text;
  const font = style?.font ?? DEFAULT_FONT_NAME;
  const fontSize = style?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontColor = style?.fontBaseColor ?? DEFAULT_FONT_BASE_COLOR;
  const backgroundColor = style?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
  const backgroundOpacity =
    style?.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const position = style?.position ?? DEFAULT_POSITION;
  const edgePaddingPercent =
    style?.edgePaddingPercent ?? DEFAULT_EDGE_PADDING_PERCENT;

  const start = entry.startTime;
  const end = entry.startTime + entry.duration;
  const transitionWindow = computeTransitionWindow(entry.duration);
  const slideDistance = Math.round(options.width * 0.2);

  const basePosition = computeBasePositionExpressions(
    position,
    edgePaddingPercent,
    options.width,
    options.height
  );
  const xExpression = buildXExpression(
    entry.transition,
    basePosition.x,
    start,
    end,
    transitionWindow,
    slideDistance
  );
  const yExpression = basePosition.y;
  const alphaExpression = buildAlphaExpression(
    entry.transition,
    start,
    end,
    transitionWindow
  );
  const fontSizeExpression = buildFontSizeExpression(
    entry.transition,
    fontSize,
    start,
    end,
    transitionWindow
  );

  const drawtextParts: string[] = [
    `text='${escapeDrawtextText(entry.text)}'`,
    `font='${escapeDrawtextText(font)}'`,
    `fontsize='${escapeDrawtextExpression(fontSizeExpression)}'`,
    `fontcolor=${fontColor}`,
    `x='${escapeDrawtextExpression(xExpression)}'`,
    `y='${escapeDrawtextExpression(yExpression)}'`,
    `alpha='${escapeDrawtextExpression(alphaExpression)}'`,
    `enable='between(t,${formatNumber(start)},${formatNumber(end)})'`,
  ];

  if (backgroundOpacity > 0) {
    drawtextParts.push('box=1');
    drawtextParts.push(
      `boxcolor=${backgroundColor}@${formatOpacity(backgroundOpacity)}`
    );
    drawtextParts.push(`boxborderw=${DEFAULT_BOX_BORDER_WIDTH}`);
  } else {
    drawtextParts.push('box=0');
  }

  return `drawtext=${drawtextParts.join(':')}`;
}

function computeBasePositionExpressions(
  position: OverlayPosition,
  edgePaddingPercent: number,
  _width: number,
  height: number
): { x: string; y: string } {
  const edgePaddingPx = Math.round(height * (edgePaddingPercent / 100));

  switch (position) {
    case 'top-left':
      return {
        x: `${edgePaddingPx}`,
        y: `${edgePaddingPx}`,
      };
    case 'top-center':
      return {
        x: '(w-text_w)/2',
        y: `${edgePaddingPx}`,
      };
    case 'top-right':
      return {
        x: `w-text_w-${edgePaddingPx}`,
        y: `${edgePaddingPx}`,
      };
    case 'middle-left':
      return {
        x: `${edgePaddingPx}`,
        y: '(h-text_h)/2',
      };
    case 'middle-center':
      return {
        x: '(w-text_w)/2',
        y: '(h-text_h)/2',
      };
    case 'middle-right':
      return {
        x: `w-text_w-${edgePaddingPx}`,
        y: '(h-text_h)/2',
      };
    case 'bottom-left':
      return {
        x: `${edgePaddingPx}`,
        y: `h-text_h-${edgePaddingPx}`,
      };
    case 'bottom-center':
      return {
        x: '(w-text_w)/2',
        y: `h-text_h-${edgePaddingPx}`,
      };
    case 'bottom-right':
      return {
        x: `w-text_w-${edgePaddingPx}`,
        y: `h-text_h-${edgePaddingPx}`,
      };
  }
}

function buildXExpression(
  transition: TextEffectTransition,
  baseX: string,
  start: number,
  end: number,
  window: number,
  slideDistance: number
): string {
  if (
    transition !== 'slide-in-out-left' &&
    transition !== 'slide-in-out-right'
  ) {
    return baseX;
  }

  const enterEnd = start + window;
  const exitStart = end - window;
  const sign = transition === 'slide-in-out-left' ? 1 : -1;

  const entering = `(${baseX})-${sign * slideDistance}*(1-(t-${formatNumber(start)})/${formatNumber(window)})`;
  const exiting = `(${baseX})+${sign * slideDistance}*((t-${formatNumber(exitStart)})/${formatNumber(window)})`;

  return `if(lt(t,${formatNumber(enterEnd)}),${entering},if(lt(t,${formatNumber(
    exitStart
  )}),(${baseX}),${exiting}))`;
}

function buildAlphaExpression(
  transition: TextEffectTransition,
  start: number,
  end: number,
  window: number
): string {
  if (transition !== 'fade-in-out') {
    return '1';
  }

  const enterEnd = start + window;
  const exitStart = end - window;

  return `if(lt(t,${formatNumber(start)}),0,if(lt(t,${formatNumber(
    enterEnd
  )}),(t-${formatNumber(start)})/${formatNumber(window)},if(lt(t,${formatNumber(
    exitStart
  )}),1,if(lt(t,${formatNumber(end)}),(${formatNumber(end)}-t)/${formatNumber(
    window
  )},0))))`;
}

function buildFontSizeExpression(
  transition: TextEffectTransition,
  baseFontSize: number,
  start: number,
  end: number,
  window: number
): string {
  if (transition !== 'spring-in-out') {
    return `${baseFontSize}`;
  }

  const enterEnd = start + window;
  const exitStart = end - window;
  const enterProgress = `(t-${formatNumber(start)})/${formatNumber(window)}`;
  const exitProgress = `(${formatNumber(end)}-t)/${formatNumber(window)}`;
  const springIn = `max(0.001,${enterProgress}+0.2*sin(12*${enterProgress})*exp(-5*${enterProgress}))`;
  const springOut = `max(0.001,${exitProgress}+0.2*sin(12*${exitProgress})*exp(-5*${exitProgress}))`;
  const scale = `if(lt(t,${formatNumber(enterEnd)}),${springIn},if(lt(t,${formatNumber(
    exitStart
  )}),1,${springOut}))`;

  return `${baseFontSize}*(${scale})`;
}

function computeTransitionWindow(duration: number): number {
  const candidate = Math.min(0.35, duration * 0.25);
  const withFloor = Math.max(0.08, candidate);
  return Math.min(withFloor, duration / 2);
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\n/g, '\\n');
}

function escapeDrawtextExpression(expr: string): string {
  return expr.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,');
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function formatOpacity(value: number): string {
  return Number(value.toFixed(3)).toString();
}
