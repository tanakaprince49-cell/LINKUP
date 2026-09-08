// Linky endpoint: app actions, housekeeping cron, Telegram + WhatsApp webhooks.
// One function on purpose (Vercel Hobby caps a deployment at 12).
//
//   POST /api/linky            {action, ...}  Bearer <Firebase idToken>
//   POST /api/linky?action=cron               x-linky-cron: <token>   (GitHub Actions, hourly housekeeping)
//   POST /api/telegram  -> rewrite -> /api/linky?channel=telegram      (Telegram setWebhook URL)
//   GET|POST /api/whatsapp -> rewrite -> /api/linky?channel=whatsapp   (Meta Cloud API webhook)
//
// Env (Vercel): FIREBASE_SERVICE_ACCOUNT (already set), GEMINI_API_KEY (already set),
//   TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (optional),
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (optional),
//   LINKY_CRON_SECRET (optional; otherwise derived from the service-account key so no new secret is needed).
import crypto from 'node:crypto';
import { getDb, verifyRequestUser } from './_firebaseAdmin.js';
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import {
  APP_URL, LIMITS, OFFERS, ask, audit, botUserFor, consumeLinkCode, createLinkCode, forget, home,
  loadCards, loadState, loadUser, meet, orderedCards, pickPerson, pointers, respond, runCron, sendTelegram,
  sendWhatsApp, setCardStatus, setFacts, setPrefs, unlinkBot, profileFacts, telegramWebhookSecret,
} from './_linky.js';


// ---------------------------------------------------------------- cron auth
export function cronToken() {
  const explicit = String(process.env.LINKY_CRON_SECRET || '').trim();
  if (explicit) return explicit;
  let key = '';
  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    key = raw ? String(JSON.parse(raw).private_key || '') : String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  } catch { key = ''; }
  if (!key) return '';
  return crypto.createHash('sha256').update(`linky-cron:${key.replace(/\s+/g, '')}`).digest('hex');
}

function serviceAccountProject() {
  try {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (raw) return String(JSON.parse(raw).project_id || '');
  } catch {}
  return String(process.env.FIREBASE_PROJECT_ID || 'linkup-e0906');
}

