# Issue #012: UI Core Services

## Overview

Create core service modules for the Next.js frontend. All Light Protocol and Encore program interactions go through these services.

## Time Estimate: 1.5 hours

## Dependencies

- `@lazorkit/wallet` (passkey wallet, no fees)
- `@solana/wallet-adapter-react`
- `@lightprotocol/stateless.js`
- `@coral-xyz/anchor`

## File Structure

```
app/
├── providers/
│   └── WalletProvider.tsx    # ✅ Already have this
├── lib/
│   ├── config.ts             # RPC, program ID, constants
│   ├── encore-idl.ts         # Import IDL from target/
│   └── services/
│       ├── index.ts
│       ├── commitment.ts     # Secret + commitment generation
│       ├── light.ts          # Light Protocol helpers
│       └── encore.ts         # Program instruction wrappers
└── hooks/
    ├── useEncore.ts          # Hook for Encore client
    └── useTickets.ts         # Hook for user's tickets
```

## Implementation

### 1. `lib/config.ts`

```typescript
export const CONFIG = {
  RPC_URL: "https://devnet.helius-rpc.com/?api-key=YOUR_KEY",
  PROGRAM_ID: "BjapcaBemidgideMDLWX4wujtnEETZknmNyv28uXVB7V",
  ADDRESS_TREE: "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx", // batchAddressTree
};

export const LAZORKIT_CONFIG = {
  RPC_URL: CONFIG.RPC_URL,
  PORTAL_URL: "https://portal.lazorkit.xyz",
  PAYMASTER: { ... },
  CLUSTER: "devnet",
};
```

### 2. `lib/services/commitment.ts`

```typescript
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Generate secret from wallet signature (deterministic)
 * User never stores this - regenerate anytime
 */
export async function generateSecret(
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
  ticketId: number,
  eventConfig: PublicKey
): Promise<Uint8Array> {
  const message = `ticket:${ticketId}:${eventConfig.toBase58()}`;
  const signature = await signMessage(new TextEncoder().encode(message));
  return sha256(signature);
}

/**
 * Compute commitment = SHA256(pubkey || secret)
 */
export function computeCommitment(
  pubkey: PublicKey,
  secret: Uint8Array
): Uint8Array {
  const data = new Uint8Array([...pubkey.toBytes(), ...secret]);
  return sha256(data);
}

/**
 * Generate random secret (for new tickets where ID unknown)
 */
export function generateRandomSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
```

### 3. `lib/services/light.ts`

```typescript
import { PublicKey } from "@solana/web3.js";
import {
  createRpc,
  Rpc,
  bn,
  deriveAddressV2,
  deriveAddressSeedV2,
  PackedAccounts,
  SystemAccountMetaConfig,
  batchAddressTree,
} from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha256";
import { CONFIG } from "../config";

let rpc: Rpc | null = null;

export function getRpc(): Rpc {
  if (!rpc) {
    rpc = createRpc(CONFIG.RPC_URL, CONFIG.RPC_URL);
  }
  return rpc;
}

export function getAddressTree(): PublicKey {
  return new PublicKey(batchAddressTree);
}

export function deriveTicketAddress(
  seed: Uint8Array,
  programId: PublicKey
): PublicKey {
  const addressTree = getAddressTree();
  const ticketSeed = deriveAddressSeedV2([Buffer.from("ticket"), Buffer.from(seed)]);
  return deriveAddressV2(ticketSeed, addressTree, programId);
}

export function deriveNullifierAddress(
  secret: Uint8Array,
  programId: PublicKey
): PublicKey {
  const addressTree = getAddressTree();
  const secretHash = sha256(secret);
  const nullifierSeed = deriveAddressSeedV2([Buffer.from("nullifier"), Buffer.from(secretHash)]);
  return deriveAddressV2(nullifierSeed, addressTree, programId);
}

export async function getValidityProof(newAddresses: PublicKey[]) {
  const rpc = getRpc();
  const addressTree = getAddressTree();
  
  return rpc.getValidityProofV0(
    [],
    newAddresses.map(addr => ({
      address: bn(addr.toBytes()),
      tree: addressTree,
      queue: addressTree,
    }))
  );
}

export async function buildPackedAccounts(programId: PublicKey) {
  const rpc = getRpc();
  const addressTree = getAddressTree();
  
  const stateTreeInfos = await rpc.getStateTreeInfos();
  const stateTreeInfo = stateTreeInfos.find(i => i.tree.toBase58().startsWith('bmt'));
  if (!stateTreeInfo) throw new Error("No batched state tree found");
  
  const config = SystemAccountMetaConfig.new(programId);
  const packed = PackedAccounts.newWithSystemAccountsV2(config);
  
  const addressTreeIndex = packed.insertOrGet(addressTree);
  const outputStateTreeIndex = packed.insertOrGet(stateTreeInfo.queue);
  
  return { packed, addressTreeIndex, outputStateTreeIndex };
}
```

### 4. `lib/services/encore.ts`

