# Issue #006: Batch Ticket Minting

## Overview

Add batch minting instruction to create multiple tickets in a single transaction, leveraging Light Protocol's multi-account proof capabilities.

## Description

**Current**: Mint tickets one at a time (expensive, slow)
**Solution**: Batch mint up to 8 tickets in single transaction

## Use Cases

1. **Organizer VIP Reserve**: Mint 100 tickets, keep first 10 for VIPs
2. **Bulk Airdrop**: Distribute tickets to multiple winners
3. **Cost Optimization**: Save on transaction fees (1 proof vs N proofs)

## Technical Approach

### Single Mint (Current)

```rust
mint_ticket(commitment) // 1 ticket, 1 tx, 100k CU
```

### Batch Mint (New)

```rust
batch_mint_tickets([
    commitment_1,
    commitment_2,
    // ... up to 8
]) // 8 tickets, 1 tx, 100k CU (same cost!)
```

## Instruction Design

```rust
pub fn batch_mint_tickets<'info>(
    ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    ticket_data: Vec<TicketMintData>, // Max 8
) -> Result<()>

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct TicketMintData {
    pub owner_commitment: [u8; 32],
    pub purchase_price: u64,
}
```

## Implementation Steps

1. Create `batch_mint_tickets` instruction
2. Loop through `ticket_data` to create multiple `LightAccount` instances
3. Chain `.with_light_account()` calls (up to 8)
4. Create addresses for all tickets
5. Single CPI call with all accounts
6. Update `tickets_minted` by batch count
7. Emit batch mint event

## Light Protocol Limits

- **Max accounts per proof**: 8
- **Max addresses per proof**: 8
- **CU cost**: 100k per proof (not per account!)

## Files to Create/Modify

| File | Change |
|------|--------|
| `instructions/batch_mint.rs` | New instruction |
| `instructions/mod.rs` | Export batch_mint |
| `lib.rs` | Add batch_mint_tickets entrypoint |
| `events.rs` | Add BatchTicketsMinted event |
| `tests/integration.rs` | Add batch mint test |

## Event Design

```rust
#[event]
pub struct BatchTicketsMinted {
    pub event_config: Pubkey,
    pub start_ticket_id: u32,
    pub count: u32,
    pub commitments: Vec<[u8; 32]>,
}
```

## Testing Scenarios

1. Batch mint 8 tickets successfully
2. Batch mint fails if exceeds max supply
3. Batch mint fails if > 8 tickets
4. All tickets created with correct IDs and data

## Success Criteria

- Can mint up to 8 tickets in one transaction
- Significant CU savings demonstrated
- Properly validates max supply across batch
- All tests passing

## Priority

**MEDIUM-HIGH** - Great demo feature, shows optimization understanding

## Estimated Time

1-2 hours
