import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { CONFIG } from "../config";
import * as light from "./light";
import * as commitment from "./commitment";

// Import IDL JSON directly
import encoreIdl from "../../../../target/idl/encore.json";

// Event account type from IDL
export interface EventConfig {
    authority: PublicKey;
    maxSupply: number;
    ticketsMinted: number;
    resaleCapBps: number;
    eventName: string;
    eventLocation: string;
    eventDescription: string;
    maxTicketsPerPerson: number; // u8
    eventTimestamp: BN;
    createdAt: BN;
    updatedAt: BN;
    bump: number;
}

// Listing account type
export interface Listing {
    seller: PublicKey;
    eventConfig: PublicKey;
    ticketId: BN;
    ownerCommitment: number[];
    encryptedSecret: number[];
    pricePerTicket: BN;
    buyer: PublicKey | null;
    buyerCommitment: number[] | null;
    status: { active: object } | { claimed: object } | { sold: object } | { cancelled: object };
    createdAt: BN;
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

    constructor(provider: AnchorProvider) {
        this.provider = provider;
        this.programId = new PublicKey(CONFIG.PROGRAM_ID);
        this.program = new Program(encoreIdl as Idl, provider);
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
            return await this.program.account.eventConfig.fetch(eventConfig);
        } catch {
            return null;
        }
    }

    async fetchAllEvents(): Promise<EventWithPubkey[]> {
        return this.program.account.eventConfig.all();
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

        const tx = await this.program.methods
            .createEvent(
                new BN(maxSupply),
                new BN(resaleCapBps),
                name,
                location,
                description,
                maxTicketsPerPerson,
                new BN(timestamp)
            )
            .accountsPartial({
                authority,
                eventConfig,
            })
            .rpc();

        return tx;
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

        const tx = await this.program.methods
            .createListing(
                Array.from(ticketCommitment),
                Array.from(encryptedSecret),
                new BN(priceLamports),
                eventConfig,
                ticketId,
                Array.from(ticketAddressSeed),
                0
            )
            .accountsPartial({
                seller,
                listing: listingPda,
            })
            .rpc();

        return { txSig: tx, listingPda };
    }

    async claimListing(
        listingPda: PublicKey,
        buyer: PublicKey,
        buyerCommitment: Uint8Array
    ): Promise<string> {
        return this.program.methods
            .claimListing(Array.from(buyerCommitment))
            .accountsPartial({ buyer, listing: listingPda })
            .rpc();
    }

    async cancelListing(listingPda: PublicKey, seller: PublicKey): Promise<string> {
        return this.program.methods
            .cancelListing()
            .accountsPartial({ seller, listing: listingPda })
            .rpc();
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
            return await this.program.account.listing.fetch(listingPda);
        } catch {
            return null;
        }
    }

    async fetchAllListings(): Promise<ListingWithPubkey[]> {
        return this.program.account.listing.all();
    }

    async fetchActiveListings(): Promise<ListingWithPubkey[]> {
        const all = await this.fetchAllListings();
        return all.filter((l) => l.account.status && "active" in l.account.status);
    }
}
