import {searchBrief} from './_linkyQuality.js';
export const TONES = ['warm','direct','playful'];
export function toneCommand(message) {
  const match=String(message).trim().match(/^(?:\/?tone\s*[:=]?\s*|be (?:more )?)(warm|direct|playful)[.!\s]*$/i);
  return match?match[1].toLowerCase():'';
}
export function socialReply(message, {name='',tone='warm',streak=0}={}) {
  const s=String(message).trim().toLowerCase();
  if(/\b(?:are you (?:a |an )?(?:real|human|bot|ai)|who are you)\b/.test(s))return "I'm Linky, LINKUP's AI connector—not a person. I can still talk things through with you and be straight about what I find.";
  if(/^(?:thanks?|thank you|ty|cheers|much appreciated|you.?re a legend)[.!\s]*$/.test(s))return tone==='direct'?"You're welcome.":"Anytime. Hope the next step goes well.";
  if(/\b(?:lonely|rough day|overwhelmed|stressed|frustrated|feeling down)\b/.test(s)&&! /\b(find|hire|developer|investor)\b/.test(s))return "That sounds like a lot. Want to talk about what's making today hard, or work out one small next step?";
  if(/^(?:hi+|hey+|hello+|yo+|yoo+|sup|mhoro|howzit|bro|good (?:morning|afternoon|evening))[!,.\s]*$/.test(s)) {
    const first=String(name).split(/\s+/)[0];
    if(tone==='direct')return `Hey${first?`, ${first}`:''}. What's on your mind?`;
    if(tone==='playful')return streak%2?"Back for round two? What's the mission today?":`Hey${first?`, ${first}`:''}! Big plan or tiny problem—what are we working on?`;
    return streak%2?"Hey, good to hear from you. What's on your mind?":`Hey${first?`, ${first}`:''}! How's your day going?`;
  }
  if(/^(?:how are (?:you|u)|how.?s it going|what.?s up|wyd)[?!.\s]*$/.test(s))return "I'm here and ready to help. How's your day going?";
  if(/^(?:ok(?:ay)?|cool|nice|yeah|yep|sure|nope|nah|lol|haha+)[!.\s]*$/.test(s))return tone==='direct'?'Got it.':"Got you. We can take it from there.";
  return '';
}
export function briefText(need) {
  if(!need)return "We haven't set a search yet. Who are you hoping to meet, and what would you work on together?";
  const brief=searchBrief(need);
  return ['Here’s the search I’m working with:',`Need: ${need}`,`Must match: ${brief.required.map(r=>r.label).join(', ')||'not specific yet'}`,`Location: ${brief.location||'not specified'}${brief.remoteAllowed?' (remote alternatives explicitly allowed)':''}${brief.remoteOnly?' (remote only)':''}`,...(brief.unverifiedConstraints||[]).map(c=>`Can't confirm from profile evidence: ${c}`),`Exclude: ${brief.excluded.join(', ')||'none specified'}`,"I won't loosen these requirements unless you ask."].join('\n');
}
export function utilityCommand(message) {
  const s=String(message).trim();
  if(/^(?:search brief|my search|show (?:my |the )?brief)$/i.test(s))return {kind:'brief'};
  let m=s.match(/^(?:why|evidence)(?:\s+(\d{1,2}))?\??$/i);
  if(m)return {kind:'why',numbers:[Number(m[1]||1)]};
  m=s.match(/^compare\s+(\d{1,2})\s*(?:and|vs\.?|with|,)\s*(\d{1,2})$/i);
  if(m)return {kind:'compare',numbers:[Number(m[1]),Number(m[2])]};
  m=s.match(/^(?:prep|meeting prep|prepare for)(?:\s+(\d{1,2}))?$/i);
  return m?{kind:'prep',numbers:[Number(m[1]||1)]}:null;
}
export function utilityReply(command,cards,need) {
  if(command.kind==='brief')return briefText(need);
  const selected=command.numbers.map(n=>cards[n-1]);
  if(selected.some(c=>!c)||new Set(command.numbers).size!==command.numbers.length)return "Those numbers don't point to a current shortlist. Run a search first, then try “why 1”, “compare 1 and 2”, or “prep 1”.";
  if(command.kind==='why') {
    const c=selected[0];
    return [`Why ${c.targetName}:`,c.why,...(c.unknowns||['Current availability and interest are not confirmed.']).map(s=>`Still to check: ${s}`),'This is profile evidence, not a verified guarantee of ability or a compatibility percentage.'].join('\n');
  }
  if(command.kind==='compare')return ['Side by side, using only the current cards:',...selected.map((c,i)=>`${command.numbers[i]}. ${c.targetName}\nRole: ${c.targetRole||'not stated'}\nLocation: ${c.targetCity||'not stated'}\nEvidence: ${c.why}\nStill to check: ${(c.unknowns||['Availability, rates and interest are unconfirmed.']).join(' ')}`),"Neither is a guaranteed fit. Which evidence matters more for your project? I haven't contacted either person."].join('\n\n');
  const c=selected[0];
  return [`A simple first-chat plan for ${c.targetName}:`,`Context: ${need||c.need||'your collaboration'}`,`Start from something real: ${c.why}`,'1. Ask them to walk through a relevant project and what they personally did.','2. Share your goal, timeline, budget or equity expectations; ask what works for them.','3. Agree on one small next step, with a clear owner and date.',"Keep the first call around 15 minutes. This is preparation—not a scheduled meeting or a message sent on your behalf."].join('\n');
}
