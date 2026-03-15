# Secrets - Cut Down MVP

## Decision: Use `.env` File

Skip custom vault for MVP. Use standard `.env` with `chmod 600`.

```
~/.summon/.env          # Secrets file (chmod 600)
~/.summon/.env.example  # Template
```

## Format

```bash
# ~/.summon/.env
OPENROUTER_API_KEY=sk-or-...
ALPHA_VANTAGE_API_KEY=...
```

## Implementation (src/secrets/index.ts)

```typescript
import { readFileSync, existsSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SECRETS_FILE = join(homedir(), '.summon', '.env');

export function getSecret(key: string): string | undefined {
  // 1. Check env var first (for CI/docker)
  if (process.env[key]) {
    return process.env[key];
  }
  
  // 2. Check ~/.summon/.env
  if (!existsSync(SECRETS_FILE)) {
    return undefined;
  }
  
  const content = readFileSync(SECRETS_FILE, 'utf-8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    const match = line.match(new RegExp(`^${key}=(.+)$`));
    if (match) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

export function setSecret(key: string, value: string): void {
  let content = '';
  
  if (existsSync(SECRETS_FILE)) {
    content = readFileSync(SECRETS_FILE, 'utf-8');
    // Update existing or append
    const regex = new RegExp(`^${key}=.+$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  } else {
    content = `${key}=${value}`;
  }
  
  writeFileSync(SECRETS_FILE, content.trim() + '\n');
  chmodSync(SECRETS_FILE, 0o600);
}

export function listSecrets(): string[] {
  if (!existsSync(SECRETS_FILE)) {
    return [];
  }
  
  const content = readFileSync(SECRETS_FILE, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.includes('=') && !line.startsWith('#'))
    .map(line => line.split('=')[0]);
}

export function removeSecret(key: string): void {
  if (!existsSync(SECRETS_FILE)) {
    return;
  }
  
  const content = readFileSync(SECRETS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => !line.startsWith(`${key}=`));
  writeFileSync(SECRETS_FILE, lines.join('\n'));
}
```

## CLI Commands

```bash
summon secrets add OPENROUTER_API_KEY
# Prompts for value, writes to ~/.summon/.env

summon secrets list
# OPENROUTER_API_KEY
# ALPHA_VANTAGE_API_KEY

summon secrets remove OPENROUTER_API_KEY

summon secrets get OPENROUTER_API_KEY  # For debugging
```

## Ritual Integration

```typescript
// In tool implementation
import { getSecret } from '@summon/secrets';

const apiKey = getSecret('ALPHA_VANTAGE_API_KEY');
if (!apiKey) {
  throw new Error('Missing ALPHA_VANTAGE_API_KEY. Run: summon secrets add ALPHA_VANTAGE_API_KEY');
}
```

## Future (Post-MVP)

If cloud execution needed, THEN build encrypted vault.
