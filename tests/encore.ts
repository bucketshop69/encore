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
  selectStateTreeInfo,
  TreeInfo,
  batchAddressTree,
} from "@lightprotocol/stateless.js";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// Enable V2 feature flag
(featureFlags as any).version = VERSION.V2;

describe("Encore Privacy Tests - Commitment + Nullifier Model", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Encore as Program<Encore>;

  // Load local keypair (event owner / funder)
  const payerKeypairPath = `${os.homedir()}/.config/solana/id.json`;
  const payerKeypair = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(payerKeypairPath, "utf-8")))
  );

  let rpc: Rpc;
  let eventConfigPda: web3.PublicKey;

  // Separate wallets for realistic testing
  let buyer1: web3.Keypair;  // First buyer (mints ticket)
  let buyer2: web3.Keypair;  // Second buyer (buys from buyer1)

  // Store ticket info for transfer test
  let mintedTicketAddress: web3.PublicKey;
  let mintedTicketSecret: Buffer;  // Secret for commitment
  let mintedTicketOwnerPubkey: web3.PublicKey;  // Owner's pubkey
  let mintedTicketId: number;
  let mintedOriginalPrice: anchor.BN;

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
    const sig = await provider.sendAndConfirm(tx, [payerKeypair]);
    console.log(`💰 Funded ${wallet.publicKey.toBase58().slice(0, 8)}... with ${amountSol} SOL`);
    return sig;
  }

  before(async () => {
    // Use Helius devnet RPC with Photon indexer
    rpc = createRpc(
      "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def",
      "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def"
    );

    // Derive event config PDA
    [eventConfigPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("event"), payerKeypair.publicKey.toBuffer()],
      program.programId
    );

    // Create fresh wallets for buyers
    buyer1 = web3.Keypair.generate();
    buyer2 = web3.Keypair.generate();

    console.log("=== Wallet Setup ===");
    console.log("Event Owner (Payer):", payerKeypair.publicKey.toString());
    const balance = await rpc.getBalance(payerKeypair.publicKey);
    console.log("Payer balance:", balance / web3.LAMPORTS_PER_SOL, "SOL");
    console.log("Buyer 1:", buyer1.publicKey.toString());
    console.log("Buyer 2:", buyer2.publicKey.toString());
    console.log("Event config PDA:", eventConfigPda.toString());

    // Fund buyer1 with 0.05 SOL
    await fundWallet(buyer1, 0.05);
    console.log("");
  });

  it("Should create event successfully", async () => {
    const authority = payerKeypair;

    const maxSupply = 1000;
    const resaleCapBps = 15000; // 1.5x
    const maxTicketsPerPerson = 10; // Not enforced in simplified model
    const eventName = "Privacy Test Concert";
    const eventLocation = "Virtual";
    const eventDescription = "Testing privacy-preserving ticketing";
    const eventTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 86400);

    try {
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

      console.log("✅ Event created successfully");
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log("ℹ️ Event already exists, continuing...");
      } else {
        throw e;
      }
    }

    // Verify event exists
    const eventConfig = await program.account.eventConfig.fetch(eventConfigPda);
    assert.ok(eventConfig.authority.equals(authority.publicKey));
    console.log("📊 Current tickets minted:", eventConfig.ticketsMinted);
  });

  it("Should mint ticket with commitment (Buyer 1)", async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("🎫 Buyer 1 purchasing ticket...");
    console.log("Buyer 1 pubkey:", buyer1.publicKey.toString());

    // --- COMMITMENT MODEL ---
    // Generate secret for this ticket (in real app: derive from wallet signature)
    const ticketSecret = crypto.randomBytes(32);
    console.log("Secret (first 8 bytes):", Array.from(ticketSecret.slice(0, 8)));

    // Compute commitment = SHA256(owner_pubkey || secret)
    const ownerCommitment = computeCommitment(buyer1.publicKey, ticketSecret);
    console.log("Owner commitment (first 8 bytes):", ownerCommitment.slice(0, 8));

    // Use batchAddressTree constant for V2
    const addressTree = new web3.PublicKey(batchAddressTree);
    console.log("Address tree:", addressTree.toBase58());

    // Generate random seed for ticket (privacy!)
    const ticketAddressSeed = Array.from(crypto.randomBytes(32));
    console.log("Random ticket seed (first 8 bytes):", ticketAddressSeed.slice(0, 8));

    // Derive ticket address
    const ticketSeed = deriveAddressSeedV2([
      Buffer.from("ticket"),
      Buffer.from(ticketAddressSeed)
    ]);
    const ticketAddress = deriveAddressV2(
      ticketSeed,
      addressTree,
      program.programId
    );
    console.log("Ticket address:", ticketAddress.toBase58());

    // Get validity proof for CREATE (single new address)
    // For batched trees, tree and queue are the same
    const proofRpcResult = await rpc.getValidityProofV0(
      [], // No existing accounts
      [
        {
          address: bn(ticketAddress.toBytes()),
          tree: addressTree,
          queue: addressTree,
        },
      ]
    );

    console.log("Root indices:", proofRpcResult.rootIndices);

    // Get state tree info - need V2 batched tree (bmt*) to match V2 address tree
    const stateTreeInfos = await rpc.getStateTreeInfos();
    console.log("State tree infos count:", stateTreeInfos.length);

    // Find a batched state tree (bmt*) for V2 compatibility
    let stateTreeInfo = stateTreeInfos.find(info =>
      info.tree.toBase58().startsWith('bmt')
    );

    if (!stateTreeInfo) {
      throw new Error("No batched state tree (bmt*) found - required for V2 address tree");
    }
    console.log("Selected batched state tree:", stateTreeInfo.tree.toBase58());

    const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
    const packedAccounts = PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

    // For batched trees, tree and queue use the same index
    const addressTreeIndex = packedAccounts.insertOrGet(addressTree);
    const addressQueueIndex = addressTreeIndex;

    const addressTreeInfoPacked = {
      rootIndex: proofRpcResult.rootIndices[0],
      addressMerkleTreePubkeyIndex: addressTreeIndex,
      addressQueuePubkeyIndex: addressQueueIndex,
    };
    const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.queue);

    const purchasePrice = new anchor.BN(1_000_000_000); // 1 SOL

    const proof = { 0: proofRpcResult.compressedProof };
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000,
    });

    // Mint ticket with commitment (not pubkey!)
    await program.methods
      .mintTicket(
        proof,
        addressTreeInfoPacked,
        outputStateTreeIndex,
        ownerCommitment,  // [u8; 32] commitment instead of Pubkey
        purchasePrice,
        ticketAddressSeed,
      )
      .accounts({
        buyer: buyer1.publicKey,
        eventOwner: payerKeypair.publicKey,
        eventConfig: eventConfigPda,
      })
      .preInstructions([computeBudgetIx])
      .remainingAccounts(remainingAccounts)
      .signers([buyer1])
      .rpc();

    console.log("✅ Ticket minted successfully!");
    console.log("   Signer (buyer): ", buyer1.publicKey.toBase58());

    // Wait for indexer
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify ticket was created
    const ticketAccount = await rpc.getCompressedAccount(
      bn(ticketAddress.toBytes())
    );
    assert.ok(ticketAccount, "Ticket should exist");
    console.log("✅ Ticket verified at address:", ticketAddress.toBase58());

    // Store for transfer test
    mintedTicketAddress = ticketAddress;
    mintedTicketSecret = ticketSecret;
    mintedTicketOwnerPubkey = buyer1.publicKey;

    // Get ticket ID from event config
    const eventConfig = await program.account.eventConfig.fetch(eventConfigPda);
    mintedTicketId = eventConfig.ticketsMinted;
    mintedOriginalPrice = purchasePrice;

    console.log("📊 Ticket ID:", mintedTicketId);
    console.log("🔐 Secret stored for transfer test");
    console.log("👤 Ticket owner: Buyer 1");
  });

  it("Should transfer ticket (Commitment + Nullifier)", async function () {
    if (!mintedTicketAddress || !mintedTicketSecret) {
      console.log("⏭️ Skipping - no minted ticket from previous test");
      this.skip();
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("🔄 Transferring ticket using Nullifier pattern...");
    console.log("Seller pubkey:", mintedTicketOwnerPubkey.toString());
    console.log("Ticket ID:", mintedTicketId);

    // Fund buyer2 for this transaction
    await fundWallet(buyer2, 0.05);
    console.log("💰 Buyer 2 funded:", buyer2.publicKey.toBase58());

    const seller = buyer1;  // buyer1 is the current owner

    // --- Buyer 2 Setup ---
    // buyer2 is a fresh wallet who will buy from buyer1
    const buyerSecret = crypto.randomBytes(32);
    const buyerCommitment = computeCommitment(buyer2.publicKey, buyerSecret);
    console.log("Buyer 2 commitment (first 8):", buyerCommitment.slice(0, 8));

    // --- Nullifier Setup ---
    // nullifier_address = derive(["nullifier", hash(seller_secret)])
    const sellerSecretArray = Array.from(mintedTicketSecret);

    // Compute hash of secret for nullifier seed (matches Rust: hash(&seller_secret))
    const nullifierSeedHash = crypto.createHash('sha256').update(mintedTicketSecret).digest();
    console.log("Nullifier seed hash (first 8):", Array.from(nullifierSeedHash.slice(0, 8)));

    // Derive nullifier address
    const addressTree = new web3.PublicKey(batchAddressTree);
    const nullifierPrefix = Buffer.from("nullifier");
    const nullifierSeed = deriveAddressSeedV2([nullifierPrefix, nullifierSeedHash]);
    const nullifierAddress = deriveAddressV2(nullifierSeed, addressTree, program.programId);
    console.log("Nullifier address:", nullifierAddress.toBase58());

    // --- New Ticket Setup ---
    const newTicketAddressSeed = crypto.randomBytes(32);
    const newTicketSeed = deriveAddressSeedV2([
      Buffer.from("ticket"),
      newTicketAddressSeed
    ]);
    const newTicketAddress = deriveAddressV2(newTicketSeed, addressTree, program.programId);
    console.log("New ticket address:", newTicketAddress.toBase58());

    // --- Get Validity Proof for TWO new addresses ---
    const proofRpcResult = await rpc.getValidityProofV0(
      [],  // No existing accounts (we're only CREATing)
      [
        {
          address: bn(nullifierAddress.toBytes()),
          tree: addressTree,
          queue: addressTree,
        },
        {
          address: bn(newTicketAddress.toBytes()),
          tree: addressTree,
          queue: addressTree,
        },
      ]
    );
    console.log("Proof root indices:", proofRpcResult.rootIndices);

    // --- Build accounts ---
    const stateTreeInfos = await rpc.getStateTreeInfos();
    let stateTreeInfo = stateTreeInfos.find(info =>
      info.tree.toBase58().startsWith('bmt')
    );
    if (!stateTreeInfo) {
      throw new Error("No batched state tree found");
    }
    console.log("State tree:", stateTreeInfo.tree.toBase58());
    console.log("State tree queue:", stateTreeInfo.queue.toBase58());

    const systemAccountConfig = SystemAccountMetaConfig.new(program.programId);
    const packedAccounts = PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

    // Match mint order: address tree first, then state tree queue
    const addressTreeIndex = packedAccounts.insertOrGet(addressTree);
    const addressQueueIndex = addressTreeIndex;  // For V2 batch, queue = tree
    const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.queue);

    const addressTreeInfoPacked = {
      rootIndex: proofRpcResult.rootIndices[0],
      addressMerkleTreePubkeyIndex: addressTreeIndex,
      addressQueuePubkeyIndex: addressQueueIndex,
    };

    const proof = { 0: proofRpcResult.compressedProof };
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    const computeBudgetIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000,
    });

    // Convert BN to number for u64 (safe for this value)
    const originalPriceU64 = new anchor.BN(mintedOriginalPrice);

    await program.methods
      .transferTicket(
        proof,
        addressTreeInfoPacked,
        outputStateTreeIndex,
        mintedTicketId,                           // current_ticket_id (u32)
        originalPriceU64,                         // current_original_price (u64)
        sellerSecretArray,                        // seller_secret [u8; 32]
        buyerCommitment,                          // new_owner_commitment [u8; 32]
        Array.from(newTicketAddressSeed),         // new_ticket_address_seed [u8; 32]
        null,                                     // resale_price Option<u64>
      )
      .accounts({
        seller: buyer1.publicKey,  // buyer1 is selling
        eventOwner: payerKeypair.publicKey,
        eventConfig: eventConfigPda,
      })
      .preInstructions([computeBudgetIx])
      .remainingAccounts(remainingAccounts)
      .signers([buyer1])  // buyer1 signs as seller
      .rpc();

    console.log("✅ Ticket transferred successfully!");
    console.log("   Signer (seller):", buyer1.publicKey.toBase58());
    console.log("   New owner:      ", buyer2.publicKey.toBase58());

    // Wait for indexer
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify nullifier was created (prevents double-spend)
    const nullifierAccount = await rpc.getCompressedAccount(
      bn(nullifierAddress.toBytes())
    );
    assert.ok(nullifierAccount, "Nullifier should exist");
    console.log("✅ Nullifier created at:", nullifierAddress.toBase58());

    // Verify new ticket was created with buyer's commitment
    const newTicketAccount = await rpc.getCompressedAccount(
      bn(newTicketAddress.toBytes())
    );
    assert.ok(newTicketAccount, "New ticket should exist");
    console.log("✅ New ticket created at:", newTicketAddress.toBase58());

    // Update stored values for potential next transfer
    mintedTicketAddress = newTicketAddress;
    mintedTicketSecret = buyerSecret;
    mintedTicketOwnerPubkey = buyer2.publicKey;

    console.log("🎉 Transfer complete! Buyer 2 now owns ticket with hidden identity.");
  });
});
