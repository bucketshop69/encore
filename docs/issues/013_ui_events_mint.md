# Issue #013: UI Events + Mint Flow

## Overview

Event browsing and ticket minting UI. User can browse events and purchase tickets.

## Time Estimate: 1 hour

## Dependencies

- Issue #012: Core Services ✅

## Pages

```
app/
├── page.tsx              # Home → redirect to /events
├── events/
│   ├── page.tsx          # Browse all events
│   └── [id]/
│       └── page.tsx      # Event detail + Buy button
```

## Styling Approach

**Minimal CSS with Tailwind utility classes.** No component library needed.

```css
/* globals.css - add these utilities */
.card { @apply bg-zinc-900 border border-zinc-800 rounded-lg p-4; }
.btn { @apply px-4 py-2 rounded-lg font-medium transition-colors; }
.btn-primary { @apply bg-purple-600 hover:bg-purple-700 text-white; }
.btn-secondary { @apply bg-zinc-800 hover:bg-zinc-700 text-zinc-100; }
.input { @apply bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white; }
```

## Components

### `components/EventCard.tsx`

```tsx
interface EventCardProps {
  name: string;
  location: string;
  date: Date;
  ticketsMinted: number;
  maxSupply: number;
  eventConfig: string; // PublicKey as string
}

export function EventCard({ name, location, date, ticketsMinted, maxSupply, eventConfig }: EventCardProps) {
  return (
    <Link href={`/events/${eventConfig}`} className="card hover:border-purple-500">
      <h3 className="text-lg font-bold text-white">{name}</h3>
      <p className="text-zinc-400 text-sm">{location}</p>
      <p className="text-zinc-500 text-xs mt-2">
        {new Date(date).toLocaleDateString()}
      </p>
      <div className="mt-3 flex justify-between items-center">
        <span className="text-xs text-zinc-500">
          {ticketsMinted}/{maxSupply} sold
        </span>
        <span className="text-purple-400 text-sm">View →</span>
      </div>
    </Link>
  );
}
```

### `components/BuyTicketModal.tsx`

```tsx
"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { computeCommitment, generateRandomSecret } from "@/lib/services/commitment";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

interface BuyTicketModalProps {
  eventConfig: string;
  eventOwner: string;
  price: number; // in SOL
  onClose: () => void;
  onSuccess: () => void;
}

export function BuyTicketModal({ eventConfig, eventOwner, price, onClose, onSuccess }: BuyTicketModalProps) {
  const { publicKey } = useWallet();
  const client = useEncore();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleBuy = async () => {
    if (!publicKey || !client) return;
    
    setStatus("loading");
    try {
      // Generate commitment (hides buyer identity)
      const secret = generateRandomSecret();
      const commitment = computeCommitment(publicKey, secret);
      
      // Store secret locally (user needs this to prove ownership later)
      const storedTickets = JSON.parse(localStorage.getItem("encore_tickets") || "[]");
      storedTickets.push({
        eventConfig,
        secret: Array.from(secret),
        commitment: Array.from(commitment),
        purchasedAt: Date.now(),
      });
      localStorage.setItem("encore_tickets", JSON.stringify(storedTickets));
      
      // Mint ticket
      const tx = await client.mintTicket(
        publicKey,
        new PublicKey(eventOwner),
        commitment,
        new BN(price * LAMPORTS_PER_SOL)
      );
      
      await tx.rpc();
      
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
        <h2 className="text-xl font-bold text-white mb-4">Buy Ticket</h2>
        
        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Price</span>
            <span className="text-white">{price} SOL</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-400">Privacy</span>
            <span className="text-green-400">✓ Identity Hidden</span>
          </div>
        </div>
        
        {status === "error" && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}
        
        {status === "success" ? (
          <p className="text-green-400 text-center">✓ Ticket purchased!</p>
        ) : (
          <div className="flex gap-3">
            <button onClick={onClose} className="btn btn-secondary flex-1">
              Cancel
            </button>
            <button 
              onClick={handleBuy} 
              disabled={status === "loading"}
              className="btn btn-primary flex-1"
            >
              {status === "loading" ? "Processing..." : "Buy Ticket"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

## Pages

### `app/events/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useEncore } from "@/hooks/useEncore";
import { EventCard } from "@/components/EventCard";

