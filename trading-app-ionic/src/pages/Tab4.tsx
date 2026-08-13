import React, { useState, useEffect } from 'react';
import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar,
  IonList,
  IonItem,
  IonLabel,
  IonIcon,
  IonToggle,
  IonSelect,
  IonSelectOption
} from '@ionic/react';
import { 
  personOutline, 
  cardOutline, 
  notificationsOutline,
  moonOutline,
  languageOutline,
  shieldCheckmarkOutline,
  sunnyOutline,
  logOutOutline
} from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';

const Tab4: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const [isLightMode, setIsLightMode] = useState(false);

  useEffect(() => {
    setIsLightMode(document.body.classList.contains('light-magic'));
  }, []);

  const toggleTheme = (checked: boolean) => {
    setIsLightMode(checked);
    if (checked) {
      document.body.classList.add('light-magic');
    } else {
      document.body.classList.remove('light-magic');
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0 }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('tab_scrolls')} ({t('settings')})</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div 
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {user && (
            <p style={{ textAlign: 'center', fontSize: '0.85rem', opacity: 0.8, marginTop: 0 }}>
              {t('logged_in_as')} <strong style={{ color: '#f2e3cd' }}>{user.displayName}</strong> ({user.email})
            </p>
          )}
          <motion.div variants={containerVariants} initial="hidden" animate="visible">
            <IonList className="mtg-list">
              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full" button routerLink="/account">
                  <IonIcon icon={personOutline} slot="start" />
                  <IonLabel>{t('account_details')}</IonLabel>
                </IonItem>
              </motion.div>
              
              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full" button routerLink="/payment">
                  <IonIcon icon={cardOutline} slot="start" />
                  <IonLabel>{t('payment_methods')}</IonLabel>
                </IonItem>
              </motion.div>

              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full" button routerLink="/security">
                  <IonIcon icon={shieldCheckmarkOutline} slot="start" />
                  <IonLabel>{t('security_2fa')}</IonLabel>
                </IonItem>
              </motion.div>
              
              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full">
                  <IonIcon icon={notificationsOutline} slot="start" />
                  <IonLabel>{t('trade_notifications')}</IonLabel>
                  <IonToggle slot="end" checked={true} style={{'--handle-background-checked': '#d4af37', '--background-checked': '#8b0000'}} />
                </IonItem>
              </motion.div>
              
              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full">
                  <IonIcon icon={isLightMode ? sunnyOutline : moonOutline} slot="start" />
                  <IonLabel>{isLightMode ? t('light_magic_theme') : t('dark_magic_theme')}</IonLabel>
                  <IonToggle slot="end" checked={isLightMode} onIonChange={e => toggleTheme(e.detail.checked)} style={{'--handle-background-checked': '#ffb6c1', '--background-checked': '#d81b60'}} />
                </IonItem>
              </motion.div>
              
              <motion.div variants={itemVariants}>
                <IonItem className="mtg-list-item-row" lines="full">
                  <IonIcon icon={languageOutline} slot="start" />
                  <IonLabel>{t('language')}</IonLabel>
                  <IonSelect 
                    value={i18n.language} 
                    onIonChange={e => changeLanguage(e.detail.value)} 
                    slot="end" 
                    interface="popover"
                    interfaceOptions={{ cssClass: 'mtg-popover' }}
                    style={{color: '#c2b5b5', maxWidth: '100%'}}
                  >
                    <IonSelectOption value="en">English</IonSelectOption>
                    <IonSelectOption value="es-LA">Español (LA)</IonSelectOption>
                    <IonSelectOption value="fr">Français</IonSelectOption>
                  </IonSelect>
                </IonItem>
              </motion.div>

              <motion.div variants={itemVariants}>
                {/* Clears the stored session (token + user, see AuthContext)
                    and drops back to Onboarding. Nothing to call on the
                    backend — JWT is stateless, so there's no server-side
                    session to invalidate (would change if refresh-token
                    revocation gets added later). */}
                <IonItem className="mtg-list-item-row" lines="none" button onClick={logout}>
                  <IonIcon icon={logOutOutline} slot="start" style={{color: '#d3202a'}} />
                  <IonLabel style={{color: '#d3202a', fontWeight: 'bold'}}>{t('abandon_quest')}</IonLabel>
                </IonItem>
              </motion.div>
            </IonList>
          </motion.div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Tab4;
