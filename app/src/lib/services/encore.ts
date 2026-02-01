import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { createSolanaRpc, type Rpc } from "@solana/kit";
import { CONFIG } from "../config";
import * as light from "./light";
import * as commitment from "./commitment";
import {
    getCreateEventInstruction,
    getCreateListingInstruction,
    getClaimListingInstruction,
    getCancelListingInstruction,
    fetchEventConfig,
    fetchListing,
    ListingStatus as CodamaListingStatus
} from "../../client";
import { asSigner, toV2Address, toV1Instruction, toV1PublicKey } from "./adapter";

// Import IDL JSON directly
import encoreIdl from "../../../../target/idl/encore.json";

// Event account type - Mapped to Codama Types (Native BigInt)
export interface EventConfig {
    authority: PublicKey;
    maxSupply: number;
    ticketsMinted: number;
    resaleCapBps: number;
    eventName: string;
    eventLocation: string;
    eventDescription: string;
    maxTicketsPerPerson: number; // u8
    eventTimestamp: bigint;
    createdAt: bigint;
    updatedAt: bigint;
    bump: number;
}

// Listing account type - Mapped to Codama Types (Native BigInt)
export interface Listing {
    seller: PublicKey;
    eventConfig: PublicKey;
    ticketId: number;
    ownerCommitment: number[];
    encryptedSecret: number[];
    priceLamports: bigint;
    buyer: PublicKey | null;
    buyerCommitment: number[] | null;
    status: { active: object } | { claimed: object } | { sold: object } | { cancelled: object };
    createdAt: bigint;
    bump: number;
}

export interface EventWithPubkey {
    publicKey: PublicKey;
    account: EventConfig;
}

export interface ListingWithPubkey {
    publicKey: PublicKey;
    account: Listing;
}

/**
 * Encore client for interacting with the program
 */
