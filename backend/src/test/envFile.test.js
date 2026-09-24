import { describe, it, expect, vi } from 'vitest';
import { resolveEnvFile } from '../config/env.js';

const present = (...files) => (file) => files.includes(file);

describe('resolveEnvFile', () => {
  it('uses ENV_FILE exclusively without probing anything else', () => {
    const exists = vi.fn(() => true);
    expect(resolveEnvFile({ envFile: '.env.e2e', nodeEnv: 'production', exists })).toBe('.env.e2e');
    expect(exists).not.toHaveBeenCalled();
  });

  it('loads only .env.production in production, never .env.local or .env', () => {
    expect(resolveEnvFile({ nodeEnv: 'production', exists: present('.env.local', '.env.production', '.env') })).toBe(
      '.env.production',
    );
    expect(resolveEnvFile({ nodeEnv: 'production', exists: present('.env.local', '.env') })).toBeNull();
  });

  it('prefers .env.local, then the legacy .env, and never loads .env.production outside production', () => {
    expect(resolveEnvFile({ nodeEnv: 'development', exists: present('.env.local', '.env.production', '.env') })).toBe(
      '.env.local',
    );
    expect(resolveEnvFile({ nodeEnv: undefined, exists: present('.env.production', '.env') })).toBe('.env');
    expect(resolveEnvFile({ nodeEnv: 'test', exists: present('.env.production') })).toBeNull();
  });

  it('loads nothing when no file exists', () => {
    expect(resolveEnvFile({ nodeEnv: 'development', exists: present() })).toBeNull();
  });
});
