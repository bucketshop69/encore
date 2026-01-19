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

    let output_state_tree_index = rpc
        .get_random_state_tree_info()?
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
