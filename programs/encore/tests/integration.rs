#![cfg(feature = "test-sbf")]

use anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas};
use light_program_test::{
    program_test::LightProgramTest, AddressWithTree, Indexer, ProgramTestConfig, Rpc, RpcError,
};
use light_sdk::{
    address::v2::derive_address,
    instruction::{PackedAccounts, SystemAccountMetaConfig},
};
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
async fn test_mint_private_ticket_ephemeral() {
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

    // Generate recipient's Ephemeral Keypair (Stealth Address)
    // This keypair is used ONLY for this ticket to preserve privacy
    let recipient_ephemeral = Keypair::new();
    
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
        recipient_ephemeral.pubkey(), // Mint directly to ephemeral key
        &ticket_address,
        1_000_000_000,
    )
    .await
    .unwrap();

    // Verify ticket was created with correct owner
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
    assert_eq!(ticket.owner, recipient_ephemeral.pubkey()); // Owner matches ephemeral key
    assert_eq!(ticket.original_price, 1_000_000_000);

    // Verify event config was updated
    let event_config = rpc
        .get_anchor_account::<encore::state::EventConfig>(&event_config_pda)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(event_config.tickets_minted, 1);
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
        recipient1.pubkey(),
        &ticket1_address,
        1_000_000_000,
    )
    .await
    .unwrap();

    // Mint second ticket - should fail
    let recipient2 = Keypair::new();
    
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
        recipient2.pubkey(),
        &ticket2_address,
        1_000_000_000,
    )
    .await;

    assert!(result.is_err(), "Should fail when max supply reached");
}

#[tokio::test]
async fn test_transfer_ticket_ephemeral() {
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

    // Step 2: Mint ticket to Alice (Ephemeral Key 1)
    let alice_ephemeral = Keypair::new();

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
        alice_ephemeral.pubkey(),
        &ticket_address,
        original_price,
    )
    .await
    .unwrap();

    println!("✅ Minted ticket to Alice (Ephemeral Key: {})", alice_ephemeral.pubkey());

    // Verify ticket was minted to Alice
    let compressed_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    let data = &compressed_account.data.as_ref().unwrap().data;
    let ticket = PrivateTicket::deserialize(&mut &data[..]).unwrap();
    assert_eq!(ticket.owner, alice_ephemeral.pubkey());

    // Step 3: Transfer ticket from Alice to Bob (Ephemeral Key 2)
    println!("⏳ Waiting for indexer...");
    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    
    let bob_ephemeral = Keypair::new();
    let resale_price = 1_400_000_000;

    println!("🔄 Transferring ticket from Alice -> Bob...");
    println!("   Alice must SIGN to prove ownership");
    println!("   Bob receives ticket at new Ephemeral Key: {}", bob_ephemeral.pubkey());

    transfer_ticket(
        &mut rpc,
        &payer,
        &alice_ephemeral, // Alice SIGNS the transfer
        &event_config_pda,
        &ticket_address,
        bob_ephemeral.pubkey(), // Bob's new key
        Some(resale_price),
    )
    .await
    .unwrap();

    println!("✅ Transfer successful!");

    // Step 4: Verify ticket is now owned by Bob
    let updated_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    let updated_data = &updated_account.data.as_ref().unwrap().data;
    let updated_ticket = PrivateTicket::deserialize(&mut &updated_data[..]).unwrap();

    assert_eq!(
        updated_ticket.owner, bob_ephemeral.pubkey(),
        "Ticket should now be owned by Bob (Ephemeral Key 2)"
    );
    assert_ne!(
        updated_ticket.owner, alice_ephemeral.pubkey(),
        "Ticket should no longer be owned by Alice"
    );

    println!("✅ Ownership verified - Bob is now the owner!");
}

async fn mint_ticket(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    event_config: &Pubkey,
    owner: Pubkey,
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

    // Use V2 state tree
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
        owner,
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

async fn transfer_ticket(
    rpc: &mut LightProgramTest,
    payer: &Keypair,
    current_owner: &Keypair, // Must sign!
    event_config: &Pubkey,
    ticket_address: &[u8; 32],
    new_owner: Pubkey,
    resale_price: Option<u64>,
) -> Result<Signature, RpcError> {
    let config = SystemAccountMetaConfig::new(encore::ID);
    let mut remaining_accounts = PackedAccounts::default();
    remaining_accounts.add_system_accounts_v2(config)?;

    let address_tree_info = rpc.get_address_tree_v2();

    // Get the existing compressed account - retry logic
    let compressed_account = rpc
        .get_compressed_account(*ticket_address, None)
        .await?
        .value
        .expect("Ticket account not found");
    
    // Deserialize current ticket data
    let current_ticket_data = &compressed_account.data.as_ref().unwrap().data;
    let current_ticket = PrivateTicket::deserialize(&mut &current_ticket_data[..]).unwrap();
    
    let rpc_result = rpc
        .get_validity_proof(
            vec![compressed_account.hash],
            vec![],  
            None,
        )
        .await?
        .value;

    let packed_accounts = rpc_result
        .pack_tree_infos(&mut remaining_accounts)
        .state_trees
        .unwrap();

    let (remaining_accounts_metas, _, _) = remaining_accounts.to_account_metas();

    // Build CompressedAccountMeta
    use light_sdk::instruction::account_meta::CompressedAccountMeta;
    
    let account_meta = CompressedAccountMeta {
        tree_info: packed_accounts.packed_tree_infos[0],
        output_state_tree_index: packed_accounts.output_tree_index,
        address: compressed_account.address.unwrap_or([0u8; 32]),
    };

    let accounts = encore::accounts::TransferTicket {
        payer: payer.pubkey(),
        owner: current_owner.pubkey(), // Current owner must sign
        event_config: *event_config,
    };



    // We need to fix the 'address_tree_info' field in struct initialization above.
    // We can get it from 'rpc.get_address_tree_v2()' and pack it.
    let address_tree_index = remaining_accounts.insert_or_get(address_tree_info.tree);
    use light_sdk::instruction::PackedAddressTreeInfo;
    let address_tree_packed = PackedAddressTreeInfo {
        address_merkle_tree_pubkey_index: address_tree_index,
        address_queue_pubkey_index: address_tree_index,
        root_index: 0, 
    };
    
    // Re-create data with correct packed info
    let ix_data = encore::instruction::TransferTicket {
        proof: rpc_result.proof,
        account_meta,
        address_tree_info: address_tree_packed,
        current_ticket_id: current_ticket.ticket_id,
        current_original_price: current_ticket.original_price,
        new_owner,
        resale_price,
    };
    
    // Regenerate metas since we added address tree
    let (remaining_accounts_metas, _, _) = remaining_accounts.to_account_metas();

    let instruction = Instruction {
        program_id: encore::ID,
        accounts: [accounts.to_account_metas(None), remaining_accounts_metas].concat(),
        data: ix_data.data(),
    };

    rpc.create_and_send_transaction(&[instruction], &payer.pubkey(), &[payer, current_owner])
        .await
}
