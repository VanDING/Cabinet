export function globToRegex(pattern: string): RegExp {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (pattern.startsWith('*')) re = '.*' + re.slice(2);
  return new RegExp('^' + re + '$');
}

export function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
}
