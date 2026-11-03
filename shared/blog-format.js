// Shared rich-text blog formatter, inline link parser, and read-time helper.
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

/**
 * Applies rich formatting to the current text + cursor/selection range.
 * Actions: 'bold' | 'italic' | 'h2' | 'quote' | 'list' | 'link'
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
    if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
      const inner = selected.slice(2, -2);
      const next = before + inner + after;
      return { text: next, selection: { start, end: start + inner.length } };
    }
    const content = selected || 'bold text';
    const wrapped = `**${content}**`;
    const next = before + wrapped + after;
    return {
      text: next,
      selection: { start: start + 2, end: start + 2 + content.length },
    };
  }

  if (action === 'italic') {
    if (
      selected.startsWith('*') &&
      selected.endsWith('*') &&
      !selected.startsWith('**') &&
      selected.length >= 2
    ) {
      const inner = selected.slice(1, -1);
      const next = before + inner + after;
      return { text: next, selection: { start, end: start + inner.length } };
    }
    const content = selected || 'italic text';
    const wrapped = `*${content}*`;
    const next = before + wrapped + after;
    return {
      text: next,
      selection: { start: start + 1, end: start + 1 + content.length },
    };
  }

  if (action === 'link') {
    const cleanUrl = sanitizeBlogUrl(extra?.url || 'https://') || 'https://example.com';
    const label = String(extra?.label || selected || 'link text').trim() || 'link text';
    const markdownLink = `[${label}](${cleanUrl})`;
    const next = before + markdownLink + after;
    return {
      text: next,
      selection: { start, end: start + markdownLink.length },
    };
  }

  // Line-based block formatters: 'h2' | 'quote' | 'list'
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextNewline = source.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const blockBefore = source.slice(0, lineStart);
  const blockLines = source.slice(lineStart, lineEnd).split('\n');
  const blockAfter = source.slice(lineEnd);

  const prefixMap = {
    h2: '## ',
    quote: '> ',
    list: '- ',
  };
  const prefix = prefixMap[action] || '';
  if (!prefix) return { text: source, selection: { start, end } };

  const nonEmpty = blockLines.filter((l) => l.trim().length > 0);
  const allAlreadyPrefixed =
    nonEmpty.length > 0 && nonEmpty.every((l) => l.trimStart().startsWith(prefix));

  const transformedLines = blockLines.map((line, idx) => {
    if (!line.trim() && blockLines.length > 1) return line;
    const stripped = line.replace(/^\s*(?:##\s+|>\s+|-\s+)/, '');
    if (allAlreadyPrefixed) return stripped;
    const fallback =
      !stripped.trim() && idx === 0
        ? action === 'h2'
          ? 'Sub-heading'
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

function parseStyleTokens(fragment, baseLinkUrl = '') {
  const runs = [];
  const str = String(fragment || '');
  if (!str) return runs;

  // Match ***bold+italic***, **bold**, or *italic*
  const tokenRegex = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRegex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      runs.push({
        type: baseLinkUrl ? 'link' : 'text',
        text: str.slice(lastIndex, match.index),
        bold: false,
        italic: false,
        ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
      });
    }
    if (match[2] !== undefined) {
      runs.push({
        type: baseLinkUrl ? 'link' : 'text',
        text: match[2],
        bold: true,
        italic: true,
        ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
      });
    } else if (match[3] !== undefined) {
      runs.push({
        type: baseLinkUrl ? 'link' : 'text',
        text: match[3],
        bold: true,
        italic: false,
        ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
      });
    } else if (match[4] !== undefined) {
      runs.push({
        type: baseLinkUrl ? 'link' : 'text',
        text: match[4],
        bold: false,
        italic: true,
        ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
      });
    }
    lastIndex = tokenRegex.lastIndex;
  }
  if (lastIndex < str.length) {
    runs.push({
      type: baseLinkUrl ? 'link' : 'text',
      text: str.slice(lastIndex),
      bold: false,
      italic: false,
      ...(baseLinkUrl ? { url: baseLinkUrl } : {}),
    });
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
        out.push({ type: 'link', text: m[3], url: safe, bold: false, italic: false });
      } else {
        out.push({ type: 'text', text: m[3], bold: false, italic: false });
      }
    }
    lastIndex = linkRegex.lastIndex;
  }
  if (lastIndex < str.length) {
    out.push(...parseStyleTokens(str.slice(lastIndex)));
  }
  return out;
}

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

    // H2 Heading: ## Heading
    if (/^##\s+/.test(trimmed)) {
      const content = trimmed.replace(/^##\s+/, '').trim();
      if (content) {
        blocks.push({ type: 'h2', segments: parseInlineSegments(content) });
      }
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

    // Regular paragraph (collect consecutive normal lines until blank line or special block)
    const paraLines = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() &&
      !/^(?:##\s+|>\s?|-\s+|•\s+|\*\s+)/.test(rawLines[i].trim())
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
    .replace(/^\s*(?:##\s+|>\s?|-\s+|•\s+)/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen - 1).trimEnd() + '…';
}
