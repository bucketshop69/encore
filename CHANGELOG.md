# Changelog

All notable changes to this project will be documented in this file.

## [0.6.3] - 2026-02-02

### UI Branding

- **Logo Integration**
  - Added logo to app header next to "Encore" title
  - Added small logo to back navigation links on event detail pages
  - Updated favicon to use logo.png instead of default vite.svg
  - Applied rounded (circular) styling to all logo instances

---

## [0.6.2] - 2026-02-01

### Documentation & Demo Improvements

- **README Overhaul**
  - New external-facing README with ASCII flow diagram
  - "Try It" section with 4 commands to run demo
  - Key concepts table (Compressed Accounts, Commitment, Nullifier, Escrow)
  - Sample test output showing what users will see
  - Old README preserved in `docs/ARCHITECTURE.md`

- **Test Output with Explorer Links**
  - Rewrote `marketplace-roundtrip.ts` as a demo with full addresses
  - Added `explorerAccountUrl()` and `explorerTxUrl()` helpers
  - All tickets, nullifiers, listings printed with Solana Explorer links
  - Visual formatting with headers, dividers, and emoji
  - Transaction summary at end for easy verification

- **Security: Remove Sensitive Logs**
  - Removed commitment fragments from `ticket_mint.rs`
  - Removed seller pubkey and commitment logs from `listing_complete.rs`
  - Removed owner pubkey and commitment logs from `ticket_transfer.rs`
  - On-chain logs now show only safe operational messages