// Three ways in, no new secrets required:
//   x-linky-cron: <LINKY_CRON_SECRET or the key-derived token>
//   Authorization: Bearer <Google OAuth access token minted by a service
//   account of this Firebase project> (what the GitHub Action sends).
async function cronAuthorized(req) {
  const token = cronToken();
  const given = String(req.headers['x-linky-cron'] || '');
  if (token && given && safeEqual(given, token)) return true;
  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearer || bearer.length > 4096) return false;
  try {
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(bearer)}`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
    const email = String(info?.email || '');
    return String(info?.email_verified) === 'true' && email.endsWith(`@${serviceAccountProject()}.iam.gserviceaccount.com`);
  } catch {
    return false;
  }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

function readRawBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data || '{}'));
    req.on('error', () => resolve('{}'));
  });
}

// ---------------------------------------------------------------- bot brain (shared by Telegram + WhatsApp)
// What the bot actually answers, as a slash menu. `group` = worth showing inside
// a group chat, where Linky only wakes when called. Adding an entry here without a
// matching branch in botReply() is the bug this list exists to prevent.
export const BOT_COMMANDS = [
  { command: 'start', description: 'Link this chat to your LINKUP account', group: true },
  { command: 'help', description: 'How Linky works, in one screen', group: true },
  { command: 'cards', description: 'Your current cards' },
  { command: 'meet', description: 'Ask for the intro - "meet 1"' },
  { command: 'skip', description: 'Clear a card - "skip 1"' },
  { command: 'save', description: 'Keep a card for later - "save 1"' },
  { command: 'accept', description: 'Answer an intro waiting on you' },
  { command: 'decline', description: 'Say no, quietly, both ways' },
  { command: 'later', description: 'Park an intro for two weeks' },
  { command: 'draft', description: 'Write the first message for your top card' },
  { command: 'more', description: 'Where to look outside LINKUP' },
  { command: 'prefs', description: 'What you are open to' },
  { command: 'audit', description: 'What Linky knows about you' },
  { command: 'unlink', description: 'Disconnect this chat' },
];

const HELP = [
  'Just type who you need - a role, a skill, a city, or somebody by name. e.g. "a Flutter developer in Harare, paid" or "fred".',
  '',
  'cards      your current cards',
  'meet 1     ask for the intro on card 1',
  'skip 1     clear a card   |   save 1   keep it',
  'accept     answer an intro waiting on you (decline / later too)',
  'more       where to look outside LINKUP when nobody fits',
  'prefs      what you are open to',
  'unlink     disconnect this chat',
  '',
  'I only say things I can point at on a real profile. If nobody fits, I say that instead of guessing.',
].join('\n');

// The bot's own short lines, so it reads like a person and not a receipt.


const offerLabel = (o) => ({ paid: 'paid work', equity: 'equity', advisory: 'advisory', coffee: 'a coffee' }[o] || o);

function cardLine(c, n) {
  return `${n}. ${c.targetName}${c.targetRole ? ` - ${c.targetRole}` : ''}${c.targetCity ? ` (${c.targetCity})` : ''}\n   Why: ${c.why}`;
}

export async function botReply(channel, chatId, textIn, { callback } = {}) {
  const raw = String(textIn || '').trim();
  const lower = raw.toLowerCase();
  const bu = await botUserFor(channel, chatId);

  // ---- not linked yet
  if (!bu) {
    // Only ever treat the whole message as a code. The old pattern matched any
    // six-letter word, so "hey people" came back as "that code did not work".
    const bare = raw.replace(/[\s.,;:]/g, '').toUpperCase();
    const startCode = lower.startsWith('/start ') ? raw.slice(7).trim() : lower.startsWith('/link ') ? raw.slice(6).trim() : (/^[A-HJ-NP-Z2-9]{6}$/.test(bare) ? bare : '');
    if (startCode) {
      const uid = await consumeLinkCode(startCode, channel, chatId);
      if (uid) {
        const user = await loadUser(uid);
        const name = profileFacts(user)?.name?.split(' ')[0] || 'there';
        return { text: `That's you linked, ${name}. This chat is your Linky line now - I answer in here the same way I do in the app.\n\n${HELP}` };
      }
      if (!lower.startsWith('/start')) return { text: 'That code did not work (codes last 15 minutes). Open LINKUP, go to the Linky tab, tap Connect Telegram / WhatsApp and send me the new code.' };
    }
    return { text: `Hi, I am Linky from LINKUP. To connect this chat to your account: open LINKUP (${APP_URL}), go to the Linky tab, tap "Connect ${channel === 'telegram' ? 'Telegram' : 'WhatsApp'}" and send me the 6-character code.` };
  }

  const uid = bu.uid;
  const user = await loadUser(uid);
  if (!user) {
    await unlinkBot(channel, chatId);
    return { text: 'Your LINKUP account is gone, so I unlinked this chat.' };
  }

  // ---- button callbacks (Telegram callback_data / WhatsApp reply ids)
  if (callback) {
    const [kind, a, b] = String(callback).split(':');
    try {
      if (kind === 'm') { const r = await meet(uid, a, { userDoc: user }); return { text: r.matchId ? `You two are already connected, so no intro needed. Chat: ${APP_URL}/chat/${r.matchId}` : `On it. I will ask them politely and tell you the moment they answer.${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : ''}` }; }
      if (kind === 's') { await setCardStatus(uid, a, 'skip'); return { text: 'Done, they will not come up again for a while.' }; }
      if (kind === 'v') { await setCardStatus(uid, a, 'saved'); return { text: 'Kept. They will wait for you in cards.' }; }
      if (kind === 'p') { const r = await pointers(uid, String(a || ''), { userDoc: user }); return { text: pointerText(r) }; }
      // A tapped chip on WhatsApp arrives as an id like c:0:cards - re-run it as
      // though the member had typed it.
      if (kind === 'c') return await botReply(channel, chatId, [a, b].filter(Boolean).join(':').replace(/^\d+:/, ''));
      if (kind === 'r') { const r = await respond(uid, b, a); return { text: r.status === 'accepted' ? `Done - you and ${await nameOf(uid, b)} are connected. Chat: ${APP_URL}/chat/${r.matchId}` : r.status === 'snoozed' ? 'Parked for 2 weeks, no pressure on either side.' : 'Declined quietly. They will not be suggested to you again.' }; }
    } catch (err) {
      return { text: String(err?.message || 'That did not work.') };
    }
  }

  let cmd = lower.replace(/^\//, '');
  // Tapping the chip Linky offered ("Where to look outside LINKUP") must not be
  // treated as a fresh search. Chips are commands wearing a sentence.
  if (/outside linkup|search the web|look outside/.test(cmd) && !/^(meet|skip|save)\b/.test(cmd)) cmd = 'more';
  const num = (s, d = 1) => { const m = s.match(/\b(\d{1,2})\b/); return m ? Math.max(1, Number(m[1])) : d; };

  if (cmd === 'start' || cmd === 'help') return { text: `Hi ${profileFacts(user)?.name?.split(' ')[0] || 'there'} - here is how I work.\n\n${HELP}` };

  // "Fred? I have two of those - which one?" -> "1" should just work.
  const last = await loadState(uid).then((st) => st.lastAsk).catch(() => null);
  if (last?.kind === 'ambiguous' && /^\d{1,2}$/.test(cmd.trim()) && Array.isArray(last.nearest) && last.nearest.length) {
    const picked = last.nearest[Number(cmd.trim()) - 1];
    if (picked?.uid) {
      const card = await pickPersonCard(uid, picked);
      if (card && card.id) return { text: `${picked.name}, yes. Card is in front of you - ${card.why}`, cards: [card] };
      if (card?.error) return { text: `${picked.name} - ${card.error}` };
    }
  }
  if (last?.kind === 'ambiguous' && /^\d{1,2}$/.test(cmd.trim())) return { text: 'I lost that one. Say "cards" and pick by name, or ask again.' };
  if (cmd === 'unlink') { await unlinkBot(channel, chatId); return { text: 'Unlinked. Your LINKUP account is untouched.' }; }
  if (cmd === 'forget') { await forget(uid); return { text: 'Forgotten: cards deleted, what you told me cleared, chat unlinked.' }; }

  const numbered = async () => orderedCards(await loadCards(uid), await loadState(uid)).slice(0, 5);

  if (cmd === 'brief' || cmd === 'cards' || cmd === 'today') {
    const cards = await numbered();
    if (!cards.length) return { text: 'No cards right now. Tell me who you need and I answer straight away.' };
    return {
      text: `Your cards:\n${cards.map((c, i) => cardLine(c, i + 1)).join('\n')}\n\nReply "meet 1" (or 2, 3...) and I will ask them.`,
      cards,
    };
  }
  if (cmd === 'prefs') {
    const h = await home(uid, { userDoc: user });
    return { text: `Open to: ${h.prefs.openTo.map(offerLabel).join(', ')}. Weekly inbound cap: ${h.prefs.inboundCap}.\nChange these in the app: Linky tab > Preferences.` };
  }
  // Linky reads the audit page out loud, because "what do you know about me" is a
  // question people ask and making them open the app to answer it is a shrug.
  if (cmd === 'audit' || cmd.startsWith('audit ')) {
    const a = await audit(uid, { userDoc: user });
    const line = (label, value) => (value ? `${label}: ${value}\n` : '');
    const top = (a.asks || []).slice(0, 3).map((x) => `  - ${x.need}${x.none ? ' (nobody yet)' : ` (${x.cards} cards)`}`).join('\n');
    return {
      text: `Here is everything I have on you.\n\n${line('Role', a.facts.role)}${line('Company', a.facts.company)}${line('City', a.facts.city)}${line('Skills', (a.facts.skills || []).slice(0, 6).join(', '))}${line('Open to', a.signals.openTo.map(offerLabel).join(', '))}${line('Your notes', (a.told.notes || '').slice(0, 180))}Used today: ${a.signals.asksUsedToday} asks, ${a.signals.meetsUsedToday} Meets. People you asked me not to suggest again: ${a.signals.mutedCount}.\n\n${top ? `Last asks:\n${top}` : 'No asks yet.'}\n\nSay "forget" any time and I delete all of it.`,
    };
  }
  // "draft" is a real intent the app has; on the bot it drafted nothing and simply
  // became a search for the word "draft".
  if (cmd === 'draft' || cmd.startsWith('draft ')) {
    const rest = cmd.replace(/^draft\s*/, '').trim();
    const r = await ask(uid, rest ? `write me a message to ${rest}` : 'write the first message', { source: channel, userDoc: user });
    return { text: r.reply, chips: (r.suggest || []).slice(0, 3) };
  }

  // ---- card decisions by number
  if (/^(meet|skip|save)\b/.test(cmd)) {
    const cards = await numbered();
    const card = cards[num(cmd) - 1];
    if (!card) return { text: 'No card with that number. Say "cards" to see them.' };
    try {
      if (cmd.startsWith('meet')) {
        const r = await meet(uid, card.id, { userDoc: user });
        return { text: r.matchId ? `You are already connected with ${card.targetName}. Chat: ${APP_URL}/chat/${r.matchId}` : `Asked ${card.targetName}. I will tell you when they answer.${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : ''}` };
      }
      await setCardStatus(uid, card.id, cmd.startsWith('skip') ? 'skip' : 'saved');
      return { text: cmd.startsWith('skip') ? `Skipped ${card.targetName}.` : `Saved ${card.targetName}.` };
    } catch (err) {
      return { text: String(err?.message || 'That did not work.') };
    }
  }

  // ---- inbound intro answers
  if (/^(accept|decline|later|not now|yes please)\b/.test(cmd)) {
    const h = await home(uid, { userDoc: user });
    const pending = h.inbound[0];
    if (!pending) return { text: 'Nothing to answer right now.' };
    const decision = cmd.startsWith('accept') || cmd.startsWith('yes') ? 'accept' : cmd.startsWith('decline') ? 'decline' : 'later';
    const r = await respond(uid, pending.id, decision);
    return { text: r.status === 'accepted' ? `Done - you and ${pending.requesterName} are connected. Chat: ${APP_URL}/chat/${r.matchId}` : r.status === 'snoozed' ? 'Parked for 2 weeks.' : 'Declined. They will not be suggested to you again.' };
  }

  // ---- "more" after a no-match: where to look outside LINKUP
  if (cmd === 'more' || cmd === 'outside' || cmd === 'where') {
    const state = await loadState(uid);
    const last = state.lastAsk;
    if (!last?.need) return { text: 'Ask me who you need first, then I can go looking outside LINKUP.' };
    try {
      const r = await pointers(uid, last.need, { userDoc: user });
      return { text: pointerText(r), buttons: r.leads?.length ? leadsKeyboard(r.leads) : undefined };
    } catch (err) {
      return { text: String(err?.message || 'That did not work.') };
    }
  }

  // ---- everything else is an ask: answered right now
  const message = cmd.startsWith('new') ? raw.replace(/^\/?new\b[\s:,-]*/i, '').trim() : raw;
  try {
    const out = await ask(uid, message, { userDoc: user, source: channel });
    if (!out.cards.length) {
      return { text: out.reply, chips: (out.suggest || []).filter((c) => !/outside LINKUP/i.test(c)).slice(0, 3) };
    }
    return { text: `${out.reply}\n\n${out.cards.map((c, i) => cardLine(c, i + 1)).join('\n')}`, cards: out.cards, chips: out.suggest };
  } catch (err) {
    return { text: String(err?.message || 'That did not work.') };
  }
}

