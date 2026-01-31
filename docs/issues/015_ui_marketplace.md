# Issue #015: UI Marketplace + Buy Flow

## Overview

Browse marketplace listings and buy tickets from other users.

## Time Estimate: 1 hour

## Dependencies

- Issue #012: Core Services ✅
- Issue #013: Events + Mint ✅
- Issue #014: My Tickets ✅

## Pages

```
app/
├── marketplace/
│   └── page.tsx          # Browse all active listings
```

## Components

### `components/ListingCard.tsx`

```tsx
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

interface ListingCardProps {
  listingPda: string;
  eventName: string;
  price: number; // lamports
  seller: string;
  status: "active" | "claimed" | "completed" | "cancelled";
  onBuy: () => void;
}

export function ListingCard({ 
  listingPda, 
  eventName, 
  price, 
  seller, 
  status,
  onBuy 
}: ListingCardProps) {
  const priceInSol = price / LAMPORTS_PER_SOL;
  const isAvailable = status === "active";
  
  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-white">{eventName}</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Seller: {seller.slice(0, 4)}...{seller.slice(-4)}
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${
          isAvailable 
            ? "bg-green-500/20 text-green-400" 
            : "bg-zinc-700 text-zinc-400"
        }`}>
          {status}
        </span>
      </div>
      
      <div className="mt-4 flex justify-between items-center">
        <span className="text-xl font-bold text-white">{priceInSol} SOL</span>
        
        {isAvailable && (
          <button onClick={onBuy} className="btn btn-primary text-sm">
            Buy Now
          </button>
        )}
      </div>
    </div>
  );
}
```

### `components/BuyFromListingModal.tsx`

```tsx
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { computeCommitment, generateRandomSecret } from "@/lib/services/commitment";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";

interface BuyFromListingModalProps {
  listingPda: string;
  eventConfig: string;
  seller: string;
  price: number; // lamports
  onClose: () => void;
  onSuccess: () => void;
}

