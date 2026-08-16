import React, { useCallback, useEffect, useState } from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonIcon, IonSpinner, IonButton } from '@ionic/react';
import { useParams } from 'react-router';
import { checkmarkCircleOutline, timeOutline, personOutline, cashOutline, closeCircleOutline, refreshOutline, receiptOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

const TransactionDetails: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [transaction, setTransaction] = useState<api.Transaction | null>(null);
  const [card, setCard] = useState<api.Card | null>(null);
  const [otherPartyName, setOtherPartyName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const [receipt, setReceipt] = useState<api.ReceiptBreakdown | null>(null);

  const fetchAll = useCallback(() => {
    setIsLoading(true);
    setError(false);
    setTransaction(null);
    setCard(null);
    setOtherPartyName(null);
    setReceipt(null);
    api
      .getTransaction(id)
      .then(async (tx) => {
        setTransaction(tx);
        const otherPartyId = tx.buyerId === user?.id ? tx.sellerId : tx.buyerId;
        const [fetchedCard, otherUser] = await Promise.all([
          api.getCard(tx.cardId).catch(() => null),
          api.getUser(otherPartyId).catch(() => null),
        ]);
        setCard(fetchedCard);
        setOtherPartyName(otherUser?.displayName ?? null);
        if (tx.status === 'PAID') {
          api.getTransactionReceipt(tx.id).then(setReceipt).catch(() => { /* non-critical — page still works without it */ });
        }
      })
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, [id, user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const isBuy = transaction?.buyerId === user?.id;

  // A MercadoPago transaction can flip PENDING → PAID asynchronously (its
  // webhook, after the buyer completes checkout in the tab that opened) —
  // this renders honestly by real status rather than always claiming
  // success, and the refresh button below lets the buyer re-check after
  // returning from that external tab.
  const statusIcon =
    transaction?.status === 'PAID' ? checkmarkCircleOutline :
    transaction?.status === 'PENDING' ? timeOutline :
    closeCircleOutline;
  const statusColor =
    transaction?.status === 'PAID' ? '#00733e' :
    transaction?.status === 'PENDING' ? '#d4af37' :
    '#5c1b1b';
  const statusLabel =
    transaction?.status === 'PAID' ? t('transaction_complete') :
    transaction?.status === 'PENDING' ? t('transaction_status_pending') :
    transaction?.status === 'FAILED' ? t('transaction_status_failed') :
    t('transaction_status_cancelled');
  const sealedLabel = transaction?.paymentMethod === 'CASH' ? t('sealed_cash') : t('sealed_mercadopago');

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tab1" />
          </IonButtons>
          <IonTitle>{t('trade_record', { id: id.slice(0, 8) })}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('transaction_loading')}</p>
            </div>
          )}

          {!isLoading && (error || !transaction) && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p>{t('transaction_error')}</p>
              <IonButton fill="outline" className="mtg-btn" onClick={fetchAll}>{t('retry')}</IonButton>
            </div>
          )}

          {!isLoading && transaction && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <IonIcon icon={statusIcon} style={{ fontSize: '80px', color: statusColor }} />
                <h2>{statusLabel}</h2>
                <p style={{fontStyle: 'italic'}}>{sealedLabel}</p>
                {transaction.status === 'PENDING' && (
                  <IonButton fill="clear" size="small" onClick={fetchAll}>
                    <IonIcon icon={refreshOutline} slot="start" />
                    {t('refresh_status')}
                  </IonButton>
                )}
              </div>

              <div style={{ background: 'rgba(20, 10, 15, 0.4)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(139, 0, 0, 0.2)' }}>
                <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid rgba(139, 0, 0, 0.3)', paddingBottom: '10px' }}>{t('trade_details')}</h3>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <span style={{color: '#c2b5b5'}}><IonIcon icon={cashOutline} style={{verticalAlign: 'middle'}}/> {t('artifact_label')}</span>
                  <strong style={{color: '#f2e3cd'}}>{card?.title ?? t('unknown_artifact')}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <span style={{color: '#c2b5b5'}}><IonIcon icon={personOutline} style={{verticalAlign: 'middle'}}/> {t('transacted_with')}</span>
                  <strong style={{color: '#f2e3cd'}}>{otherPartyName ?? t('unknown_trader')}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <span style={{color: '#c2b5b5'}}><IonIcon icon={timeOutline} style={{verticalAlign: 'middle'}}/> {t('date_label')}</span>
                  <strong style={{color: '#f2e3cd'}}>{new Date(transaction.createdAt).toLocaleString()}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed rgba(139, 0, 0, 0.3)' }}>
                  <span style={{color: '#c2b5b5', fontSize: '1.2rem'}}>{isBuy ? t('total_paid') : t('total_received')}</span>
                  <strong style={{color: isBuy ? 'var(--ion-color-secondary-tint)' : 'var(--ion-color-tertiary-tint)', fontSize: '1.5rem', fontFamily: 'Cinzel'}}>
                    ${transaction.amount.toFixed(2)}
                  </strong>
                </div>
              </div>

              {transaction.status === 'PAID' && (
                <div style={{ background: 'rgba(20, 10, 15, 0.4)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(139, 0, 0, 0.2)', marginTop: '20px' }}>
                  <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid rgba(139, 0, 0, 0.3)', paddingBottom: '10px' }}>
                    <IonIcon icon={receiptOutline} style={{verticalAlign: 'middle', marginRight: '6px'}}/> {t('receipt_title')}
                  </h3>

                  {!receipt && <p style={{color: '#c2b5b5', fontSize: '0.9rem'}}>{t('receipt_loading')}</p>}

                  {receipt && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{color: '#c2b5b5'}}>{t('receipt_net')}</span>
                        <span style={{color: '#f2e3cd'}}>${receipt.net.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{color: '#c2b5b5'}}>{t('receipt_iva')}</span>
                        <span style={{color: '#f2e3cd'}}>${receipt.iva.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', paddingTop: '10px', borderTop: '1px dashed rgba(139, 0, 0, 0.3)' }}>
                        <strong style={{color: '#f2e3cd'}}>{t('receipt_total')}</strong>
                        <strong style={{color: '#f2e3cd'}}>${receipt.total.toFixed(2)}</strong>
                      </div>
                      <p style={{fontSize: '0.75rem', fontStyle: 'italic', opacity: 0.7, margin: 0}}>{t('receipt_disclaimer')}</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default TransactionDetails;