// Outside-LINKUP answer, formatted once for both bots.
function pointerText(r) {
  const leads = Array.isArray(r?.leads) ? r.leads : [];
  const body = String(r?.text || '').trim();
  if (!leads.length) return body;
  const list = leads.map((l, i) => `${i + 1}. ${l.name}${l.title ? ` - ${l.title}` : ''}${l.why ? ` (${l.why})` : ''}\n   ${l.url}`).join('\n');
  return `${body}\n\nHere are ${leads.length} public ${leads.length === 1 ? 'profile' : 'profiles'} I found just now - no contact details, just the public page:\n${list}\n\nMessage them yourself from your own account - or say DRAFT and I will write the first line for you.`;
}

function leadsKeyboard(leads) {
  return leads.slice(0, 3).map((l, i) => ([{ text: `${i + 1}. ${String(l.name).slice(0, 22)}`, url: l.url }]));
}

// "1" after an ambiguous name: the server turns that person into a real card.
async function pickPersonCard(uid, picked) {
  try {
    return await pickPerson(uid, picked.uid);
  } catch (err) {
    return { error: String(err?.message || 'That did not work.'), picked };
  }
}

async function nameOf(uid, introId) {
  try {
    const L = await import('./_linky.js');
    const h = await L.home(uid);
    return (h.inbound.find((i) => i.id === introId) || {}).requesterName || 'them';
  } catch { return 'them'; }
}

