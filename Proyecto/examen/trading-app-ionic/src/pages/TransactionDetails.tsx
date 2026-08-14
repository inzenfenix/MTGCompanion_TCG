import React from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonIcon } from '@ionic/react';
import { useParams } from 'react-router';
import { checkmarkCircleOutline, timeOutline, personOutline, cashOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const TransactionDetails: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  // Mock data based on ID
  const isBuy = id === '1' || id === '3';
  const amount = isBuy ? 45.00 : 120.00;
  const cardName = isBuy ? 'Chalice of the Void' : 'Tarmogoyf';
  const otherParty = isBuy ? 'Grand Magus (Merchant)' : 'LootGoblin99 (Buyer)';

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tab1" />
          </IonButtons>
          <IonTitle>{t('trade_record', { id })}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <IonIcon icon={checkmarkCircleOutline} style={{ fontSize: '80px', color: 'var(--ion-color-tertiary-tint)' }} />
            <h2>{t('transaction_complete')}</h2>
            <p style={{fontStyle: 'italic'}}>{t('sealed_webpay')}</p>
          </div>

          <div style={{ background: 'rgba(20, 10, 15, 0.4)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(139, 0, 0, 0.2)' }}>
            <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid rgba(139, 0, 0, 0.3)', paddingBottom: '10px' }}>{t('trade_details')}</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <span style={{color: '#c2b5b5'}}><IonIcon icon={cashOutline} style={{verticalAlign: 'middle'}}/> {t('artifact_label')}</span>
              <strong style={{color: '#f2e3cd'}}>{cardName}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <span style={{color: '#c2b5b5'}}><IonIcon icon={personOutline} style={{verticalAlign: 'middle'}}/> {t('transacted_with')}</span>
              <strong style={{color: '#f2e3cd'}}>{otherParty}</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
              <span style={{color: '#c2b5b5'}}><IonIcon icon={timeOutline} style={{verticalAlign: 'middle'}}/> {t('date_label')}</span>
              <strong style={{color: '#f2e3cd'}}>2026-07-28 14:32:00</strong>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', paddingTop: '15px', borderTop: '1px dashed rgba(139, 0, 0, 0.3)' }}>
              <span style={{color: '#c2b5b5', fontSize: '1.2rem'}}>{isBuy ? t('total_paid') : t('total_received')}</span>
              <strong style={{color: isBuy ? 'var(--ion-color-secondary-tint)' : 'var(--ion-color-tertiary-tint)', fontSize: '1.5rem', fontFamily: 'Cinzel'}}>
                ${amount.toFixed(2)}
              </strong>
            </div>
          </div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default TransactionDetails;
