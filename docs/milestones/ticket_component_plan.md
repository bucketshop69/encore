# Milestone: Ticket Component Knowledge Base

## Purpose
Documentation for the Ticket component that outlines the knowledge domain, validation requirements, and business logic for private ticket management.

## Domain Knowledge

### Ticket Properties
- **Unique Hidden ID**: Each ticket has a unique identifier stored in the Merkle tree
- **Ownership Proof**: Tickets can be proven to be owned without revealing owner identity
- **Purchase History**: Tickets store their last purchase price to enforce resale rules
- **Privacy Preservation**: Ticket ownership is hidden from public viewers

### Business Rules
- Tickets exist as compressed PDAs in Light Protocol Merkle tree
- Only the Merkle Root exists on-chain, not individual ticket records
- Tickets remember their purchase price for resale calculations
- Ownership transfers happen via ZK proofs without revealing identities

## Validation Requirements

### State Validation
- Verify ticket exists in the correct event's Merkle tree
- Validate ownership through ZK proof verification
- Check that resale price respects the event's cap
- Ensure ticket hasn't been double-spent

### Ownership Verification
- Validate ZK proof of ownership
- Confirm ticket belongs to the correct event
- Check that previous owner is authorized to transfer
- Verify new owner meets any eligibility requirements

## Technical Specifications

### Ticket Data Structure
- Unique identifier in the Merkle tree
- Link to parent event configuration
- Last purchase price information
- Current owner commitment (hidden)
- Transfer history (for resale validation)

### Security Considerations
- Prevent double-spending of tickets
- Ensure ZK proofs are properly validated
- Maintain privacy of ticket holders
- Protect against replay attacks