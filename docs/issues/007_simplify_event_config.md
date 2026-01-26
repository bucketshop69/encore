# Issue #007: Simplify EventConfig

## Overview

Simplify EventConfig by removing marketplace-specific fields and adding event metadata.

## Description

**Current**: EventConfig includes resale cap and royalty (marketplace features)
**Goal**: Focus on privacy hackathon, remove marketplace complexity

## Proposed Changes

### Remove

- ❌ `royalty_bps` - Marketplace feature, not privacy-related
- ❌ `calculate_royalty()` - Helper for removed field
- ⚠️ **Keep** `resale_cap_bps` - Prevents price manipulation (privacy-relevant)

### Add

- ✅ `event_location: String` - Useful metadata for events
- ✅ `event_description: String` (optional) - Better context

## Rationale

**Why remove royalty?**

- Not relevant to privacy hackathon
- Adds complexity without privacy value
- Judges care about ZK/privacy, not marketplace logic

**Why keep resale cap?**

- Prevents whales from price manipulation
- Privacy protection: limits price discovery
- Core to anti-scalping use case

**Why add location?**

- Real-world event metadata
- Makes demo more realistic
- Simple addition

## Schema Changes

### Before

```rust
pub struct EventConfig {
    pub authority: Pubkey,
    pub max_supply: u32,
    pub tickets_minted: u32,
    pub resale_cap_bps: u32,     // KEEP
    pub royalty_bps: u16,         // REMOVE
    pub event_name: String,
    pub event_timestamp: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}
```

### After

```rust
pub struct EventConfig {
    pub authority: Pubkey,
    pub max_supply: u32,
    pub tickets_minted: u32,
    pub resale_cap_bps: u32,     // KEEP
    pub event_name: String,
    pub event_location: String,  // NEW
    pub event_timestamp: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}
```

## Files to Modify

| File | Change |
|------|--------|
| `state/event_config.rs` | Update struct, remove royalty helpers |
| `instructions/event_create.rs` | Update parameters |
| `instructions/event_update.rs` | Remove royalty update |
| `events.rs` | Update EventCreated/Updated events |
| `constants.rs` | Add MAX_EVENT_LOCATION_LEN |
| `errors.rs` | Add EventLocationTooLong |
| `tests/integration.rs` | Update test calls |
| `CHANGELOG.md` | Document changes |

## Migration Impact

⚠️ **Breaking Change** - Existing accounts incompatible
✅ **Acceptable** - Hackathon/devnet only

## Success Criteria

- EventConfig simplified to privacy-focused fields
- All tests updated and passing
- Cleaner, more focused implementation

## Priority

**MEDIUM** - Nice cleanup, but not critical for demo

## Estimated Time

20-30 minutes
