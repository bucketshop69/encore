use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct EventConfig {
    pub authority: Pubkey,
    pub max_supply: u32,
    pub tickets_minted: u32,
    pub resale_cap_bps: u32,
    pub royalty_bps: u16,
    #[max_len(64)]
    pub event_name: String,
    pub event_timestamp: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl EventConfig {
    pub fn can_mint(&self, amount: u32) -> bool {
        self.tickets_minted
            .checked_add(amount)
            .map(|total| total <= self.max_supply)
            .unwrap_or(false)
    }

    pub fn calculate_royalty(&self, sale_price: u64) -> Option<u64> {
        sale_price
            .checked_mul(self.royalty_bps as u64)?
            .checked_div(10000)
    }

    pub fn is_valid_resale_price(&self, original_price: u64, proposed_price: u64) -> bool {
        let max_price = original_price
            .checked_mul(self.resale_cap_bps as u64)
            .and_then(|v| v.checked_div(10000));

        match max_price {
            Some(max) => proposed_price <= max,
            None => false,
        }
    }
}
