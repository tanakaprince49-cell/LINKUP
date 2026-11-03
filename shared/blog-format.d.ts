export const DEFAULT_BLOG_CATEGORIES: string[];
export function sanitizeBlogUrl(raw?: string): string;
export function estimateReadTimeMinutes(body?: string): number;

export type BlogSelection = { start: number; end: number };
export type ToolbarAction = 'bold' | 'italic' | 'h2' | 'quote' | 'list' | 'link';

export function applyToolbarFormat(
  text?: string,
  selection?: BlogSelection,
  action?: ToolbarAction,
  extra?: { url?: string; label?: string }
): { text: string; selection: BlogSelection };

export type InlineSegment =
  | { type: 'text'; text: string; bold: boolean; italic: boolean }
  | { type: 'link'; text: string; url: string; bold: boolean; italic: boolean };

export type BlogBlock =
  | { type: 'h2'; segments: InlineSegment[] }
  | { type: 'quote'; segments: InlineSegment[] }
  | { type: 'list'; items: InlineSegment[][] }
  | { type: 'paragraph'; segments: InlineSegment[] };

export function parseInlineSegments(line?: string): InlineSegment[];
export function parseBlogBlocks(body?: string): BlogBlock[];
export function plainExcerptFromBlog(body?: string, maxLen?: number): string;