export default function EventsPage() {
  const client = useEncore();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    
    client.fetchAllEvents().then((data) => {
      setEvents(data);
      setLoading(false);
    });
  }, [client]);

  if (!client) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-zinc-400">Connect wallet to browse events</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Events</h1>
      
      {loading ? (
        <p className="text-zinc-400">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-zinc-400">No events found</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
            <EventCard
              key={event.publicKey.toString()}
              eventConfig={event.publicKey.toString()}
              name={event.account.eventName}
              location={event.account.eventLocation}
              date={new Date(event.account.eventTimestamp.toNumber() * 1000)}
              ticketsMinted={event.account.ticketsMinted}
              maxSupply={event.account.maxSupply}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

### `app/events/[id]/page.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEncore } from "@/hooks/useEncore";
import { BuyTicketModal } from "@/components/BuyTicketModal";
import { PublicKey } from "@solana/web3.js";

export default function EventDetailPage() {
  const params = useParams();
  const { connected } = useWallet();
  const client = useEncore();
  const [event, setEvent] = useState<any>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);

  useEffect(() => {
    if (!client || !params.id) return;
    
    client.fetchEvent(new PublicKey(params.id as string)).then(setEvent);
  }, [client, params.id]);

  if (!event) {
    return <div className="container mx-auto p-6 text-zinc-400">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="card">
        <h1 className="text-2xl font-bold text-white">{event.eventName}</h1>
        <p className="text-zinc-400 mt-1">{event.eventLocation}</p>
        
        <p className="text-zinc-300 mt-4">{event.eventDescription}</p>
        
        <div className="grid grid-cols-2 gap-4 mt-6 text-sm">
          <div>
            <span className="text-zinc-500">Date</span>
            <p className="text-white">
              {new Date(event.eventTimestamp.toNumber() * 1000).toLocaleDateString()}
            </p>
          </div>
          <div>
            <span className="text-zinc-500">Tickets</span>
            <p className="text-white">{event.ticketsMinted} / {event.maxSupply}</p>
          </div>
          <div>
            <span className="text-zinc-500">Resale Cap</span>
            <p className="text-white">{event.resaleCapBps / 10000}x</p>
          </div>
        </div>
        
        <div className="mt-6 pt-6 border-t border-zinc-800">
          {connected ? (
            <button 
              onClick={() => setShowBuyModal(true)}
              className="btn btn-primary w-full"
              disabled={event.ticketsMinted >= event.maxSupply}
            >
              {event.ticketsMinted >= event.maxSupply ? "Sold Out" : "Buy Ticket"}
            </button>
          ) : (
            <p className="text-zinc-400 text-center">Connect wallet to buy tickets</p>
          )}
        </div>
      </div>
      
      {showBuyModal && (
        <BuyTicketModal
          eventConfig={params.id as string}
          eventOwner={event.authority.toString()}
          price={0.1} // Default price, could be from event config
          onClose={() => setShowBuyModal(false)}
          onSuccess={() => {
            setShowBuyModal(false);
            // Refresh event data
            client?.fetchEvent(new PublicKey(params.id as string)).then(setEvent);
          }}
        />
      )}
    </div>
  );
}
```

## Success Criteria

- [ ] Events page shows all events from chain
- [ ] Event detail page shows event info
- [ ] Buy modal generates commitment
- [ ] Ticket mints successfully
- [ ] Secret stored in localStorage

## Local Storage Schema

```typescript
interface StoredTicket {
  eventConfig: string;
  secret: number[];      // To regenerate commitment
  commitment: number[];  // For quick lookup
  purchasedAt: number;
  ticketId?: number;     // If known
}

// localStorage.getItem("encore_tickets") → StoredTicket[]
```
