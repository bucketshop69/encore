/**
 * Marketplace Round-Trip Test
 * 
 * Tests the complete flow of a ticket being sold twice:
 * Alice → Bob → Alice
 * 
 * Verifies:
 * - Ticket minting with commitment
 * - Marketplace listing/claim/release
 * - Nullifier creation (prevents double-spend)
 * - Ticket address changes each transfer
 * - Same ticket can be resold multiple times
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

describe("Marketplace Round-Trip: Alice → Bob → Alice", () => {
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

    // Helper: compute commitment = SHA256(pubkey || secret)
    function computeCommitment(pubkey: web3.PublicKey, secret: Buffer): number[] {
        const data = Buffer.concat([pubkey.toBuffer(), secret]);
        const hash = crypto.createHash('sha256').update(data).digest();
        return Array.from(hash);
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
        await provider.sendAndConfirm(tx, [payerKeypair]);
        console.log(`   💰 Funded ${wallet.publicKey.toBase58().slice(0, 8)}... with ${amountSol} SOL`);
    }

    // Helper: verify ticket exists on-chain
    async function verifyTicketExists(ticketAddress: web3.PublicKey, description: string) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const account = await rpc.getCompressedAccount(bn(ticketAddress.toBytes()));
        assert.ok(account, `${description} - Ticket should exist at ${ticketAddress.toBase58()}`);
        console.log(`   ✅ ${description}: ${ticketAddress.toBase58().slice(0, 12)}...`);
        return account;
    }

    // Helper: verify nullifier exists (ticket spent)
    async function verifyNullifierExists(nullifierAddress: web3.PublicKey, description: string) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const account = await rpc.getCompressedAccount(bn(nullifierAddress.toBytes()));
        assert.ok(account, `${description} - Nullifier should exist`);
        console.log(`   🔒 ${description}: ${nullifierAddress.toBase58().slice(0, 12)}...`);
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

        console.log(`   📋 Listing status: ${statusKey}${expectedBuyer ? `, buyer: ${expectedBuyer.toBase58().slice(0, 8)}...` : ''}`);
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

        console.log("\n╔════════════════════════════════════════════════════════════╗");
        console.log("║     MARKETPLACE ROUND-TRIP TEST: Alice → Bob → Alice       ║");
        console.log("╠════════════════════════════════════════════════════════════╣");
        console.log(`║ Alice: ${alice.publicKey.toBase58().slice(0, 20)}...                   ║`);
        console.log(`║ Bob:   ${bob.publicKey.toBase58().slice(0, 20)}...                   ║`);
        console.log("╚════════════════════════════════════════════════════════════╝\n");

        // Fund both wallets
        await fundWallet(alice, 0.2);
        await fundWallet(bob, 0.2);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Alice mints a ticket
    // ═══════════════════════════════════════════════════════════════════

    it("Step 1: Alice mints ticket", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 1: Alice mints ticket              │");
        console.log("└─────────────────────────────────────────┘");

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate Alice's secret and commitment
        const aliceSecret = crypto.randomBytes(32);
        const aliceCommitment = computeCommitment(alice.publicKey, aliceSecret);

        console.log(`   🔑 Alice's secret: ${aliceSecret.slice(0, 4).toString('hex')}...`);
        console.log(`   🔐 Alice's commitment: ${Buffer.from(aliceCommitment).slice(0, 4).toString('hex')}...`);

        const addressTree = new web3.PublicKey(batchAddressTree);
        const ticketAddressSeed = crypto.randomBytes(32);

        const ticketSeed = deriveAddressSeedV2([
            Buffer.from("ticket"),
            ticketAddressSeed
        ]);
        const ticketAddress = deriveAddressV2(ticketSeed, addressTree, program.programId);

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

        await program.methods
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

        console.log(`\n   📊 TICKET STATE AFTER STEP 1:`);
        console.log(`      Ticket ID: #${ticketId}`);
        console.log(`      Address: ${ticketAddress.toBase58()}`);
        console.log(`      Owner: Alice ✅`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Alice creates listing
    // ═══════════════════════════════════════════════════════════════════

    let listing1Pda: web3.PublicKey;

    it("Step 2: Alice creates listing", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 2: Alice creates listing           │");
        console.log("└─────────────────────────────────────────┘");

        const ticketCommitmentBuffer = Buffer.from(currentTicket.commitment);
        [listing1Pda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("listing"), alice.publicKey.toBuffer(), ticketCommitmentBuffer],
            program.programId
        );

        // Encrypt secret
        const listingPdaHash = crypto.createHash('sha256').update(listing1Pda.toBuffer()).digest();
        const encryptedSecret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            encryptedSecret[i] = currentTicket.secret[i] ^ listingPdaHash[i];
        }

        const price = new anchor.BN(150_000_000); // 0.15 SOL

        await program.methods
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

        listingPdas.push(listing1Pda);

        // Verify
        await verifyListingStatus(listing1Pda, 'active');

        console.log(`\n   📊 LISTING STATE:`);
        console.log(`      Listing PDA: ${listing1Pda.toBase58().slice(0, 20)}...`);
        console.log(`      Seller: Alice`);
        console.log(`      Price: 0.15 SOL`);
        console.log(`      Status: Active ✅`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: Bob claims listing
    // ═══════════════════════════════════════════════════════════════════

    let bobSecret: Buffer;
    let bobCommitment: number[];

    it("Step 3: Bob claims listing", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 3: Bob claims listing              │");
        console.log("└─────────────────────────────────────────┘");

        bobSecret = crypto.randomBytes(32);
        bobCommitment = computeCommitment(bob.publicKey, bobSecret);

        console.log(`   🔑 Bob's secret: ${bobSecret.slice(0, 4).toString('hex')}...`);
        console.log(`   🔐 Bob's commitment: ${Buffer.from(bobCommitment).slice(0, 4).toString('hex')}...`);

        await program.methods
            .claimListing(bobCommitment)
            .accountsPartial({
                buyer: bob.publicKey,
                listing: listing1Pda,
            })
            .signers([bob])
            .rpc();

        // Verify
        await verifyListingStatus(listing1Pda, 'claimed', bob.publicKey);

        console.log(`\n   📊 LISTING STATE:`);
        console.log(`      Status: Claimed ✅`);
        console.log(`      Buyer: Bob`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Alice releases ticket (completes sale)
    // ═══════════════════════════════════════════════════════════════════

    it("Step 4: Alice releases ticket to Bob", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 4: Alice releases ticket to Bob    │");
        console.log("└─────────────────────────────────────────┘");

        const addressTree = new web3.PublicKey(batchAddressTree);

        // Nullifier from Alice's secret
        const nullifierSeedHash = crypto.createHash('sha256').update(currentTicket.secret).digest();
        const nullifierSeed = deriveAddressSeedV2([Buffer.from("nullifier"), nullifierSeedHash]);
        const nullifierAddress = deriveAddressV2(nullifierSeed, addressTree, program.programId);

        // New ticket for Bob
        const newTicketAddressSeed = crypto.randomBytes(32);
        const newTicketSeed = deriveAddressSeedV2([Buffer.from("ticket"), newTicketAddressSeed]);
        const newTicketAddress = deriveAddressV2(newTicketSeed, addressTree, program.programId);

        console.log(`   🔄 Creating nullifier for Alice's old ticket...`);
        console.log(`   🎫 Creating new ticket for Bob...`);

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

        await program.methods
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
            })
            .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(packedAccounts.toAccountMetas().remainingAccounts)
            .signers([alice])
            .rpc();

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
        await verifyNullifierExists(nullifierAddress, "Nullifier (Alice's ticket spent)");
        await verifyTicketExists(newTicketAddress, "Bob's new ticket");

        console.log(`\n   📊 TICKET STATE AFTER STEP 4:`);
        console.log(`      Old Address: ${ticketAddresses[0].toBase58().slice(0, 16)}... [SPENT ❌]`);
        console.log(`      New Address: ${newTicketAddress.toBase58().slice(0, 16)}...`);
        console.log(`      Owner: Bob ✅`);
        console.log(`      Nullifier: Created (prevents double-spend)`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Bob creates listing (same ticket!)
    // ═══════════════════════════════════════════════════════════════════

    let listing2Pda: web3.PublicKey;

    it("Step 5: Bob creates listing (reselling same ticket)", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 5: Bob creates listing (resale!)   │");
        console.log("└─────────────────────────────────────────┘");

        await new Promise(resolve => setTimeout(resolve, 2000));

        const ticketCommitmentBuffer = Buffer.from(currentTicket.commitment);
        [listing2Pda] = web3.PublicKey.findProgramAddressSync(
            [Buffer.from("listing"), bob.publicKey.toBuffer(), ticketCommitmentBuffer],
            program.programId
        );

        // Encrypt Bob's secret
        const listingPdaHash = crypto.createHash('sha256').update(listing2Pda.toBuffer()).digest();
        const encryptedSecret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            encryptedSecret[i] = currentTicket.secret[i] ^ listingPdaHash[i];
        }

        const price = new anchor.BN(200_000_000); // 0.2 SOL (Bob's markup!)

        await program.methods
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

        listingPdas.push(listing2Pda);

        // Verify
        await verifyListingStatus(listing2Pda, 'active');

        console.log(`\n   📊 LISTING STATE:`);
        console.log(`      Listing PDA: ${listing2Pda.toBase58().slice(0, 20)}...`);
        console.log(`      Seller: Bob`);
        console.log(`      Price: 0.2 SOL (marked up from 0.15!)`);
        console.log(`      Status: Active ✅`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Alice claims Bob's listing
    // ═══════════════════════════════════════════════════════════════════

    let aliceSecret2: Buffer;
    let aliceCommitment2: number[];

    it("Step 6: Alice claims Bob's listing", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 6: Alice claims Bob's listing      │");
        console.log("└─────────────────────────────────────────┘");

        // Alice generates new secret for receiving the ticket back
        aliceSecret2 = crypto.randomBytes(32);
        aliceCommitment2 = computeCommitment(alice.publicKey, aliceSecret2);

        console.log(`   🔑 Alice's new secret: ${aliceSecret2.slice(0, 4).toString('hex')}...`);
        console.log(`   🔐 Alice's new commitment: ${Buffer.from(aliceCommitment2).slice(0, 4).toString('hex')}...`);

        await program.methods
            .claimListing(aliceCommitment2)
            .accountsPartial({
                buyer: alice.publicKey,
                listing: listing2Pda,
            })
            .signers([alice])
            .rpc();

        // Verify
        await verifyListingStatus(listing2Pda, 'claimed', alice.publicKey);

        console.log(`\n   📊 LISTING STATE:`);
        console.log(`      Status: Claimed ✅`);
        console.log(`      Buyer: Alice (buying back her original ticket!)`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // STEP 7: Bob releases ticket (Alice gets it back!)
    // ═══════════════════════════════════════════════════════════════════

    it("Step 7: Bob releases ticket to Alice", async function () {
        console.log("\n┌─────────────────────────────────────────┐");
        console.log("│ STEP 7: Bob releases ticket to Alice    │");
        console.log("└─────────────────────────────────────────┘");

        const addressTree = new web3.PublicKey(batchAddressTree);

        // Nullifier from Bob's secret
        const nullifierSeedHash = crypto.createHash('sha256').update(currentTicket.secret).digest();
        const nullifierSeed = deriveAddressSeedV2([Buffer.from("nullifier"), nullifierSeedHash]);
        const nullifierAddress = deriveAddressV2(nullifierSeed, addressTree, program.programId);

        // New ticket for Alice
        const newTicketAddressSeed = crypto.randomBytes(32);
        const newTicketSeed = deriveAddressSeedV2([Buffer.from("ticket"), newTicketAddressSeed]);
        const newTicketAddress = deriveAddressV2(newTicketSeed, addressTree, program.programId);

        console.log(`   🔄 Creating nullifier for Bob's ticket...`);
        console.log(`   🎫 Creating new ticket for Alice...`);

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

        await program.methods
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
            })
            .preInstructions([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
            .remainingAccounts(packedAccounts.toAccountMetas().remainingAccounts)
            .signers([bob])
            .rpc();

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
        await verifyNullifierExists(nullifierAddress, "Nullifier (Bob's ticket spent)");
        await verifyTicketExists(newTicketAddress, "Alice's new ticket");

        console.log(`\n   📊 TICKET STATE AFTER STEP 7:`);
        console.log(`      Old Address: ${ticketAddresses[1].toBase58().slice(0, 16)}... [SPENT ❌]`);
        console.log(`      New Address: ${newTicketAddress.toBase58().slice(0, 16)}...`);
        console.log(`      Owner: Alice ✅ (BACK TO ORIGINAL OWNER!)`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════════

    it("Summary: Verify complete round-trip", async function () {
        console.log("\n╔════════════════════════════════════════════════════════════╗");
        console.log("║              ROUND-TRIP TEST SUMMARY                       ║");
        console.log("╠════════════════════════════════════════════════════════════╣");

        console.log("║ TICKET JOURNEY:                                            ║");
        console.log(`║   Address 1: ${ticketAddresses[0].toBase58().slice(0, 20)}... [SPENT]      ║`);
        console.log(`║   Address 2: ${ticketAddresses[1].toBase58().slice(0, 20)}... [SPENT]      ║`);
        console.log(`║   Address 3: ${ticketAddresses[2].toBase58().slice(0, 20)}... [ACTIVE]     ║`);

        console.log("║                                                            ║");
        console.log("║ NULLIFIERS (prevent double-spend):                         ║");
        console.log(`║   N1: ${nullifierAddresses[0].toBase58().slice(0, 24)}...          ║`);
        console.log(`║   N2: ${nullifierAddresses[1].toBase58().slice(0, 24)}...          ║`);

        console.log("║                                                            ║");
        console.log("║ LISTINGS:                                                  ║");
        console.log(`║   L1 (Alice→Bob): ${listingPdas[0].toBase58().slice(0, 16)}... [COMPLETED]  ║`);
        console.log(`║   L2 (Bob→Alice): ${listingPdas[1].toBase58().slice(0, 16)}... [COMPLETED]  ║`);

        console.log("║                                                            ║");
        console.log("║ OWNERSHIP HISTORY:                                         ║");
        console.log("║   Step 1: Alice minted ticket                              ║");
        console.log("║   Step 4: Alice → Bob (sold)                               ║");
        console.log("║   Step 7: Bob → Alice (resold back!)                       ║");

        console.log("║                                                            ║");
        console.log("║ ✅ FINAL OWNER: Alice (with NEW secret & commitment)       ║");
        console.log("╚════════════════════════════════════════════════════════════╝");

        // Final assertions
        assert.equal(ticketAddresses.length, 3, "Should have 3 ticket addresses");
        assert.equal(nullifierAddresses.length, 2, "Should have 2 nullifiers");
        assert.equal(listingPdas.length, 2, "Should have 2 listings");
        assert.ok(currentTicket.ownerPubkey.equals(alice.publicKey), "Alice should be final owner");

        console.log("\n🎉 ROUND-TRIP TEST PASSED! Ticket successfully traded twice.");
    });
});
