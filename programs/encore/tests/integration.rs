#![cfg(feature = "test-sbf")]

use anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas};
use light_program_test::{
    program_test::LightProgramTest, AddressWithTree, Indexer, ProgramTestConfig, Rpc, RpcError,
};
use light_sdk::{
    address::v2::derive_address,
    instruction::{PackedAccounts, SystemAccountMetaConfig},
};
use solana_sdk::hash::hash;
use encore::state::PrivateTicket;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    system_program,
};

const EVENT_SEED: &[u8] = b"event";
const TICKET_SEED: &[u8] = b"ticket";

fn get_event_config_pda(authority: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[EVENT_SEED, authority.as_ref()], &encore::ID)
}

/// Compute owner commitment: SHA256(owner_pubkey || secret)
/// In production, would use Poseidon for ZK-friendliness
fn compute_owner_commitment(owner: &Pubkey, secret: &[u8; 32]) -> [u8; 32] {
    let mut data = Vec::with_capacity(64);
    data.extend_from_slice(owner.as_ref());
    data.extend_from_slice(secret);
    hash(&data).to_bytes()
}

#[tokio::test]
async fn test_create_event() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    let (event_config_pda, _bump) = get_event_config_pda(&payer.pubkey());

    let future_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86400;

    let accounts = encore::accounts::CreateEvent {
        authority: payer.pubkey(),
        event_config: event_config_pda,
        system_program: system_program::ID,
    };

    let ix_data = encore::instruction::CreateEvent {
        max_supply: 5000,
        resale_cap_bps: 15000,
        royalty_bps: 500,
        event_name: "Test Concert".to_string(),
        event_timestamp: future_timestamp,
    };

    let instruction = Instruction {
        program_id: encore::ID,
        accounts: accounts.to_account_metas(None),
        data: ix_data.data(),
    };

    let sig = rpc
        .create_and_send_transaction(&[instruction], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    println!("create_event tx: {:?}", sig);

    let account_data = rpc
        .get_anchor_account::<encore::state::EventConfig>(&event_config_pda)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(account_data.authority, payer.pubkey());
    assert_eq!(account_data.max_supply, 5000);
    assert_eq!(account_data.tickets_minted, 0);
    assert_eq!(account_data.resale_cap_bps, 15000);
    assert_eq!(account_data.royalty_bps, 500);
}

#[tokio::test]
async fn test_mint_private_ticket() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    // First create an event
    let (event_config_pda, _bump) = get_event_config_pda(&payer.pubkey());

    let future_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86400;

    let create_accounts = encore::accounts::CreateEvent {
        authority: payer.pubkey(),
        event_config: event_config_pda,
        system_program: system_program::ID,
    };

    let create_ix_data = encore::instruction::CreateEvent {
        max_supply: 100,
        resale_cap_bps: 15000,
        royalty_bps: 500,
        event_name: "Mint Test".to_string(),
        event_timestamp: future_timestamp,
    };

    let create_instruction = Instruction {
        program_id: encore::ID,
        accounts: create_accounts.to_account_metas(None),
        data: create_ix_data.data(),
    };

    rpc.create_and_send_transaction(&[create_instruction], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    // Generate recipient's secret and commitment
    let recipient = Keypair::new();
    let recipient_secret: [u8; 32] = [42u8; 32]; // In real app, this would be random
    let owner_commitment = compute_owner_commitment(&recipient.pubkey(), &recipient_secret);
    
    let ticket_id: u32 = 1;

    let address_tree_info = rpc.get_address_tree_v2();

    let (ticket_address, _) = derive_address(
        &[
            TICKET_SEED,
            event_config_pda.as_ref(),
            &ticket_id.to_le_bytes(),
        ],
        &address_tree_info.tree,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        owner_commitment,
        &ticket_address,
        1_000_000_000, // 1 SOL purchase price
    )
    .await
    .unwrap();

    // Verify ticket was created with commitment (NOT the pubkey!)
    let compressed_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    let data = &compressed_account.data.as_ref().unwrap().data;
    let ticket = PrivateTicket::deserialize(&mut &data[..]).unwrap();

    assert_eq!(ticket.event_config, event_config_pda);
    assert_eq!(ticket.ticket_id, 1);
    assert_eq!(ticket.owner_commitment, owner_commitment); // Commitment, not pubkey!
    assert_eq!(ticket.original_price, 1_000_000_000);

    // Verify event config was updated
    let event_config = rpc
        .get_anchor_account::<encore::state::EventConfig>(&event_config_pda)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(event_config.tickets_minted, 1);
}

