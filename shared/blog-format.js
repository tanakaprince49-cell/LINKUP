// Shared rich-text blog formatter, inline link parser, cover crop math, and read-time helper.
// Pure and dependency-free so server validation, mobile/web rendering, and tests share identical rules.

export const DEFAULT_BLOG_CATEGORIES = [
  'Startups',
  'Engineering',
  'AI & Agents',
  'Product & Design',
  'Growth & GTM',
  'Fundraising',
  'Founder Stories',
];

export function sanitizeBlogUrl(raw = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed || trimmed.length > 2048) return '';
  const withProto = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)
      ? `https://${trimmed}`
      : '';
  if (!withProto) return '';
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function estimateReadTimeMinutes(body = '') {
  const words = String(body || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.min(60, Math.ceil(words / 200)));
}

export function slugifyBlogTitle(title = '') {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/g, '');
}

export function canonicalBlogSlug(title = '', blogId = '') {
  const cleanId = String(blogId || '').trim();
  const slug = slugifyBlogTitle(title);
  if (!cleanId) return slug;
  return slug ? `${slug}--${cleanId}` : cleanId;
}

export function extractBlogIdFromSlug(slugOrId = '') {
  const raw = String(slugOrId || '').trim();
  if (!raw || raw.length > 220) return '';
  const idx = raw.lastIndexOf('--');
  const candidate = idx >= 0 ? raw.slice(idx + 2) : raw;
  return /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : '';
}

export function defaultCoverAlt(title = '', authorName = '', categories = []) {
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Community Blog';
  const a = String(authorName || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const c = Array.isArray(categories) && categories[0] ? String(categories[0]).trim() : 'Startup';
  return a ? `${t} — ${c} blog by ${a} on LINKUP` : `${t} — ${c} blog on LINKUP`;
}

/**
 * Extracts { label, url } if `selected` is already formatted as `[label](url)`.
 */
export function extractMarkdownLink(selected = '') {
  const m = String(selected || '').trim().match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (!m) return null;
  return { label: m[1], url: m[2] };
}

/**
 * Pure 16:9 interactive crop math mapping stage pan/zoom back to natural image pixels.
 */
export function computeCoverCropRect({
  imgW = 1280,
  imgH = 720,
  stageW = 320,
  stageH = 180,
  zoom = 1,
  panX = 0,
  panY = 0,
} = {}) {
  const safeImgW = Math.max(1, Number(imgW) || 1280);
  const safeImgH = Math.max(1, Number(imgH) || 720);
  const safeStageW = Math.max(1, Number(stageW) || 320);
  const safeStageH = Math.max(1, Number(stageH) || safeStageW * (9 / 16));
  const clampedZoom = Math.max(1, Math.min(4, Number(zoom) || 1));

  const baseScale = Math.max(safeStageW / safeImgW, safeStageH / safeImgH);
  const effectiveScale = baseScale * clampedZoom;
  const dispW = safeImgW * effectiveScale;
  const dispH = safeImgH * effectiveScale;

  const maxPanX = Math.max(0, (dispW - safeStageW) / 2);
  const maxPanY = Math.max(0, (dispH - safeStageH) / 2);
  const clampedPanX = Math.max(-maxPanX, Math.min(maxPanX, Number(panX) || 0));
  const clampedPanY = Math.max(-maxPanY, Math.min(maxPanY, Number(panY) || 0));

  const imgLeft = (safeStageW - dispW) / 2 + clampedPanX;
  const imgTop = (safeStageH - dispH) / 2 + clampedPanY;

  const originX = Math.max(
    0,
    Math.min(safeImgW - 1, Math.round(-imgLeft / effectiveScale))
  );
  const originY = Math.max(
    0,
    Math.min(safeImgH - 1, Math.round(-imgTop / effectiveScale))
  );
  const width = Math.max(
    1,
    Math.min(safeImgW - originX, Math.round(safeStageW / effectiveScale))
  );
  const height = Math.max(
    1,
    Math.min(safeImgH - originY, Math.round(safeStageH / effectiveScale))
  );

  return {
    originX,
    originY,
    width,
    height,
    dispW,
    dispH,
    maxPanX,
    maxPanY,
    clampedPanX,
    clampedPanY,
  };
}

function toggleInlineWrap(source, start, end, marker, placeholder) {
  const mLen = marker.length;
  const before = source.slice(0, start);
  const selected = source.slice(start, end);
  const after = source.slice(end);

  // Case 1: Selected text itself includes the markers (e.g. `**word**`)
  if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length >= mLen * 2 &&
    !(marker === '*' && selected.startsWith('**'))
  ) {
    const inner = selected.slice(mLen, selected.length - mLen);
    const next = before + inner + after;
    return { text: next, selection: { start, end: start + inner.length } };
  }

  // Case 2: Markers sit immediately outside the current selection (e.g. `**[word]**`)
  if (
    before.endsWith(marker) &&
    after.startsWith(marker) &&
    !(marker === '*' && before.endsWith('**') && !before.endsWith('***'))
  ) {
    const next = before.slice(0, before.length - mLen) + selected + after.slice(mLen);
    return {
      text: next,
      selection: { start: start - mLen, end: end - mLen },
    };
  }

  const content = selected || placeholder;
  const wrapped = `${marker}${content}${marker}`;
  const next = before + wrapped + after;
  return {
    text: next,
    selection: { start: start + mLen, end: start + mLen + content.length },
  };
}

