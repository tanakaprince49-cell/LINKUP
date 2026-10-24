import { budgetConfig, sustainableMessages, fairShare } from '../shared/linky-budget.js';

const config = budgetConfig(process.env);
const messages = sustainableMessages(config);
const line = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

console.log('LINKY MESSAGE BUDGET\n');
line('Model requests / day', config.modelRequestsPerDay);
line('Average calls per message', config.callsPerMessage);
line('Headroom reserved', `${Math.round(config.headroom * 100)}%`);
line('Sustainable messages / day', messages);
line('Shared daily ceiling', config.globalDailyMessages || 'disabled');
line('Free monthly allowance', config.freePerMonth);
line('Free daily cap', config.freeDaily || 'none');
line('PLUS messages', config.plusUnlimited ? 'unlimited' : config.plusDaily);
console.log('\nPer-member daily fair share (25% daily-active):');
for (const members of [100, 500, 1000]) line(`  ${members} members`, fairShare({ messagesPerDay: messages, members }));
console.log('\nMessages a month this buys 500 members:', Math.floor(messages * 30 / 500));
console.log('\nSet these in Vercel to change behaviour without a code change:');
console.log('  LINKY_GLOBAL_DAILY_MESSAGES, LINKY_FREE_DAILY, LINKY_MODEL_RPD, LINKY_CALLS_PER_MESSAGE');
