#![cfg(feature = "test-sbf")]

use anchor_lang::{InstructionData, ToAccountMetas};
use encore::{
    constants::{EVENT_SEED, IDENTITY_COUNTER_SEED, TICKET_SEED},
    errors::EncoreError,
    instruction as encore_ix,
    state::{IdentityCounter, PrivateTicket},
};
use light_client::indexer::{CompressedAccount, TreeInfo};
use light_program_test::{
    program_test::LightProgramTest, AddressWithTree, Indexer, ProgramTestConfig, Rpc, RpcError,
};
use light_sdk::{
    address::v2::derive_address,
    instruction::{account_meta::CompressedAccountMeta, PackedAccounts, SystemAccountMetaConfig},
};
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    system_program,
    transaction::Transaction,
};

#[tokio::test]
async fn test_privacy_refactor_complete_flow() {
    let config = ProgramTestConfig::new(true, Some(vec![("encore", encore::ID)]));
    let mut rpc = LightProgramTest::new(config).await.unwrap();
    let payer = rpc.get_payer().insecure_clone();
    let authority = Keypair::new();

    // 1. Fund authority
    {
        let transfer_ix = solana_sdk::system_instruction::transfer(
            &payer.pubkey(),
            &authority.pubkey(),
            1_000_000_000,
        );
        let recent_blockhash = rpc.get_latest_blockhash().await.unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[transfer_ix],
            Some(&payer.pubkey()),
            &[&payer],
            recent_blockhash.0,
        );
        rpc.process_transaction(tx).await.unwrap();
    }

    // 2. Create Event
    let event_name = "Privacy Event".to_string();
    let (event_config_pda, _) = Pubkey::find_program_address(
        &[EVENT_SEED, authority.pubkey().as_ref()],
        &encore::ID,
    );

    let create_event_ix = Instruction {
        program_id: encore::ID,
        accounts: encore::accounts::CreateEvent {
            authority: authority.pubkey(),
            event_config: event_config_pda,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: encore_ix::CreateEvent {
            max_supply: 1000,
            resale_cap_bps: 20000,
            event_name,
            event_location: "Test Location".to_string(),
            event_description: "Test Desc".to_string(),
            max_tickets_per_person: 2,
            event_timestamp: 2_000_000_000,
        }
        .data(),
    };

    let recent_blockhash = rpc.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[create_event_ix],
        Some(&payer.pubkey()),
        &[&payer, &authority],
        recent_blockhash.0,
    );
    rpc.process_transaction(tx).await.unwrap();

    // 3. Mint Ticket 1
    let ticket_owner_1 = Keypair::new();
    let ticket_address_seed_1 = [1u8; 32];
    let purchase_price = 1_000_000;

    let address_tree_info = rpc.get_address_tree_v2();
    let address_tree_pubkey = address_tree_info.tree;

    // Derive Identity Counter Address
    let (identity_address, _) = derive_address(
        &[
            IDENTITY_COUNTER_SEED,
            event_config_pda.as_ref(),
            authority.pubkey().as_ref(),
        ],
        &address_tree_pubkey,
        &encore::ID,
    );

    // Derive Ticket Address
    let (ticket_address, _) = derive_address(
        &[TICKET_SEED, &ticket_address_seed_1],
        &address_tree_pubkey,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &authority,
        event_config_pda,
        &ticket_address,
        &identity_address,
        address_tree_info.clone(),
        ticket_owner_1.pubkey(),
        purchase_price,
        ticket_address_seed_1,
        None, // No existing identity counter
        None,
    )
    .await
    .unwrap();

    // Verify Identity Counter
    let identity_account = rpc
        .get_compressed_account(identity_address, None)
        .await
        .unwrap()
        .value
        .unwrap();
    let data = &identity_account.data.as_ref().unwrap().data;
    // Simple verification - in real test deserialize
    assert!(data.len() > 0);

    // Verify Ticket
    let ticket_account = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();
    assert!(ticket_account.data.as_ref().unwrap().data.len() > 0);

    // 4. Mint Ticket 2 (Should increment counter)
    let ticket_owner_2 = Keypair::new();
    let ticket_address_seed_2 = [2u8; 32];

    let (ticket_address_2, _) = derive_address(
        &[TICKET_SEED, &ticket_address_seed_2],
        &address_tree_pubkey,
        &encore::ID,
    );

    mint_ticket(
        &mut rpc,
        &payer,
        &authority,
        event_config_pda,
        &ticket_address_2,
        &identity_address, // Provide same identity address
        address_tree_info.clone(),
        ticket_owner_2.pubkey(),
        purchase_price,
        ticket_address_seed_2,
        Some(&identity_account), // Provide existing identity account!
        Some(1),                 // Current tickets minted = 1
    )
    .await
    .unwrap();

    // 5. Test Transfer
    let new_owner = Keypair::new();
    let new_address_seed = [3u8; 32];
    let (new_ticket_address, _) = derive_address(
        &[TICKET_SEED, &new_address_seed],
        &address_tree_pubkey,
        &encore::ID,
    );

    // Get latest state of ticket 1
    let ticket_account_1 = rpc
        .get_compressed_account(ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();

    transfer_ticket(
        &mut rpc,
        &payer,
        &ticket_owner_1,
        event_config_pda,
        &ticket_account_1,
        &new_ticket_address,
        address_tree_info,
        1,              // ticket_id (1st minted)
        purchase_price, // original price
        new_owner.pubkey(),
        new_address_seed,
        None,
    )
    .await
    .unwrap();

    // Verify new ticket exists
    let new_ticket_account = rpc
        .get_compressed_account(new_ticket_address, None)
        .await
        .unwrap()
        .value
        .unwrap();
    assert!(new_ticket_account.data.as_ref().unwrap().data.len() > 0);
}

