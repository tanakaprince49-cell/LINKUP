import {Platform, Share} from 'react-native';
import {linkupWebBaseUrl} from './profileLinks';

/**
 * The Builder League top-three card. It is a public image: anyone can open or
 * download it at any time, signed in or not, because it only contains what the
 * public board already shows.
 */
export const leagueCardUrl = (period: 'week' | 'month' | 'year' = 'week') =>
  linkupWebBaseUrl() + '/api/publicSeo?mode=league-card' + (period === 'week' ? '' : '&period=' + period);
export const leagueCardPageUrl = (period: 'week' | 'month' | 'year' = 'week') =>
  'https://www.linkupbuild.com/app/builder-league/card' + (period === 'week' ? '' : '?period=' + period);
export const LEAGUE_CARD_FILE = 'linkup-builder-league-top3.png';

export async function downloadLeagueCard(period: 'week' | 'month' | 'year' = 'week') {
  const url = leagueCardUrl(period);
  const message = 'Builder League top three on LINKUP. Only number one wears the crown. linkupbuild.com';
  if (Platform.OS === 'web') {
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) {
      throw new Error('The league card is unavailable right now. Try again in a moment.');
    }
    const blob = await response.blob();
    const file = new File([blob], LEAGUE_CARD_FILE, {type: 'image/png'});
    const nav = (globalThis as any).navigator;
    if (nav?.canShare?.({files: [file]})) {
      try { await nav.share({title: 'LINKUP Builder League', text: message, files: [file]}); } catch (error: any) { if (error?.name !== 'AbortError') throw error; }
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl; anchor.download = LEAGUE_CARD_FILE;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    return;
  }
  const Sharing = await import('expo-sharing').catch(() => null);
  if (Sharing && await Sharing.isAvailableAsync().catch(() => false)) {
    const FS = await import('expo-file-system/legacy');
    const uri = FS.cacheDirectory + 'linkup-league-' + Date.now() + '.png';
    try {
      const result = await FS.downloadAsync(url, uri);
      if (result.status !== 200) throw new Error('The league card is unavailable right now.');
      await Sharing.shareAsync(uri, {mimeType: 'image/png', dialogTitle: 'LINKUP Builder League top three', UTI: 'public.png'});
    } finally {
      await FS.deleteAsync(uri, {idempotent: true}).catch(() => {});
    }
    return;
  }
  await Share.share({message, url: leagueCardPageUrl(period), title: 'LINKUP Builder League'});
}
