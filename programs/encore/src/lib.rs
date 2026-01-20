use anchor_lang::prelude::*;
use light_sdk::instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof};

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("2Ky4W1nqfzo82q4KTCR1RJpTjF7ihWU7dcwSVb7Rc6pT");

#[program]
pub mod encore {
    use super::*;

    pub fn create_event(
        ctx: Context<CreateEvent>,
        max_supply: u32,
        resale_cap_bps: u32,
        royalty_bps: u16,
        event_name: String,
        event_timestamp: i64,
    ) -> Result<()> {
        instructions::create_event(ctx, max_supply, resale_cap_bps, royalty_bps, event_name, event_timestamp)
    }

    pub fn update_event(
        ctx: Context<UpdateEvent>,
        resale_cap_bps: Option<u32>,
        royalty_bps: Option<u16>,
    ) -> Result<()> {
        instructions::update_event(ctx, resale_cap_bps, royalty_bps)
    }

    pub fn mint_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        owner_commitment: [u8; 32],
        purchase_price: u64,
    ) -> Result<()> {
        instructions::mint_ticket(ctx, proof, address_tree_info, output_state_tree_index, owner_commitment, purchase_price)
    }

    pub fn transfer_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        address_tree_info: PackedAddressTreeInfo,
        current_ticket_id: u32,
        current_original_price: u64,
        seller_pubkey: Pubkey,
        seller_secret: [u8; 32],
        new_owner_commitment: [u8; 32],
        resale_price: Option<u64>,
    ) -> Result<()> {
        instructions::transfer_ticket(ctx, proof, account_meta, address_tree_info, current_ticket_id, current_original_price, seller_pubkey, seller_secret, new_owner_commitment, resale_price)
    }
}