async fn mint_ticket(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    event_config: &Pubkey,
    owner_commitment: [u8; 32],
    address: &[u8; 32],
    purchase_price: u64,
) -> Result<Signature, RpcError> {
    let config = SystemAccountMetaConfig::new(encore::ID);
    let mut remaining_accounts = PackedAccounts::default();
    remaining_accounts.add_system_accounts_v2(config)?;

    let address_tree_info = rpc.get_address_tree_v2();

    let rpc_result = rpc
        .get_validity_proof(
            vec![],
            vec![AddressWithTree {
                address: *address,
                tree: address_tree_info.tree,
            }],
            None,
        )
        .await?
        .value;

    let packed_accounts = rpc_result.pack_tree_infos(&mut remaining_accounts);

    // Use V2 state tree (get_state_tree_infos returns V2 trees with v2 feature)
    let output_state_tree_index = rpc
        .get_state_tree_infos()[0]
        .pack_output_tree_index(&mut remaining_accounts)?;

    let (remaining_accounts_metas, _, _) = remaining_accounts.to_account_metas();

    let accounts = encore::accounts::MintTicket {
        authority: payer.pubkey(),
        event_config: *event_config,
    };

    let ix_data = encore::instruction::MintTicket {
        proof: rpc_result.proof,
        address_tree_info: packed_accounts.address_trees[0],
        output_state_tree_index,
        owner_commitment,
        purchase_price,
    };

    let instruction = Instruction {
        program_id: encore::ID,
        accounts: [accounts.to_account_metas(None), remaining_accounts_metas].concat(),
        data: ix_data.data(),
    };

    rpc.create_and_send_transaction(&[instruction], &payer.pubkey(), &[payer])
        .await
}

#[tokio::test]
async fn test_mint_ticket_fails_max_supply() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    // Create an event with max_supply = 1
    let (event_config_pda, _bump) = get_event_config_pda(&payer.pubkey());

    let future_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86400;

    let create_accounts = encore::accounts::CreateEvent {
        authority: payer.pubkey(),
        event_config: event_config_pda,
        system_program: system_program::ID,
    };

    let create_ix_data = encore::instruction::CreateEvent {
        max_supply: 1, // Only 1 ticket allowed
        resale_cap_bps: 15000,
        royalty_bps: 500,
        event_name: "Limited Event".to_string(),
        event_timestamp: future_timestamp,
    };

    let create_instruction = Instruction {
        program_id: encore::ID,
        accounts: create_accounts.to_account_metas(None),
        data: create_ix_data.data(),
    };

    rpc.create_and_send_transaction(&[create_instruction], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    // Mint first ticket - should succeed
    let recipient1 = Keypair::new();
    let secret1: [u8; 32] = [1u8; 32];
    let commitment1 = compute_owner_commitment(&recipient1.pubkey(), &secret1);
    
    let address_tree_info = rpc.get_address_tree_v2();

    let (ticket1_address, _) = derive_address(
        &[
            TICKET_SEED,
            event_config_pda.as_ref(),
            &1u32.to_le_bytes(),
        ],
        &address_tree_info.tree,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        commitment1,
        &ticket1_address,
        1_000_000_000,
    )
    .await
    .unwrap();

    // Mint second ticket - should fail
    let recipient2 = Keypair::new();
    let secret2: [u8; 32] = [2u8; 32];
    let commitment2 = compute_owner_commitment(&recipient2.pubkey(), &secret2);
    
    let (ticket2_address, _) = derive_address(
        &[
            TICKET_SEED,
            event_config_pda.as_ref(),
            &2u32.to_le_bytes(),
        ],
        &address_tree_info.tree,
        &encore::ID,
    );

    let result = mint_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        commitment2,
        &ticket2_address,
        1_000_000_000,
    )
    .await;

    assert!(result.is_err(), "Should fail when max supply reached");
}