export class EncoreClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any;
    programId: PublicKey;
    provider: AnchorProvider;
    rpc: Rpc<any>;

    constructor(provider: AnchorProvider) {
        this.provider = provider;
        this.programId = new PublicKey(CONFIG.PROGRAM_ID);
        this.program = new Program(encoreIdl as Idl, provider);
        this.rpc = createSolanaRpc(CONFIG.RPC_URL);
    }

    // ============================================
    // Event Methods
    // ============================================

    getEventConfigPda(authority: PublicKey): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("event"), authority.toBuffer()],
            this.programId
        );
        return pda;
    }

    async fetchEvent(eventConfig: PublicKey): Promise<EventConfig | null> {
        try {
            // Use Codama fetcher (Direct V2)
            const account = await fetchEventConfig(this.rpc, toV2Address(eventConfig));
            if (!account) return null;

            return {
                authority: toV1PublicKey(account.data.authority),
                maxSupply: account.data.maxSupply,
                ticketsMinted: account.data.ticketsMinted,
                resaleCapBps: account.data.resaleCapBps,
                eventName: account.data.eventName,
                eventLocation: account.data.eventLocation,
                eventDescription: account.data.eventDescription,
                maxTicketsPerPerson: account.data.maxTicketsPerPerson,
                eventTimestamp: account.data.eventTimestamp,
                createdAt: account.data.createdAt,
                updatedAt: account.data.updatedAt,
                bump: account.data.bump
            };
        } catch (e) {
            console.error("Failed to fetch event:", e);
            return null;
        }
    }

    async fetchAllEvents(): Promise<EventWithPubkey[]> {
        // Still using Anchor for GPA (all()) for now, but mapping to new V2 types
        const events = await this.program.account.eventConfig.all();
        return events.map((event: any) => ({
            publicKey: event.publicKey,
            account: {
                authority: event.account.authority,
                maxSupply: event.account.maxSupply,
                ticketsMinted: event.account.ticketsMinted,
                resaleCapBps: event.account.resaleCapBps,
                eventName: event.account.eventName,
                eventLocation: event.account.eventLocation,
                eventDescription: event.account.eventDescription,
                maxTicketsPerPerson: event.account.maxTicketsPerPerson,
                eventTimestamp: BigInt(event.account.eventTimestamp.toString()),
                createdAt: BigInt(event.account.createdAt.toString()),
                updatedAt: BigInt(event.account.updatedAt.toString()),
                bump: event.account.bump
            }
        }));
    }

    async createEvent(
        authority: PublicKey,
        name: string,
        location: string,
        description: string,
        maxSupply: number,
        resaleCapBps: number,
        maxTicketsPerPerson: number,
        timestamp: number // unix timestamp in seconds
    ): Promise<string> {
        const eventConfig = this.getEventConfigPda(authority);

        const inst = getCreateEventInstruction({
            authority: asSigner(toV2Address(authority)),
            eventConfig: toV2Address(eventConfig),
            maxSupply,
            resaleCapBps,
            eventName: name,
            eventLocation: location,
            eventDescription: description,
            maxTicketsPerPerson,
            eventTimestamp: BigInt(timestamp)
        });

        const tx = new Transaction().add(toV1Instruction(inst));
        return await this.provider.sendAndConfirm(tx);
    }

    // ============================================
    // Mint Methods
    // ============================================

    async mintTicket(
        eventConfig: PublicKey,
        buyer: PublicKey,
        ownerCommitment: Uint8Array,
        priceLamports: BN
    ): Promise<{ txSig: string; ticketSeed: Uint8Array }> {
        // Get event to find authority
        const event = await this.fetchEvent(eventConfig);
        if (!event) throw new Error("Event not found");

        const ticketSeed = commitment.generateRandomSecret();
        const ticketAddress = light.deriveTicketAddress(ticketSeed, this.programId);
        const proofResult = await light.getValidityProof([ticketAddress]);
        const { packed, addressTreeIndex, outputStateTreeIndex } =
            await light.buildPackedAccounts(this.programId);
        const { remainingAccounts } = packed.toAccountMetas();

        // FIX: Ensure the State Tree Queue is writable. 
        // Light Protocol requires the output state tree to be writable for appending new leaves.
        // PackedAccounts might default to ReadOnly.
        if (outputStateTreeIndex < remainingAccounts.length) {
            remainingAccounts[outputStateTreeIndex].isWritable = true;
            console.log(`Forced OutputStateTree (idx ${outputStateTreeIndex}) to Writable: ${remainingAccounts[outputStateTreeIndex].pubkey.toBase58()}`);
        } else {
            console.warn("OutputStateTreeIndex out of bounds for remainingAccounts!");
        }

        const addressTreeInfo = light.buildAddressTreeInfo(
            proofResult.rootIndices[0],
            addressTreeIndex
        );

        const tx = await this.program.methods
            .mintTicket(
                { 0: proofResult.compressedProof },
                addressTreeInfo,
                outputStateTreeIndex,
                Array.from(ownerCommitment),
                priceLamports,
                Array.from(ticketSeed)
            )
            .accountsPartial({
                buyer,
                eventOwner: event.authority,
                eventConfig,
            })
            .preInstructions([
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
            ])
            .remainingAccounts(remainingAccounts)
            .rpc();

        return { txSig: tx, ticketSeed };
    }

    // ============================================
    // Listing Methods
    // ============================================

    getListingPda(seller: PublicKey, ticketCommitment: Uint8Array): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("listing"), seller.toBuffer(), Buffer.from(ticketCommitment)],
            this.programId
        );
        return pda;
    }

    async createListing(
        eventConfig: PublicKey,
        ticketId: number,
        seller: PublicKey,
        ticketCommitment: Uint8Array,
        secret: Uint8Array,
        priceLamports: number
    ): Promise<{ txSig: string; listingPda: PublicKey }> {
        const listingPda = this.getListingPda(seller, ticketCommitment);
        const encryptedSecret = commitment.encryptSecret(secret, listingPda.toBytes());
        const ticketAddressSeed = commitment.generateRandomSecret();

        const inst = getCreateListingInstruction({
            seller: asSigner(toV2Address(seller)),
            listing: toV2Address(listingPda),
            eventConfig: toV2Address(eventConfig),
            ticketCommitment: ticketCommitment,
            encryptedSecret: encryptedSecret,
            priceLamports: BigInt(priceLamports),
            ticketId: ticketId,
            ticketAddressSeed: ticketAddressSeed,
            ticketBump: 0,
        });

        const tx = new Transaction().add(toV1Instruction(inst));
        const txSig = await this.provider.sendAndConfirm(tx);
        return { txSig, listingPda };
    }

    async claimListing(
        listingPda: PublicKey,
        buyer: PublicKey,
        buyerCommitment: Uint8Array
    ): Promise<string> {
        const inst = getClaimListingInstruction({
            buyer: asSigner(toV2Address(buyer)),
            listing: toV2Address(listingPda),
            buyerCommitment: buyerCommitment
        });
        const tx = new Transaction().add(toV1Instruction(inst));
        return await this.provider.sendAndConfirm(tx);
    }

    async cancelListing(listingPda: PublicKey, seller: PublicKey): Promise<string> {
        const inst = getCancelListingInstruction({
            seller: asSigner(toV2Address(seller)),
            listing: toV2Address(listingPda)
        });
        const tx = new Transaction().add(toV1Instruction(inst));
        return await this.provider.sendAndConfirm(tx);
    }

    async cancelClaim(listingPda: PublicKey, buyer: PublicKey): Promise<string> {
        // Use Anchor program directly since Codama might not have this yet
        const tx = await this.program.methods
            .cancelClaim()
            .accountsPartial({
                buyer: buyer,
                listing: listingPda,
            })
            .transaction();
        return await this.provider.sendAndConfirm(tx);
    }

    async completeSale(
        _eventConfig: PublicKey,
        _ticketId: number,
        seller: PublicKey,
        buyer: PublicKey,
        sellerSecret: Uint8Array,
        _buyerCommitment: Uint8Array
    ): Promise<{ txSig: string; newTicketSeed: Uint8Array }> {
        // Compute seller's commitment from their secret
        const sellerCommitment = commitment.computeCommitment(seller, sellerSecret);
        const listingPda = this.getListingPda(seller, sellerCommitment);

        const nullifierAddress = light.deriveNullifierAddress(sellerSecret, this.programId);
        const newTicketSeed = commitment.generateRandomSecret();
        const newTicketAddress = light.deriveTicketAddress(newTicketSeed, this.programId);
        const proofResult = await light.getValidityProof([nullifierAddress, newTicketAddress]);
        const { packed, addressTreeIndex, outputStateTreeIndex } =
            await light.buildPackedAccounts(this.programId);
        const { remainingAccounts } = packed.toAccountMetas();
        const addressTreeInfo = light.buildAddressTreeInfo(proofResult.rootIndices[0], addressTreeIndex);

        const tx = await this.program.methods
            .completeSale(
                { 0: proofResult.compressedProof },
                addressTreeInfo,
                outputStateTreeIndex,
                Array.from(newTicketSeed),
                0,
                Array.from(sellerSecret)
            )
            .accountsPartial({
                seller,
                buyer,
                listing: listingPda
            })
            .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(remainingAccounts)
            .rpc();

        return { txSig: tx, newTicketSeed };
    }

    async fetchListing(listingPda: PublicKey): Promise<Listing | null> {
        try {
            // Use Codama fetcher (Direct V2)
            const account = await fetchListing(this.rpc, toV2Address(listingPda));
            if (!account) return null;

            const data = account.data;
            let statusObj: any = { active: {} };
            switch (data.status) {
                case CodamaListingStatus.Active: statusObj = { active: {} }; break;
                case CodamaListingStatus.Claimed: statusObj = { claimed: {} }; break;
                case CodamaListingStatus.Completed: statusObj = { sold: {} }; break;
                case CodamaListingStatus.Cancelled: statusObj = { cancelled: {} }; break;
            }

            // Map Codama types to our Listing interface
            return {
                seller: toV1PublicKey(data.seller),
                eventConfig: toV1PublicKey(data.eventConfig),
                ticketId: data.ticketId,
                ownerCommitment: Array.from(data.ticketCommitment),
                encryptedSecret: Array.from(data.encryptedSecret),
                priceLamports: data.priceLamports,
                buyer: (data.buyer.__option === 'Some') ? toV1PublicKey(data.buyer.value) : null,
                buyerCommitment: (data.buyerCommitment.__option === 'Some') ? Array.from(data.buyerCommitment.value) : null,
                status: statusObj,
                createdAt: data.createdAt,
                bump: data.bump
            };
        } catch {
            return null;
        }
    }

    async fetchAllListings(): Promise<ListingWithPubkey[]> {
        // Still using Anchor for GPA (all()) for now, but mapping to new V2 types
        const listings = await this.program.account.listing.all();
        return listings.map((l: any) => ({
            publicKey: l.publicKey,
            account: {
                seller: l.account.seller,
                eventConfig: l.account.eventConfig,
                ticketId: l.account.ticketId,
                ownerCommitment: l.account.ticketCommitment,
                encryptedSecret: l.account.encryptedSecret,
                priceLamports: BigInt(l.account.priceLamports.toString()),
                buyer: l.account.buyer,
                buyerCommitment: l.account.buyerCommitment,
                status: l.account.status,
                createdAt: BigInt(l.account.createdAt.toString()),
                bump: l.account.bump
            }
        }));
    }

    async fetchActiveListings(): Promise<ListingWithPubkey[]> {
        const all = await this.fetchAllListings();
        // Include both active and claimed listings (exclude completed/cancelled)
        return all.filter((l) => l.account.status &&
            ("active" in l.account.status || "claimed" in l.account.status));
    }

    // ============================================
    // Ticket Discovery (RPC-based, no localStorage)
    // ============================================

    /**
     * Scan for tickets owned by the current wallet.
     * Uses deterministic secrets to check each possible ticket ID.
     * 
     * @param eventConfig - The event to scan
     * @param maxTicketId - The max ticket ID to scan (usually event.ticketsMinted)
     * @param ownerPubkey - The wallet public key
     * @param signMessage - Wallet's signMessage function for deterministic secrets
     * @returns Array of owned tickets with their secrets
     */
    async scanOwnedTickets(
        eventConfig: PublicKey,
        maxTicketId: number,
        ownerPubkey: PublicKey,
        signMessage: (msg: Uint8Array) => Promise<Uint8Array>
    ): Promise<Array<{ ticketId: number; secret: Uint8Array; commitment: string }>> {
        const ownedTickets: Array<{ ticketId: number; secret: Uint8Array; commitment: string }> = [];
        const lightRpc = light.getRpc();

        console.log(`🔍 Scanning tickets 1-${maxTicketId} for ${ownerPubkey.toBase58().slice(0, 8)}...`);

        // Sign ONCE to get master key, then derive all secrets from it
        const masterKey = await commitment.generateMasterKey(signMessage, eventConfig);
        console.log(`🔑 Master key generated (single signature)`);

        const { bn } = await import("@lightprotocol/stateless.js");

        for (let ticketId = 1; ticketId <= maxTicketId; ticketId++) {
            try {
                // Derive secret from master key (no signing needed)
                const secret = commitment.deriveTicketSecret(masterKey, ticketId);

                // Compute what our commitment would be
                const ourCommitment = commitment.computeCommitment(ownerPubkey, secret);

                // Derive the ticket address from this commitment
                const ticketAddress = light.deriveTicketAddress(ourCommitment, this.programId);

                // Check if this ticket exists on-chain
                const account = await lightRpc.getCompressedAccount(bn(ticketAddress.toBytes()));

                if (account) {
                    // Also check nullifier doesn't exist (ticket not spent)
                    const nullifierAddress = light.deriveNullifierAddress(secret, this.programId);
                    const nullifier = await lightRpc.getCompressedAccount(bn(nullifierAddress.toBytes()));

                    if (!nullifier) {
                        console.log(`✅ Found owned ticket #${ticketId}`);
                        ownedTickets.push({
                            ticketId,
                            secret,
                            commitment: commitment.commitmentToHex(ourCommitment),
                        });
                    } else {
                        console.log(`⚠️ Ticket #${ticketId} has been spent (nullifier exists)`);
                    }
                }
            } catch (err) {
                // Ticket doesn't exist or error - continue scanning
            }
        }

        console.log(`🔍 Scan complete. Found ${ownedTickets.length} tickets.`);
        return ownedTickets;
    }
}
