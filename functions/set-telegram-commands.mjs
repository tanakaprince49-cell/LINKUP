#!/usr/bin/env node
// One-time (or whenever the command list changes) BotFather-side setup for Linky:
// the slash-command menu, the two descriptions people see before they press Start,
// and - optionally - the webhook, so `npm run linky:webhook` is not needed
// separately on a fresh bot.
//
//   TELEGRAM_BOT_TOKEN=xxxx node functions/set-telegram-commands.mjs
//   TELEGRAM_BOT_TOKEN=xxxx node functions/set-telegram-commands.mjs --webhook https://linkup-muqu.vercel.app/api/telegram
//
// Reads .env from the repo root if present, so a local run needs no exports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function loadEnv() {
  for (const dir of [process.cwd(), root]) {
    const f = path.join(dir, '.env');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}
loadEnv();

const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Export it or put it in .env (never commit it).');
  process.exit(1);
}
const argWebhook = (process.argv.find((a) => a.startsWith('--webhook=')) || '').split('=')[1]
  || (() => { const i = process.argv.indexOf('--webhook'); return i > -1 ? process.argv[i + 1] : ''; })();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

// Registered straight from the handler module, so the menu can never advertise a
// command the bot does not understand.
const { BOT_COMMANDS: COMMANDS } = await import('../api/linky.js');

const DESCRIPTION = 'Linky finds the person on LINKUP for what you need - a Flutter developer in Harare, a bookkeeper who has seen a disaster - and shows the profile line that made him pick them. If nobody fits, he says so and tells you where else to look.';
const SHORT = 'Ask who you need. Linky answers with people, not guesses.';

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  }).catch((err) => { console.error(`${method} threw`, err?.message || err); return null; });
  if (!res) return { ok: false, description: 'network' };
  const json = await res.json().catch(() => ({}));
  if (!json.ok) console.error(`${method} ->`, res.status, json.description || '(no description)');
  return json;
};

const results = [];
const flat = COMMANDS.map(({ command, description }) => ({ command, description }));
results.push(['setMyCommands', await call('setMyCommands', { commands: flat, scope: { type: 'all_private_chats' } })]);
results.push(['setMyCommands(groups)', await call('setMyCommands', {
  // in a group Linky stays quiet unless called, so only the entry points are shown
  commands: COMMANDS.filter((c) => c.group).map(({ command, description }) => ({ command, description })),
  scope: { type: 'all_group_chats' },
})]);
results.push(['setMyDescription', await call('setMyDescription', { description: DESCRIPTION })]);
results.push(['setMyShortDescription', await call('setMyShortDescription', { short_description: SHORT })]);

if (argWebhook) {
  const body = { url: argWebhook, drop_pending_updates: false };
  if (secret) body.secret_token = secret;
  results.push(['setWebhook', await call('setWebhook', body)]);
  const info = await call('getWebhookInfo');
  if (info.ok) console.log('webhook now:', info.result.url || '(unset)', '| last error:', info.result.last_error_message || 'none');
}

const failed = results.filter(([, r]) => !r?.ok);
console.log(results.map(([n, r]) => `${r?.ok ? 'ok  ' : 'FAIL'} ${n}${r?.ok ? '' : ' - ' + (r?.description || 'failed')}`).join('\n'));
if (failed.length) process.exit(1);
console.log(`\n${COMMANDS.length} commands registered. BotFather-side text can take a few minutes to show in the client.`);
