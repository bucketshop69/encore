import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { CONFIG } from "../config";
import * as light from "./light";
import * as commitment from "./commitment";

// Import IDL JSON directly
import encoreIdl from "../../../../target/idl/encore.json";

/**
 * Encore client for interacting with the program
 */
export class EncoreClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    program: any;
    programId: PublicKey;

    constructor(provider: AnchorProvider) {
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

    async fetchEvent(eventConfig: PublicKey) {
        return this.program.account.eventConfig.fetch(eventConfig);
    }

    async fetchAllEvents() {
        return this.program.account.eventConfig.all();
    }

    // ============================================
    // Mint Methods
    // ============================================

    async mintTicket(
        buyer: PublicKey,
        eventOwner: PublicKey,
        ownerCommitment: Uint8Array,
        purchasePrice: BN
    ) {
        const eventConfig = this.getEventConfigPda(eventOwner);
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

        return {
            tx: this.program.methods
                .mintTicket(
                    { 0: proofResult.compressedProof },
                    addressTreeInfo,
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
                .preInstructions([
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
                ])
                .remainingAccounts(remainingAccounts),
            ticketSeed,
            ticketAddress,
        };
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
        seller: PublicKey,
        ticketCommitment: Uint8Array,
        secret: Uint8Array,
        priceLamports: BN,
        eventConfig: PublicKey,
        ticketId: number
    ) {
        const listingPda = this.getListingPda(seller, ticketCommitment);
        const encryptedSecret = commitment.encryptSecret(secret, listingPda.toBytes());
        const ticketAddressSeed = commitment.generateRandomSecret();

        return {
            tx: this.program.methods
                .createListing(
                    Array.from(ticketCommitment),
                    Array.from(encryptedSecret),
                    priceLamports,
                    eventConfig,
                    ticketId,
                    Array.from(ticketAddressSeed),
                    0
                )
                .accountsPartial({
                    seller,
                    listing: listingPda,
                }),
            listingPda,
        };
    }

    async claimListing(buyer: PublicKey, listingPda: PublicKey, buyerCommitment: Uint8Array) {
        return this.program.methods
            .claimListing(Array.from(buyerCommitment))
            .accountsPartial({ buyer, listing: listingPda });
    }

    async cancelListing(seller: PublicKey, listingPda: PublicKey) {
        return this.program.methods.cancelListing().accountsPartial({ seller, listing: listingPda });
    }

    async completeSale(seller: PublicKey, listingPda: PublicKey, sellerSecret: Uint8Array) {
        const nullifierAddress = light.deriveNullifierAddress(sellerSecret, this.programId);
        const newTicketSeed = commitment.generateRandomSecret();
        const newTicketAddress = light.deriveTicketAddress(newTicketSeed, this.programId);
        const proofResult = await light.getValidityProof([nullifierAddress, newTicketAddress]);
        const { packed, addressTreeIndex, outputStateTreeIndex } =
            await light.buildPackedAccounts(this.programId);
        const { remainingAccounts } = packed.toAccountMetas();
        const addressTreeInfo = light.buildAddressTreeInfo(proofResult.rootIndices[0], addressTreeIndex);

        return {
            tx: this.program.methods
                .completeSale(
                    { 0: proofResult.compressedProof },
                    addressTreeInfo,
                    outputStateTreeIndex,
                    Array.from(newTicketSeed),
                    0,
                    Array.from(sellerSecret)
                )
                .accountsPartial({ seller, listing: listingPda })
                .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
                .remainingAccounts(remainingAccounts),
            nullifierAddress,
            newTicketAddress,
            newTicketSeed,
        };
    }

    async fetchListing(listingPda: PublicKey) {
        return this.program.account.listing.fetch(listingPda);
    }

    async fetchAllListings() {
        return this.program.account.listing.all();
    }

    async fetchActiveListings() {
        const all = await this.fetchAllListings();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return all.filter((l: any) => l.account.status && "active" in l.account.status);
    }
}
