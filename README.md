# Project Context: Private ZK Ticketing System on Solana

## 1. Executive Summary

We are building a **privacy-preserving ticketing marketplace** using **Light Protocol (ZK Compression)** on Solana. The system allows organizers to mint tickets effectively for free (compressed), enforces resale price caps and royalties trustlessly via smart contracts, and keeps ticket ownership and pricing private using Zero-Knowledge proofs.

## 2. Core Value Protocol

- **Privacy:** Ticket ownership and resale prices are hidden from public viewers but verifiable by the protocol.
- **Trustless Enforcement:** Resale caps (e.g., max 1.5x mint price) and royalties (e.g., 5%) are hard-coded into the ticket logic.
- **Cost Efficiency:** Using Compressed Accounts allows minting 10k+ tickets for <\$1 (rent-free).
- **Security:** Funds are escrowed until event settlement.

---

## 3. Architecture & Mental Model

### The "Compressed Ticket" Concept

Instead of a standard SPL Token or Metaplex NFT, a ticket is a **Compressed PDA** stored in a Light Protocol Merkle tree.

- **On-Chain:** Only the Merkle Root and the Event Config PDA exist.
- **Off-Chain:** The detailed state (Ownership, Purchase Price) is cryptographic history.
- **Interaction:** Users submit ZK Proofs to transition state (e.g., "I own Ticket #42 and am selling it").