#[tokio::test]
async fn test_transfer_ticket() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    // Step 1: Create event
    let (event_config_pda, _bump) = get_event_config_pda(&payer.pubkey());

    let future_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86400;

    let create_accounts = encore::accounts::CreateEvent {
        authority: payer.pubkey(),
        event_config: event_config_pda,
        system_program: system_program::ID,
    };

    let create_ix_data = encore::instruction::CreateEvent {
        max_supply: 100,
        resale_cap_bps: 15000, // 1.5x
        royalty_bps: 500,
        event_name: "Transfer Test".to_string(),
        event_timestamp: future_timestamp,
    };

    let create_instruction = Instruction {
        program_id: encore::ID,
        accounts: create_accounts.to_account_metas(None),
        data: create_ix_data.data(),
    };

    rpc.create_and_send_transaction(&[create_instruction], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    // Step 2: Mint ticket to Alice
    let alice = Keypair::new();
    let alice_secret: [u8; 32] = [42u8; 32];
    let alice_commitment = compute_owner_commitment(&alice.pubkey(), &alice_secret);

    let ticket_id: u32 = 1;
    let original_price = 1_000_000_000; // 1 SOL

    let address_tree_info = rpc.get_address_tree_v2();

    let (ticket_address, _) = derive_address(
        &[
            TICKET_SEED,
            event_config_pda.as_ref(),
            &ticket_id.to_le_bytes(),
        ],
        &address_tree_info.tree,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        alice_commitment,
        &ticket_address,
        original_price,
    )
    .await
    .unwrap();

    println!("✅ Minted ticket to Alice with commitment: {:?}", alice_commitment);

    // Verify ticket was minted to Alice
    let compressed_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    let data = &compressed_account.data.as_ref().unwrap().data;
    let ticket = PrivateTicket::deserialize(&mut &data[..]).unwrap();
    assert_eq!(ticket.owner_commitment, alice_commitment);

    // Step 3: Transfer ticket from Alice to Bob
    // Wait a bit longer for the indexer to fully index the account
    // (needed for get_validity_proof to work - local indexer can be slow)
    println!("⏳ Waiting for indexer to fully process the account...");
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
    
    let bob = Keypair::new();
    let bob_secret: [u8; 32] = [99u8; 32];
    let bob_commitment = compute_owner_commitment(&bob.pubkey(), &bob_secret);

    let resale_price = 1_400_000_000; // 1.4 SOL (within 1.5x cap)

    println!("🔄 Transferring ticket from Alice to Bob...");
    println!("   Alice pubkey: {}", alice.pubkey());
    println!("   Alice commitment: {:?}", alice_commitment);
    println!("   Bob commitment: {:?}", bob_commitment);
    println!("   Resale price: {} (max allowed: {})", resale_price, original_price * 15000 / 10000);

    transfer_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        &ticket_address,
        // Seller proof
        &alice.pubkey(),
        &alice_secret,
        // Buyer commitment
        bob_commitment,
        Some(resale_price),
    )
    .await
    .unwrap();

    println!("✅ Transfer successful!");

    // Step 4: Verify ticket is now owned by Bob (via commitment)
    let updated_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    let updated_data = &updated_account.data.as_ref().unwrap().data;
    let updated_ticket = PrivateTicket::deserialize(&mut &updated_data[..]).unwrap();

    assert_eq!(
        updated_ticket.owner_commitment, bob_commitment,
        "Ticket should now be owned by Bob"
    );
    assert_ne!(
        updated_ticket.owner_commitment, alice_commitment,
        "Ticket should no longer be owned by Alice"
    );

    println!("✅ Ownership verified - Bob is now the owner!");
}