#[allow(clippy::too_many_arguments)]
async fn mint_ticket<R>(
    rpc: &mut R,
    payer: &Keypair,
    authority: &Keypair,
    event_config: Pubkey,
    ticket_address: &[u8; 32],
    identity_address: &[u8; 32],
    address_tree_info: TreeInfo,
    owner: Pubkey,
    purchase_price: u64,
    ticket_address_seed: [u8; 32],
    existing_identity_account: Option<&CompressedAccount>,
    current_tickets_minted: Option<u8>,
) -> Result<Signature, RpcError>
where
    R: Rpc + Indexer,
{
    let mut remaining_accounts = PackedAccounts::default();
    let config = SystemAccountMetaConfig::new(encore::ID);
    remaining_accounts.add_system_accounts_v2(config)?;

    let mut addresses_to_proof = vec![AddressWithTree {
        address: *identity_address,
        tree: address_tree_info.tree,
    }];
    if *ticket_address != *identity_address {
        addresses_to_proof.push(AddressWithTree {
            address: *ticket_address,
            tree: address_tree_info.tree,
        });
    }

    let mut hashes_to_proof = vec![];
    if let Some(acc) = existing_identity_account {
        hashes_to_proof.push(acc.hash);
    }

    let rpc_result = rpc
        .get_validity_proof(hashes_to_proof, addresses_to_proof, None)
        .await?
        .value;

    let packed_tree_accounts = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let output_state_tree_index = rpc
        .get_random_state_tree_info()?
        .pack_output_tree_index(&mut remaining_accounts)?;

    // We only have input info if we are updating an existing identity account
    let identity_account_meta = if let Some(acc) = existing_identity_account {
        let packed_state_tree_accounts = packed_tree_accounts.state_trees.as_ref().unwrap();
        // Since we requested proof for 1 hash, it should be at index 0
        Some(CompressedAccountMeta {
            tree_info: packed_state_tree_accounts.packed_tree_infos[0],
            address: acc.address.unwrap(),
            output_state_tree_index: packed_state_tree_accounts.output_tree_index,
        })
    } else {
        None
    };

    let instruction_data = encore_ix::MintTicket {
        proof: rpc_result.proof,
        address_tree_info: packed_tree_accounts.address_trees[0], // Assuming we use same tree for boht
        output_state_tree_index,
        owner,
        purchase_price,
        ticket_address_seed,
        identity_account_meta,
        current_tickets_minted,
    };

    let accounts = encore::accounts::MintTicket {
        authority: authority.pubkey(),
        event_config,
    };

    let (remaining_metas, _, _) = remaining_accounts.to_account_metas();
    let instruction = Instruction {
        program_id: encore::ID,
        accounts: [accounts.to_account_metas(None), remaining_metas].concat(),
        data: instruction_data.data(),
    };

    rpc.create_and_send_transaction(
        &[instruction],
        &payer.pubkey(),
        &[payer, authority],
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn transfer_ticket<R>(
    rpc: &mut R,
    payer: &Keypair,
    current_owner: &Keypair,
    event_config: Pubkey,
    existing_ticket: &CompressedAccount,
    new_ticket_address: &[u8; 32],
    address_tree_info: TreeInfo,
    current_ticket_id: u32,
    current_original_price: u64,
    new_owner: Pubkey,
    new_address_seed: [u8; 32],
    resale_price: Option<u64>,
) -> Result<Signature, RpcError>
where
    R: Rpc + Indexer,
{
    let mut remaining_accounts = PackedAccounts::default();
    let config = SystemAccountMetaConfig::new(encore::ID);
    remaining_accounts.add_system_accounts_v2(config)?;

    let hash = existing_ticket.hash;

    let rpc_result = rpc
        .get_validity_proof(
            vec![hash],
            vec![AddressWithTree {
                address: *new_ticket_address,
                tree: address_tree_info.tree,
            }],
            None,
        )
        .await?
        .value;

    let packed_tree_accounts = rpc_result.pack_tree_infos(&mut remaining_accounts);
    let packed_state_tree_accounts = packed_tree_accounts.state_trees.unwrap();
    let packed_address_tree_accounts = packed_tree_accounts.address_trees;
    
    let account_meta = CompressedAccountMeta {
        tree_info: packed_state_tree_accounts.packed_tree_infos[0],
        address: existing_ticket.address.unwrap(),
        output_state_tree_index: packed_state_tree_accounts.output_tree_index,
    };

    let instruction_data = encore_ix::TransferTicket {
        proof: rpc_result.proof,
        account_meta,
        address_tree_info: packed_address_tree_accounts[0],
        current_ticket_id,
        current_original_price,
        new_owner,
        new_address_seed,
        resale_price,
    };
    
    let accounts = encore::accounts::TransferTicket {
        payer: payer.pubkey(),
        owner: current_owner.pubkey(),
        event_config,
    };

    let (remaining_metas, _, _) = remaining_accounts.to_account_metas();
    let instruction = Instruction {
        program_id: encore::ID,
        accounts: [accounts.to_account_metas(None), remaining_metas].concat(),
        data: instruction_data.data(),
    };

    rpc.create_and_send_transaction(&[instruction], &payer.pubkey(), &[payer, current_owner])
        .await
}
