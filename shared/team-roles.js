const categoryOf = (role) => /\b(engineer|developer|technical|data)\b/i.test(role) ? 'engineering'
  : /\b(design|product)\b/i.test(role) ? 'product'
    : /\b(sales|marketing|growth|partnerships)\b/i.test(role) ? 'growth'
      : /\b(operations|operator|ops|compliance|risk|clinical|healthcare|domain)\b/i.test(role) ? 'operations' : '';

export function fallbackTeamRoles(project, ownerRole, targetCount, requestedRoles = []) {
  const idea = String(project || '');
  const pool = /\b(fintech|bank|payment|lending|insurance|invest|financial)\b/i.test(idea)
    ? ['Fintech software engineer', 'Compliance and risk specialist', 'Customer partnerships lead', 'Product designer']
    : /\b(health|clinic|medical|patient|wellness|care)\b/i.test(idea)
      ? ['Healthcare domain specialist', 'Software engineer', 'Clinical partnerships lead', 'Product designer']
      : /\b(agri|farm|food|climate|energy|environment)\b/i.test(idea)
        ? ['Domain operations specialist', 'Software or data engineer', 'Customer growth lead', 'Product designer']
        : /\b(marketplace|e-commerce|commerce|retail|delivery|logistics)\b/i.test(idea)
          ? ['Software engineer', 'Operations and supply lead', 'Customer growth lead', 'Product designer']
          : ['Software engineer', 'Product designer', 'Customer growth lead', 'Operations specialist'];
  const owner = String(ownerRole || '').toLowerCase();
  const ownerCategory = /\b(engineer|developer|technical|cto)\b/.test(owner) ? 'engineering'
    : /\b(design|product)\b/.test(owner) ? 'product'
      : /\b(sales|marketing|growth)\b/.test(owner) ? 'growth'
        : /\b(operations|operator|ops)\b/.test(owner) ? 'operations' : '';
  const roles = [...new Set((Array.isArray(requestedRoles) ? requestedRoles : []).map(x => String(x || '').trim()).filter(Boolean))].slice(0, targetCount);
  for (const role of pool) {
    if (roles.length >= targetCount) break;
    if (roles.some(item => item.toLowerCase() === role.toLowerCase())) continue;
    if (ownerCategory && categoryOf(role) === ownerCategory) continue;
    roles.push(role);
  }
  return roles.slice(0, targetCount);
}
