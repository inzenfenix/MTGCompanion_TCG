import React from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonInput, IonItem, IonLabel, IonButton, IonIcon } from '@ionic/react';
import { personCircleOutline, saveOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const AccountSettings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab4" /></IonButtons>
          <IonTitle>{t('account_details')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div style={{textAlign: 'center', margin: '20px 0'}}>
            <IonIcon icon={personCircleOutline} style={{fontSize: '80px', color: '#c2b5b5'}} />
          </div>
          
          <IonItem className="mtg-list-item-row" style={{marginBottom: '10px', borderRadius: '8px'}}>
            <IonLabel position="stacked" style={{color: '#c2b5b5'}}>Display Name</IonLabel>
            <IonInput value="Grand Magus" style={{color: '#f2e3cd', fontWeight: 'bold'}} />
          </IonItem>
          
          <IonItem className="mtg-list-item-row" style={{marginBottom: '10px', borderRadius: '8px'}}>
            <IonLabel position="stacked" style={{color: '#c2b5b5'}}>Email Address</IonLabel>
            <IonInput value="magus@wizardstower.com" type="email" style={{color: '#f2e3cd', fontWeight: 'bold'}} />
          </IonItem>

          <IonButton expand="block" className="mtg-btn" style={{marginTop: '20px'}}>
            <div className="mtg-btn-content">
              <IonIcon icon={saveOutline} />
              <span>{t('save')}</span>
            </div>
          </IonButton>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default AccountSettings;
