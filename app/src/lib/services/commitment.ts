import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Generate a random 32-byte secret
 */
export function generateRandomSecret(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Compute commitment = SHA256(pubkey || secret)
 * This hides the owner's identity on-chain
 */
export function computeCommitment(
    pubkey: PublicKey,
    secret: Uint8Array
): Uint8Array {
    const data = new Uint8Array([...pubkey.toBytes(), ...secret]);
    return sha256(data);
}

/**
 * Generate a master key by signing once for an event.
 * This single signature can derive all ticket secrets.
 */
export async function generateMasterKey(
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
    eventConfig: PublicKey
): Promise<Uint8Array> {
    const message = `encore:master:${eventConfig.toBase58()}`;
    const signature = await signMessage(new TextEncoder().encode(message));
    return sha256(signature);
}

/**
 * Derive a ticket secret from master key (no signing needed)
 * secret = sha256(masterKey || ticketId)
 */
export function deriveTicketSecret(
    masterKey: Uint8Array,
    ticketId: number
): Uint8Array {
    const data = new Uint8Array(masterKey.length + 4);
    data.set(masterKey);
    // Add ticketId as 4 bytes (little-endian)
    data[masterKey.length] = ticketId & 0xff;
    data[masterKey.length + 1] = (ticketId >> 8) & 0xff;
    data[masterKey.length + 2] = (ticketId >> 16) & 0xff;
    data[masterKey.length + 3] = (ticketId >> 24) & 0xff;
    return sha256(data);
}

/**
 * Generate secret from wallet signature (deterministic)
 * User can regenerate this anytime by signing the same message
 * 
 * @deprecated Use generateMasterKey + deriveTicketSecret instead for bulk operations
 */
export async function generateDeterministicSecret(
    signMessage: (msg: Uint8Array) => Promise<Uint8Array>,
    ticketId: number,
    eventConfig: PublicKey
): Promise<Uint8Array> {
    // For backward compatibility, derive from master key
    const masterKey = await generateMasterKey(signMessage, eventConfig);
    return deriveTicketSecret(masterKey, ticketId);
}

/**
 * Encrypt secret using XOR with hash(key)
 * Used for storing encrypted secrets in listings
 */
export function encryptSecret(secret: Uint8Array, key: Uint8Array): Uint8Array {
    const keyHash = sha256(key);
    const encrypted = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        encrypted[i] = secret[i] ^ keyHash[i];
    }
    return encrypted;
}

/**
 * Decrypt secret (XOR is symmetric)
 */
export function decryptSecret(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
    return encryptSecret(encrypted, key); // XOR is symmetric
}

/**
 * Convert commitment to hex string for display
 */
export function commitmentToHex(commitment: Uint8Array): string {
    return Array.from(commitment)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Convert hex string back to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}
