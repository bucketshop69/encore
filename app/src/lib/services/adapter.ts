import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type Address, type Instruction, type TransactionSigner, AccountRole } from "@solana/kit";

export function toV2Address(pubkey: PublicKey): Address {
  return pubkey.toBase58() as Address;
}

export function toV1PublicKey(address: Address): PublicKey {
  return new PublicKey(address);
}

export function asSigner(address: Address): TransactionSigner {
  // We return a minimal object that satisfies TransactionSigner 
  // for the purpose of instruction generation.
  // We do NOT implement actual signing here.
  return {
    address,
    signTransactions: async (_txs: unknown[]) => { throw new Error("Not implemented in dummy signer"); },
    authorizationResult: undefined,
  } as unknown as TransactionSigner;
}

export function toV1Instruction(inst: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: toV1PublicKey(inst.programAddress),
    keys: inst.accounts?.map(acc => ({
      pubkey: toV1PublicKey(acc.address),
      isSigner: (acc.role === AccountRole.READONLY_SIGNER || acc.role === AccountRole.WRITABLE_SIGNER),
      isWritable: (acc.role === AccountRole.WRITABLE || acc.role === AccountRole.WRITABLE_SIGNER),
    })) || [],
    data: Buffer.from(inst.data || []),
  });
}
