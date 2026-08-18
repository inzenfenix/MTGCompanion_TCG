/**
 * ROADMAP.md J5/J14 — the dedicated "Buy" page a scanned QR (J4) lands on.
 * Route: /buy/:token — token is the short-lived signed listing token
 * CardsService.createListingToken (backend, J4) mints, not a bare cardId,
 * so a forged/tampered QR can't point this page at an arbitrary card.
 *
 * J14 supersedes J5's original "suggested price, flat Buy button" shape:
 * per the user's own "auction style" design decision, EVERY purchase goes
 * through the live 5-second-window auction (J12/J13), not a fixed-price
 * buy — the seller's guessedPrice is just the starting ask a first offer
 * must meet or beat. The countdown shown here is a courtesy display only;
 * OffersGateway (J13) pushes new offers live, but the actual "who won" the
 * instant the countdown hits zero always comes from a REST read (see
 * useAuctionSocket.ts's own header comment for why) — this view reflects
 * the server's resolution, it never decides it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons,
  IonBackButton, IonButton, IonIcon, IonSegment, IonSegmentButton,
  IonLabel, IonSpinner, IonInput, IonItem,
} from '@ionic/react';
import { useParams } from 'react-router';
import { checkmarkCircleOutline, timeOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';
import { useAuctionSocket, type AuctionUpdate } from '../lib/scan/useAuctionSocket';

type LoadState = 'loading' | 'ready' | 'not-found';
const COUNTDOWN_TICK_MS = 250;

const Buy: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [card, setCard] = useState<api.Card | null>(null);
  const [sellerName, setSellerName] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<api.PaymentMethod>('MERCADOPAGO');
  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [createdTransaction, setCreatedTransaction] = useState<api.CreateTransactionResult | null>(null);

  // Auction state (J12/J14) — seeded via REST, kept live via the socket,
  // and re-fetched once the client-side countdown hits zero to get the
  // real, server-resolved outcome.
  const [auction, setAuction] = useState<api.AuctionState | null>(null);
  const [bidAmount, setBidAmount] = useState<number | null>(null);
  const [isBidding, setIsBidding] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hasCheckedResolutionRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setCard(null);
    setSellerName(null);
    setCreatedTransaction(null);
    setPayError(null);
    setAuction(null);

    api.resolveListingToken(token)
      .then(({ cardId }) => Promise.all([api.getCard(cardId), api.getAuctionState(cardId)]))
      .then(([fetchedCard, auctionState]) => {
        if (cancelled) return;
        setCard(fetchedCard);
        setAuction(auctionState);
        setLoadState('ready');
        api.getUser(fetchedCard.ownerId)
          .then((seller) => { if (!cancelled) setSellerName(seller.displayName); })
          .catch(() => { /* show without a name */ });
      })
      .catch(() => {
        if (!cancelled) setLoadState('not-found');
      });

    return () => { cancelled = true; };
  }, [token]);

  // ROADMAP.md J13 — live updates. hasCheckedResolutionRef resets on every
  // new offer, so a fresh countdown gets its own one-shot resolution check.
  useAuctionSocket(card?.id ?? null, (update: AuctionUpdate) => {
    hasCheckedResolutionRef.current = false;
    setAuction((prev) => (prev ? {
      ...prev,
      offers: [update.offer, ...prev.offers],
      currentOffer: update.offer,
      closesAt: update.closesAt,
      wonOfferId: null,
    } : prev));
  });

  // Courtesy countdown tick + the one real resolution check, once, when it
  // visually reaches zero.
  useEffect(() => {
    if (!auction?.closesAt || auction.wonOfferId) return;
    const interval = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [auction?.closesAt, auction?.wonOfferId]);

  useEffect(() => {
    if (!card || !auction?.closesAt || auction.wonOfferId) return;
    if (now < new Date(auction.closesAt).getTime()) return;
    if (hasCheckedResolutionRef.current) return;
    hasCheckedResolutionRef.current = true;
    api.getAuctionState(card.id).then(setAuction).catch(() => { /* next tick retries */ });
  }, [now, card, auction?.closesAt, auction?.wonOfferId]);

  const remainingSeconds = useMemo(() => {
    if (!auction?.closesAt || auction.wonOfferId) return null;
    return Math.max(0, Math.ceil((new Date(auction.closesAt).getTime() - now) / 1000));
  }, [auction?.closesAt, auction?.wonOfferId, now]);

  const isOwnCard = !!(card && user && card.ownerId === user.id);
  const floor = auction?.currentOffer?.amount ?? card?.guessedPrice ?? 0;
  const resolvedOffer = auction?.wonOfferId
    ? auction.offers.find((o) => o.id === auction.wonOfferId)
    : null;
  const didIWin = !!(resolvedOffer && user && resolvedOffer.bidderId === user.id);

  const handlePlaceOffer = async () => {
    if (!card || bidAmount === null) return;
    setIsBidding(true);
    setBidError(null);
    try {
      await api.placeOffer(card.id, bidAmount);
      // The socket delivers the authoritative update (see useAuctionSocket
      // above) — no optimistic local write here, one source of truth.
    } catch (err) {
      setBidError(err instanceof api.ApiError ? err.message : t('buy_page_bid_error'));
    } finally {
      setIsBidding(false);
    }
  };

  const handlePay = async () => {
    if (!card) return;
    setIsPaying(true);
    setPayError(null);
    try {
      const tx = await api.createTransaction({ cardId: card.id, paymentMethod });
      setCreatedTransaction(tx);
      // MercadoPago Checkout Pro is a redirect-based flow — send the buyer
      // there in a new tab (checkoutUrl is only present when the backend
      // actually has a MercadoPago provider configured).
      if (tx.checkoutUrl) {
        window.open(tx.checkoutUrl, '_blank', 'noopener');
      }
    } catch (err) {
      setPayError(err instanceof api.ApiError ? err.message : t('trade_payment_error'));
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab2" /></IonButtons>
          <IonTitle>{t('buy_page_title')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          {loadState === 'loading' && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('buy_page_loading')}</p>
            </div>
          )}

          {loadState === 'not-found' && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p>{t('buy_page_invalid_code')}</p>
            </div>
          )}

          {loadState === 'ready' && card && auction && !createdTransaction && (
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '1.8rem', marginBottom: '5px' }}>{card.title}</h1>
              <p style={{ color: '#c2b5b5' }}>
                {t('purchasing_from')} <strong>{sellerName ?? '…'}</strong>
              </p>

              <div style={{ margin: '20px 0' }}>
                <p style={{ margin: 0, color: '#c2b5b5', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '2px' }}>
                  {auction.currentOffer ? t('buy_page_current_offer') : t('buy_page_starting_ask')}
                </p>
                <h2 style={{ fontSize: '2.8rem', margin: '5px 0', color: 'var(--ion-color-tertiary-tint)' }}>
                  ${floor.toFixed(2)}
                </h2>
                {remainingSeconds !== null && (
                  <p style={{ color: 'var(--ion-color-warning)', fontWeight: 'bold' }}>
                    <IonIcon icon={timeOutline} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    {t('buy_page_countdown', { seconds: remainingSeconds })}
                  </p>
                )}
              </div>

              {/* Resolved — someone won the auction */}
              {resolvedOffer && (
                <div style={{ margin: '20px 0' }}>
                  {didIWin && (
                    <>
                      <p style={{ color: 'var(--ion-color-success)', fontWeight: 'bold' }}>{t('buy_page_you_won', { amount: resolvedOffer.amount.toFixed(2) })}</p>
                      <IonSegment
                        value={paymentMethod}
                        onIonChange={(e) => setPaymentMethod(e.detail.value as api.PaymentMethod)}
                        style={{ marginBottom: '15px' }}
                      >
                        <IonSegmentButton value="MERCADOPAGO">
                          <IonLabel>{t('payment_method_mercadopago')}</IonLabel>
                        </IonSegmentButton>
                        <IonSegmentButton value="CASH">
                          <IonLabel>{t('payment_method_cash')}</IonLabel>
                        </IonSegmentButton>
                      </IonSegment>
                      <IonButton expand="block" className="mtg-btn" disabled={isPaying} onClick={handlePay}>
                        <div className="mtg-btn-content">
                          <span>{isPaying ? t('processing_payment') : (paymentMethod === 'CASH' ? t('pay_cash') : t('pay_mercadopago'))}</span>
                        </div>
                      </IonButton>
                      {payError && <p style={{ color: 'var(--ion-color-danger)', marginTop: '10px' }}>{payError}</p>}
                    </>
                  )}
                  {!didIWin && !isOwnCard && (
                    <p style={{ color: 'var(--ion-color-danger)' }}>{t('buy_page_outbid')}</p>
                  )}
                  {!didIWin && isOwnCard && (
                    <p style={{ color: '#c2b5b5' }}>{t('buy_page_auction_ended_seller', { amount: resolvedOffer.amount.toFixed(2) })}</p>
                  )}
                </div>
              )}

              {/* Still open — bid form (hidden for the seller viewing their own listing) */}
              {!resolvedOffer && (
                isOwnCard ? (
                  <p style={{ color: 'var(--ion-color-danger)' }}>{t('buy_page_own_card')}</p>
                ) : (
                  <div style={{ margin: '20px 0' }}>
                    <IonItem color="transparent" style={{ '--border-color': 'rgba(139,0,0,0.3)' }}>
                      <IonLabel position="stacked">{t('buy_page_your_offer')}</IonLabel>
                      <IonInput
                        type="number"
                        value={bidAmount ?? ''}
                        placeholder={`> $${floor.toFixed(2)}`}
                        onIonInput={(e) => setBidAmount(e.detail.value ? parseFloat(e.detail.value) : null)}
                      />
                    </IonItem>
                    <IonButton
                      expand="block"
                      className="mtg-btn"
                      style={{ marginTop: '15px' }}
                      disabled={isBidding || bidAmount === null}
                      onClick={handlePlaceOffer}
                    >
                      <div className="mtg-btn-content">
                        <span>{isBidding ? t('buy_page_bidding') : t('buy_page_place_offer')}</span>
                      </div>
                    </IonButton>
                    {bidError && <p style={{ color: 'var(--ion-color-danger)', marginTop: '10px' }}>{bidError}</p>}
                  </div>
                )
              )}
            </div>
          )}

          {createdTransaction && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <IonIcon icon={checkmarkCircleOutline} style={{ fontSize: '80px', color: '#00733e' }} />
              <h2>{t('trade_sale_complete')}</h2>
              <p>
                {createdTransaction.checkoutUrl
                  ? t('trade_mp_redirect_notice')
                  : paymentMethod === 'CASH'
                    ? t('buy_page_cash_pending_notice')
                    : t('trade_pending_notice')}
              </p>
              <IonButton expand="block" className="mtg-btn" routerLink={`/transaction/${createdTransaction.id}`} style={{ marginTop: '20px' }}>
                {t('view_trade_record')}
              </IonButton>
            </div>
          )}

        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Buy;
