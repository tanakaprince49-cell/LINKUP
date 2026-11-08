// WHAT LINKUP PLUS ACTUALLY GIVES YOU — one list, three surfaces.
//
// This is the canonical answer, imported by the paywall (mobile), the scheduled
// invitation (mobile/src/lib/plusInviteSchedule.ts carries the same nine ids and
// is checked against this file by tests/plus-benefits.test.mjs) and the email
// nudge (api/_emailNotify.js).
//
// TWO RULES, both learned the hard way:
//
//  1. Every benefit here must map to code that reads hasLinkupPro() or to a
//     server limit keyed on the paid tier. Do not add a line before the gate
//     exists. "Unlimited idea deck" and "advanced search" used to be on this
//     list and neither was true; the idea deck is free forever by decree.
//  2. The `proof` is a NUMBER or a SURFACE, never an adjective. "Free stops at
//     3 recommendations a week" sells; "richer discovery" does not, and the
//     member finds out either way.

/** Reading order is deliberate: curiosity, then leverage, then status. */
export const PLUS_BENEFIT_GROUPS = Object.freeze({
  see: 'SEE EVERYTHING',
  do: 'NO CEILINGS',
  look: 'AND THE FRONT ROW',
});

export const PLUS_BENEFITS = Object.freeze([
  {
    id: 'viewers',
    group: 'see',
    title: 'See exactly who opened your profile',
    proof: 'Names, photos and when they looked, across all four analytics tabs. Free shows you the number and a lock.',
    invite: {
      feature: 'See exactly who opened your profile',
      line: 'Builders looked at what you are building this week. Right now you can see the number. With PLUS you see the names.',
    },
    email: {
      feature: 'See exactly who opened your profile',
      line: 'Right now you get a number. PLUS gives you the names.',
    },
  },
  {
    id: 'recommendations',
    group: 'see',
    title: 'Every builder the matcher finds for you',
    proof: 'Free stops at 3 recommendations a week. PLUS lifts the cap and ranks the whole pool for you.',
    invite: {
      feature: 'Every recommendation, not three a week',
      line: 'The algorithm finds more people for you than free is allowed to show you. Free stops at three. PLUS does not stop.',
    },
    email: {
      feature: 'Every weekly recommendation, not three',
      line: 'The algorithm finds more people for you than free is allowed to show.',
    },
  },
  {
    id: 'turbo',
    group: 'see',
    title: 'Turbo Connect — first in line in Discover',
    proof: 'A +8 lift in the Discover and search ranking, every time somebody looks for what you do.',
    invite: {
      feature: 'Turbo Connect — stand at the front of Discover',
      line: 'Somebody is looking for exactly what you are building. Turbo Connect is how they find you before they find the next person.',
    },
    email: {
      feature: 'Turbo Connect — stand at the front of Discover',
      line: 'Be found before the next person with the same skills is.',
    },
  },
  {
    id: 'linky',
    group: 'do',
    title: 'Unlimited messages to Linky',
    proof: 'Free gets 5 a day, across every channel. PLUS keeps talking until Linky finds the person.',
    invite: {
      feature: 'Unlimited Linky — no five-a-day cap',
      line: 'Five messages a day is a short conversation with your own scout. PLUS takes the lid off and lets Linky keep looking.',
    },
    email: {
      feature: 'Unlimited Linky — no five-a-day cap',
      line: 'Five messages a day is a short conversation. PLUS lets Linky keep looking.',
    },
  },
  {
    id: 'meets',
    group: 'do',
    title: 'Unlimited Meet requests',
    proof: 'Free: 2 a day. PLUS: every builder Linky puts in front of you, without waiting for tomorrow.',
    invite: {
      feature: 'Meet every builder Linky finds, not two a day',
      line: 'Two Meet requests a day is a queue built on purpose. PLUS deletes the queue.',
    },
    email: {
      feature: 'Meet every builder Linky finds, not two a day',
      line: 'Two a day is a queue built on purpose. PLUS deletes the queue.',
    },
  },
  {
    id: 'posts',
    group: 'do',
    title: 'Ship 10 startups a week instead of 1',
    proof: 'The builders who get matched are the ones who keep showing up. Free posts once a week; PLUS posts ten.',
    invite: {
      feature: 'Post as often as you ship — 10 a week',
      line: 'You ship more than you post. Free caps it at one a week; PLUS gives you ten.',
    },
    email: {
      feature: 'Post 10 startups a week, not 1',
      line: 'The builders who get matched are the ones who keep showing up.',
    },
  },
  {
    id: 'warmintro',
    group: 'do',
    title: 'Unlimited AI Warm Intro drafts',
    proof: 'One a month on free. PLUS writes the first message for every introduction you get.',
    invite: {
      feature: 'An AI-written first message, every time',
      line: 'The first message is the hardest one to send. Free gets one a month; PLUS writes every one.',
    },
    email: {
      feature: 'Unlimited AI Warm Intros',
      line: 'The first message is the hardest one to send.',
    },
  },
  {
    id: 'noads',
    group: 'look',
    title: 'No sponsored cards. Anywhere.',
    proof: 'Home, Linky, startups, blogs, notifications and email — a PLUS member sees none of it.',
    invite: {
      feature: 'No sponsored cards. Anywhere. Ever.',
      line: 'You are the one person on this app who should not be sold to — PLUS members never see a sponsored card, on any surface, or in any email.',
    },
    email: {
      feature: 'No sponsored cards. Anywhere. Ever.',
      line: 'PLUS members never see a sponsored card — not on home, not on Linky, not in this email.',
    },
  },
  {
    id: 'badge',
    group: 'look',
    title: 'The blue check and the PLUS crown',
    proof: 'A verified tick and a crown beside your name, everywhere you appear in LINKUP.',
    invite: {
      feature: 'The blue check and the PLUS crown',
      line: 'A verified tick and a crown beside your name, everywhere you appear — because being chosen starts with looking chosen.',
    },
    email: {
      feature: 'The blue check and the PLUS crown',
      line: 'Being chosen starts with looking chosen.',
    },
  },
]);

export const PLUS_BENEFIT_COUNT = PLUS_BENEFITS.length;

/** "And 8 more things you don't have yet" — one is already on screen. */
export const PLUS_MORE_COUNT = PLUS_BENEFIT_COUNT - 1;

/** The paywall renders these in order, with the group label above the first row. */
export function plusBenefitGroups() {
  const labels = [];
  for (const benefit of PLUS_BENEFITS) {
    let group = labels.find((entry) => entry.id === benefit.group);
    if (!group) {
      group = { id: benefit.group, label: PLUS_BENEFIT_GROUPS[benefit.group] || '', items: [] };
      labels.push(group);
    }
    group.items.push(benefit);
  }
  return labels;
}

export const plusBenefitById = (id) => PLUS_BENEFITS.find((entry) => entry.id === id) || null;
