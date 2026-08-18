import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export interface AuctionUpdate {
  cardId: string;
  offer: { id: string; cardId: string; bidderId: string; amount: number; createdAt: string };
  closesAt: string;
}

/**
 * ROADMAP.md J13/J14 — subscribes to a card's live auction room
 * (OffersGateway, backend) for as long as the calling component is
 * mounted with a non-null `cardId`. Fires `onUpdate` for every new offer
 * any bidder places, live, without polling.
 *
 * Deliberately does NOT try to receive a "resolved" push — the backend
 * gateway never sends one (see offers.gateway.ts's own header comment for
 * why: resolution is lazy/read-triggered, no server timer to push from).
 * The caller (Buy.tsx) is responsible for polling GET /cards/:id/offers
 * once its own countdown display reaches zero.
 */
export function useAuctionSocket(cardId: string | null, onUpdate: (update: AuctionUpdate) => void): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!cardId) return;
    const socket: Socket = io(API_BASE_URL, { transports: ['websocket'] });
    socket.on('connect', () => socket.emit('join-auction', { cardId }));
    socket.on('auction-update', (update: AuctionUpdate) => {
      if (update.cardId === cardId) onUpdateRef.current(update);
    });
    return () => {
      socket.emit('leave-auction', { cardId });
      socket.disconnect();
    };
  }, [cardId]);
}
