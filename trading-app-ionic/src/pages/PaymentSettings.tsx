import React from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonList, IonItem, IonLabel, IonIcon, IonButton } from '@ionic/react';
import { cardOutline, addCircleOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const PaymentSettings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab4" /></IonButtons>
          <IonTitle>{t('payment_methods')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
          
          <IonList className="mtg-list" style={{background: 'transparent', marginBottom: '20px'}}>
            <IonItem className="mtg-list-item-row" lines="none" style={{borderRadius: '8px', marginBottom: '10px'}}>
              <IonIcon icon={cardOutline} slot="start" style={{color: 'var(--ion-color-tertiary-tint)'}} />
              <IonLabel>
                <h2 style={{color: '#f2e3cd'}}>WebPay Credit Card</h2>
                <p style={{color: '#c2b5b5'}}>**** **** **** 4242</p>
              </IonLabel>
            </IonItem>
          </IonList>

          <IonButton expand="block" className="mtg-btn">
            <div className="mtg-btn-content">
              <IonIcon icon={addCircleOutline} />
              <span>Add WebPay Account</span>
            </div>
          </IonButton>

        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default PaymentSettings;
