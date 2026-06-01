export function isInternalIP(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  )
    return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (
    hostname === '[::1]' ||
    hostname === '[fe80::]' ||
    hostname.startsWith('[fc') ||
    hostname.startsWith('[fd')
  )
    return true;
  return false;
}