async fn transfer_ticket(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    event_config: &Pubkey,
    ticket_address: &[u8; 32],
    // Seller proves ownership
    seller_pubkey: &Pubkey,
    seller_secret: &[u8; 32],
    // Buyer's new commitment
    new_owner_commitment: [u8; 32],
    // Optional resale price
    resale_price: Option<u64>,
) -> Result<Signature, RpcError> {
    let config = SystemAccountMetaConfig::new(encore::ID);
    let mut remaining_accounts = PackedAccounts::default();
    remaining_accounts.add_system_accounts_v2(config)?;

    let address_tree_info = rpc.get_address_tree_v2();

    // Get the existing compressed account - retry if not yet indexed
    let max_retries = 10;
    let mut compressed_account = None;
    
    for attempt in 0..max_retries {
        match rpc.get_compressed_account(*ticket_address, None).await {
            Ok(result) if result.value.is_some() => {
                compressed_account = result.value;
                println!("   ✓ Found compressed account after {} attempts", attempt + 1);
                break;
            }
            Ok(_) => {
                println!("   ⏳ Attempt {}/{}: Account exists but value is None, retrying...", attempt + 1, max_retries);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
            Err(e) => {
                println!("   ⏳ Attempt {}/{}: Error: {:?}, retrying...", attempt + 1, max_retries, e);
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            }
        }
    }
    
    let compressed_account = compressed_account.expect("Ticket account not found after retries");
    
    // Deserialize current ticket data
    let current_ticket_data = &compressed_account.data.as_ref().unwrap().data;
    let current_ticket = PrivateTicket::deserialize(&mut &current_ticket_data[..]).unwrap();
    
    println!("   📋 Ticket address: {:?}", ticket_address);
    println!("   📋 Account hash: {:?}", compressed_account.hash);
    
    // Compute nullifier for double-spend protection (now enabled with V2 trees!)
    let mut nullifier_data = Vec::with_capacity(36);
    nullifier_data.extend_from_slice(&current_ticket.ticket_id.to_le_bytes());
    nullifier_data.extend_from_slice(seller_secret);
    let nullifier = hash(&nullifier_data).to_bytes();
    
    // Derive nullifier address
    use light_sdk::address::v2::derive_address;
    let (nullifier_address, _) = derive_address(
        &[
            b"nullifier",
            &nullifier,
        ],
        &address_tree_info.tree,
        &encore::ID,
    );
    
    println!("   📋 Nullifier: {:?}", nullifier);
    println!("   📋 Nullifier address: {:?}", nullifier_address);
    
    let rpc_result = rpc
        .get_validity_proof(
            vec![compressed_account.hash],
            vec![AddressWithTree {
                address: nullifier_address,
                tree: address_tree_info.tree,
            }],  // Include nullifier address
            None,
        )
        .await?
        .value;

    println!("   ✓ Got validity proof");
    
    // CRITICAL: Use tree info FROM THE PROOF!
    let packed_accounts = rpc_result
        .pack_tree_infos(&mut remaining_accounts)
        .state_trees
        .unwrap();

    println!("   ✓ Packed tree infos from proof");

    // Pack the address tree for nullifier creation
    let address_tree_index = remaining_accounts.insert_or_get(address_tree_info.tree);

    let (remaining_accounts_metas, _, _) = remaining_accounts.to_account_metas();

    // Build CompressedAccountMeta using tree info FROM THE PROOF
    use light_sdk::instruction::account_meta::CompressedAccountMeta;
    
    let account_meta = CompressedAccountMeta {
        tree_info: packed_accounts.packed_tree_infos[0],  // ← From proof!
        output_state_tree_index: packed_accounts.output_tree_index,  // ← From proof!
        address: compressed_account.address.unwrap_or([0u8; 32]),  // Keep the ticket's original address
    };

    println!("   ✓ Built CompressedAccountMeta from proof");

    // Build address tree info for nullifier
    use light_sdk::instruction::PackedAddressTreeInfo;
    let address_tree_packed = PackedAddressTreeInfo {
        address_merkle_tree_pubkey_index: address_tree_index,
        address_queue_pubkey_index: address_tree_index,
        root_index: 0, // Will be populated from the proof
    };

    let accounts = encore::accounts::TransferTicket {
        payer: payer.pubkey(),
        event_config: *event_config,
    };

    let ix_data = encore::instruction::TransferTicket {
        proof: rpc_result.proof,
        account_meta,
        address_tree_info: address_tree_packed,
        current_ticket_id: current_ticket.ticket_id,  // Pass current data
        current_original_price: current_ticket.original_price,  // Pass current data
        seller_pubkey: *seller_pubkey,
        seller_secret: *seller_secret,
        new_owner_commitment,
        resale_price,
    };

    let instruction = Instruction {
        program_id: encore::ID,
        accounts: [accounts.to_account_metas(None), remaining_accounts_metas].concat(),
        data: ix_data.data(),
    };

    rpc.create_and_send_transaction(&[instruction], &payer.pubkey(), &[payer])
        .await
}

#[tokio::test]
async fn test_prevent_double_spend() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();

    // Step 1: Create event
    let (event_config_pda, _bump) = get_event_config_pda(&payer.pubkey());

    let future_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
        + 86400;

    let create_accounts = encore::accounts::CreateEvent {
        authority: payer.pubkey(),
        event_config: event_config_pda,
        system_program: system_program::ID,
    };

    let create_ix_data = encore::instruction::CreateEvent {
        max_supply: 100,
        resale_cap_bps: 15000, // 1.5x
        royalty_bps: 500,
        event_name: "Double-Spend Test".to_string(),
        event_timestamp: future_timestamp,
    };

    let create_instruction = Instruction {
        program_id: encore::ID,
        accounts: create_accounts.to_account_metas(None),
        data: create_ix_data.data(),
    };

    rpc.create_and_send_transaction(&[create_instruction], &payer.pubkey(), &[&payer])
        .await
        .unwrap();

    // Step 2: Mint ticket to Alice
    let alice = Keypair::new();
    let alice_secret: [u8; 32] = [42u8; 32];
    let alice_commitment = compute_owner_commitment(&alice.pubkey(), &alice_secret);

    let ticket_id: u32 = 1;
    let original_price = 1_000_000_000; // 1 SOL

    let address_tree_info = rpc.get_address_tree_v2();

    let (ticket_address, _) = derive_address(
        &[
            TICKET_SEED,
            event_config_pda.as_ref(),
            &ticket_id.to_le_bytes(),
        ],
        &address_tree_info.tree,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        alice_commitment,
        &ticket_address,
        original_price,
    )
    .await
    .unwrap();

    println!("✅ Minted ticket to Alice");

    // Wait for indexer
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Step 3: First transfer - Alice → Bob (SHOULD SUCCEED)
    let bob = Keypair::new();
    let bob_secret: [u8; 32] = [99u8; 32];
    let bob_commitment = compute_owner_commitment(&bob.pubkey(), &bob_secret);

    println!("🔄 First transfer: Alice → Bob");
    
    transfer_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        &ticket_address,
        &alice.pubkey(),
        &alice_secret,
        bob_commitment,
        Some(1_400_000_000),
    )
    .await
    .unwrap();

    println!("✅ First transfer successful - Nullifier created");

    // Wait for indexer to process
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Step 4: Second transfer - Alice → Carol (SHOULD FAIL - Double-spend!)
    let carol = Keypair::new();
    let carol_secret: [u8; 32] = [123u8; 32];
    let carol_commitment = compute_owner_commitment(&carol.pubkey(), &carol_secret);

    println!("🔄 Second transfer attempt: Alice → Carol (using same secret)");
    println!("   This should FAIL because nullifier already exists!");

    let result = transfer_ticket(
        &mut rpc,
        &payer,
        &event_config_pda,
        &ticket_address,
        &alice.pubkey(),
        &alice_secret,  // ← SAME SECRET AS BEFORE!
        carol_commitment,
        Some(1_200_000_000),
    )
    .await;

    // Assert it failed
    assert!(
        result.is_err(),
        "Second transfer should have failed! Double-spend attack prevented."
    );

    println!("✅ Double-spend prevented! Nullifier security works!");
    println!("   Error: {:?}", result.unwrap_err());
}