- **Vercel Build Fix**
  - Copied IDL to `app/src/idl/encore.json` (Vercel can't access `target/`)
  - Fixed unused import `getClaimListingInstruction`
  - Fixed unused variable `buyer` → `_buyer`

---

## [0.6.1] - 2026-02-01

### UI Escrow Flow Integration (Issue #018 - ✅ COMPLETE)

- **Marketplace Buttons Show Amounts**
  - Buy button: "Buy & Deposit X SOL"
  - Release button: "Release & Receive X SOL"
  - Cancel claim button: "Cancel & Get X SOL Back"

- **Seller Cancel Feature**
  - New "Cancel & Refund Buyer" button for sellers on claimed listings
  - Calls `sellerCancelClaim()` to refund buyer and release listing
  - Available in both My Tickets and Marketplace views

- **Pending Purchases**
  - Shows escrow amount badge: "💰 X SOL in escrow"
  - Cancel button shows refund amount

- **Success Messages**
  - "Deposited X SOL to escrow. Waiting for seller..."
  - "Ticket #N sold! Received X SOL."
  - "Listing cancelled. Refunded X SOL to buyer."
  - "Claim cancelled. Refunded X SOL."

- **Styling**
  - Added `.badge-escrow` style (gold/amber)

---

## [0.6.0] - 2026-02-01

### SOL Escrow for Marketplace Payments (Issue #011 - ✅ COMPLETE)

- **Escrow PDA System**
  - Seeds: `["escrow", listing.key()]` - unique escrow per listing
  - Buyer deposits SOL to escrow when claiming listing
  - Seller receives SOL from escrow when releasing ticket
  - Full refund to buyer on any cancellation

- **New Instructions**
  - `claim_listing`: Now deposits `listing.price` SOL from buyer to escrow PDA
  - `complete_sale`: Now withdraws escrow SOL to seller via `invoke_signed`
  - `cancel_claim`: Now refunds escrow SOL to buyer (buyer cancels)
  - `seller_cancel_claim` (**NEW**): Seller can cancel claimed listing, refunds buyer

- **Technical Implementation**
  - Added `ESCROW_SEED` constant
  - PDA signing with `invoke_signed` for System-owned escrow accounts
  - Proper Rust borrow ordering to satisfy borrow checker

- **Client Updates**
  - `getEscrowPda()` helper function
  - All marketplace methods include escrow + systemProgram accounts
  - `sellerCancelClaim()` method for seller cancellation

- **Testing**
  - Full round-trip test verified with real SOL deposits/withdrawals
  - Both trade directions tested (Alice→Bob, Bob→Alice)

---

## [0.5.0] - 2026-02-01

### Marketplace UX Fixes & cancel_claim Instruction (Issues #017, #018)

- **New Instruction: `cancel_claim`** (Issue #017 - ✅ COMPLETE)
  - Allows buyer to voluntarily release a claimed listing
  - Resets listing status from `Claimed` → `Active`
  - Clears buyer and buyer_commitment fields
  - Added to program mod.rs, lib.rs, and IDL

- **Marketplace End-to-End Flow Fixes**
  - **Listing Status Display**: Fixed `fetchActiveListings()` to include both `active` AND `claimed` listings
  - **Seller Release Flow**: Alice now sees "Release Ticket" button when Bob claims her listing
  - **Ticket Removal on Sale**: `removeTicket()` properly removes from seller's localStorage after `completeSale`
  - **Claim-to-Ticket Conversion**: Bob's claimed tickets convert to owned tickets when seller releases

- **Deterministic Secrets (Master Key Pattern)**
  - Single wallet signature per event generates master key
  - All ticket secrets derived from master key (no repeated signing)
  - Functions: `generateMasterKey()`, `deriveTicketSecret()`
  - Backward compatible with existing `generateDeterministicSecret()`

- **UI Improvements**
  - "Check Status" button in Pending Purchases section for manual refresh
  - Console logging for debugging claim/ticket flow
  - Proper state updates after marketplace actions

- **Technical Notes**
  - RPC scanning for tickets not feasible (ticket addresses use random seeds for privacy)
  - localStorage remains the source of truth for ticket ownership
  - Future: Consider encrypted backup solution for secret recovery

---

## [0.4.0] - 2026-01-31

### Codama Kit Migration (Issue #016 - ✅ COMPLETE)

- **Client Architecture Overhaul**
  - Migrated client-side SDK (`encore.ts`) to use Codama-generated instructions and types.
  - Adopted `@solana/kit` (Web3.js v2) for better type safety and `bigint` support.
  - Implemented **Hybrid Stack**:
    - **Codama**: Used for Instruction building and Account decoding (Lightweight, Type-safe).
    - **Anchor**: Retained for Transaction signing/sending and some GPA calls (Compatibility).
  - Created `adapter.ts` to seamless bridge V2 types (Address, Instruction) with V1 legacy types.

- **Type Safety & Data Handling**
  - Unified all numeric types to `bigint` in domain interfaces (`EventConfig`, `Listing`).
  - Removed reliance on `BN.js` in frontend logic (mapped at boundary).
  - Fixed `EventDetail` and `Home` UI components to correctly handle native `bigint` values.

- **Critical Fixes**
  - **Light Protocol Integration**: Fixed critical "No associated TreeInfo" bug by properly enabling V2 feature flag.
  - **State Tree Writability**: Resolved "Cross-program invocation with unauthorized signer or writable account" in `mintTicket` by forcing `outputStateTreeIndex` to be writable.

---

## [0.3.3] - 2026-01-31

### UI/UX Overhaul - "Industrial Rave" Theme (Issues #013-#015 - ✅ COMPLETE)

- **Premium Visual Identity**

  - **Color Palette**: Deep Black (`#09090b`) background with Acid Green (`#CCFF00`) accents
  - **Typography**: "Itim" (Handwritten style) for headers and "Space Mono" for distinct, technical data
  - **Component Styling**: Dark, neutral surfaces with high-contrast interactions (hover states)
  - **Wallet Integration**: Custom styling for wallet adapter buttons and modals to match the theme (neutral default, acid green active/hover)

- **Enhanced User Experience**
  - **"Connect & Action" Patterns**:
    - **Create Event**: Modal allows non-connected users to see the form; "Create" button automatically triggers wallet connection
    - **Buy Ticket**: "Buy" buttons in Hero and Marketplace initiate wallet connection if disconnected
    - **Seamless Access**: Users can explore the app (Home, Details, Marketplace) without prior connection
  - **Optimized Layouts**:
    - **Create Event Modal**: Wider layout (`max-width: 650px`), combined row inputs (Location/Date, 3-column Ticket Details), improved padding and alignment
    - **Event Detail Hero**: "Buy Ticket" CTA moved to the main hero card for better conversion visibility
    - **Responsive Design**: Fixed body layout issues (`display: flex` removal) and input box alignment (`box-sizing` fix)

---

## [0.3.2] - 2026-01-31

### Added

- **UI Core Services** (Issue #012 - ✅ COMPLETE)

  - `commitment.ts` - Secret generation, commitment computation (SHA256), encryption/decryption
  - `light.ts` - Light Protocol SDK wrappers (validity proofs, packed accounts, address derivation)
  - `encore.ts` - EncoreClient class with all program methods (Anchor + web3.js)
  - `useEncore.ts` - React hook for EncoreClient instance
  - `config.ts` - RPC_URL, PROGRAM_ID, ADDRESS_TREE constants

- **Vite + React + TypeScript Frontend**
  - Clean TypeScript build with `verbatimModuleSyntax`
  - Anchor Program integration (IDL imported as JSON)
  - Light Protocol SDK v0.22.1-alpha.1 integration

### Technical Decisions

- Used manual Anchor wrapper instead of Codama (Codama generates @solana/kit code, incompatible with Anchor)
- All program methods return transaction signatures for confirmation
- Commitment utilities use Web Crypto API (browser-native)

---

## [0.3.1] - 2026-01-31

### Added

- **Marketplace with Light Protocol CPI** (Issue #010 - ✅ COMPLETE)

  - `complete_sale` instruction with full Light Protocol CPI integration
  - Creates nullifier atomically to prevent double-spend
  - Creates new ticket with buyer's commitment in same transaction
  - `SaleCompleted` event with listing, seller, buyer, event_config, ticket_id, price_lamports
  - All marketplace tests passing on devnet (8/8 tests)

- **Marketplace Test Coverage**

  - `test_create_listing` - Seller lists ticket with encrypted secret
  - `test_claim_listing` - Buyer locks listing with commitment
  - `test_complete_sale` - Full Light Protocol CPI with nullifier + ticket creation
  - `test_cancel_listing` - Seller cancels before claim
  - `test_privacy_cash_integration` - Privacy Cash payment flow (with fallback)

- **UI Planning Documents** (Issues #012-#015)
  - Issue #012: UI Core Services (commitment.ts, light.ts, encore.ts)
  - Issue #013: UI Events + Mint Flow
  - Issue #014: UI My Tickets + List for Sale
  - Issue #015: UI Marketplace + Buy Flow

### Changed

- Updated test file to use `accountsPartial()` for Anchor 0.31 compatibility
- Added Privacy Cash SDK as optional dependency

---

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
