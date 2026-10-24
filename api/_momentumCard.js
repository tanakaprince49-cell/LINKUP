import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { momentumCardStats } from '../shared/momentum-card.js';
import { calendarWeeks } from '../shared/contributions.js';
import { isGoldMember } from '../shared/member-badges.js';
import { selectProfileImage, decodeProfileImage } from './_publicProfileImage.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const safeUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const allowedHost = h => h === 'ik.imagekit.io' || h === 'firebasestorage.googleapis.com' || h === 'storage.googleapis.com' || h === 'lh3.googleusercontent.com' || /^lh[1-6]\.googleusercontent\.com$/.test(h);

// No arbitrary photo proxy: fixed public-CDN allowlist, no redirects, bounded
// response and timeout. Unsupported hosts use the member's initial instead.
export function safeCardRaster(bytes) {
  let w = 0, h = 0;
  try {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20); }
    else if (bytes[0] === 255 && bytes[1] === 216) {
      for (let p = 2; p + 4 < bytes.length;) {
        if (bytes[p++] !== 255) break;
        while (bytes[p] === 255) p++;
        const marker = bytes[p++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const len = bytes.readUInt16BE(p);
        if (len < 2 || p + len > bytes.length) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && len >= 8) { h = bytes.readUInt16BE(p + 3); w = bytes.readUInt16BE(p + 5); break; }
        p += len;
      }
    } else if (bytes.length >= 30 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
      const kind = bytes.subarray(12, 16).toString();
      if (kind === 'VP8X') { w = 1 + bytes.readUIntLE(24, 3); h = 1 + bytes.readUIntLE(27, 3); }
      else if (kind === 'VP8 ') { w = bytes.readUInt16LE(26) & 16383; h = bytes.readUInt16LE(28) & 16383; }
      else if (kind === 'VP8L' && bytes[20] === 47) { const n = bytes.readUInt32LE(21); w = 1 + (n & 16383); h = 1 + ((n >>> 14) & 16383); }
    }
  } catch { return false; }
  return w > 0 && h > 0 && w <= 4096 && h <= 4096 && w * h <= 4194304;
}

export async function cardAvatar(uid, user, { fetcher = fetch } = {}) {
  const selected = selectProfileImage(uid, user, safeUrl);
  if (selected?.bytes && safeCardRaster(selected.bytes)) return 'data:' + selected.contentType + ';base64,' + selected.bytes.toString('base64');
  if (selected?.bytes || !selected?.url) return '';
  const url = new URL(selected.url);
  if (!allowedHost(url.hostname) || url.port) return '';
  try {
    const r = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(4000) });
    if (!r.ok || !/^image\/(png|jpe?g|webp|gif)(?:;|$)/i.test(r.headers.get('content-type') || '') || Number(r.headers.get('content-length')) > 650000) return '';
    const reader = r.body.getReader();
    let size = 0, chunks = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 650000) { await reader.cancel(); return ''; } chunks.push(value); } } finally { reader.releaseLock(); }
    const data = 'data:' + r.headers.get('content-type').split(';')[0] + ';base64,' + Buffer.concat(chunks).toString('base64');
    const decoded = decodeProfileImage(data);
    return decoded && safeCardRaster(decoded.bytes) ? data : '';
  } catch { return ''; }
}

/* ------------------------------------------------------------------ *
 * Card artwork.
 *
 * The card is drawn as one SVG so the same numbers always produce the
 * same picture. Everything is a plain shape or a <text> in the bundled
 * DejaVu Sans Bold face; nothing depends on a system font, an emoji or a
 * remote asset, which is why it cannot quietly render as an empty square.
 * ------------------------------------------------------------------ */
const INK = '#0A0B0D';
const GOLD = '#FBE618';
const GOLD_DEEP = '#F0C808';
const CREAM = '#FFFCEB';
const PAPER = '#FFFFFF';
const LINE = '#E7E0C2';
const MUTED = '#6F6C5C';
const DIM = '#B9B4A0';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dayLabel = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const shortDay = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const weekStartOf = day => { const d = new Date(day + 'T00:00:00Z'), offset = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - offset); return d.toISOString().slice(0, 10); };

function crown(x, y, scale, color) {
  const s = scale;
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-30 14 L-34 -14 L-14 2 L0 -22 L14 2 L34 -14 L30 14 Z" fill="${color}"/><rect x="-30" y="18" width="60" height="9" rx="4.5" fill="${color}"/></g>`;
}

export function championBadge(champion) {
  if (!champion?.kind) return null;
  const kind = String(champion.kind);
  if (!['week', 'month', 'year'].includes(kind)) return null;
  const start = Number(champion.start) || 0, end = Number(champion.end) || 0;
  const span = start && end ? (kind === 'week' ? `${shortDay(start)} – ${shortDay(end - 1)}` : kind === 'month' ? `${MONTHS[new Date(start).getUTCMonth()]} ${new Date(start).getUTCFullYear()}` : String(new Date(start).getUTCFullYear())) : '';
  return { kind, label: `${kind.toUpperCase()} CHAMPION`, span };
}