export function BuyFromListingModal({
  listingPda,
  eventConfig,
  seller,
  price,
  onClose,
  onSuccess,
}: BuyFromListingModalProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const client = useEncore();
  const [status, setStatus] = useState<"idle" | "claiming" | "paying" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleBuy = async () => {
    if (!publicKey || !client) return;
    
    try {
      // Step 1: Generate buyer's commitment
      setStatus("claiming");
      const secret = generateRandomSecret();
      const commitment = computeCommitment(publicKey, secret);
      
      // Claim listing
      const claimTx = await client.claimListing(
        publicKey,
        new PublicKey(listingPda),
        commitment
      );
      await claimTx.rpc();
      
      // Step 2: Send payment
      setStatus("paying");
      const transferIx = SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: new PublicKey(seller),
        lamports: price,
      });
      
      const paymentTx = new Transaction().add(transferIx);
      const sig = await sendTransaction(paymentTx, connection);
      await connection.confirmTransaction(sig);
      
      // Store ticket locally (for when sale is completed)
      const storedTickets = JSON.parse(localStorage.getItem("encore_tickets") || "[]");
      storedTickets.push({
        eventConfig,
        secret: Array.from(secret),
        commitment: Array.from(commitment),
        purchasedAt: Date.now(),
        pendingFromListing: listingPda, // Mark as pending
      });
      localStorage.setItem("encore_tickets", JSON.stringify(storedTickets));
      
      setStatus("success");
      setTimeout(onSuccess, 1500);
      
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  };

  const priceInSol = price / LAMPORTS_PER_SOL;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4">
      <div className="card max-w-md w-full">
        <h2 className="text-xl font-bold text-white mb-4">Buy Ticket</h2>
        
        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Price</span>
            <span className="text-white">{priceInSol} SOL</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Seller</span>
            <span className="text-zinc-300 font-mono text-xs">
              {seller.slice(0, 8)}...
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Your Privacy</span>
            <span className="text-green-400">✓ Identity Hidden</span>
          </div>
        </div>
        
        <div className="bg-zinc-800/50 rounded-lg p-3 mb-4 text-xs text-zinc-400">
          <p className="font-medium text-zinc-300 mb-1">How it works:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>You claim the listing (locks it to you)</li>
            <li>You send payment to seller</li>
            <li>Seller confirms → ticket transferred</li>
          </ol>
        </div>
        
        {status === "error" && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}
        
        {status === "success" ? (
          <div className="text-center">
            <p className="text-green-400">✓ Listing claimed & payment sent!</p>
            <p className="text-zinc-400 text-xs mt-1">
              Waiting for seller to complete transfer
            </p>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Cancel
            </button>
            <button 
              onClick={handleBuy} 
              disabled={status === "claiming" || status === "paying"}
              className="btn btn-primary flex-1"
            >
              {status === "claiming" && "Claiming..."}
              {status === "paying" && "Sending payment..."}
              {status === "idle" && `Buy for ${priceInSol} SOL`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Pages

### `app/marketplace/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { ListingCard } from "@/components/ListingCard";
import { BuyFromListingModal } from "@/components/BuyFromListingModal";

interface Listing {
  publicKey: string;
  account: {
    seller: string;
    ticketCommitment: number[];
    priceLamports: number;
    eventConfig: string;
    ticketId: number;
    buyer: string | null;
    status: { active?: {}; claimed?: {}; completed?: {}; cancelled?: {} };
  };
}

export default function MarketplacePage() {
  const { connected } = useWallet();
  const client = useEncore();
  const [listings, setListings] = useState<Listing[]>([]);
  const [events, setEvents] = useState<Record<string, any>>({});
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch listings
  useEffect(() => {
    if (!client) return;
    
    client.fetchAllListings().then((data) => {
      // Transform data
      const transformed = data.map((d: any) => ({
        publicKey: d.publicKey.toString(),
        account: {
          seller: d.account.seller.toString(),
          ticketCommitment: d.account.ticketCommitment,
          priceLamports: d.account.priceLamports.toNumber(),
          eventConfig: d.account.eventConfig.toString(),
          ticketId: d.account.ticketId,
          buyer: d.account.buyer?.toString() || null,
          status: d.account.status,
        },
      }));
      setListings(transformed);
      setLoading(false);
    });
  }, [client]);

  // Fetch event names
  useEffect(() => {
    if (!client || listings.length === 0) return;
    
    const uniqueEvents = [...new Set(listings.map(l => l.account.eventConfig))];
    
    Promise.all(
      uniqueEvents.map(async (ec) => {
        try {
          const event = await client.fetchEvent(new (await import("@solana/web3.js")).PublicKey(ec));
          return [ec, event];
        } catch {
          return [ec, null];
        }
      })
    ).then((results) => {
      const eventsMap: Record<string, any> = {};
      results.forEach(([key, val]) => {
        if (val) eventsMap[key as string] = val;
      });
      setEvents(eventsMap);
    });
  }, [client, listings]);

  const getStatusString = (status: any): "active" | "claimed" | "completed" | "cancelled" => {
    if (status.active) return "active";
    if (status.claimed) return "claimed";
    if (status.completed) return "completed";
    if (status.cancelled) return "cancelled";
    return "active";
  };

  // Filter to only active listings
  const activeListings = listings.filter(l => l.account.status.active);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-2">Marketplace</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Buy tickets with hidden identity using commitment model
      </p>
      
      {!client ? (
        <p className="text-zinc-400">Connect wallet to browse marketplace</p>
      ) : loading ? (
        <p className="text-zinc-400">Loading listings...</p>
      ) : activeListings.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-zinc-400">No active listings</p>
          <p className="text-zinc-500 text-sm mt-1">
            Check back later or list your own ticket
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeListings.map((listing) => {
            const event = events[listing.account.eventConfig];
            
            return (
              <ListingCard
                key={listing.publicKey}
                listingPda={listing.publicKey}
                eventName={event?.eventName || "Loading..."}
                price={listing.account.priceLamports}
                seller={listing.account.seller}
                status={getStatusString(listing.account.status)}
                onBuy={() => setSelectedListing(listing)}
              />
            );
          })}
        </div>
      )}
      
      {selectedListing && (
        <BuyFromListingModal
          listingPda={selectedListing.publicKey}
          eventConfig={selectedListing.account.eventConfig}
          seller={selectedListing.account.seller}
          price={selectedListing.account.priceLamports}
          onClose={() => setSelectedListing(null)}
          onSuccess={() => {
            setSelectedListing(null);
            // Refresh listings
            client?.fetchAllListings().then((data) => {
              const transformed = data.map((d: any) => ({
                publicKey: d.publicKey.toString(),
                account: {
                  seller: d.account.seller.toString(),
                  ticketCommitment: d.account.ticketCommitment,
                  priceLamports: d.account.priceLamports.toNumber(),
                  eventConfig: d.account.eventConfig.toString(),
                  ticketId: d.account.ticketId,
                  buyer: d.account.buyer?.toString() || null,
                  status: d.account.status,
                },
              }));
              setListings(transformed);
            });
          }}
        />
      )}
    </div>
  );
}
```

## Seller Complete Flow (Optional Component)

For sellers to complete claimed listings:

### `components/CompleteListingCard.tsx`

```tsx
// Show in /tickets page for tickets that are listed and claimed
// Seller clicks "Complete Sale" → runs completeSale() with their secret
```

This is **nice-to-have** for the demo. For hackathon, you can manually trigger `completeSale` from console if needed.

## Success Criteria

- [ ] Marketplace shows active listings
- [ ] Can claim listing (buyer commitment generated)
- [ ] Payment sent to seller
- [ ] Ticket secret stored locally (pending)
- [ ] Listings refresh after actions

## Demo Flow

```
1. Wallet A: Buy ticket from event → shows in "My Tickets"
2. Wallet A: List ticket for 2 SOL → shows in "Marketplace"
3. Wallet B: Browse marketplace → Buy ticket
4. (Behind scenes): Seller completes → Ticket transferred
5. Wallet B: Check "My Tickets" → Shows new ticket
```

## Privacy Indicators

Show throughout the UI:

- 🔒 "Identity Hidden" badges
- "Only commitment visible on-chain"
- "Seller can't see buyer identity"
