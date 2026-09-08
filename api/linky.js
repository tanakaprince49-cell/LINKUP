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
import { verifyRequestUser } from './_firebaseAdmin.js';
import { handleOptions, readJsonBody, sendError, setCors } from './_gemini.js';
import {
  APP_URL, LIMITS, OFFERS, ask, audit, botUserFor, consumeLinkCode, createLinkCode, forget, home,
  loadCards, loadState, loadUser, meet, orderedCards, respond, runCron, sendTelegram,
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
const HELP = [
  'I am Linky, LINKUP\'s connector. Tell me who you need and I answer right away with the people on LINKUP I can actually cite.',
  '',
  'Just type who you need, e.g. "a Flutter developer in Harare, paid"',
  'cards               - your current cards',
  'meet [n]            - ask for the intro on card n (default 1)',
  'skip [n] / save [n] - clear or keep a card',
  'accept / decline / later - answer an intro request',
  'prefs               - what you are open to',
  'unlink              - disconnect this chat',
  'help                - this list',
].join('\n');

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
    const codeMatch = raw.match(/\b([A-Za-z2-9]{6})\b/);
    const startCode = lower.startsWith('/start ') ? raw.slice(7).trim() : lower.startsWith('/link ') ? raw.slice(6).trim() : codeMatch ? codeMatch[1] : '';
    if (startCode) {
      const uid = await consumeLinkCode(startCode, channel, chatId);
      if (uid) {
        const user = await loadUser(uid);
        const name = profileFacts(user)?.name?.split(' ')[0] || 'there';
        return { text: `Linked. Hi ${name}, this chat is now your Linky line. Tell me who you need and I answer right away.\n\n${HELP}` };
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
      if (kind === 'm') { const r = await meet(uid, a, { userDoc: user }); return { text: r.matchId ? `You are already connected. Open the chat: ${APP_URL}/chat/${r.matchId}` : `Asked. I will tell you when they answer.${r.meetsLeft != null ? ` (${r.meetsLeft} Meets left today)` : ''}` }; }
      if (kind === 's') { await setCardStatus(uid, a, 'skip'); return { text: 'Skipped.' }; }
      if (kind === 'v') { await setCardStatus(uid, a, 'saved'); return { text: 'Saved.' }; }
      if (kind === 'r') { const r = await respond(uid, b, a); return { text: r.status === 'accepted' ? `Done - you two are connected. Chat: ${APP_URL}/chat/${r.matchId}` : r.status === 'snoozed' ? 'Parked for 2 weeks.' : 'Declined. They will not be suggested to you again.' }; }
    } catch (err) {
      return { text: String(err?.message || 'That did not work.') };
    }
  }

  const cmd = lower.replace(/^\//, '');
  const num = (s, d = 1) => { const m = s.match(/\b(\d{1,2})\b/); return m ? Math.max(1, Number(m[1])) : d; };

  if (cmd === 'start' || cmd === 'help') return { text: HELP };
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

  // ---- everything else is an ask: answered right now
  const message = cmd.startsWith('new') ? raw.replace(/^\/?new\b[\s:,-]*/i, '').trim() : raw;
  try {
    const out = await ask(uid, message, { userDoc: user, source: channel });
    if (!out.cards.length) return { text: out.reply };
    return { text: `${out.reply}\n\n${out.cards.map((c, i) => cardLine(c, i + 1)).join('\n')}\n\nReply "meet 1" (or 2, 3...) and I will ask them.`, cards: out.cards };
  } catch (err) {
    return { text: String(err?.message || 'That did not work.') };
  }
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

async function handleTelegram(req, res) {
  const secret = telegramWebhookSecret();
  if (!secret) { res.status(503).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' }); return; }
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], secret)) { res.status(401).json({ ok: false }); return; }
  const update = readJsonBody(req);
  try {
    if (update?.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const r = await botReply('telegram', String(chatId), '', { callback: String(cq.data || '') });
      await telegramApi('answerCallbackQuery', { callback_query_id: cq.id, text: String(r.text).slice(0, 190) });
      await sendTelegram(chatId, r.text);
    } else if (update?.message?.text) {
      const chatId = update.message.chat.id;
      const r = await botReply('telegram', String(chatId), update.message.text);
      if (r.cards?.length) {
        await telegramApi('sendMessage', { chat_id: chatId, text: r.text, disable_web_page_preview: true, reply_markup: { inline_keyboard: telegramCardButtons(r.cards) } });
      } else {
        await sendTelegram(chatId, r.text);
      }
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
          } else continue;
          await sendWhatsApp(from, r.text);
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
      case 'meet': out = await meet(uid, String(body.cardId || '')); break;
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

