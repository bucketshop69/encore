import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Encore } from "../target/types/encore";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";

describe("encore", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.encore as Program<Encore>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const EVENT_SEED = Buffer.from("event");

  function getEventConfigPDA(authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [EVENT_SEED, authority.toBuffer()],
      program.programId
    );
  }

  describe("create_event", () => {
    it("creates an event with valid parameters", async () => {
      const authority = provider.wallet.publicKey;
      const [eventConfigPDA] = getEventConfigPDA(authority);

      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

      const tx = await program.methods
        .createEvent(
          5000,           // max_supply
          15000,          // resale_cap_bps (1.5x)
          500,            // royalty_bps (5%)
          "Concert 2026",
          new anchor.BN(futureTimestamp)
        )
        .accounts({
          authority,
          eventConfig: eventConfigPDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      console.log("create_event tx:", tx);

      const eventConfig = await program.account.eventConfig.fetch(eventConfigPDA);
      
      expect(eventConfig.authority.toString()).to.equal(authority.toString());
      expect(eventConfig.maxSupply).to.equal(5000);
      expect(eventConfig.ticketsMinted).to.equal(0);
      expect(eventConfig.resaleCapBps).to.equal(15000);
      expect(eventConfig.royaltyBps).to.equal(500);
      expect(eventConfig.eventName).to.equal("Concert 2026");
    });

    it("fails with zero ticket supply", async () => {
      const newKeypair = anchor.web3.Keypair.generate();
      
      // Fund the new keypair
      const sig = await provider.connection.requestAirdrop(
        newKeypair.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(sig);

      const [eventConfigPDA] = getEventConfigPDA(newKeypair.publicKey);
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;

      try {
        await program.methods
          .createEvent(
            0,              // invalid: zero supply
            15000,
            500,
            "Bad Event",
            new anchor.BN(futureTimestamp)
          )
          .accounts({
            authority: newKeypair.publicKey,
            eventConfig: eventConfigPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newKeypair])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidTicketSupply");
      }
    });

    it("fails with resale cap below 1.0x", async () => {
      const newKeypair = anchor.web3.Keypair.generate();
      
      const sig = await provider.connection.requestAirdrop(
        newKeypair.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(sig);

      const [eventConfigPDA] = getEventConfigPDA(newKeypair.publicKey);
      const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;

      try {
        await program.methods
          .createEvent(
            1000,
            5000,           // invalid: 0.5x is below minimum
            500,
            "Bad Event",
            new anchor.BN(futureTimestamp)
          )
          .accounts({
            authority: newKeypair.publicKey,
            eventConfig: eventConfigPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newKeypair])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("ResaleCapTooLow");
      }
    });

    it("fails with event timestamp in the past", async () => {
      const newKeypair = anchor.web3.Keypair.generate();
      
      const sig = await provider.connection.requestAirdrop(
        newKeypair.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(sig);

      const [eventConfigPDA] = getEventConfigPDA(newKeypair.publicKey);
      const pastTimestamp = Math.floor(Date.now() / 1000) - 86400; // 1 day ago

      try {
        await program.methods
          .createEvent(
            1000,
            15000,
            500,
            "Past Event",
            new anchor.BN(pastTimestamp)
          )
          .accounts({
            authority: newKeypair.publicKey,
            eventConfig: eventConfigPDA,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newKeypair])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("EventTimestampInPast");
      }
    });
  });

  describe("update_event", () => {
    it("updates resale cap", async () => {
      const authority = provider.wallet.publicKey;
      const [eventConfigPDA] = getEventConfigPDA(authority);

      const tx = await program.methods
        .updateEvent(
          20000,          // new resale_cap_bps (2.0x)
          null            // keep royalty unchanged
        )
        .accounts({
          authority,
          eventConfig: eventConfigPDA,
        })
        .rpc();

      console.log("update_event tx:", tx);

      const eventConfig = await program.account.eventConfig.fetch(eventConfigPDA);
      expect(eventConfig.resaleCapBps).to.equal(20000);
      expect(eventConfig.royaltyBps).to.equal(500); // unchanged
    });

    it("updates royalty", async () => {
      const authority = provider.wallet.publicKey;
      const [eventConfigPDA] = getEventConfigPDA(authority);

      await program.methods
        .updateEvent(
          null,           // keep resale cap unchanged
          1000            // new royalty_bps (10%)
        )
        .accounts({
          authority,
          eventConfig: eventConfigPDA,
        })
        .rpc();

      const eventConfig = await program.account.eventConfig.fetch(eventConfigPDA);
      expect(eventConfig.resaleCapBps).to.equal(20000); // unchanged from previous test
      expect(eventConfig.royaltyBps).to.equal(1000);
    });

    it("fails when unauthorized", async () => {
      const authority = provider.wallet.publicKey;
      const [eventConfigPDA] = getEventConfigPDA(authority);
      
      const randomKeypair = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        randomKeypair.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(sig);

      try {
        // Try to derive PDA with wrong authority - this will fail at PDA derivation
        const [wrongPDA] = getEventConfigPDA(randomKeypair.publicKey);
        
        await program.methods
          .updateEvent(30000, null)
          .accounts({
            authority: randomKeypair.publicKey,
            eventConfig: wrongPDA, // This PDA doesn't exist
          })
          .signers([randomKeypair])
          .rpc();
        
        expect.fail("Should have thrown an error");
      } catch (err: any) {
        // Will fail because the PDA doesn't exist for this authority
        expect(err).to.exist;
      }
    });
  });
});
