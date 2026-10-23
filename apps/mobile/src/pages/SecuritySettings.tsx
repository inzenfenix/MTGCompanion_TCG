import React, { useState } from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonItem, IonLabel, IonToggle, IonIcon, IonInput, IonButton } from '@ionic/react';
import { lockClosedOutline, locationOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import * as api from '../lib/api';
import { isLocationSharingOptedOut, setLocationSharingOptedOut } from '../lib/locationConsent';

const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();
  const [twoFactor, setTwoFactor] = useState(true);
  const [shareLocation, setShareLocation] = useState(() => !isLocationSharingOptedOut());
  const [locationError, setLocationError] = useState(false);

  // ROADMAP.md O14 — withdrawing location consent. Off: the backend erases
  // the stored location (DELETE /users/me/location) and this device stops
  // re-sending it. On: the next Bazaar visit shares it again, after the
  // OS/browser permission prompt as before.
  const onShareLocationChange = async (checked: boolean) => {
    setLocationError(false);
    if (checked) {
      setLocationSharingOptedOut(false);
      setShareLocation(true);
      return;
    }
    try {
      await api.revokeMyLocation();
      setLocationSharingOptedOut(true);
      setShareLocation(false);
    } catch {
      setLocationError(true);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab4" /></IonButtons>
          <IonTitle>{t('security_2fa')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
          
          <IonItem className="mtg-list-item-row" lines="none" style={{borderRadius: '8px', marginBottom: '20px'}}>
            <IonIcon icon={shieldCheckmarkOutline} slot="start" style={{color: 'var(--ion-color-tertiary-tint)'}} />
            <IonLabel style={{color: '#f2e3cd'}}>Enable 2FA (Authenticator)</IonLabel>
            <IonToggle checked={twoFactor} onIonChange={e => setTwoFactor(e.detail.checked)} slot="end" style={{'--handle-background-checked': '#d4af37', '--background-checked': '#8b0000'}} />
          </IonItem>

          <IonItem className="mtg-list-item-row" lines="none" style={{borderRadius: '8px', marginBottom: '6px'}}>
            <IonIcon icon={locationOutline} slot="start" style={{color: 'var(--ion-color-tertiary-tint)'}} />
            <IonLabel style={{color: '#f2e3cd'}}>{t('privacy_share_location')}</IonLabel>
            <IonToggle checked={shareLocation} onIonChange={e => void onShareLocationChange(e.detail.checked)} slot="end" style={{'--handle-background-checked': '#d4af37', '--background-checked': '#8b0000'}} />
          </IonItem>
          <p style={{color: '#c2b5b5', fontSize: '0.85em', margin: '0 4px 20px'}}>
            {locationError ? t('privacy_share_location_error') : t('privacy_share_location_help')}
          </p>

          <div style={{background: 'rgba(20,10,15,0.4)', border: '1px solid rgba(139,0,0,0.2)', padding: '15px', borderRadius: '8px'}}>
            <h3 style={{margin: '0 0 15px 0', color: '#f2e3cd'}}>Change Password</h3>
            <IonItem className="mtg-list-item-row" lines="none" style={{marginBottom: '10px', borderRadius: '4px'}}>
              <IonLabel position="stacked" style={{color: '#c2b5b5'}}>Current Password</IonLabel>
              <IonInput type="password" value="********" style={{color: '#f2e3cd'}} />
            </IonItem>
            <IonItem className="mtg-list-item-row" lines="none" style={{marginBottom: '10px', borderRadius: '4px'}}>
              <IonLabel position="stacked" style={{color: '#c2b5b5'}}>New Password</IonLabel>
              <IonInput type="password" placeholder="Enter new password" style={{color: '#f2e3cd'}} />
            </IonItem>
            <IonButton expand="block" className="mtg-btn" style={{marginTop: '15px'}}>
              <div className="mtg-btn-content">
                <IonIcon icon={lockClosedOutline} />
                <span>Update Password</span>
              </div>
            </IonButton>
          </div>

        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default SecuritySettings;
