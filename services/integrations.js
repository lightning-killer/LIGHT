import { OAuth2Client } from 'google-auth-library';
import { query, one } from '../database/db.js';
import { config } from '../config/index.js';
import { encrypt, decrypt } from './crypto.js';
import { HttpError } from '../middleware/errorHandler.js';

// Integrations stay disconnected until the user explicitly connects them, and each one asks only for
// the narrowest read-only scope that makes it useful. Nothing is requested at sign-in.
export const CATALOG = {
  google_calendar: { name: 'Google Calendar', kind: 'google', scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'], description: 'Read-only access to your calendar events.' },
  gmail: { name: 'Gmail', kind: 'google', scopes: ['https://www.googleapis.com/auth/gmail.readonly'], description: 'Read-only access to your mail. LIGHT cannot send mail.' },
  google_drive: { name: 'Google Drive', kind: 'google', scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'], description: 'Read-only access to file names and metadata (not file contents).' },
};
export const PLANNED = [
  { provider: 'ai_providers', name: 'External AI providers', description: 'Configured by the server administrator through AI_PROVIDER in .env (cloud or local Ollama).' },
  { provider: 'research_services', name: 'Research services', description: 'Planned. No research service is connectable yet.' },
];

export const integrationClient = () => new OAuth2Client(config.google.clientId, config.google.clientSecret, config.integrationCallbackUrl);

export async function listIntegrations(userId) {
  const rows = await query('SELECT provider, status, scopes, connected_at FROM integrations WHERE user_id = ?', [userId]);
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));
  return Object.entries(CATALOG).map(([provider, c]) => ({
    provider, name: c.name, description: c.description, scopes: c.scopes,
    status: byProvider[provider]?.status || 'disconnected', connectedAt: byProvider[provider]?.connected_at || null,
  }));
}

export function buildConnectUrl(provider, state) {
  const c = CATALOG[provider];
  if (!c) throw new HttpError(404, 'Unknown integration', 'not_found');
  if (!config.google.clientId) throw new HttpError(503, 'Google OAuth is not configured on the server', 'not_configured');
  return integrationClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: c.scopes, state, include_granted_scopes: false });
}

export async function completeConnect(userId, provider, code) {
  const c = CATALOG[provider];
  if (!c) throw new HttpError(404, 'Unknown integration', 'not_found');
  const { tokens } = await integrationClient().getToken(code);
  await query(
    `INSERT INTO integrations (user_id, provider, status, scopes, credentials_enc, connected_at)
     VALUES (?, ?, 'connected', ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE status = 'connected', scopes = VALUES(scopes), credentials_enc = VALUES(credentials_enc), connected_at = UTC_TIMESTAMP()`,
    [userId, provider, c.scopes.join(' '), encrypt(JSON.stringify(tokens))]);
}

export async function disconnect(userId, provider) {
  const row = await one('SELECT credentials_enc FROM integrations WHERE user_id = ? AND provider = ?', [userId, provider]);
  if (!row) throw new HttpError(404, 'Integration is not connected', 'not_found');
  let revoked = false;
  try {
    const tokens = JSON.parse(decrypt(row.credentials_enc));
    const token = tokens.refresh_token || tokens.access_token;
    if (token) { await integrationClient().revokeToken(token); revoked = true; }
  } catch { /* revocation at Google is best-effort; local credentials are removed regardless */ }
  await query("UPDATE integrations SET status = 'disconnected', credentials_enc = NULL, scopes = NULL, connected_at = NULL WHERE user_id = ? AND provider = ?", [userId, provider]);
  return { revoked };
}
