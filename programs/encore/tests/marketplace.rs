// NOTE: These tests are temporarily disabled pending refactor of test helpers.
// TODO: Re-enable after implementing proper test utilities for Issue #010

/*
use anchor_lang::prelude::*;
use light_sdk::instruction::{PackedAddressTreeInfo, ValidityProof};

use crate::constants::{LISTING_SEED, TICKET_SEED};
use crate::state::{Listing, PrivateTicket};

#[test]
fn test_marketplace_flow() {
    // Initialize test context
    let program = Program::new();
    let (mut ctx, wallet1, wallet2, wallet3) = program.create_context();

    // Create event
    let event_owner = wallet1;
    let max_supply = 100;
    let resale_cap_bps = 20000; // 2.0x
    let event_name = "Concert".to_string();
    let event_location = "Stadium".to_string();
    let event_description = "Live music event".to_string();
    let max_tickets_per_person = 4;
    let event_timestamp = 1000000000;

    let event_config = program
        .create_event(
            &mut ctx,
            event_owner,
            max_supply,
            resale_cap_bps,
            event_name,
            event_location,
            event_description,
            max_tickets_per_person,
            event_timestamp,
        )
        .unwrap();

    // Mint ticket for seller
    let seller = wallet1;
    let buyer = wallet2;
    let new_buyer = wallet3;

    let ticket_id = 1;
    let owner_commitment = [1u8; 32]; // Simplified for test
    let purchase_price = 1000;
    let ticket_address_seed = [2u8; 32];

    let ticket = program
        .mint_ticket(
            &mut ctx,
            seller,
            owner_commitment,
            purchase_price,
            ticket_address_seed,
            ticket_id,
            event_config,
        )
        .unwrap();

    // Create listing
    let ticket_commitment = ticket.owner_commitment;
    let encrypted_secret = [3u8; 32]; // Simplified for test
    let price_lamports = 1500;
    let listing = program
        .create_listing(
            &mut ctx,
            seller,
            ticket_commitment,
            encrypted_secret,
            price_lamports,
            event_config,
            ticket_id,
            ticket_address_seed,
        )
        .unwrap();

    // Claim listing
    let buyer_commitment = [4u8; 32]; // Simplified for test
    let claimed_listing = program
        .claim_listing(&mut ctx, buyer, buyer_commitment, listing)
        .unwrap();

    // Complete sale
    let proof = ValidityProof::default(); // Simplified for test
    let address_tree_info = PackedAddressTreeInfo::default();
    let output_state_tree_index = 0;
    let seller_secret = [5u8; 32]; // Simplified for test

    let completed_sale = program
        .complete_sale(
            &mut ctx,
            seller,
            proof,
            address_tree_info,
            output_state_tree_index,
            ticket_address_seed,
            seller_secret,
            claimed_listing,
        )
        .unwrap();

    // Verify listing status is Completed
    assert_eq!(completed_sale.status, ListingStatus::Completed);

    // Verify ticket was transferred
    let new_ticket = program.get_ticket(new_buyer, ticket_address_seed).unwrap();
    assert_eq!(new_ticket.owner_commitment, buyer_commitment);

    msg!("✅ Marketplace flow test passed!");
}

#[test]
fn test_cancel_listing() {
    // Initialize test context
    let program = Program::new();
    let (mut ctx, wallet1, _) = program.create_context();

    // Create event and mint ticket (same as above)
    let event_owner = wallet1;
    let max_supply = 100;
    let resale_cap_bps = 20000;
    let event_name = "Concert".to_string();
    let event_location = "Stadium".to_string();
    let event_description = "Live music event".to_string();
    let max_tickets_per_person = 4;
    let event_timestamp = 1000000000;

    let event_config = program
        .create_event(
            &mut ctx,
            event_owner,
            max_supply,
            resale_cap_bps,
            event_name,
            event_location,
            event_description,
            max_tickets_per_person,
            event_timestamp,
        )
        .unwrap();

    let seller = wallet1;
    let ticket_id = 1;
    let owner_commitment = [1u8; 32];
    let purchase_price = 1000;
    let ticket_address_seed = [2u8; 32];

    let ticket = program
        .mint_ticket(
            &mut ctx,
            seller,
            owner_commitment,
            purchase_price,
            ticket_address_seed,
            ticket_id,
            event_config,
        )
        .unwrap();

    // Create listing
    let ticket_commitment = ticket.owner_commitment;
    let encrypted_secret = [3u8; 32];
    let price_lamports = 1500;

    let listing = program
        .create_listing(
            &mut ctx,
            seller,
            ticket_commitment,
            encrypted_secret,
            price_lamports,
            event_config,
            ticket_id,
            ticket_address_seed,
        )
        .unwrap();

    // Cancel listing
    let cancelled_listing = program.cancel_listing(&mut ctx, seller, listing).unwrap();

    // Verify listing status is Cancelled
    assert_eq!(cancelled_listing.status, ListingStatus::Cancelled);

    msg!("✅ Cancel listing test passed!");
}

#[test]
fn test_release_claim() {
    // Initialize test context
    let program = Program::new();
    let (mut ctx, wallet1, wallet2) = program.create_context();

    // Create event and mint ticket
    let event_owner = wallet1;
    let max_supply = 100;
    let resale_cap_bps = 20000;
    let event_name = "Concert".to_string();
    let event_location = "Stadium".to_string();
    let event_description = "Live music event".to_string();
    let max_tickets_per_person = 4;
    let event_timestamp = 1000000000;

    let event_config = program
        .create_event(
            &mut ctx,
            event_owner,
            max_supply,
            resale_cap_bps,
            event_name,
            event_location,
            event_description,
            max_tickets_per_person,
            event_timestamp,
        )
        .unwrap();

    let seller = wallet1;
    let buyer = wallet2;
    let ticket_id = 1;
    let owner_commitment = [1u8; 32];
    let purchase_price = 1000;
    let ticket_address_seed = [2u8; 32];

    let ticket = program
        .mint_ticket(
            &mut ctx,
            seller,
            owner_commitment,
            purchase_price,
            ticket_address_seed,
            ticket_id,
            event_config,
        )
        .unwrap();

    // Create listing
    let ticket_commitment = ticket.owner_commitment;
    let encrypted_secret = [3u8; 32];
    let price_lamports = 1500;

    let listing = program
        .create_listing(
            &mut ctx,
            seller,
            ticket_commitment,
            encrypted_secret,
            price_lamports,
            event_config,
            ticket_id,
            ticket_address_seed,
        )
        .unwrap();

    // Claim listing
    let buyer_commitment = [4u8; 32];
    let claimed_listing = program
        .claim_listing(&mut ctx, buyer, buyer_commitment, listing)
        .unwrap();

    // Fast forward time to trigger timeout
    ctx.set_clock(
        claimed_listing.claimed_at.unwrap() + crate::constants::CLAIM_TIMEOUT_SECONDS + 1,
    );

    // Release claim
    let released_listing = program
        .release_claim(&mut ctx, seller, claimed_listing)
        .unwrap();

    // Verify listing status is Active again
    assert_eq!(released_listing.status, ListingStatus::Active);
    assert!(released_listing.buyer.is_none());
    assert!(released_listing.buyer_commitment.is_none());
    assert!(released_listing.claimed_at.is_none());

    msg!("✅ Release claim test passed!");
}
*/
