import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Encore } from "../target/types/encore";
import {
  bn,
  confirmTx,
  createRpc,
  PackedAccounts,
  Rpc,
  SystemAccountMetaConfig,
  deriveAddressV2,
  deriveAddressSeedV2,
  featureFlags,
  VERSION,
  getDefaultAddressTreeInfo,
  defaultTestStateTreeAccounts,
  batchAddressTree,
} from "@lightprotocol/stateless.js";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// Enable V2 feature flag
featureFlags.version = VERSION.V2;

describe("Encore Privacy Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Encore as Program<Encore>;
  const connection = provider.connection;

  // Load local keypair with more SOL
  const payerKeypairPath = `${os.homedir()}/.config/solana/id.json`;
  const payerKeypair = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(payerKeypairPath, "utf-8")))
  );

  let rpc: Rpc;

  before(async () => {
    // Use Helius devnet RPC with Photon indexer (needs 2 URLs for compression)
    rpc = createRpc(
      "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def",
      "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def"
    );
    // Verify payer wallet and balance
    console.log("Payer pubkey:", payerKeypair.publicKey.toString());
    const balance = await connection.getBalance(payerKeypair.publicKey);
    console.log("Payer balance:", balance / web3.LAMPORTS_PER_SOL, "SOL");
  });

  it.skip("Should create event successfully", async () => {
    // Use payer keypair as authority (save SOL, no funding needed)
    const authority = payerKeypair;

    // Derive event config PDA
    const [eventConfigPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("event"), authority.publicKey.toBuffer()],
      program.programId
    );

    // Create event
    const maxSupply = 1000;
    const resaleCapBps = 15000; // 1.5x
    const maxTicketsPerPerson = 2;
    const eventName = "Privacy Test Concert";
    const eventLocation = "Virtual";
    const eventDescription = "Testing privacy-preserving ticketing";
    const eventTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);

    await program.methods
      .createEvent(
        maxSupply,
        resaleCapBps,
        eventName,
        eventLocation,
        eventDescription,
        maxTicketsPerPerson,
        eventTimestamp
      )
      .accounts({
        authority: authority.publicKey,
        eventConfig: eventConfigPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    // Verify event was created
    const eventConfig = await program.account.eventConfig.fetch(eventConfigPda);
    assert.ok(eventConfig.authority.equals(authority.publicKey));
    assert.equal(eventConfig.maxSupply, maxSupply);
    assert.equal(eventConfig.ticketsMinted, 0);
    assert.equal(eventConfig.maxTicketsPerPerson, maxTicketsPerPerson);
    assert.equal(eventConfig.eventName, eventName);

    console.log("✅ Event created successfully");
  });

  it("Should mint ticket with identity counter", async () => {
    // Wait to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 5000));

    // OPTION 1: Use NEW WALLET for fresh test (first mint scenario)
    const authority = web3.Keypair.generate();
    // Transfer 0.1 SOL from payer to new wallet (avoids airdrop rate limits)
    const transferTx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: authority.publicKey,
        lamports: 0.1 * web3.LAMPORTS_PER_SOL,
      })
    );
    await web3.sendAndConfirmTransaction(connection, transferTx, [payerKeypair]);
    console.log("🆕 Testing with NEW wallet:", authority.publicKey.toString());

    // OPTION 2: Use EXISTING WALLET (tests subsequent mint scenario)
    // const authority = payerKeypair;

    // Use EXISTING event from payer wallet
    const [eventConfigPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("event"), payerKeypair.publicKey.toBuffer()],
      program.programId
    );
    console.log("Using existing event from payer:", payerKeypair.publicKey.toString());

    // Use V2 address tree explicitly
    const addressTree = new web3.PublicKey(batchAddressTree);
    const addressTreeInfo = {
      tree: addressTree,
      queue: addressTree,
    };

    // Generate random seed for ticket (privacy!)
    // Each ticket should have a unique random address
    const ticketAddressSeed = Array.from(crypto.randomBytes(32));
    console.log("Random ticket seed (first 8 bytes):", ticketAddressSeed.slice(0, 8));

    // Derive ticket address from random seed (MUST match Rust: [TICKET_SEED, random_seed])
    const ticketSeed = deriveAddressSeedV2([
      Buffer.from("ticket"),
      Buffer.from(ticketAddressSeed)
    ]);
    console.log("Ticket seed (first 8 bytes):", Array.from(ticketSeed).slice(0, 8));
    const ticketAddress = deriveAddressV2(
      ticketSeed,
      addressTree,
      program.programId
    );
    console.log("Ticket address:", ticketAddress.toBase58());

    //Derive identity counter address (deterministic)
    // Use NEW wallet (buyer) - each buyer has their own identity counter per event
    const identityCounterSeed = deriveAddressSeedV2([
      Buffer.from("identity_counter"),
      eventConfigPda.toBuffer(),
      authority.publicKey.toBuffer(),  // Buyer's address
    ]);
    console.log("Identity seed (first 8 bytes):", Array.from(identityCounterSeed).slice(0, 8));
    const identityCounterAddress = deriveAddressV2(
      identityCounterSeed,
      addressTree,
      program.programId
    );
    console.log("Identity address:", identityCounterAddress.toBase58());

    // Get validity proof for FIRST MINT (both accounts are new)
    const proofRpcResult = await rpc.getValidityProofV0(
      [], // No existing accounts
      [
        {
          address: bn(identityCounterAddress.toBytes()),
          tree: addressTree,
          queue: addressTree,
        },
        {
          address: bn(ticketAddress.toBytes()),
          tree: addressTree,
          queue: addressTree,
        },
      ] // Both identity and ticket are new
    );

    console.log("\\nRust will call:");
    console.log("  .with_light_account(identity_counter) <- maps to proof[0]");
    console.log("  .with_light_account(ticket)           <- maps to proof[1]");
    console.log("  .with_new_addresses([identity_params, ticket_params])");
    console.log("===========================\\n");

    // Pack accounts
    const config = SystemAccountMetaConfig.new(program.programId);
    const packedAccounts = PackedAccounts.newWithSystemAccountsV2(config);

    // Pack address tree
    const addressTreeIndex = packedAccounts.insertOrGet(addressTreeInfo.tree);
    const addressQueueIndex = packedAccounts.insertOrGet(addressTreeInfo.queue);

    // Debug: Log proof details
    console.log("Root indices:", proofRpcResult.rootIndices);

    // Build address tree info for both new accounts
    const identityAddressTreeInfo = {
      rootIndex: proofRpcResult.rootIndices[0], // First address in proof
      addressMerkleTreePubkeyIndex: addressTreeIndex,
      addressQueuePubkeyIndex: addressQueueIndex,
    };
    const ticketAddressTreeInfo = {
      rootIndex: proofRpcResult.rootIndices[1], // Second address in proof
      addressMerkleTreePubkeyIndex: addressTreeIndex,
      addressQueuePubkeyIndex: addressQueueIndex,
    };

    // Use default state tree for devnet (v0.22.0)
    const defaultTrees = defaultTestStateTreeAccounts();
    const stateTree = new web3.PublicKey(defaultTrees.merkleTree);
    const outputStateTreeIndex = packedAccounts.insertOrGet(stateTree);

    // Create ticket owner (ephemeral keypair for privacy)
    const ticketOwner = web3.Keypair.generate();
    const purchasePrice = new anchor.BN(1_000_000_000); // 1 SOL

    const proof = {
      0: proofRpcResult.compressedProof,
    };

    // Mint ticket
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    // Increase compute budget for ZK compression operations
    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000,
    });

    await program.methods
      .mintTicket(
        proof,
        identityAddressTreeInfo,
        ticketAddressTreeInfo,
        outputStateTreeIndex,
        ticketOwner.publicKey,
        purchasePrice,
        ticketAddressSeed,
        null,
        null
      )
      .accounts({
        buyer: authority.publicKey,  // New user buying the ticket
        eventOwner: payerKeypair.publicKey,  // Payer owns the event
        eventConfig: eventConfigPda,
      })
      .preInstructions([computeBudgetIx])
      .remainingAccounts(remainingAccounts)
      .signers([authority])  // Buyer signs the transaction
      .rpc();

    console.log("✅ First ticket minted successfully");

    // Verify identity counter was created
    const identityAccount = await rpc.getCompressedAccount(
      bn(identityCounterAddress.toBytes())
    );
    assert.ok(identityAccount, "Identity counter should exist");

    // Verify ticket was created
    const ticketAccount = await rpc.getCompressedAccount(
      bn(ticketAddress.toBytes())
    );
    assert.ok(ticketAccount, "Ticket should exist");

    console.log("✅ Identity counter and ticket verified");
  });
});

