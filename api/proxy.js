import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(normalized) === 4) return isPrivateIPv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.slice(7));
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') || normalized.startsWith('2001:db8:');
}

async function validateTarget(rawUrl) {
  let target;
  try { target = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (target.protocol !== 'https:') throw new Error('HTTPS is required');
  if (target.username || target.password || target.port) throw new Error('Credentials and custom ports are not allowed');
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === 'metadata.google.internal') throw new Error('Private destinations are not allowed');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private destinations are not allowed');
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Private destinations are not allowed');
  }
  return target;
}

async function fetchValidated(rawUrl, redirectCount = 0) {
  const target = await validateTarget(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/pdf,image/jpeg,image/png,image/webp' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error('Too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid redirect');
      clearTimeout(timer);
      return fetchValidated(new URL(location, target).href, redirectCount + 1);
    }
    if (!response.ok) throw new Error('Remote server rejected the request');
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) throw new Error('Unsupported remote file type');
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_BYTES) throw new Error('Remote file is too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Remote response could not be read');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Remote file is too large'); }
      chunks.push(value);
    }
    return { type, chunks, size };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).send('Method not allowed'); }
  const rawUrl = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  if (!rawUrl) return res.status(400).send('Missing URL');
  try {
    const { type, chunks, size } = await fetchValidated(rawUrl);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(size));
    return res.status(200).send(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size));
  } catch (error) {
    console.warn('Remote import rejected:', error?.message || error);
    const status = error?.name === 'AbortError' ? 504 : 400;
    return res.status(status).send('Remote file could not be imported');
  }
}
