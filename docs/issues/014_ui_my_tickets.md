# Issue #014: UI My Tickets + List for Sale

## Overview

View owned tickets and list them on marketplace.

## Time Estimate: 1 hour

## Dependencies

- Issue #012: Core Services ✅
- Issue #013: Events + Mint ✅

## Pages

```
app/
├── tickets/
│   └── page.tsx          # My tickets (from localStorage secrets)
```

## Key Concept: Proving Ownership

User's tickets are stored locally with their secrets. To prove ownership:

```typescript
commitment = SHA256(wallet_pubkey || secret)
```

If this matches the ticket's `owner_commitment` on-chain, user owns it.

## Components

### `components/TicketCard.tsx`

```tsx
interface TicketCardProps {
  eventName: string;
  eventConfig: string;
  ticketId?: number;
  commitment: string; // hex
  onSell: () => void;
}

export function TicketCard({ eventName, eventConfig, ticketId, commitment, onSell }: TicketCardProps) {
  return (
    <div className="card">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-white">{eventName}</h3>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {commitment.slice(0, 16)}...
          </p>
        </div>
        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
          Owned
        </span>
      </div>
      
      <div className="mt-4 flex gap-2">
        <button onClick={onSell} className="btn btn-primary flex-1 text-sm">
          List for Sale
        </button>
      </div>
    </div>
  );
}
```

### `components/CreateListingModal.tsx`

```tsx
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { computeCommitment } from "@/lib/services/commitment";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

interface CreateListingModalProps {
  eventConfig: string;
  secret: Uint8Array;
  ticketId: number;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateListingModal({ 
  eventConfig, 
  secret, 
  ticketId, 
  onClose, 
  onSuccess 
}: CreateListingModalProps) {
  const { publicKey } = useWallet();
  const client = useEncore();
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleList = async () => {
    if (!publicKey || !client || !price) return;
    
    setStatus("loading");
    try {
      const commitment = computeCommitment(publicKey, secret);
      
      const tx = await client.createListing(
        publicKey,
        commitment,
        secret,
        new BN(parseFloat(price) * LAMPORTS_PER_SOL),
        new PublicKey(eventConfig),
        ticketId
      );
      
      await tx.rpc();
      
      // Mark ticket as listed in localStorage
      const tickets = JSON.parse(localStorage.getItem("encore_tickets") || "[]");
      const idx = tickets.findIndex((t: any) => 
        JSON.stringify(t.commitment) === JSON.stringify(Array.from(commitment))
      );
      if (idx >= 0) {
        tickets[idx].listed = true;
        tickets[idx].listingPrice = parseFloat(price);
        localStorage.setItem("encore_tickets", JSON.stringify(tickets));
      }
      
      setStatus("success");
      setTimeout(onSuccess, 1500);
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4">
      <div className="card max-w-md w-full">
        <h2 className="text-xl font-bold text-white mb-4">List Ticket for Sale</h2>
        
        <div className="mb-4">
          <label className="text-sm text-zinc-400 block mb-1">Price (SOL)</label>
          <input
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="1.0"
            className="input w-full"
          />
        </div>
        
        <div className="bg-zinc-800/50 rounded-lg p-3 mb-4">
          <p className="text-xs text-zinc-400">
            🔒 Your identity stays hidden. Only the ticket commitment is visible.
          </p>
        </div>
        
        {status === "error" && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}
        
        {status === "success" ? (
          <p className="text-green-400 text-center">✓ Listing created!</p>
        ) : (
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Cancel
            </button>
            <button 
              onClick={handleList} 
              disabled={status === "loading" || !price}
              className="btn btn-primary flex-1"
            >
              {status === "loading" ? "Creating..." : "Create Listing"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Pages

### `app/tickets/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { TicketCard } from "@/components/TicketCard";
import { CreateListingModal } from "@/components/CreateListingModal";
import { computeCommitment } from "@/lib/services/commitment";

interface StoredTicket {
  eventConfig: string;
  secret: number[];
  commitment: number[];
  purchasedAt: number;
  ticketId?: number;
  listed?: boolean;
}

export default function TicketsPage() {
  const { publicKey, connected } = useWallet();
  const client = useEncore();
  const [tickets, setTickets] = useState<StoredTicket[]>([]);
  const [events, setEvents] = useState<Record<string, any>>({});
  const [selectedTicket, setSelectedTicket] = useState<StoredTicket | null>(null);

  // Load tickets from localStorage
  useEffect(() => {
    if (!connected || !publicKey) {
      setTickets([]);
      return;
    }
    
    const stored = JSON.parse(localStorage.getItem("encore_tickets") || "[]");
    
    // Verify each ticket belongs to current wallet
    const verified = stored.filter((t: StoredTicket) => {
      const secret = new Uint8Array(t.secret);
      const computed = computeCommitment(publicKey, secret);
      return JSON.stringify(Array.from(computed)) === JSON.stringify(t.commitment);
    });
    
    setTickets(verified);
  }, [connected, publicKey]);

  // Fetch event details
  useEffect(() => {
    if (!client || tickets.length === 0) return;
    
    const uniqueEvents = [...new Set(tickets.map(t => t.eventConfig))];
    
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
  }, [client, tickets]);

  if (!connected) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold text-white mb-6">My Tickets</h1>
        <p className="text-zinc-400">Connect wallet to view your tickets</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-6">My Tickets</h1>
      
      {tickets.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-zinc-400">No tickets yet</p>
          <a href="/events" className="text-purple-400 text-sm mt-2 inline-block">
            Browse events →
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tickets.map((ticket, idx) => {
            const event = events[ticket.eventConfig];
            const commitmentHex = Buffer.from(ticket.commitment).toString("hex");
            
            return (
              <TicketCard
                key={idx}
                eventName={event?.eventName || "Loading..."}
                eventConfig={ticket.eventConfig}
                ticketId={ticket.ticketId}
                commitment={commitmentHex}
                onSell={() => setSelectedTicket(ticket)}
              />
            );
          })}
        </div>
      )}
      
      {selectedTicket && (
        <CreateListingModal
          eventConfig={selectedTicket.eventConfig}
          secret={new Uint8Array(selectedTicket.secret)}
          ticketId={selectedTicket.ticketId || 0}
          onClose={() => setSelectedTicket(null)}
          onSuccess={() => {
            setSelectedTicket(null);
            // Refresh tickets
            const stored = JSON.parse(localStorage.getItem("encore_tickets") || "[]");
            setTickets(stored);
          }}
        />
      )}
    </div>
  );
}
```

## Success Criteria

- [ ] Tickets page shows owned tickets from localStorage
- [ ] Only shows tickets matching current wallet
- [ ] Can list ticket for sale
- [ ] Listing created on-chain
- [ ] localStorage updated with listing status

## Privacy Note

The UI clearly indicates:

- ✅ Ticket ownership is hidden (commitment only)
- ✅ When selling, only commitment visible
- ✅ Buyer identity will be hidden too
