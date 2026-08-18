/**
 * ROADMAP.md J5 — the dedicated "Buy" page a scanned QR (J4) lands on.
 * Route: /buy/:token — token is the short-lived signed listing token
 * CardsService.createListingToken (backend, J4) mints, not a bare cardId,
 * so a forged/tampered QR can't point this page at an arbitrary card.
 *
 * Mirrors CardDetails.tsx's card-rendering pieces where practical; the
 * actual purchase logic (payment method pick, create the transaction,
 * redirect to MercadoPago Checkout Pro if applicable) is what used to live
 * inline in Tab2.tsx's buyerStep 2/3 — moved here since Tab2.tsx's buyer
 * role is now just "scan a QR", not a second copy of this flow.
 */
import React, { useEffect, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons,
  IonBackButton, IonButton, IonIcon, IonSegment, IonSegmentButton,
  IonLabel, IonSpinner,
} from '@ionic/react';
import { useParams } from 'react-router';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

type LoadState = 'loading' | 'ready' | 'not-found';

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

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setCard(null);
    setSellerName(null);
    setCreatedTransaction(null);
    setPayError(null);

    api.resolveListingToken(token)
      .then(({ cardId }) => api.getCard(cardId))
      .then((fetchedCard) => {
        if (cancelled) return;
        setCard(fetchedCard);
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

  const isOwnCard = card && user && card.ownerId === user.id;

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

          {loadState === 'ready' && card && !createdTransaction && (
            <div style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: '1.8rem', marginBottom: '5px' }}>{card.title}</h1>
              <p style={{ color: '#c2b5b5' }}>
                {t('purchasing_from')} <strong>{sellerName ?? '…'}</strong>
              </p>

              <div style={{ margin: '25px 0' }}>
                <h2 style={{ fontSize: '2.8rem', margin: '5px 0', color: 'var(--ion-color-tertiary-tint)' }}>
                  ${card.guessedPrice.toFixed(2)}
                </h2>
              </div>

              {isOwnCard ? (
                <p style={{ color: 'var(--ion-color-danger)' }}>{t('buy_page_own_card')}</p>
              ) : (
                <>
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
                  {payError && (
                    <p style={{ color: 'var(--ion-color-danger)', marginTop: '10px' }}>{payError}</p>
                  )}
                </>
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
