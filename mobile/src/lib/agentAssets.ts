/**
 * The workforce's faces. Agents are AI and labelled as such everywhere —
 * the photos exist so a member always knows exactly WHO (which agent) they
 * are talking to, the same way a profile photo anchors a human member.
 */
export const AGENT_PHOTOS: Record<string, number> = {
  alex: require('../../assets/agents/Alex.jpg'),
  Sarah: require('../../assets/agents/Sarah.jpg'),
};

export const agentPhoto = (agentId?: string) => AGENT_PHOTOS[String(agentId || 'alex')] || AGENT_PHOTOS.Alex;