// Exposed for the emulator E2E only.
export const botReplyForTest = botReply;

// ---------------------------------------------------------------- Telegram
async function telegramApi(method, payload) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return null;
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000),
  }).catch(() => null);
}

function telegramCardButtons(cards) {
  return cards.slice(0, 5).map((c, i) => ([
    { text: `Meet ${i + 1}`, callback_data: `m:${c.id}` },
    { text: `Skip ${i + 1}`, callback_data: `s:${c.id}` },
    { text: `Save ${i + 1}`, callback_data: `v:${c.id}` },
  ]));
}

// The chips Linky suggested become real buttons, so a member taps instead of
// typing. Free-text chips become reply keys; a card list becomes inline buttons.
function telegramChips(chips) {
  const out = (chips || []).filter(Boolean).slice(0, 3);
  if (!out.length) return undefined;
  return { keyboard: [out.slice(0, 3).map((t) => ({ text: String(t).slice(0, 32) }))], resize_keyboard: false, one_time_keyboard: true };
}

async function handleTelegram(req, res) {
  const secret = telegramWebhookSecret();
  if (!secret) { res.status(503).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }); return; }
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], secret)) { res.status(401).json({ ok: false }); return; }
  const update = readJsonBody(req);
  // Telegram retries anything it does not get a 200 for in 60s, and a retried
  // "meet 2" is a second request to a real person. Skip what we already did.
  const updateId = Number(update?.update_id || 0);
  if (updateId) {
    try {
      const seen = await getDb().collection('linkyOutreach').doc(`tg_${updateId}`).get();
      if (seen.exists) { res.status(200).json({ ok: true, duplicate: true }); return; }
      await getDb().collection('linkyOutreach').doc(`tg_${updateId}`).set({ at: Date.now() });
    } catch { /* if the guard breaks, answer the member anyway */ }
  }
  try {
    if (update?.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const r = await botReply('telegram', String(chatId), '', { callback: String(cq.data || '') });
      await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: String(r.text).slice(0, 190) });
      await sendTelegram(chatId, r.text);
    } else if (update?.message?.text) {
      const chatId = update.message.chat.id;
      // An ask can take a few seconds; "typing…" is the difference between a
      // chatbot and a voicemail box.
      await telegramApi('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => null);
      const r = await botReply('telegram', String(chatId), update.message.text);
      const markup = r.cards?.length
        ? { inline_keyboard: telegramCardButtons(r.cards) }
        : telegramChips(r.chips);
      await telegramApi('sendMessage', { chat_id: chatId, text: r.text, disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
    } else if (update?.message?.chat?.id && !update?.message?.text) {
      // Voice notes, photos, stickers: no transcription here, so say so like a
      // person instead of leaving them on read.
      await sendTelegram(update.message.chat.id, 'I only get text, I am afraid - pictures and voice notes go straight past me. Type who you need and I will go looking.');
    }
  } catch (err) {
    console.error('[linky] telegram error', err);
  }
  res.status(200).json({ ok: true });
}

// ---------------------------------------------------------------- WhatsApp (Meta Cloud API)
async function handleWhatsApp(req, res) {
  if (req.method === 'GET') {
    const q = req.query || {};
    const verify = String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim();
    if (q['hub.mode'] === 'subscribe' && verify && safeEqual(q['hub.verify_token'], verify)) { res.status(200).send(String(q['hub.challenge'] || '')); return; }
    res.status(403).send('Forbidden');
    return;
  }
  // Optional HMAC check (WHATSAPP_APP_SECRET). Vercel parses JSON bodies before
  // we see them, so the raw bytes are reconstructed; if Meta ever changes its
  // serialisation the check fails closed and the env var can be unset.
  const appSecret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  const raw = await readRawBody(req);
  if (appSecret) {
    const sig = String(req.headers['x-hub-signature-256'] || '');
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(raw).digest('hex')}`;
    if (!safeEqual(sig, expected)) { console.warn('[linky] whatsapp signature mismatch'); res.status(401).json({ ok: false }); return; }
  }
  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(raw); } catch { body = {}; }
  try {
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        for (const msg of change?.value?.messages || []) {
          const from = String(msg.from || '');
          if (!from) continue;
          let r;
          if (msg.type === 'interactive' && msg.interactive?.button_reply?.id) {
            r = await botReply('whatsapp', from, '', { callback: msg.interactive.button_reply.id });
          } else if (msg.type === 'text') {
            r = await botReply('whatsapp', from, msg.text?.body || '');
          } else if (['audio', 'voice', 'image', 'sticker', 'document'].includes(msg.type)) {
            await sendWhatsApp(from, 'I only get text on this number - voice notes and pictures go straight past me. Type who you need and I will go looking.');
            continue;
          } else continue;
          if (!r.cards?.length && r.chips?.length) {
            await sendWhatsAppButtons(from, r.text, r.chips.slice(0, 3).map((c, i) => ({ id: `c:${i}:${String(c).slice(0, 60)}`, title: String(c).slice(0, 20) })));
          } else {
            await sendWhatsApp(from, r.text);
          }
          if (r.cards?.length) {
            // WhatsApp allows 3 reply buttons per message: one message per card.
            for (const c of r.cards.slice(0, 3)) {
              await sendWhatsAppButtons(from, `${c.targetName}${c.targetRole ? ` - ${c.targetRole}` : ''}\nWhy: ${c.why}`, [
                { id: `m:${c.id}`, title: 'Meet' }, { id: `s:${c.id}`, title: 'Skip' }, { id: `v:${c.id}`, title: 'Save' },
              ]);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[linky] whatsapp error', err);
  }
  res.status(200).json({ ok: true });
}

async function sendWhatsAppButtons(waId, body, buttons) {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneId) return false;
  const resp = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: waId, type: 'interactive',
      interactive: { type: 'button', body: { text: String(body).slice(0, 1000) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } },
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  return !!resp?.ok;
}

// ---------------------------------------------------------------- app actions
async function handleApp(req, res) {
  const user = await verifyRequestUser(req);
  if (!user) { sendError(res, 401, 'Sign in to talk to Linky.'); return; }
  const body = readJsonBody(req);
  const action = String(body.action || req.query?.action || '').trim();
  const uid = user.uid;
  try {
    let out;
    switch (action) {
      case 'home': out = await home(uid); break;
      case 'ask': out = await ask(uid, body.message, { source: 'app' }); break;
      case 'facts': out = await setFacts(uid, { notes: body.notes, skills: body.skills, lookingFor: body.lookingFor }); break;
      case 'pointers': out = await pointers(uid, String(body.need || '')); break;
      case 'meet': out = await meet(uid, String(body.cardId || '')); break;
      case 'pickPerson': out = await pickPerson(uid, String(body.targetUid || '')); break;
      case 'card': {
        const status = ['skip', 'saved', 'new'].includes(body.status) ? body.status : 'skip';
        out = await setCardStatus(uid, String(body.cardId || ''), status); break;
      }
      case 'respond': {
        const decision = ['accept', 'decline', 'later'].includes(body.decision) ? body.decision : 'later';
        out = await respond(uid, String(body.introId || ''), decision); break;
      }
      case 'prefs': out = await setPrefs(uid, { openTo: body.openTo, inboundCap: body.inboundCap }); break;
      case 'audit': out = await audit(uid); break;
      case 'forget': out = await forget(uid); break;
      case 'linkCode': out = await createLinkCode(uid); break;
      case 'unlinkChannel': {
        const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'telegram';
        const state = await loadState(uid);
        const chatId = String(state?.channels?.[channel] || '');
        out = { ok: chatId ? await unlinkBot(channel, chatId) : true };
        break;
      }
      case 'limits': out = { LIMITS, OFFERS }; break;
      default: sendError(res, 400, `Unknown Linky action "${action}".`); return;
    }
    setCors(res);
    res.status(200).json(out);
  } catch (err) {
    const message = String(err?.message || 'Linky hit a snag.');
    sendError(res, err?.code === 'ask_limit' || err?.code === 'meet_limit' ? 402 : 400, message, message);
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const channel = String(req.query?.channel || '');
  if (channel === 'telegram') { if (req.method !== 'POST') { res.status(405).end(); return; } await handleTelegram(req, res); return; }
  if (channel === 'whatsapp') { await handleWhatsApp(req, res); return; }

  const wantsCron = String(req.query?.action || '') === 'cron' || (req.method === 'POST' && readJsonBody(req)?.action === 'cron');
  if (wantsCron) {
    if (!(await cronAuthorized(req))) { sendError(res, 401, 'Bad cron token.'); return; }
    try {
      const out = await runCron();
      setCors(res);
      res.status(200).json(out);
    } catch (err) {
      sendError(res, 500, 'Cron failed.', String(err?.message || err));
    }
    return;
  }
  if (req.method !== 'POST') { sendError(res, 405, 'Use POST.'); return; }
  await handleApp(req, res);
}

