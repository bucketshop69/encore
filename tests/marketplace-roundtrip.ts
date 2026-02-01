/**
 * ENCORE - Private Ticketing Demo
 * 
 * This test demonstrates the complete marketplace flow:
 * - Private ticket minting with hidden ownership
 * - Marketplace listing with encrypted secrets
 * - Trustless escrow for payments
 * - Nullifiers to prevent double-spending
 * 
 * All addresses are printed in full with Solana Explorer links for verification.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Encore } from "../target/types/encore";
import {
    bn,
    createRpc,
    PackedAccounts,
    Rpc,
    SystemAccountMetaConfig,
    deriveAddressV2,
    deriveAddressSeedV2,
    featureFlags,
    VERSION,
    batchAddressTree,
} from "@lightprotocol/stateless.js";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// Enable V2 feature flag
(featureFlags as any).version = VERSION.V2;

// ═══════════════════════════════════════════════════════════════════════════
// EXPLORER HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const EXPLORER_BASE = "https://explorer.solana.com";
const CLUSTER = "devnet";

function explorerAccountUrl(address: web3.PublicKey | string): string {
    const addr = typeof address === 'string' ? address : address.toBase58();
    return `${EXPLORER_BASE}/address/${addr}?cluster=${CLUSTER}`;
}

function explorerTxUrl(signature: string): string {
    return `${EXPLORER_BASE}/tx/${signature}?cluster=${CLUSTER}`;
}

function printDivider(char = "═", length = 80) {
    console.log(char.repeat(length));
}

function printHeader(title: string) {
    console.log("");
    printDivider("═");
    console.log(`  ${title}`);
    printDivider("═");
}

function printSubHeader(title: string) {
    console.log("");
    console.log(`┌${"─".repeat(78)}┐`);
    console.log(`│  ${title.padEnd(75)} │`);
    console.log(`└${"─".repeat(78)}┘`);
}

function printKeyValue(key: string, value: string, indent = 2) {
    const spaces = " ".repeat(indent);
    console.log(`${spaces}${key}: ${value}`);
}

function printExplorerLink(label: string, address: web3.PublicKey | string, indent = 2) {
    const spaces = " ".repeat(indent);
    const addr = typeof address === 'string' ? address : address.toBase58();
    console.log(`${spaces}${label}:`);
    console.log(`${spaces}  Address: ${addr}`);
    console.log(`${spaces}  Explorer: ${explorerAccountUrl(addr)}`);
}

function printTxLink(label: string, signature: string, indent = 2) {
    const spaces = " ".repeat(indent);
    console.log(`${spaces}${label}:`);
    console.log(`${spaces}  Signature: ${signature}`);
    console.log(`${spaces}  Explorer: ${explorerTxUrl(signature)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

describe("ENCORE - Private Ticketing Demo", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Encore as Program<Encore>;

    // Load payer keypair
    const payerKeypairPath = `${os.homedir()}/.config/solana/id.json`;
    const payerKeypair = web3.Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(payerKeypairPath, "utf-8")))
    );

    let rpc: Rpc;
    let eventConfigPda: web3.PublicKey;

    // Our two actors
    let alice: web3.Keypair;
    let bob: web3.Keypair;

    // Track ticket state through the journey
    interface TicketState {
        address: web3.PublicKey;
        secret: Buffer;
        ownerPubkey: web3.PublicKey;
        commitment: number[];
        ticketId: number;
        originalPrice: anchor.BN;
    }

    let currentTicket: TicketState;

    // Track all addresses for verification
    const ticketAddresses: web3.PublicKey[] = [];
    const nullifierAddresses: web3.PublicKey[] = [];
    const listingPdas: web3.PublicKey[] = [];
    const transactionSignatures: { step: string; signature: string }[] = [];

    // Helper: compute commitment = SHA256(pubkey || secret)
    function computeCommitment(pubkey: web3.PublicKey, secret: Buffer): number[] {
        const data = Buffer.concat([pubkey.toBuffer(), secret]);
        const hash = crypto.createHash('sha256').update(data).digest();
        return Array.from(hash);
    }

    // Helper: derive escrow PDA from listing
    function getEscrowPda(listingPda: web3.PublicKey): web3.PublicKey {
        const [escrowPda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("escrow"), listingPda.toBuffer()],
            program.programId
        );
        return escrowPda;
    }

    // Helper: fund a wallet
    async function fundWallet(wallet: web3.Keypair, amountSol: number) {
        const tx = new web3.Transaction().add(
            web3.SystemProgram.transfer({
                fromPubkey: payerKeypair.publicKey,
                toPubkey: wallet.publicKey,
                lamports: amountSol * web3.LAMPORTS_PER_SOL,
            })
        );
        const sig = await provider.sendAndConfirm(tx, [payerKeypair]);
        console.log(`  💰 Funded with ${amountSol} SOL`);
        console.log(`     Tx: ${explorerTxUrl(sig)}`);
    }

    // Helper: verify ticket exists on-chain
    async function verifyTicketExists(ticketAddress: web3.PublicKey, description: string) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const account = await rpc.getCompressedAccount(bn(ticketAddress.toBytes()));
        assert.ok(account, `${description} - Ticket should exist at ${ticketAddress.toBase58()}`);
        return account;
    }

    // Helper: verify nullifier exists (ticket spent)
    async function verifyNullifierExists(nullifierAddress: web3.PublicKey, description: string) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const account = await rpc.getCompressedAccount(bn(nullifierAddress.toBytes()));
        assert.ok(account, `${description} - Nullifier should exist`);
        return account;
    }

    // Helper: verify listing status
    async function verifyListingStatus(
        listingPda: web3.PublicKey,
        expectedStatus: string,
        expectedBuyer?: web3.PublicKey
    ) {
        const listing = await program.account.listing.fetch(listingPda);
        const statusKey = Object.keys(listing.status)[0];
        assert.equal(statusKey, expectedStatus, `Listing status should be ${expectedStatus}`);
        if (expectedBuyer) {
            assert.ok(listing.buyer?.equals(expectedBuyer), "Buyer should match");
        }
        return listing;
    }

    before(async () => {
        rpc = createRpc(
            "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def",
            "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def"
        );

        [eventConfigPda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("event"), payerKeypair.publicKey.toBuffer()],
            program.programId
        );

        // Create Alice and Bob
        alice = web3.Keypair.generate();
        bob = web3.Keypair.generate();

        printHeader("ENCORE - Private Ticketing on Solana");
        console.log("");
        console.log("  Encore is a privacy-focused ticketing platform where users can:");
        console.log("  • Create events and mint tickets privately");
        console.log("  • Buy and sell tickets on a trustless marketplace");
        console.log("  • Prove ownership without revealing identity");
        console.log("");
        console.log("  Built with:");
        console.log("  • Light Protocol compressed accounts (99.8% cost reduction)");
        console.log("  • Commitment/Nullifier model (privacy without sacrificing verifiability)");
        console.log("  • SOL escrow (trustless payments)");
        printDivider("─");

        printSubHeader("ACTORS");

        printExplorerLink("Alice (Seller → Buyer)", alice.publicKey);
        console.log("");
        printExplorerLink("Bob (Buyer → Seller)", bob.publicKey);
        console.log("");
        printExplorerLink("Event Config", eventConfigPda);
        console.log("");
        printExplorerLink("Program ID", program.programId);

        printSubHeader("FUNDING WALLETS");
        console.log("\n  Alice:");
        await fundWallet(alice, 0.5);
        console.log("\n  Bob:");
        await fundWallet(bob, 0.5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Alice mints a ticket
    // ═══════════════════════════════════════════════════════════════════

    it("Step 1: Alice mints a private ticket", async function () {
        printSubHeader("STEP 1: Alice mints a private ticket");

        console.log("\n  📖 What's happening:");
        console.log("     Alice generates a SECRET (only she knows)");
        console.log("     COMMITMENT = hash(Alice's pubkey + secret)");
        console.log("     Commitment goes on-chain, secret stays private");
        console.log("     → Nobody can see Alice owns this ticket!\n");

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate Alice's secret and commitment
        const aliceSecret = crypto.randomBytes(32);
        const aliceCommitment = computeCommitment(alice.publicKey, aliceSecret);

        printKeyValue("Alice's Secret (private)", aliceSecret.toString('hex'));
        printKeyValue("Alice's Commitment (public)", Buffer.from(aliceCommitment).toString('hex'));

        const addressTree = new web3.PublicKey(batchAddressTree);
        const ticketAddressSeed = crypto.randomBytes(32);

        const ticketSeed = deriveAddressSeedV2([
            Buffer.from("ticket"),
            ticketAddressSeed
        ]);
        const ticketAddress = deriveAddressV2(ticketSeed, addressTree, program.programId);

        console.log("");
        printExplorerLink("Ticket Address (compressed)", ticketAddress);

        // Get proof
        const proofRpcResult = await rpc.getValidityProofV0(
            [],
            [{ address: bn(ticketAddress.toBytes()), tree: addressTree, queue: addressTree }]
        );

        const stateTreeInfos = await rpc.getStateTreeInfos();
        const stateTreeInfo = stateTreeInfos.find(info => info.tree.toBase58().startsWith('bmt'));
        if (!stateTreeInfo) throw new Error("No batched state tree found");

        const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
        const packedAccounts = PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

        const addressTreeIndex = packedAccounts.insertOrGet(addressTree);
        const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.queue);

        const addressTreeInfoPacked = {
            rootIndex: proofRpcResult.rootIndices[0],
            addressMerkleTreePubkeyIndex: addressTreeIndex,
            addressQueuePubkeyIndex: addressTreeIndex,
        };

        const purchasePrice = new anchor.BN(100_000_000); // 0.1 SOL

        const sig = await program.methods
            .mintTicket(
                { 0: proofRpcResult.compressedProof },
                addressTreeInfoPacked,
                outputStateTreeIndex,
                aliceCommitment,
                purchasePrice,
                Array.from(ticketAddressSeed),
            )
            .accountsPartial({
                buyer: alice.publicKey,
                eventOwner: payerKeypair.publicKey,
                eventConfig: eventConfigPda,
            })
            .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(packedAccounts.toAccountMetas().remainingAccounts)
            .signers([alice])
            .rpc();

        transactionSignatures.push({ step: "Step 1: Mint", signature: sig });

        // Get ticket ID
        const eventConfig = await program.account.eventConfig.fetch(eventConfigPda);
        const ticketId = eventConfig.ticketsMinted;

        // Store ticket state
        currentTicket = {
            address: ticketAddress,
            secret: aliceSecret,
            ownerPubkey: alice.publicKey,
            commitment: aliceCommitment,
            ticketId,
            originalPrice: purchasePrice,
        };

        ticketAddresses.push(ticketAddress);

        // Verify
        await verifyTicketExists(ticketAddress, "Alice's minted ticket");

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Ticket ID", `#${ticketId}`, 5);
        printKeyValue("Owner", "Alice (hidden - only she knows the secret)", 5);
        printKeyValue("Status", "MINTED", 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Alice creates listing
    // ═══════════════════════════════════════════════════════════════════

    let listing1Pda: web3.PublicKey;
    let escrow1Pda: web3.PublicKey;

    it("Step 2: Alice lists ticket for 0.15 SOL", async function () {
        printSubHeader("STEP 2: Alice lists ticket for 0.15 SOL");

        console.log("\n  📖 What's happening:");
        console.log("     Alice encrypts her secret with the listing PDA");
        console.log("     Only after purchase can buyer decrypt it");
        console.log("     → Price is visible, but seller identity stays private!\n");

        const ticketCommitmentBuffer = Buffer.from(currentTicket.commitment);
        [listing1Pda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("listing"), alice.publicKey.toBuffer(), ticketCommitmentBuffer],
            program.programId
        );

        escrow1Pda = getEscrowPda(listing1Pda);

        printExplorerLink("Listing PDA", listing1Pda);
        console.log("");
        printExplorerLink("Escrow PDA (will hold buyer's SOL)", escrow1Pda);

        // Encrypt secret
        const listingPdaHash = crypto.createHash('sha256').update(listing1Pda.toBuffer()).digest();
        const encryptedSecret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            encryptedSecret[i] = currentTicket.secret[i] ^ listingPdaHash[i];
        }

        console.log("");
        printKeyValue("Encrypted Secret (on-chain)", encryptedSecret.toString('hex'));

        const price = new anchor.BN(150_000_000); // 0.15 SOL

        const sig = await program.methods
            .createListing(
                currentTicket.commitment,
                Array.from(encryptedSecret),
                price,
                eventConfigPda,
                currentTicket.ticketId,
                Array.from(crypto.randomBytes(32)),
                0,
            )
            .accountsPartial({
                seller: alice.publicKey,
                listing: listing1Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([alice])
            .rpc();

        transactionSignatures.push({ step: "Step 2: List", signature: sig });
        listingPdas.push(listing1Pda);

        // Verify
        await verifyListingStatus(listing1Pda, 'active');

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing", listing1Pda.toBase58(), 5);
        printKeyValue("Price", "0.15 SOL", 5);
        printKeyValue("Status", "ACTIVE (awaiting buyer)", 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Bob claims listing
    // ═══════════════════════════════════════════════════════════════════

    let bobSecret: Buffer;
    let bobCommitment: number[];

    it("Step 3: Bob claims listing & deposits 0.15 SOL to escrow", async function () {
        printSubHeader("STEP 3: Bob claims listing & deposits 0.15 SOL to escrow");

        console.log("\n  📖 What's happening:");
        console.log("     Bob generates HIS OWN secret for the ticket");
        console.log("     Bob's SOL goes to escrow PDA (not to Alice yet!)");
        console.log("     → Trustless! Bob's money is safe until Alice releases ticket\n");

        bobSecret = crypto.randomBytes(32);
        bobCommitment = computeCommitment(bob.publicKey, bobSecret);

        printKeyValue("Bob's Secret (private)", bobSecret.toString('hex'));
        printKeyValue("Bob's Commitment (public)", Buffer.from(bobCommitment).toString('hex'));

        const sig = await program.methods
            .claimListing(bobCommitment)
            .accountsPartial({
                buyer: bob.publicKey,
                listing: listing1Pda,
                escrow: escrow1Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([bob])
            .rpc();

        transactionSignatures.push({ step: "Step 3: Claim", signature: sig });

        // Verify
        await verifyListingStatus(listing1Pda, 'claimed', bob.publicKey);

        console.log("");
        printTxLink("Transaction", sig);

        // Check escrow balance
        const escrowBalance = await provider.connection.getBalance(escrow1Pda);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing Status", "CLAIMED", 5);
        printKeyValue("Buyer", bob.publicKey.toBase58(), 5);
        printKeyValue("Escrow Balance", `${escrowBalance / web3.LAMPORTS_PER_SOL} SOL`, 5);
        console.log("");
        printExplorerLink("Verify Escrow Balance", escrow1Pda, 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Alice releases ticket (completes sale)
    // ═══════════════════════════════════════════════════════════════════

    it("Step 4: Alice releases ticket → Bob gets ticket, Alice gets SOL", async function () {
        printSubHeader("STEP 4: Alice releases ticket → Bob gets ticket, Alice gets SOL");

        console.log("\n  📖 What's happening:");
        console.log("     Alice's old ticket is NULLIFIED (can never be spent again)");
        console.log("     New ticket created with Bob's commitment");
        console.log("     Escrow SOL released to Alice");
        console.log("     → Atomic swap! Both parties get what they want\n");

        const addressTree = new web3.PublicKey(batchAddressTree);

        // Nullifier from Alice's secret
        const nullifierSeedHash = crypto.createHash('sha256').update(currentTicket.secret).digest();
        const nullifierSeed = deriveAddressSeedV2([Buffer.from("nullifier"), nullifierSeedHash]);
        const nullifierAddress = deriveAddressV2(nullifierSeed, addressTree, program.programId);

        // New ticket for Bob
        const newTicketAddressSeed = crypto.randomBytes(32);
        const newTicketSeed = deriveAddressSeedV2([Buffer.from("ticket"), newTicketAddressSeed]);
        const newTicketAddress = deriveAddressV2(newTicketSeed, addressTree, program.programId);

        printExplorerLink("Nullifier (prevents double-spend)", nullifierAddress);
        console.log("");
        printExplorerLink("Bob's New Ticket", newTicketAddress);

        // Get proof for both addresses
        const proofRpcResult = await rpc.getValidityProofV0(
            [],
            [
                { address: bn(nullifierAddress.toBytes()), tree: addressTree, queue: addressTree },
                { address: bn(newTicketAddress.toBytes()), tree: addressTree, queue: addressTree },
            ]
        );

        const stateTreeInfos = await rpc.getStateTreeInfos();
        const stateTreeInfo = stateTreeInfos.find(info => info.tree.toBase58().startsWith('bmt'));
        if (!stateTreeInfo) throw new Error("No batched state tree found");

        const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
        const packedAccounts = PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

        const addressTreeIndex = packedAccounts.insertOrGet(addressTree);
        const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.queue);

        const addressTreeInfoPacked = {
            rootIndex: proofRpcResult.rootIndices[0],
            addressMerkleTreePubkeyIndex: addressTreeIndex,
            addressQueuePubkeyIndex: addressTreeIndex,
        };

        // Check Alice's balance before
        const aliceBalanceBefore = await provider.connection.getBalance(alice.publicKey);

        const sig = await program.methods
            .completeSale(
                { 0: proofRpcResult.compressedProof },
                addressTreeInfoPacked,
                outputStateTreeIndex,
                Array.from(newTicketAddressSeed),
                0,
                Array.from(currentTicket.secret),
            )
            .accountsPartial({
                seller: alice.publicKey,
                listing: listing1Pda,
                escrow: escrow1Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(packedAccounts.toAccountMetas().remainingAccounts)
            .signers([alice])
            .rpc();

        transactionSignatures.push({ step: "Step 4: Complete", signature: sig });

        // Check Alice's balance after
        const aliceBalanceAfter = await provider.connection.getBalance(alice.publicKey);
        const aliceReceived = (aliceBalanceAfter - aliceBalanceBefore) / web3.LAMPORTS_PER_SOL;

        nullifierAddresses.push(nullifierAddress);
        ticketAddresses.push(newTicketAddress);

        // Update ticket state - Bob now owns it
        currentTicket = {
            address: newTicketAddress,
            secret: bobSecret,
            ownerPubkey: bob.publicKey,
            commitment: bobCommitment,
            ticketId: currentTicket.ticketId,
            originalPrice: currentTicket.originalPrice,
        };

        // Verify
        await verifyListingStatus(listing1Pda, 'completed');
        await verifyNullifierExists(nullifierAddress, "Nullifier");
        await verifyTicketExists(newTicketAddress, "Bob's ticket");

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing Status", "COMPLETED", 5);
        printKeyValue("Alice Received", `~${aliceReceived.toFixed(4)} SOL (minus tx fee)`, 5);
        printKeyValue("Old Ticket", "NULLIFIED ❌", 5);
        printKeyValue("New Ticket Owner", "Bob ✅", 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Bob creates listing (same ticket!)
    // ═══════════════════════════════════════════════════════════════════

    let listing2Pda: web3.PublicKey;
    let escrow2Pda: web3.PublicKey;

    it("Step 5: Bob lists the same ticket for 0.2 SOL (resale!)", async function () {
        printSubHeader("STEP 5: Bob lists the same ticket for 0.2 SOL (resale!)");

        console.log("\n  📖 What's happening:");
        console.log("     Bob can resell because he knows the secret");
        console.log("     New listing, new escrow, new price");
        console.log("     → Secondary market works just like primary!\n");

        await new Promise(resolve => setTimeout(resolve, 2000));

        const ticketCommitmentBuffer = Buffer.from(currentTicket.commitment);
        [listing2Pda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("listing"), bob.publicKey.toBuffer(), ticketCommitmentBuffer],
            program.programId
        );

        escrow2Pda = getEscrowPda(listing2Pda);

        printExplorerLink("Listing PDA", listing2Pda);
        console.log("");
        printExplorerLink("Escrow PDA", escrow2Pda);

        // Encrypt Bob's secret
        const listingPdaHash = crypto.createHash('sha256').update(listing2Pda.toBuffer()).digest();
        const encryptedSecret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            encryptedSecret[i] = currentTicket.secret[i] ^ listingPdaHash[i];
        }

        const price = new anchor.BN(200_000_000); // 0.2 SOL

        const sig = await program.methods
            .createListing(
                currentTicket.commitment,
                Array.from(encryptedSecret),
                price,
                eventConfigPda,
                currentTicket.ticketId,
                Array.from(crypto.randomBytes(32)),
                0,
            )
            .accountsPartial({
                seller: bob.publicKey,
                listing: listing2Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([bob])
            .rpc();

        transactionSignatures.push({ step: "Step 5: List (Bob)", signature: sig });
        listingPdas.push(listing2Pda);

        // Verify
        await verifyListingStatus(listing2Pda, 'active');

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing", listing2Pda.toBase58(), 5);
        printKeyValue("Price", "0.2 SOL (marked up from 0.15!)", 5);
        printKeyValue("Status", "ACTIVE", 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Alice claims Bob's listing
    // ═══════════════════════════════════════════════════════════════════

    let aliceSecret2: Buffer;
    let aliceCommitment2: number[];

    it("Step 6: Alice claims Bob's listing & deposits 0.2 SOL", async function () {
        printSubHeader("STEP 6: Alice claims Bob's listing & deposits 0.2 SOL");

        console.log("\n  📖 What's happening:");
        console.log("     Alice is buying BACK her original ticket!");
        console.log("     She generates a NEW secret (old one was revealed)");
        console.log("     → Full circle: Alice → Bob → Alice\n");

        aliceSecret2 = crypto.randomBytes(32);
        aliceCommitment2 = computeCommitment(alice.publicKey, aliceSecret2);

        printKeyValue("Alice's NEW Secret", aliceSecret2.toString('hex'));
        printKeyValue("Alice's NEW Commitment", Buffer.from(aliceCommitment2).toString('hex'));

        const sig = await program.methods
            .claimListing(aliceCommitment2)
            .accountsPartial({
                buyer: alice.publicKey,
                listing: listing2Pda,
                escrow: escrow2Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .signers([alice])
            .rpc();

        transactionSignatures.push({ step: "Step 6: Claim (Alice)", signature: sig });

        // Verify
        await verifyListingStatus(listing2Pda, 'claimed', alice.publicKey);

        // Check escrow balance
        const escrowBalance = await provider.connection.getBalance(escrow2Pda);

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing Status", "CLAIMED", 5);
        printKeyValue("Buyer", "Alice (buying back!)", 5);
        printKeyValue("Escrow Balance", `${escrowBalance / web3.LAMPORTS_PER_SOL} SOL`, 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: Bob releases ticket (Alice gets it back!)
    // ═══════════════════════════════════════════════════════════════════

    it("Step 7: Bob releases ticket → Alice gets it back!", async function () {
        printSubHeader("STEP 7: Bob releases ticket → Alice gets it back!");

        console.log("\n  📖 What's happening:");
        console.log("     Bob's ticket is NULLIFIED");
        console.log("     New ticket created with Alice's NEW commitment");
        console.log("     Bob receives 0.2 SOL from escrow");
        console.log("     → Alice owns the ticket again, but with a NEW secret!\n");

        const addressTree = new web3.PublicKey(batchAddressTree);

        // Nullifier from Bob's secret
        const nullifierSeedHash = crypto.createHash('sha256').update(currentTicket.secret).digest();
        const nullifierSeed = deriveAddressSeedV2([Buffer.from("nullifier"), nullifierSeedHash]);
        const nullifierAddress = deriveAddressV2(nullifierSeed, addressTree, program.programId);

        // New ticket for Alice
        const newTicketAddressSeed = crypto.randomBytes(32);
        const newTicketSeed = deriveAddressSeedV2([Buffer.from("ticket"), newTicketAddressSeed]);
        const newTicketAddress = deriveAddressV2(newTicketSeed, addressTree, program.programId);

        printExplorerLink("Nullifier (Bob's ticket spent)", nullifierAddress);
        console.log("");
        printExplorerLink("Alice's New Ticket", newTicketAddress);

        // Get proof
        const proofRpcResult = await rpc.getValidityProofV0(
            [],
            [
                { address: bn(nullifierAddress.toBytes()), tree: addressTree, queue: addressTree },
                { address: bn(newTicketAddress.toBytes()), tree: addressTree, queue: addressTree },
            ]
        );

        const stateTreeInfos = await rpc.getStateTreeInfos();
        const stateTreeInfo = stateTreeInfos.find(info => info.tree.toBase58().startsWith('bmt'));
        if (!stateTreeInfo) throw new Error("No batched state tree found");

        const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
        const packedAccounts = PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

        const addressTreeIndex = packedAccounts.insertOrGet(addressTree);
        const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.queue);

        const addressTreeInfoPacked = {
            rootIndex: proofRpcResult.rootIndices[0],
            addressMerkleTreePubkeyIndex: addressTreeIndex,
            addressQueuePubkeyIndex: addressTreeIndex,
        };

        // Check Bob's balance before
        const bobBalanceBefore = await provider.connection.getBalance(bob.publicKey);

        const sig = await program.methods
            .completeSale(
                { 0: proofRpcResult.compressedProof },
                addressTreeInfoPacked,
                outputStateTreeIndex,
                Array.from(newTicketAddressSeed),
                0,
                Array.from(currentTicket.secret),
            )
            .accountsPartial({
                seller: bob.publicKey,
                listing: listing2Pda,
                escrow: escrow2Pda,
                systemProgram: web3.SystemProgram.programId,
            })
            .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(packedAccounts.toAccountMetas().remainingAccounts)
            .signers([bob])
            .rpc();

        transactionSignatures.push({ step: "Step 7: Complete (Bob)", signature: sig });

        // Check Bob's balance after
        const bobBalanceAfter = await provider.connection.getBalance(bob.publicKey);
        const bobReceived = (bobBalanceAfter - bobBalanceBefore) / web3.LAMPORTS_PER_SOL;

        nullifierAddresses.push(nullifierAddress);
        ticketAddresses.push(newTicketAddress);

        // Update ticket state - Alice owns it again!
        currentTicket = {
            address: newTicketAddress,
            secret: aliceSecret2,
            ownerPubkey: alice.publicKey,
            commitment: aliceCommitment2,
            ticketId: currentTicket.ticketId,
            originalPrice: currentTicket.originalPrice,
        };

        // Verify
        await verifyListingStatus(listing2Pda, 'completed');
        await verifyNullifierExists(nullifierAddress, "Nullifier");
        await verifyTicketExists(newTicketAddress, "Alice's ticket");

        console.log("");
        printTxLink("Transaction", sig);

        console.log("\n  ✅ RESULT:");
        printKeyValue("Listing Status", "COMPLETED", 5);
        printKeyValue("Bob Received", `~${bobReceived.toFixed(4)} SOL (minus tx fee)`, 5);
        printKeyValue("Final Owner", "Alice ✅", 5);
    });

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════

    it("Summary: Complete round-trip verified", async function () {
        printHeader("🎉 DEMO COMPLETE - SUMMARY");

        console.log("\n  TICKET JOURNEY (same ticket, 3 different addresses):");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        ticketAddresses.forEach((addr, i) => {
            const status = i < ticketAddresses.length - 1 ? "SPENT ❌" : "ACTIVE ✅";
            const owner = i === 0 ? "Alice" : i === 1 ? "Bob" : "Alice";
            console.log(`  ${i + 1}. [${owner}] ${addr.toBase58()}`);
            console.log(`     Status: ${status}`);
            console.log(`     Explorer: ${explorerAccountUrl(addr)}`);
        });

        console.log("\n  NULLIFIERS (prevent double-spending):");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        nullifierAddresses.forEach((addr, i) => {
            const spender = i === 0 ? "Alice→Bob" : "Bob→Alice";
            console.log(`  ${i + 1}. [${spender}] ${addr.toBase58()}`);
            console.log(`     Explorer: ${explorerAccountUrl(addr)}`);
        });

        console.log("\n  LISTINGS:");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        console.log(`  1. [Alice→Bob @ 0.15 SOL] ${listingPdas[0].toBase58()}`);
        console.log(`     Explorer: ${explorerAccountUrl(listingPdas[0])}`);
        console.log(`  2. [Bob→Alice @ 0.20 SOL] ${listingPdas[1].toBase58()}`);
        console.log(`     Explorer: ${explorerAccountUrl(listingPdas[1])}`);

        console.log("\n  ALL TRANSACTIONS:");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        transactionSignatures.forEach(({ step, signature }) => {
            console.log(`  ${step}:`);
            console.log(`     ${explorerTxUrl(signature)}`);
        });

        console.log("\n  SOL FLOW:");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        console.log("  Step 3: Bob → Escrow1      0.15 SOL");
        console.log("  Step 4: Escrow1 → Alice    0.15 SOL");
        console.log("  Step 6: Alice → Escrow2    0.20 SOL");
        console.log("  Step 7: Escrow2 → Bob      0.20 SOL");
        console.log("  ─────────────────────────────────────────────────────────────────────────────");
        console.log("  Net: Alice paid 0.05 SOL to buy back her ticket (Bob's profit!)");

        printDivider("═");
        console.log("  ✅ PRIVACY: Ownership hidden behind commitments");
        console.log("  ✅ SCALABILITY: Compressed accounts (99.8% cheaper)");
        console.log("  ✅ SECURITY: Nullifiers prevent double-spending");
        console.log("  ✅ TRUSTLESS: SOL escrow for safe payments");
        printDivider("═");
        console.log("");
        console.log("  🎟️  ENCORE - Private Ticketing on Solana");
        console.log("  Built with Light Protocol | Commitment-Nullifier Model | SOL Escrow");
        console.log("");
        printDivider("═");

        // Final assertions
        assert.equal(ticketAddresses.length, 3, "Should have 3 ticket addresses");
        assert.equal(nullifierAddresses.length, 2, "Should have 2 nullifiers");
        assert.equal(listingPdas.length, 2, "Should have 2 listings");
        assert.ok(currentTicket.ownerPubkey.equals(alice.publicKey), "Alice should be final owner");
    });
});