export function momentumCardSvg({ uid, user = {}, c = {}, at = Date.now(), avatar = '', verified = false, champion = null }) {
  const stats = momentumCardStats(c, at);
  const badge = championBadge(champion);
  const rawName = String(user.displayName || user.fullName || user.name || 'LINKUP builder');
  const name = rawName.slice(0, 30);
  const gold = isGoldMember(uid), blue = verified || gold;
  const days = Array.isArray(c.days) ? c.days : [];
  const weekStart = weekStartOf(stats.today);
  const weekDays = new Set(days.filter(d => typeof d === 'string' && d >= weekStart && d <= stats.today)).size;
  const helpful = Array.isArray(c.habit?.awards) ? c.habit.awards.length : 0;
  const nameSize = Math.max(26, Math.min(44, Math.floor(660 / (Math.max(name.length, 1) * 0.60))));
  const ring = 2 * Math.PI * 76;
  const weeks = calendarWeeks(days, at);
  const recent = weeks.flat().filter(d => d.active).length;
  const check = (x, y, color) => `<g transform="translate(${x} ${y})"><circle r="20" fill="${color}"/><path d="m-8 0 6 6 12-13" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const cells = weeks.map((week, x) => week.map((d, y) =>
    `<rect x="${88 + x * 34}" y="${742 + y * 30}" width="26" height="22" rx="6" fill="${d.active ? GOLD : '#2A2D35'}"/>`
  ).join('')).join('');
  const tile = (x, label, value) => `<g><rect x="${x}" y="546" width="308" height="118" rx="24" fill="${PAPER}" stroke="${LINE}" stroke-width="2"/><text x="${x + 24}" y="586" font-size="13" letter-spacing="1.6" fill="${MUTED}">${esc(label)}</text><text x="${x + 24}" y="642" font-size="42" fill="${INK}">${esc(value)}</text></g>`;
  const ribbonLabel = badge ? badge.label : '';
  const ribbonSpanX = 276 + Math.ceil(ribbonLabel.length * 13.6) + 16;
  const ribbonWidth = badge ? (ribbonSpanX - 212) + badge.span.length * 9.8 + 28 : 0;
  const ribbon = badge ? `<g><rect x="212" y="236" width="${ribbonWidth}" height="42" rx="21" fill="${INK}"/>${crown(246, 257, 0.34, GOLD)}<text x="276" y="264" font-size="17" letter-spacing="1.2" fill="${GOLD}">${esc(ribbonLabel)}</text><text x="${ribbonSpanX}" y="264" font-size="17" fill="#C9CCD4">${esc(badge.span)}</text></g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs>
<clipPath id="avatar"><rect x="56" y="130" width="132" height="132" rx="40"/></clipPath>
<linearGradient id="sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFEC6E"/><stop offset="1" stop-color="#F3C400"/></linearGradient>
</defs>
<rect width="1080" height="1080" rx="56" fill="${CREAM}"/>
<circle cx="1146" cy="1128" r="300" fill="url(#sun)" opacity="0.18"/>
<circle cx="1146" cy="1128" r="196" fill="url(#sun)" opacity="0.16"/>
<g font-family="DejaVu Sans" font-weight="700">
<rect x="56" y="44" width="206" height="56" rx="17" fill="url(#sun)" stroke="${INK}" stroke-width="2"/>
<text x="159" y="82" text-anchor="middle" font-size="29" fill="${INK}">LINKUP</text>
<text x="284" y="81" font-size="16" letter-spacing="2.4" fill="${MUTED}">THE BUILDER NETWORK</text>
<text x="1024" y="81" text-anchor="end" font-size="15" letter-spacing="2.2" fill="${DIM}">MOMENTUM CARD</text>

<rect x="56" y="130" width="132" height="132" rx="40" fill="${GOLD}"/>
${avatar
    ? `<image x="56" y="130" width="132" height="132" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar)" xlink:href="${esc(avatar)}"/>`
    : `<text x="122" y="222" text-anchor="middle" font-size="66" fill="${INK}">${esc(name[0] || 'L')}</text>`}
<rect x="56" y="130" width="132" height="132" rx="40" fill="none" stroke="${INK}" stroke-width="3"/>
${badge ? `<circle cx="180" cy="142" r="29" fill="${INK}"/>${crown(180, 142, 0.40, GOLD)}` : ''}
<text x="212" y="180" font-size="${nameSize}" fill="${INK}">${esc(name)}</text>
<text x="212" y="218" font-size="15" letter-spacing="1.7" fill="${MUTED}">${esc(String(user.occupation || 'BUILDING. LEARNING. MOVING FORWARD.').slice(0, 48).toUpperCase())}</text>
${ribbon}
${blue ? check(964, 160, '#2485F5') : ''}${gold ? check(1012, 160, '#e0be1b') : ''}

<rect x="56" y="300" width="968" height="220" rx="32" fill="url(#sun)"/>
<circle cx="150" cy="410" r="104" fill="#FFFFFF" opacity="0.16"/>
<text x="88" y="452" font-size="${String(stats.streak).length > 2 ? 112 : 140}" fill="${INK}">${esc(String(stats.streak))}</text>
<text x="${88 + String(stats.streak).length * (String(stats.streak).length > 2 ? 68 : 84) + 22}" y="386" font-size="16" letter-spacing="2.6" fill="#4B4415">CONSECUTIVE</text>
<text x="${88 + String(stats.streak).length * (String(stats.streak).length > 2 ? 68 : 84) + 22}" y="428" font-size="38" fill="${INK}">DAY STREAK</text>
<text x="${88 + String(stats.streak).length * (String(stats.streak).length > 2 ? 68 : 84) + 22}" y="466" font-size="19" fill="#4B4415">${esc(`${stats.totalUpdates} recorded build days · ${stats.points} points`)}</text>
<text x="${88 + String(stats.streak).length * (String(stats.streak).length > 2 ? 68 : 84) + 22}" y="496" font-size="14" letter-spacing="0.6" fill="#6A6027">UTC DAYS · MISSED DAYS ARE NOT COUNTED AS WORK</text>

<g transform="translate(916 410) rotate(-90)">
<circle r="76" fill="none" stroke="#000000" stroke-opacity="0.16" stroke-width="18"/>
<circle r="76" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${(weekDays / 7) * ring} ${ring}"/>
</g>
<text x="916" y="404" text-anchor="middle" font-size="42" fill="${INK}">${weekDays}<tspan font-size="22" fill="#4B4415">/7</tspan></text>
<text x="916" y="438" text-anchor="middle" font-size="12" letter-spacing="1.6" fill="#4B4415">THIS WEEK</text>

${tile(56, 'RECORDED DAYS', String(stats.totalUpdates))}
${tile(386, 'BUILD POINTS', String(stats.points))}
${tile(716, 'HELPFUL STEPS', String(helpful))}

<rect x="56" y="688" width="968" height="292" rx="30" fill="${INK}"/>
<text x="88" y="736" font-size="16" letter-spacing="2.2" fill="${GOLD}">LAST 12 WEEKS</text>
${cells}
<g transform="translate(600 742)">
<text x="0" y="58" font-size="64" fill="${GOLD}">${recent}<tspan font-size="30" fill="#8D919C">/${weeks.flat().length}</tspan></text>
<text x="0" y="92" font-size="15" letter-spacing="1.4" fill="#C7CAD2">DAYS RECORDED IN THIS WINDOW</text>
<rect x="0" y="118" width="14" height="14" rx="4" fill="${GOLD}"/><text x="26" y="130" font-size="15" fill="#C7CAD2">A real recorded build day</text>
<rect x="0" y="146" width="14" height="14" rx="4" fill="#2A2D35"/><text x="26" y="158" font-size="15" fill="#8D919C">No update recorded</text>
<rect x="0" y="182" width="360" height="46" rx="23" fill="${GOLD}"/>
<text x="180" y="212" text-anchor="middle" font-size="22" fill="${INK}">linkupbuild.com</text>
</g>

<text x="56" y="1030" font-size="15" letter-spacing="0.8" fill="${MUTED}">${esc(`${dayLabel(at).toUpperCase()} · ACTIVITY, NOT VERIFIED SKILL`)}</text>
<text x="1024" y="1030" text-anchor="end" font-size="14" letter-spacing="1.2" fill="${DIM}">BUILD · HELP · CLIMB</text>
</g></svg>`;
}

/* @resvg/resvg-js resolves families through fontdb. `loadSystemFonts:false`
 * plus a buffer that is not registered produced an entirely textless card, so
 * the bundled face is written once to a temp file and registered by path. */
let fontFile = '';
function bundledFont() {
  if (fontFile) return fontFile;
  const dir = mkdtempSync(join(tmpdir(), 'linkup-card-'));
  fontFile = join(dir, 'LinkupSans-Bold.ttf');
  writeFileSync(fontFile, readFileSync(new URL('./_assets/LinkupSans-Bold.ttf', import.meta.url)));
  return fontFile;
}

export function renderCardSvg(svg, width = 1080) {
  return new Resvg(svg, {
    font: { fontFiles: [bundledFont()], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans', defaultFontSize: 16 },
    fitTo: { mode: 'width', value: width },
  }).render().asPng();
}

export function renderMomentumCard(options) {
  return renderCardSvg(momentumCardSvg(options), 1080);
}
