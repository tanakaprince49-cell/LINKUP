import type { LinkyAskResult, LinkyHome, LinkyCard } from './linkyApi';

// Conversation and search are different state. Saying "thanks" must not erase
// the last shortlist; a real no-match must never fall back to unrelated cards.
export function linkyShortlist(answer: LinkyAskResult | null, home: LinkyHome | null): {cards: LinkyCard[]; need: string; previous: boolean} {
  const previous = answer?.kind === 'chat' && !(answer.cardIds?.length || answer.cards?.length);
  const source = previous ? home?.lastAsk : (answer || home?.lastAsk);
  if (!source || (source.none && source.kind !== 'chat') || ['none','ambiguous','outside'].includes(source.kind || '')) return {cards:[],need:source?.need || '',previous};
  const returned = !previous && answer ? answer.cards || [] : [];
  const ids = source.cardIds?.length ? source.cardIds : returned.map(c=>c.id);
  // Home is the privacy-revalidated pool. Never revive a removed profile from
  // an older answer snapshot after a refresh.
  const pool = home?.cards || returned;
  const cards = ids.map(id=>pool.find(c=>c.id===id)).filter((c):c is LinkyCard=>!!c && ['new','saved','meet','accepted'].includes(c.status));
  return {cards,need:source.need || '',previous};
}
