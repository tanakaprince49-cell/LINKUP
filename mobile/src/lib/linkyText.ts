export type LinkyTextProfile = {name: string; uid: string};
export type LinkyTextPart = {text: string; url?: string; uid?: string};

// Only explicit web URLs can be opened. Never execute model-produced schemes.
export function linkyWebUrl(value: string): string {
  try {
    const url = new URL(value.startsWith('www.') ? `https://${value}` : value);
    return ['https:', 'http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (value: string) => !!value && /[\p{L}\p{N}_]/u.test(value);
export function linkyTextParts(text: string, profiles: LinkyTextProfile[] = []): LinkyTextPart[] {
  const parts: LinkyTextPart[] = [];
  const names = new Map<string, LinkyTextProfile | null>();
  for (const profile of profiles) {
    const key = profile.name.trim().toLowerCase();
    if (!key || !profile.uid) continue;
    if (names.has(key) && names.get(key)?.uid !== profile.uid) names.set(key, null);
    else if (!names.has(key)) names.set(key, profile);
  }
  const usable = [...names].filter(([,p])=>p).map(([name])=>name).sort((a,b)=>b.length-a.length);
  const namePattern = usable.length ? new RegExp(usable.map(escape).join('|'), 'giu') : null;
  const plain = (value: string) => {
    if (!namePattern) { if(value)parts.push({text:value}); return; }
    namePattern.lastIndex = 0;
    let cursor = 0;
    for (const match of value.matchAll(namePattern)) {
      const index = match.index!;
      if (word(value[index-1]) || word(value[index+match[0].length])) continue;
      if (index>cursor)parts.push({text:value.slice(cursor,index)});
      parts.push({text:match[0],uid:names.get(match[0].toLowerCase())!.uid});
      cursor=index+match[0].length;
    }
    if(cursor<value.length)parts.push({text:value.slice(cursor)});
  };
  // Recognise markdown links as well as ordinary pasted URLs; text stays Text,
  // not HTML. URLs are handled before names so a name cannot corrupt a link.
  const links = /\[([^\]\n]+)\]\(((?:https?:\/\/|www\.)[^\s<>]+?)\)|(?:https?:\/\/|www\.)[^\s<>"']+/giu;
  let cursor=0;
  for (const match of text.matchAll(links)) {
    const index=match.index!;
    plain(text.slice(cursor,index));
    let raw=match[2] || match[0];
    let tail='';
    if(!match[2]) {
      while(/[.,!?;:]$/.test(raw) || (raw.endsWith(')') && (raw.match(/\)/g)||[]).length>(raw.match(/\(/g)||[]).length) || /[\]}]$/.test(raw)) {tail=raw.slice(-1)+tail;raw=raw.slice(0,-1);}
    }
    const url=linkyWebUrl(raw);
    if(url)parts.push({text:match[1] || raw,url});else plain(match[0]);
    if(url && tail)plain(tail);
    cursor=index+match[0].length;
  }
  plain(text.slice(cursor));
  return parts;
}
