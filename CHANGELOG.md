# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-01-30

### Added

- **Commitment + Nullifier Privacy Model** (Issue #009 - ✅ COMPLETE)
  - Replaced ephemeral key model with commitment-based ownership
  - `owner_commitment = SHA256(owner_pubkey || secret)` hides ticket owner
  - CREATE-only operations avoid devnet indexer issues with burns/mutations
  - Nullifier pattern: CREATE empty account at `hash("nullifier" || secret)` to mark spent
  - Single CPI creates both nullifier + new ticket atomically
  - Fresh wallet separation (buyer1 mints, buyer1 transfers to buyer2)
  - All tests passing on devnet with Helius RPC

- **Transfer with Nullifier**
  - `transfer_ticket` creates nullifier to prevent double-spend
  - Creates new ticket with buyer's commitment in same transaction
  - Seller signs (owns the secret), buyer provides new commitment
  - Works reliably on devnet (no burns, no mutations)

### Changed

- **Simplified Ticket Structure**
  - Changed `owner: Pubkey` to `owner_commitment: [u8; 32]`
  - Privacy: commitment reveals nothing about owner identity

### Deprecated

- **Issue #002, #003, #008** - Superseded by #009
  - Original Poseidon/ZK circuit approach replaced with SHA256 commitments
  - Burn+Create pattern replaced with CREATE-only nullifier pattern

---

## [0.2.0] - 2026-01-19

## [0.2.1] - 2026-01-27

### Changed

- **Simplified EventConfig** (Issue #007 - ✅ COMPLETE)
  - Removed `royalty_bps` and `calculate_royalty` (Marketplace capabilities removed for privacy focus)
  - Added `event_location` (Max 64 chars) to `EventConfig` and `create_event`
  - Added `event_description` (Max 200 chars) to `EventConfig` and `create_event`
  - Added `max_tickets_per_person` (Max 4) to limit purchase quantity per wallet
  - Updated `create_event` and `update_event` instructions to reflect schema changes
  - Updated `EventCreated` and `EventUpdated` events
  - Added new constants and error codes for field validations

### Added

- **Private Ticket Minting with Light Protocol** (Issue #002)

  - `mint_ticket` instruction for minting privacy-preserving tickets
  - `PrivateTicket` struct with `owner_commitment` instead of plain pubkey
  - Ownership hidden via commitment: `SHA256(owner_pubkey || secret)`
  - Only ticket owner knows their secret - no one else can identify them
  - ZK-compressed accounts for 200x cost reduction
  - Address derivation using `["ticket", event_config, ticket_id]`
  - Max supply enforcement with `MaxSupplyReached` error
  - `TicketMinted` event emits commitment (not owner pubkey)

- **Privacy Model**
  - Ticket ownership hidden from on-chain observers
  - Organizer only receives commitment, never sees recipient identity
  - Foundation for ZK proof-based ownership verification

- **Rust Integration Tests**
  - `test_create_event` - EventConfig PDA creation
  - `test_mint_private_ticket` - Private ticket minting with commitment
  - `test_mint_ticket_fails_max_supply` - Supply limit enforcement

- **Light Protocol Infrastructure**
  - Light CLI installed for test infrastructure
  - `light-program-test` integration for Rust tests

- **Private Ticket Transfer** (Issue #003 - ✅ COMPLETE with V2 Nullifiers)
  - `transfer_ticket` instruction for privacy-preserving ownership transfers
  - **Ownership Proof**: Seller reveals pubkey + secret to prove ownership
  - **Privacy Preserved**: Buyer commitment stays private, no identity revealed
  - **Resale Cap Enforcement**: Max resale price enforced (1.0x-10.0x original price)
  - **Original Price Tracking**: First purchase price preserved across transfers
  - **UTXO Pattern**: Old account nullified, new account created with updated owner
  - **Merkle Proof Validation**: Uses tree info from validity proof
  - **✅ V2 Tree Support**: Full V2 state and address tree implementation
  - **✅ Nullifier Protection**: Double-spend prevention via nullifier accounts
  - **Nullifier Account**: Creates compressed `Nullifier` account to mark consumed transfers
  - **Event Emission**: `TicketTransferred` event with ticket_id and commitments
  - **Integration Tests**: `test_transfer_ticket` validates full transfer flow with nullifier

- **V2 Migration** (2026-01-20)
  - ✅ Enabled `v2` feature for `light-program-test` in dev dependencies
  - ✅ Added V2 address tree validation in both mint and transfer instructions
  - ✅ Imports `ADDRESS_TREE_V2` constant from `light-sdk-types`
  - ✅ Consistent V2 state and address trees throughout application
  - ✅ Fixed mixed tree version error (`StateV1` + `AddressV2`)
  - ✅ Nullifier creation fully operational with proper account indexing
  - ✅ Removed debug log messages from production code

- **Security Testing** (Issue #004 - ✅ COMPLETE)
  - ✅ Added `test_prevent_double_spend` integration test
  - ✅ Demonstrates nullifier prevents reusing same ticket transfer
  - ✅ Validates security guarantee: attempting second transfer with same secret fails
  - ✅ Clear error messaging for security failures

- **Privacy Refactor: Ephemeral Keys** (2026-01-26 - ✅ COMPLETE)
  - Refactored `PrivateTicket` to use `owner: Pubkey` (Ephemeral Key/Stealth Address) instead of hash commitment
  - Updated `mint_ticket` to accept ephemeral public key directly
  - Updated `transfer_ticket` to transfer from current ephemeral keypair to new ephemeral public key
  - Simplifies client-side ZK proof generation by removing need for custom circuit inputs
  - Maintains privacy by ensuring `owner` keys are fresh, disposable keypairs unlinked to user's main wallet
  - **Rust Tests**: Updated `integration.rs` to validate full ephemeral key mint/transfer flow

- **Client-Side Integration Tests**
  - Created `tests/encore.ts` for full client-side integration
  - Aligned client dependencies with Rust program versions:
    - Downgraded `@lightprotocol/stateless.js` to `0.17.0`
    - Downgraded `@lightprotocol/compressed-token` to `0.17.0`
  - Implemented `mintTicket` and `transferTicket` helpers compatible with SDK v0.17
  - **Note**: Client tests require external ZK Compression infrastructure (Indexer/Prover) not currently exposed by local validator. Rust tests serve as primary validation.

## [0.1.0] - 2026-01-18

### Added

- **Event Manager Instruction** (Issue #001)

  - `create_event` instruction for organizers to initialize events
  - `update_event` instruction for modifying resale caps and royalties
  - `EventConfig` PDA with seeds `["event", authority.key()]`
  - Validation for ticket supply, resale caps (1.0x-10.0x), royalties (max 50%)
  - Future timestamp validation for event dates
  - `EventCreated` and `EventUpdated` anchor events

- **Project Structure**

  - Modular codebase following CONTRIBUTING.md guidelines
  - `constants.rs` - program seeds and limits
  - `errors.rs` - custom error definitions
  - `events.rs` - anchor event definitions
  - `state/event_config.rs` - EventConfig account with helper methods
  - `instructions/event_create.rs` - create event handler
  - `instructions/event_update.rs` - update event handler

- **Tests**
  - 7 passing tests for create_event and update_event
  - Validation error tests for edge cases
  - Authorization tests

### Fixed

- Package name corrected from "create" to "encore" in Cargo.toml
