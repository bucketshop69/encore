pub const EVENT_SEED: &[u8] = b"event";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const IDENTITY_COUNTER_SEED: &[u8] = b"identity_counter";
pub const LISTING_SEED: &[u8] = b"listing";
pub const ESCROW_SEED: &[u8] = b"escrow";

pub const MIN_RESALE_CAP_BPS: u32 = 10000;
pub const MAX_RESALE_CAP_BPS: u32 = 100000;

pub const MAX_TICKET_SUPPLY: u32 = 1_000_000;
pub const CLAIM_TIMEOUT_SECONDS: i64 = 86400; // 24 hours

pub const MAX_EVENT_LOCATION_LEN: usize = 64;
pub const MAX_EVENT_DESCRIPTION_LEN: usize = 200;

pub const MAX_EVENT_NAME_LEN: usize = 64;
