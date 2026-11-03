export const DEFAULT_BLOG_CATEGORIES: string[];

export function sanitizeBlogUrl(raw?: string): string;
export function estimateReadTimeMinutes(body?: string): number;

export function extractMarkdownLink(
  selected?: string
): { label: string; url: string } | null;

export type CoverCropRectInput = {
  imgW?: number;
  imgH?: number;
  stageW?: number;
  stageH?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
};

export type CoverCropRectResult = {
  originX: number;
  originY: number;
  width: number;
  height: number;
  dispW: number;
  dispH: number;
  maxPanX: number;
  maxPanY: number;
  clampedPanX: number;
  clampedPanY: number;
};

export function computeCoverCropRect(input?: CoverCropRectInput): CoverCropRectResult;

export type BlogSelection = {
  start: number;
  end: number;
};

export type ToolbarFormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'highlight'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'list'
  | 'ordered'
  | 'codeblock'
  | 'divider'
  | 'link';

export type InlineSegment =
  | {
      type: 'text';
      text: string;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strike: boolean;
      highlight: boolean;
      code: boolean;
    }
  | {
      type: 'link';
      text: string;
      url: string;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      strike: boolean;
      highlight: boolean;
      code: boolean;
    };

export type BlogBlock =
  | { type: 'h1'; segments: InlineSegment[] }
  | { type: 'h2'; segments: InlineSegment[] }
  | { type: 'h3'; segments: InlineSegment[] }
  | { type: 'quote'; segments: InlineSegment[] }
  | { type: 'list'; items: InlineSegment[][] }
  | { type: 'ordered'; items: InlineSegment[][] }
  | { type: 'codeblock'; code: string }
  | { type: 'divider' }
  | { type: 'paragraph'; segments: InlineSegment[] };

export function applyToolbarFormat(
  text?: string,
  selection?: BlogSelection,
  action?: ToolbarFormatAction,
  extra?: { url?: string; label?: string }
): { text: string; selection: BlogSelection };

export function parseInlineSegments(line?: string): InlineSegment[];
export function parseBlogBlocks(body?: string): BlogBlock[];
export function plainExcerptFromBlog(body?: string, maxLen?: number): string;
