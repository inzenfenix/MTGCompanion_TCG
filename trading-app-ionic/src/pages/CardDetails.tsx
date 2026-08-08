import React from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonButton, IonIcon } from '@ionic/react';
import { useParams } from 'react-router';
import { storefrontOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const CardDetails: React.FC = () => {
  const { t } = useTranslation();
  // TODO: usar _id para pedir la carta real (Stage 1 identificación + Stage 3
  // precio) una vez el pipeline esté conectado — hoy la página es estática.
  const { id: _id } = useParams<{ id: string }>();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tab3" />
          </IonButtons>
          <IonTitle>{t('artifact_inspection')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="mtg-card-image-placeholder" style={{ height: '300px', boxShadow: '0 10px 30px rgba(0,0,0,0.8)' }}>
             <span style={{color: '#c2b5b5', fontStyle: 'italic'}}>{t('high_res_placeholder')}</span>
          </div>

          <div style={{ marginTop: '30px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '5px' }}>Chalice of the Void</h1>
            <p style={{ color: '#c2b5b5', fontSize: '1.1rem', margin: '0' }}>Mirrodin • Rare • Condition: Near Mint</p>

            <div style={{ margin: '25px 0' }}>
              <p style={{ margin: '0', color: '#c2b5b5', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '2px' }}>{t('current_market_value')}</p>
              <h2 style={{ fontSize: '3rem', margin: '5px 0', color: 'var(--ion-color-tertiary-tint)' }}>$45.00</h2>
            </div>

            <div style={{ background: 'rgba(20, 10, 15, 0.4)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(139, 0, 0, 0.2)', textAlign: 'left', marginBottom: '30px' }}>
              <h4 style={{margin: '0 0 10px 0'}}>{t('oracle_text')}</h4>
              <p style={{fontFamily: 'Georgia, serif', lineHeight: '1.6', color: '#e0d5d5', margin: '0'}}>
                Chalice of the Void enters the battlefield with X charge counters on it.
                <br/><br/>
                Whenever a player casts a spell with mana value equal to the number of charge counters on Chalice of the Void, counter that spell.
              </p>
            </div>

            <IonButton expand="block" className="mtg-btn" routerLink="/tab2">
              <div className="mtg-btn-content">
                <IonIcon icon={storefrontOutline} />
                <span>{t('list_market_sell')}</span>
              </div>
            </IonButton>
          </div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default CardDetails;