/**
 * Applies rich formatting to the current text + cursor/selection range.
 * Actions:
 *   Inline: 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code' | 'link'
 *   Block:  'h1' | 'h2' | 'h3' | 'quote' | 'list' | 'ordered' | 'codeblock' | 'divider'
 */
export function applyToolbarFormat(
  text = '',
  selection = { start: 0, end: 0 },
  action = 'bold',
  extra = {}
) {
  const source = String(text || '');
  const start = Math.max(0, Math.min(source.length, Number(selection?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(selection?.end) || start));
  const before = source.slice(0, start);
  const selected = source.slice(start, end);
  const after = source.slice(end);

  if (action === 'bold') {
    return toggleInlineWrap(source, start, end, '**', 'bold text');
  }
  if (action === 'italic') {
    return toggleInlineWrap(source, start, end, '*', 'italic text');
  }
  if (action === 'underline') {
    return toggleInlineWrap(source, start, end, '++', 'underlined text');
  }
  if (action === 'strike') {
    return toggleInlineWrap(source, start, end, '~~', 'crossed text');
  }
  if (action === 'highlight') {
    return toggleInlineWrap(source, start, end, '==', 'highlighted text');
  }
  if (action === 'code') {
    return toggleInlineWrap(source, start, end, '`', 'code');
  }

  if (action === 'link') {
    const existing = extractMarkdownLink(selected);
    const cleanUrl =
      sanitizeBlogUrl(extra?.url || existing?.url || 'https://') || 'https://example.com';
    const rawLabel =
      extra?.label !== undefined && String(extra.label).trim()
        ? String(extra.label).trim()
        : existing?.label || selected.trim() || 'link text';
    // Preserve leading/trailing spaces if user accidentally selected trailing space with a word
    const leadMatch = selected && !existing ? selected.match(/^\s+/) : null;
    const trailMatch = selected && !existing ? selected.match(/\s+$/) : null;
    const lead = leadMatch ? leadMatch[0] : '';
    const trail = trailMatch && selected.trim().length > 0 ? trailMatch[0] : '';
    const markdownLink = `[${rawLabel}](${cleanUrl})`;
    const next = before + lead + markdownLink + trail + after;
    const linkStart = start + lead.length;
    return {
      text: next,
      selection: { start: linkStart, end: linkStart + markdownLink.length },
    };
  }

  if (action === 'divider') {
    const needsLeadNewline = before.length > 0 && !before.endsWith('\n');
    const needsTrailNewline = after.length > 0 && !after.startsWith('\n');
    const insert = `${needsLeadNewline ? '\n\n' : ''}---\n${needsTrailNewline ? '\n' : ''}`;
    const next = before + insert + after;
    const pos = start + insert.length;
    return { text: next, selection: { start: pos, end: pos } };
  }

  if (action === 'codeblock') {
    const content = selected || 'const build = true;';
    const needsLead = before.length > 0 && !before.endsWith('\n');
    const needsTrail = after.length > 0 && !after.startsWith('\n');
    const block = `${needsLead ? '\n' : ''}\`\`\`\n${content}\n\`\`\`${needsTrail ? '\n' : ''}`;
    const next = before + block + after;
    const innerStart = start + (needsLead ? 5 : 4);
    return {
      text: next,
      selection: { start: innerStart, end: innerStart + content.length },
    };
  }

  // Line-based block formatters: 'h1' | 'h2' | 'h3' | 'quote' | 'list' | 'ordered'
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const blockBefore = source.slice(0, lineStart);
  const blockLines = source.slice(lineStart, lineEnd).split('\n');
  const blockAfter = source.slice(lineEnd);

  if (action === 'ordered') {
    const nonEmpty = blockLines.filter((l) => l.trim().length > 0);
    const allNumbered =
      nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\d+\.\s+/.test(l));
    let num = 1;
    const transformed = blockLines.map((line, idx) => {
      if (!line.trim() && blockLines.length > 1) return line;
      const stripped = line.replace(/^\s*(?:#{1,3}\s+|>\s+|-\s+|•\s+|\d+\.\s+)/, '');
      if (allNumbered) return stripped;
      const fallback = !stripped.trim() && idx === 0 ? 'List item' : stripped;
      const out = `${num}. ${fallback}`;
      num += 1;
      return out;
    });
    const joined = transformed.join('\n');
    const next = blockBefore + joined + blockAfter;
    return {
      text: next,
      selection: { start: lineStart, end: lineStart + joined.length },
    };
  }

  const prefixMap = {
    h1: '# ',
    h2: '## ',
    h3: '### ',
    quote: '> ',
    list: '- ',
  };
  const prefix = prefixMap[action] || '';
  if (!prefix) return { text: source, selection: { start, end } };

  const exactHeadingCheck = (l) => {
    const t = l.trimStart();
    if (action === 'h1') return /^#\s+/.test(t);
    if (action === 'h2') return /^##\s+/.test(t);
    if (action === 'h3') return /^###\s+/.test(t);
    return t.startsWith(prefix);
  };

  const nonEmpty = blockLines.filter((l) => l.trim().length > 0);
  const allAlreadyPrefixed = nonEmpty.length > 0 && nonEmpty.every(exactHeadingCheck);

  const transformedLines = blockLines.map((line, idx) => {
    if (!line.trim() && blockLines.length > 1) return line;
    const stripped = line.replace(/^\s*(?:#{1,3}\s+|>\s+|-\s+|•\s+|\d+\.\s+)/, '');
    if (allAlreadyPrefixed) return stripped;
    const fallback =
      !stripped.trim() && idx === 0
        ? action === 'h1'
          ? 'Main heading'
          : action === 'h2'
            ? 'Sub-heading'
            : action === 'h3'
              ? 'Section heading'
              : action === 'quote'
                ? 'Highlighted quote'
                : 'List item'
        : stripped;
    return `${prefix}${fallback}`;
  });

  const joined = transformedLines.join('\n');
  const next = blockBefore + joined + blockAfter;
  return {
    text: next,
    selection: { start: lineStart, end: lineStart + joined.length },
  };
}

function makeSegment(text, baseLinkUrl = '', flags = {}) {
  return {
    type: baseLinkUrl ? 'link' : 'text',
    text,
    bold: Boolean(flags.bold),
    italic: Boolean(flags.italic),
    underline: Boolean(flags.underline),
    strike: Boolean(flags.strike),
    highlight: Boolean(flags.highlight),
    code: Boolean(flags.code),
    ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
  };
}

function parseStyleTokens(fragment, baseLinkUrl = '') {
  const runs = [];
  const str = String(fragment || '');
  if (!str) return runs;

  // Match `code`, ***bold+italic***, **bold**, *italic*, ++underline++, ~~strike~~, ==highlight==
  const tokenRegex =
    /(`([^`]+)`|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|\+\+([^+]+)\+\+|~~([^~]+)~~|==([^=]+)==)/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRegex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      runs.push(makeSegment(str.slice(lastIndex, match.index), baseLinkUrl));
    }
    if (match[2] !== undefined) {
      runs.push(makeSegment(match[2], baseLinkUrl, { code: true }));
    } else if (match[3] !== undefined) {
      runs.push(makeSegment(match[3], baseLinkUrl, { bold: true, italic: true }));
    } else if (match[4] !== undefined) {
      runs.push(makeSegment(match[4], baseLinkUrl, { bold: true }));
    } else if (match[5] !== undefined) {
      runs.push(makeSegment(match[5], baseLinkUrl, { italic: true }));
    } else if (match[6] !== undefined) {
      runs.push(makeSegment(match[6], baseLinkUrl, { underline: true }));
    } else if (match[7] !== undefined) {
      runs.push(makeSegment(match[7], baseLinkUrl, { strike: true }));
    } else if (match[8] !== undefined) {
      runs.push(makeSegment(match[8], baseLinkUrl, { highlight: true }));
    }
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < str.length) {
    runs.push(makeSegment(str.slice(lastIndex), baseLinkUrl));
  }
  return runs;
}

export function parseInlineSegments(line = '') {
  const str = String(line || '');
  if (!str) return [];
  // Matches [label](url) OR bare https://... URLs
  const linkRegex = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/gi;
  const out = [];
  let lastIndex = 0;
  let m;
  while ((m = linkRegex.exec(str)) !== null) {
    if (m.index > lastIndex) {
      out.push(...parseStyleTokens(str.slice(lastIndex, m.index)));
    }
    if (m[1] !== undefined && m[2] !== undefined) {
      const safe = sanitizeBlogUrl(m[2]);
      if (safe) {
        out.push(...parseStyleTokens(m[1], safe));
      } else {
        out.push(...parseStyleTokens(m[1]));
      }
    } else if (m[3] !== undefined) {
      const safe = sanitizeBlogUrl(m[3]);
      if (safe) {
        out.push(makeSegment(m[3], safe));
      } else {
        out.push(makeSegment(m[3]));
      }
    }
    lastIndex = linkRegex.lastIndex;
  }
  if (lastIndex < str.length) {
    out.push(...parseStyleTokens(str.slice(lastIndex)));
  }
  return out;
}

const SPECIAL_BLOCK_START = /^(?:#{1,3}\s+|>\s?|-\s+|•\s+|\*\s+|\d+\.\s+|```|---+$)/;

export function parseBlogBlocks(body = '') {
  const rawLines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal divider: ---
    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // Code block: ``` ... ```
    if (trimmed.startsWith('```')) {
      i++;
      const codeLines = [];
      while (i < rawLines.length && !rawLines[i].trim().startsWith('```')) {
        codeLines.push(rawLines[i]);
        i++;
      }
      if (i < rawLines.length) i++; // skip closing ```
      blocks.push({ type: 'codeblock', code: codeLines.join('\n') });
      continue;
    }

    // H1 / H2 / H3 Headings
    if (/^###\s+/.test(trimmed)) {
      const content = trimmed.replace(/^###\s+/, '').trim();
      if (content) blocks.push({ type: 'h3', segments: parseInlineSegments(content) });
      i++;
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      const content = trimmed.replace(/^##\s+/, '').trim();
      if (content) blocks.push({ type: 'h2', segments: parseInlineSegments(content) });
      i++;
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      const content = trimmed.replace(/^#\s+/, '').trim();
      if (content) blocks.push({ type: 'h1', segments: parseInlineSegments(content) });
      i++;
      continue;
    }

    // Blockquote: > Quote (collect consecutive > lines)
    if (/^>\s?/.test(trimmed)) {
      const quoteLines = [];
      while (i < rawLines.length && /^>\s?/.test(rawLines[i].trim())) {
        quoteLines.push(rawLines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const joined = quoteLines.join('\n').trim();
      if (joined) {
        blocks.push({ type: 'quote', segments: parseInlineSegments(joined) });
      }
      continue;
    }

    // Bulleted list: - Item or • Item
    if (/^(?:-\s+|•\s+|\*\s+)/.test(trimmed)) {
      const items = [];
      while (i < rawLines.length && /^(?:-\s+|•\s+|\*\s+)/.test(rawLines[i].trim())) {
        const itemText = rawLines[i].trim().replace(/^(?:-\s+|•\s+|\*\s+)/, '').trim();
        if (itemText) items.push(parseInlineSegments(itemText));
        i++;
      }
      if (items.length) {
        blocks.push({ type: 'list', items });
      }
      continue;
    }

    // Numbered list: 1. Item
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (i < rawLines.length && /^\d+\.\s+/.test(rawLines[i].trim())) {
        const itemText = rawLines[i].trim().replace(/^\d+\.\s+/, '').trim();
        if (itemText) items.push(parseInlineSegments(itemText));
        i++;
      }
      if (items.length) {
        blocks.push({ type: 'ordered', items });
      }
      continue;
    }

    // Regular paragraph (collect consecutive normal lines until blank line or special block)
    const paraLines = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() &&
      !SPECIAL_BLOCK_START.test(rawLines[i].trim())
    ) {
      paraLines.push(rawLines[i].trim());
      i++;
    }
    const paraText = paraLines.join(' ');
    if (paraText) {
      blocks.push({ type: 'paragraph', segments: parseInlineSegments(paraText) });
    }
  }

  return blocks;
}

export function plainExcerptFromBlog(body = '', maxLen = 180) {
  const plain = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:#{1,3}\s+|>\s?|-\s+|•\s+|\d+\.\s+|---+$)/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\+\+([^+]+)\+\+/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen - 1).trimEnd() + '…';
}
