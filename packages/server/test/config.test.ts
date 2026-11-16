import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(c.port).toBe(3000);
    expect(c.nodeEnv).toBe('development');
    expect(c.sessionTtlDays).toBe(30);
    expect(c.scryptLogN).toBe(17);
    expect(c.rateLimitMax).toBe(10);
    expect(c.turnTimeoutMs).toBe(120_000);
    expect(c.disconnectGraceMs).toBe(60_000);
    expect(c.waitingGameTtlMs).toBe(30 * 60_000);
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.trustProxy).toBe(false);
    expect(c.webDist).toBeUndefined();
  });

  it('reads the production settings', () => {
    const c = loadConfig({ DATABASE_URL: 'x', TRUST_PROXY: 'true', WEB_DIST: '/app/web' });
    expect(c.trustProxy).toBe(true);
    expect(c.webDist).toBe('/app/web');
    expect(() => loadConfig({ DATABASE_URL: 'x', TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('parses the allowed origins list', () => {
    const c = loadConfig({ DATABASE_URL: 'x', ALLOWED_ORIGINS: ' https://a.example , https://b.example,, ' });
    expect(c.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('reads and converts environment values', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x', PORT: '8080', NODE_ENV: 'production', SCRYPT_LOG_N: '14' });
    expect(c.port).toBe(8080);
    expect(c.nodeEnv).toBe('production');
    expect(c.scryptLogN).toBe(14);
  });

  it('fails with a readable message when something is missing or invalid', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: 'x', PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL: 'x', NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ DATABASE_URL: 'x', SCRYPT_LOG_N: '3' })).toThrow(/SCRYPT_LOG_N/);
  });
});