```typescript
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { Encore, IDL } from "../encore-idl";
import { CONFIG } from "../config";
import * as light from "./light";
import * as commitment from "./commitment";

export class EncoreClient {
  program: Program<Encore>;
  
  constructor(provider: AnchorProvider) {
    this.program = new Program(IDL, new PublicKey(CONFIG.PROGRAM_ID), provider);
  }
  
  // --- Event Methods ---
  
  getEventConfigPda(authority: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("event"), authority.toBuffer()],
      this.program.programId
    );
    return pda;
  }
  
  async fetchEvent(eventConfig: PublicKey) {
    return this.program.account.eventConfig.fetch(eventConfig);
  }
  
  async fetchAllEvents() {
    return this.program.account.eventConfig.all();
  }
  
  // --- Mint Methods ---
  
  async mintTicket(
    buyer: PublicKey,
    eventOwner: PublicKey,
    ownerCommitment: Uint8Array,
    purchasePrice: BN
  ) {
    const eventConfig = this.getEventConfigPda(eventOwner);
    const ticketSeed = commitment.generateRandomSecret();
    const ticketAddress = light.deriveTicketAddress(ticketSeed, this.program.programId);
    
    const proofResult = await light.getValidityProof([ticketAddress]);
    const { packed, addressTreeIndex, outputStateTreeIndex } = await light.buildPackedAccounts(this.program.programId);
    
    const { remainingAccounts } = packed.toAccountMetas();
    
    return this.program.methods
      .mintTicket(
        { 0: proofResult.compressedProof },
        {
          rootIndex: proofResult.rootIndices[0],
          addressMerkleTreePubkeyIndex: addressTreeIndex,
          addressQueuePubkeyIndex: addressTreeIndex,
        },
        outputStateTreeIndex,
        Array.from(ownerCommitment),
        purchasePrice,
        Array.from(ticketSeed)
      )
      .accountsPartial({
        buyer,
        eventOwner,
        eventConfig,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
      .remainingAccounts(remainingAccounts);
  }
  
  // --- Listing Methods ---
  
  getListingPda(seller: PublicKey, ticketCommitment: Uint8Array): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), seller.toBuffer(), Buffer.from(ticketCommitment)],
      this.program.programId
    );
    return pda;
  }
  
  async createListing(
    seller: PublicKey,
    ticketCommitment: Uint8Array,
    secret: Uint8Array,
    priceLamports: BN,
    eventConfig: PublicKey,
    ticketId: number
  ) {
    const listingPda = this.getListingPda(seller, ticketCommitment);
    
    // Encrypt secret: XOR with hash(listing_pda)
    const listingHash = new Uint8Array(await crypto.subtle.digest('SHA-256', listingPda.toBytes()));
    const encryptedSecret = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      encryptedSecret[i] = secret[i] ^ listingHash[i];
    }
    
    return this.program.methods
      .createListing(
        Array.from(ticketCommitment),
        Array.from(encryptedSecret),
        priceLamports,
        eventConfig,
        ticketId,
        Array.from(commitment.generateRandomSecret()),
        0
      )
      .accountsPartial({
        seller,
        listing: listingPda,
      });
  }
  
  async claimListing(
    buyer: PublicKey,
    listingPda: PublicKey,
    buyerCommitment: Uint8Array
  ) {
    return this.program.methods
      .claimListing(Array.from(buyerCommitment))
      .accountsPartial({
        buyer,
        listing: listingPda,
      });
  }
  
  async completeSale(
    seller: PublicKey,
    listingPda: PublicKey,
    sellerSecret: Uint8Array
  ) {
    const nullifierAddress = light.deriveNullifierAddress(sellerSecret, this.program.programId);
    const newTicketSeed = commitment.generateRandomSecret();
    const newTicketAddress = light.deriveTicketAddress(newTicketSeed, this.program.programId);
    
    const proofResult = await light.getValidityProof([nullifierAddress, newTicketAddress]);
    const { packed, addressTreeIndex, outputStateTreeIndex } = await light.buildPackedAccounts(this.program.programId);
    
    const { remainingAccounts } = packed.toAccountMetas();
    
    return this.program.methods
      .completeSale(
        { 0: proofResult.compressedProof },
        {
          rootIndex: proofResult.rootIndices[0],
          addressMerkleTreePubkeyIndex: addressTreeIndex,
          addressQueuePubkeyIndex: addressTreeIndex,
        },
        outputStateTreeIndex,
        Array.from(newTicketSeed),
        0,
        Array.from(sellerSecret)
      )
      .accountsPartial({
        seller,
        listing: listingPda,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
      .remainingAccounts(remainingAccounts);
  }
  
  async fetchListing(listingPda: PublicKey) {
    return this.program.account.listing.fetch(listingPda);
  }
  
  async fetchAllListings() {
    return this.program.account.listing.all();
  }
}
```

### 5. `hooks/useEncore.ts`

```typescript
"use client";

import { useMemo } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { EncoreClient } from "@/lib/services/encore";

export function useEncore() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  
  const client = useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, {});
    return new EncoreClient(provider);
  }, [connection, wallet]);
  
  return client;
}
```

## Success Criteria

- [ ] Can generate commitment from wallet signature
- [ ] Can derive ticket/nullifier addresses
- [ ] Can build Light Protocol proofs
- [ ] EncoreClient wraps all instructions
- [ ] useEncore hook works with Lazorkit wallet

## Testing

```typescript
// In browser console after connecting wallet
const client = useEncore();
const events = await client.fetchAllEvents();
console.log(events);
```
