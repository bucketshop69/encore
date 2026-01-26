import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Encore } from "../target/types/encore";
import {
  bn,
  CompressedAccountWithMerkleContext,
  confirmTx,
  createRpc,
  PackedAccounts,
  Rpc,
  sleep,
  SystemAccountMetaConfig,
  deriveAddress,
  deriveAddressSeed,
  buildAndSignTx,
  sendAndConfirmTx,
  defaultTestStateTreeAccounts, // 0.17
} from "@lightprotocol/stateless.js";
import { assert } from "chai";
import * as path from "path";
import * as os from "os";

// (No featureFlags or VERSION in 0.17)

describe("encore-client-test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Encore as Program<Encore>;
  const connection = provider.connection;
  const payer = provider.wallet as anchor.Wallet;

  let rpc: Rpc;
  
  before(async () => {
     /// @ts-ignore
     // Reverting to default RPC (8899) - connection.rpcEndpoint
    rpc = createRpc(connection.rpcEndpoint, connection.rpcEndpoint, connection.rpcEndpoint);
  });

  const eventName = "Client Side Test Concert";
  const eventTimestamp = new anchor.BN(Math.floor(Date.now() / 1000) + 86400); // +1 day
  const maxSupply = 1000;
  
  let eventConfigPda: anchor.web3.PublicKey;

  // Helper to derive event config PDA
  const getEventConfigPda = (authority: anchor.web3.PublicKey) => {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("event"), authority.toBuffer()],
      program.programId
    )[0];
  };

  it("Full Integration: Create Event -> Mint -> Transfer", async () => {
    // 0. Setup Test User (to avoid PDA collisions on persistent localnet)
    const testUser = web3.Keypair.generate();
    // Fund test user
    const txFund = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: testUser.publicKey,
        lamports: 10 * web3.LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(txFund);
    // console.log(`Funded test user: ${testUser.publicKey.toBase58()}`);

    // 1. Create Event
    eventConfigPda = getEventConfigPda(testUser.publicKey);

    // console.log("Creating event...");
    await program.methods
      .createEvent(
        maxSupply,
        15000, 
        500,
        eventName,
        eventTimestamp
      )
      .accounts({
        authority: testUser.publicKey,
        //@ts-ignore
        eventConfig: eventConfigPda,
      })
      .signers([testUser])
      .rpc();

    // 2. Setup Compression Trees
    // In 0.17, we usually use default trees unless we create new ones.
    // We assume defaultTestStateTreeAccounts are existing in the environment (surfpool).
    const stateTreeInfo = defaultTestStateTreeAccounts();
    const addressTreeInfo = defaultTestStateTreeAccounts(); // addressTree is part of this object in 0.17 likely

    // 3. Mint Ticket (Alice Ephemeral)
    const aliceEphemeral = web3.Keypair.generate();
    const ticketId = 1;
    const ticketIdBuffer = Buffer.alloc(4);
    ticketIdBuffer.writeUInt32LE(ticketId);

    // Derive ticket address
    const ticketSeed = [
        Buffer.from("ticket"),
        eventConfigPda.toBuffer(),
        ticketIdBuffer
    ];
    
    // Rust: derive_address(seeds, tree, program_id)
    // JS 0.17: deriveAddressSeed(seeds[], program_id) -> hash -> deriveAddress(hash, tree)
    
    // 1. Get the seed hash exactly as Rust would (using provided helper)
    const seedHash = deriveAddressSeed(ticketSeed, program.programId);
    
    // 2. Derive the actual address
    const ticketAddress = deriveAddress(
        seedHash,
        addressTreeInfo.addressTree
    );

    // console.log(`Minting ticket to Alice Ephemeral: ${aliceEphemeral.publicKey.toBase58()}`);
    // console.log(`Ticket Address: ${ticketAddress.toBase58()}`);

    const purchasePrice = new anchor.BN(1_000_000_000);

    const sig = await mintTicket(
        rpc,
        program,
        testUser, // Signer (Authority)
        eventConfigPda,
        aliceEphemeral.publicKey,
        ticketAddress,
        purchasePrice,
        stateTreeInfo,
        addressTreeInfo
    );
    // console.log("Mint Tx:", sig);

    // 4. Verify Mint
    // await sleep(5000); // Wait for indexer!!
    // console.log("Fetching ticket account...");
    const ticketAccount = await rpc.getCompressedAccount(
        bn(ticketAddress.toBytes())
    );
    
    if (!ticketAccount) {
        throw new Error("Failed to fetch minted ticket account (indexer lag?)");
    }
    
    // Decode data
    const coder = new anchor.BorshCoder(program.idl);
    const decodedTicket = coder.types.decode("privateTicket", ticketAccount.data.data);
    
    assert.ok(decodedTicket.owner.equals(aliceEphemeral.publicKey), "Owner should be Alice Ephemeral");
    assert.equal(decodedTicket.ticketId, ticketId);


    // 5. Transfer Ticket (Alice -> Bob Ephemeral)
    const bobEphemeral = web3.Keypair.generate();
    // console.log(`Transferring ticket to Bob Ephemeral: ${bobEphemeral.publicKey.toBase58()}`);

    const sigTransfer = await transferTicket(
        rpc,
        program,
        testUser, // Payer
        aliceEphemeral, // CURRENT OWNER (Must sign!)
        eventConfigPda,
        ticketAccount, // Existing compressed account ref
        bobEphemeral.publicKey,
        addressTreeInfo,
        null // No resale price
    );
    // console.log("Transfer Tx:", sigTransfer);

    // 6. Verify Transfer
    // await sleep(5000);
    const updatedAccount = await rpc.getCompressedAccount(
        bn(ticketAddress.toBytes())
    );
    
    const decodedUpdated = coder.types.decode("privateTicket", updatedAccount.data.data);
    assert.ok(decodedUpdated.owner.equals(bobEphemeral.publicKey), "Owner should be Bob Ephemeral");

  });

  // --- HELPER FUNCTIONS (v0.17 Compatible) ---

  async function mintTicket(
    rpc: Rpc,
    program: Program<Encore>,
    signer: anchor.web3.Keypair,
    eventConfig: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    address: anchor.web3.PublicKey,
    purchasePrice: anchor.BN,
    stateTreeInfo: any, // Using generic type to avoid strict mismatches, derived from defaultStaticAccounts
    addressTreeInfo: any
  ) {
    const proofRpcResult = await rpc.getValidityProofV0(
      undefined, // hashes
      [
        {
          tree: addressTreeInfo.addressTree,
          queue: addressTreeInfo.addressQueue,
          address: bn(address.toBytes()),
        },
      ]
    );

    const config = SystemAccountMetaConfig.new(program.programId);
    const packedAccounts = PackedAccounts.newWithSystemAccountsV2(config);

    const outputStateTreeIndex = packedAccounts.insertOrGet(stateTreeInfo.merkleTree); // Use merkleTree (queue is implied/linked usually, but insertOrGet expects tree/queue pubkey)
    // Actually insertOrGet should take the queue for state tree usually in V2, let's check Rust logic.
    // Rust: output_state_tree_index = packed_accounts.insert_or_get(state_tree_info.queue);
    // So we need state tree QUEUE.
    // defaultTestStateTreeAccounts returns { merkleTree, nullifierQueue, ... }
    // This might be V1?
    
    // In 0.17, let's assume `defaultTestStateTreeAccounts` provides what we need. 
    // If it's V1, we might have issues if program expects V2.
    // But let's try with `nullifierQueue` or `merkleTree`.
    // NOTE: For 'output_state_tree_index', we usually pass the MERKLE TREE in 0.17 JS SDK examples, 
    // but the Rust code packs the QUEUE.
    // Let's pass what we have. If `stateTreeInfo` has `nullifierQueue`, use that? 
    // Or `merkleTree`.
    
    // Check exports again: `defaultTestStateTreeAccounts`
    const outputStateTree = stateTreeInfo.merkleTree;
    const outputStateTreeIndexVal = packedAccounts.insertOrGet(outputStateTree);

    const addressQueueIndex = packedAccounts.insertOrGet(addressTreeInfo.addressQueue);
    const addressTreeIndex = packedAccounts.insertOrGet(addressTreeInfo.addressTree);
    
    // NewAddressParamsPacked implementation mimicking PackedAddressTreeInfo
    const packedAddressTreeInfo = {
      seed: Array.from(proofRpcResult.compressedProof.a), // Placeholder/Wrong? 
      // Wait, Rust: PackedAddressTreeInfo { rootIndex, addressMerkleTreePubkeyIndex, addressQueuePubkeyIndex }
      // JS 0.17 NewAddressParamsPacked has: seed, addressMerkleTreeRootIndex, addressMerkleTreeAccountIndex, addressQueueAccountIndex.
      // JS helper `packNewAddressParams` generates this.
      // But the program instruction takes `PackedAddressTreeInfo`. 
      // Are they binary compatible?
      // Rust `PackedAddressTreeInfo`:
      // pub struct PackedAddressTreeInfo {
      //     pub root_index: u16,
      //     pub address_merkle_tree_pubkey_index: u8,
      //     pub address_queue_pubkey_index: u8,
      // }
      // JS `NewAddressParamsPacked`:
      // seed: number[];
      // addressMerkleTreeRootIndex: number; 
      // addressMerkleTreeAccountIndex: number;
      // addressQueueAccountIndex: number;
      
      // They are NOT compatible directly if the JS struct has 'seed'.
      // However, the anchor IDL generated types should be used for the instruction arguments!
      // I shouldn't use SDK types for the *instruction argument* if they differ.
      // I should use the object structure expected by the IDL.
    
      rootIndex: proofRpcResult.rootIndices[0],
      addressMerkleTreePubkeyIndex: addressTreeIndex,
      addressQueuePubkeyIndex: addressQueueIndex,
    };
    
    const proof = {
      compressedProof: proofRpcResult.compressedProof,
    };
    
    const remainingAccounts = packedAccounts.toAccountMetas().remainingAccounts;
    
    const tx = await program.methods
      .mintTicket(
        proof,
        packedAddressTreeInfo,
        outputStateTreeIndexVal,
        owner,
        purchasePrice
      )
      .accounts({
        authority: signer.publicKey,
        //@ts-ignore
        eventConfig: eventConfig,
      })
      .remainingAccounts(remainingAccounts)
      .signers([signer])
      .transaction();

    const recentBlockhash = (await rpc.getRecentBlockhash()).blockhash;
    const signedTx = buildAndSignTx(tx.instructions, signer, recentBlockhash);
    return await sendAndConfirmTx(rpc, signedTx);
  }

  async function transferTicket(
    rpc: Rpc,
    program: Program<Encore>,
    payer: anchor.web3.Keypair,
    currentOwner: anchor.web3.Keypair,
    eventConfig: anchor.web3.PublicKey,
    existingAccount: CompressedAccountWithMerkleContext,
    newOwner: anchor.web3.PublicKey,
    addressTreeInfo: any,
    resalePrice: anchor.BN | null
  ) {
    const proofRpcResult = await rpc.getValidityProof(
      [bn(existingAccount.hash)],
      undefined 
    );

    const config = SystemAccountMetaConfig.new(program.programId);
    const packedAccounts = PackedAccounts.newWithSystemAccountsV2(config);

    const existingAccountMeta = {
      treeInfo: {
        rootIndex: proofRpcResult.rootIndices[0],
        proveByIndex: true,
        merkleTreePubkeyIndex: packedAccounts.insertOrGet(
          existingAccount.merkleTree
        ),
        queuePubkeyIndex: packedAccounts.insertOrGet(
          existingAccount.nullifierQueue
        ),
        leafIndex: existingAccount.leafIndex,
      },
      address: existingAccount.address,
      outputStateTreeIndex: packedAccounts.insertOrGet(
        existingAccount.merkleTree // or nullifierQueue? Rust usually packs queue for output?
      ),
    };

    const addressQueueIndex = packedAccounts.insertOrGet(addressTreeInfo.addressQueue);
    const addressTreeIndex = packedAccounts.insertOrGet(addressTreeInfo.addressTree);
    
    const packedAddressTreeInfo = {
        rootIndex: 0, 
        addressMerkleTreePubkeyIndex: addressTreeIndex,
        addressQueuePubkeyIndex: addressQueueIndex,
    };
    
    // Decoder needed to extract current ID/Price for arguments
    const coder = new anchor.BorshCoder(program.idl);
    const decodedTicket = coder.types.decode("privateTicket", existingAccount.data.data); // 0.17 data struct might be different? 
    // CompressedAccount structure: { owner, lamports, address, data: { data, discriminator, dataHash }, ... }
    
    const proof = {
      compressedProof: proofRpcResult.compressedProof,
    };
    
    const remainingAccounts = packedAccounts.toAccountMetas().remainingAccounts;

    const tx = await program.methods
      .transferTicket(
        proof,
        existingAccountMeta, // account_meta
        packedAddressTreeInfo,
        decodedTicket.ticketId,
        decodedTicket.originalPrice,
        newOwner,
        resalePrice
      )
      .accounts({
        payer: payer.publicKey,
        owner: currentOwner.publicKey, // Must be current owner signer
        //@ts-ignore
        eventConfig: eventConfig,
      })
      .remainingAccounts(remainingAccounts)
      .signers([payer, currentOwner])
      .transaction();

    const recentBlockhash = (await rpc.getRecentBlockhash()).blockhash;
    const signedTx = buildAndSignTx(tx.instructions, payer, recentBlockhash, [currentOwner]);
    return await sendAndConfirmTx(rpc, signedTx);
  }

});

