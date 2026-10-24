// The Builder League top-three card: one public image anyone can download at
// any time, straight from /builder-league/card. Number one wears the only
// crown; two and three are ranked but not crowned. Same rule as the board:
// only members who opted into public momentum and are eligible right now.
import { cardAvatar, renderCardSvg } from './_momentumCard.js';

const INK = '#0A0B0D';
const GOLD = '#FBE618';
const GOLD_DEEP = '#F0C808';
const CREAM = '#FFFCEB';
const PAPER = '#FFFFFF';
const LINE = '#E7E0C2';
const MUTED = '#6F6C5C';
const DIM = '#B9B4A0';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const dayLabel = ms => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const PERIOD_TITLES = Object.freeze({ week: 'THIS WEEK', month: 'THIS MONTH', year: 'THIS YEAR' });

function crown(x, y, scale, color) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-30 14 L-34 -14 L-14 2 L0 -22 L14 2 L34 -14 L30 14 Z" fill="${color}"/><rect x="-30" y="18" width="60" height="9" rx="4.5" fill="${color}"/></g>`;
}

const initials = name => String(name || 'L').trim().slice(0, 1).toUpperCase();

/**
 * rows: the first three ranked rows [{name, points, buildDays, image, avatar}]
 * avatar: a data: URI for that row, if one could be fetched safely.
 */
export function leagueCardSvg({ period = 'week', rows = [], participants = 0, at = Date.now(), top = 100 } = {}) {
  const title = PERIOD_TITLES[period] || PERIOD_TITLES.week;
  const [first, second, third] = rows;
  const podium = [
    second && { row: second, x: 56, y: 450, h: 390, crown: false },
    first && { row: first, x: 376, y: 386, h: 454, crown: true },
    third && { row: third, x: 696, y: 450, h: 390, crown: false },
  ].filter(Boolean);

  const card = ({ row, x, y, h, crown: crowned }) => {
    const avatar = row.avatar
      ? `<image x="${x + 74}" y="${y + 34}" width="140" height="140" preserveAspectRatio="xMidYMid slice" clip-path="url(#c${x})" xlink:href="${esc(row.avatar)}"/>`
      : `<text x="${x + 144}" y="${y + 140}" text-anchor="middle" font-size="64" fill="${INK}">${esc(initials(row.name))}</text>`;
    return `<g>
<rect x="${x + 6}" y="${y + 10}" width="296" height="${h}" rx="30" fill="#00000012"/>
<rect x="${x}" y="${y}" width="296" height="${h}" rx="30" fill="${PAPER}" stroke="${LINE}" stroke-width="2"/>
<defs><clipPath id="c${x}"><circle cx="${x + 144}" cy="${y + 104}" r="70"/></clipPath></defs>
<circle cx="${x + 144}" cy="${y + 104}" r="74" fill="${GOLD}"/>
${avatar}
${crowned ? `<circle cx="${x + 144}" cy="${y - 26}" r="42" fill="${INK}"/>${crown(x + 144, y - 28, 0.62, GOLD)}` : ''}
<rect x="${x + 108}" y="${y + 186}" width="80" height="46" rx="23" fill="${crowned ? INK : '#EFEAD6'}"/>
<text x="${x + 148}" y="${y + 218}" text-anchor="middle" font-size="26" fill="${crowned ? GOLD : INK}">#${row.rank}</text>
<text x="${x + 148}" y="${y + 274}" text-anchor="middle" font-size="28" fill="${INK}">${esc(String(row.name || 'LINKUP builder').slice(0, 18))}</text>
<text x="${x + 148}" y="${y + 312}" text-anchor="middle" font-size="20" fill="${MUTED}">${esc(`${row.points} points`)}</text>
<text x="${x + 148}" y="${y + 342}" text-anchor="middle" font-size="15" letter-spacing="0.6" fill="${DIM}">${esc(`${row.buildDays} build ${Number(row.buildDays) === 1 ? 'day' : 'days'}`)}</text>
</g>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1080" viewBox="0 0 1080 1080">
<defs>
<linearGradient id="sun" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFEC6E"/><stop offset="1" stop-color="${GOLD_DEEP}"/></linearGradient>
</defs>
<rect width="1080" height="1080" rx="56" fill="${CREAM}"/>
<circle cx="1120" cy="60" r="260" fill="url(#sun)" opacity="0.18"/>
<g font-family="DejaVu Sans" font-weight="700">
<rect x="56" y="44" width="206" height="56" rx="17" fill="url(#sun)" stroke="${INK}" stroke-width="2"/>
<text x="159" y="82" text-anchor="middle" font-size="29" fill="${INK}">LINKUP</text>
<text x="284" y="81" font-size="16" letter-spacing="2.4" fill="${MUTED}">THE BUILDER NETWORK</text>
<text x="1024" y="81" text-anchor="end" font-size="15" letter-spacing="2.2" fill="${DIM}">BUILDER LEAGUE</text>

<rect x="56" y="128" width="968" height="196" rx="30" fill="url(#sun)"/>
<text x="88" y="196" font-size="16" letter-spacing="2.6" fill="#4B4415">BUILD · HELP · CLIMB</text>
<text x="88" y="262" font-size="56" fill="${INK}">Top 3 · ${esc(title)}</text>
<text x="88" y="300" font-size="19" fill="#4B4415">${esc(`${participants} builder${participants === 1 ? '' : 's'} recorded ${participants === 1 ? 'a point' : 'points'} · `)}${esc(dayLabel(at).toUpperCase())}</text>
${crown(950, 210, 0.9, INK)}
</g>
${podium.map(card).join('')}
<g font-family="DejaVu Sans" font-weight="700">
<path d="M56 840 H1024" stroke="${LINE}" stroke-width="2"/>
<text x="56" y="896" font-size="26" fill="${INK}">Only number one wears the crown.</text>
<text x="56" y="932" font-size="16" fill="${MUTED}">10 points per recorded build day + 5 per acknowledged helpful step · UTC</text>
<rect x="56" y="970" width="380" height="58" rx="29" fill="${INK}"/>
<text x="246" y="1008" text-anchor="middle" font-size="26" fill="${GOLD}">linkupbuild.com</text>
<text x="1024" y="1008" text-anchor="end" font-size="16" fill="${MUTED}">Activity, not verified skill</text>
</g></svg>`;
}

/** Fetch safe avatars for the top rows, then render the PNG. */
export async function renderLeagueCard({ period = 'week', board = null, at = Date.now(), limit = 3, fetcher } = {}) {
  const rows = Array.isArray(board?.rows) ? board.rows.slice(0, limit) : [];
  const picked = await Promise.all(rows.map(async row => {
    const user = row.user || {};
    let avatar = '';
    try { avatar = await cardAvatar(row.uid, { ...user, profilePic: user.profilePic || row.image, photoURL: user.photoURL || row.image }, fetcher ? { fetcher } : {}); } catch { avatar = ''; }
    return { ...row, avatar };
  }));
  return renderCardSvg(leagueCardSvg({ period, rows: picked, participants: Number(board?.participants) || 0, at }), 1080);
}
