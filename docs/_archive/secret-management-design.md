# Secret Management Design

## Problem
Rituals need API keys (AlphaVantage, OpenRouter, etc.). Users need secure storage that's:
- Local-first (works offline)
- Encrypted at rest
- Scoped per ritual/tool
- Easy to rotate

## Solution: Local Vault

### Architecture
```
~/.summon/secrets/
├── vault.json              # Encrypted secret store
├── vault.key               # Master key (user password derived)
└── backups/
    └── vault-2026-02-19.json.bak
```

### Security Model

**Encryption:**
- AES-256-GCM for secret values
- PBKDF2 (100k iterations) for key derivation
- Master key never stored, derived from user password
- Optional: hardware key (TouchID/FaceID on macOS)

**Scope Levels:**
```typescript
type SecretScope = 
  | 'global'        // Available to all rituals
  | 'tool'          // Available to specific tool (e.g., all alpha_vantage calls)
  | 'ritual'        // Available to specific ritual only
  | 'version';      // Available to specific ritual version only
```

### Data Model

```typescript
interface SecretVault {
  version: '1.0';
  createdAt: ISO8601;
  updatedAt: ISO8601;
  
  // Never encrypted (needed for lookup)
  entries: SecretEntry[];
  
  // Encrypted blob containing actual values
  ciphertext: string;
  nonce: string;
  salt: string;
}

interface SecretEntry {
  id: string;               // UUID
  name: string;             // User-friendly name (e.g., "AlphaVantage Prod")
  key: string;              // Secret key (e.g., "ALPHA_VANTAGE_API_KEY")
  
  // Scope
  scope: SecretScope;
  scopeTarget: string;      // tool name, ritual ID, or version
  
  // Metadata (not encrypted)
  createdAt: ISO8601;
  lastUsedAt?: ISO8601;
  useCount: number;
  
  // Rotation tracking
  expiresAt?: ISO8601;
  rotatedFrom?: string;     // Previous secret ID
}

// Decrypted only in memory
interface SecretValue {
  value: string;
  entryId: string;
}
```

### CLI Interface

```bash
# Add a secret
summon secrets add ALPHA_VANTAGE_API_KEY --scope=tool --target=alpha_vantage
# Prompts for value, encrypts, stores

# List secrets (names only, no values)
summon secrets list
# NAME                      SCOPE    TARGET           LAST_USED
# ALPHA_VANTAGE_API_KEY     tool     alpha_vantage    2h ago
# OPENROUTER_KEY            global   *                5m ago

# Use in ritual YAML
# summon run @river/stock-checker --secret=ALPHA_VANTAGE_API_KEY

# Rotate a secret
summon secrets rotate ALPHA_VANTAGE_API_KEY
# Prompts for new value, archives old

# Remove
summon secrets remove ALPHA_VANTAGE_API_KEY

# Export (encrypted backup)
summon secrets export --file=secrets-backup.json

# Import
summon secrets import --file=secrets-backup.json
```

### Ritual Integration

**Runtime injection:**
```yaml
# ritual.yaml
name: stock-checker
skills:
  - id: financial_search
    requiredTools: [alpha_vantage]
    secrets:          # Declares required secrets
      - ALPHA_VANTAGE_API_KEY

# At runtime, Summon:
# 1. Checks vault for secret with scope=tool/target=alpha_vantage
# 2. Injects into tool environment
# 3. Logs access (not value) to trace
```

**Tool SDK usage:**
```typescript
// Tool implementation
import { getSecret } from '@summon/runtime';

const apiKey = await getSecret('ALPHA_VANTAGE_API_KEY');
// Automatically scoped based on calling ritual
```

### Cloud Sync (Future)

When cloud execution is added:
- Secrets remain in local vault
- Cloud execution fetches on-demand via secure channel
- Or: user explicitly "pushes" secrets to cloud vault
- Cloud vault uses AWS KMS / Cloudflare Secrets

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Laptop stolen | Vault encrypted, needs password |
| Memory dump | Secrets only decrypted per-use, cleared after |
| Keylogger | Password entry can use secure enclave (future) |
| Backup exposure | Backups encrypted with same vault key |
| Accidental commit | `.gitignore` auto-updated, secret keys never logged |

### Implementation Phases

**Phase 1 (Now):**
- Basic vault with password encryption
- CLI add/list/remove
- Runtime injection

**Phase 2:**
- TouchID/FaceID integration (macOS)
- Secret rotation reminders
- Audit logging (who used what when)

**Phase 3:**
- Cloud vault sync
- Team/shared secrets
- Hardware security key support

## Open Questions

1. Should we support cloud secret managers as backends? (AWS Secrets Manager, 1Password, etc.)
2. How to handle secret rotation without downtime?
3. Should rituals declare required secrets upfront for validation?
