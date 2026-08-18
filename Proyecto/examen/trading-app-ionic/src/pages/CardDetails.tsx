import React, { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { useParams } from 'react-router';
import { storefrontOutline, pencilOutline, cashOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

const CardDetails: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [card, setCard] = useState<api.Card | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);
    api
      .getCard(id)
      .then((fetched) => {
        if (cancelled) return;
        setCard(fetched);
        const primaryPhoto = fetched.photos.find((p) => p.isPrimary) ?? fetched.photos[0];
        if (primaryPhoto) {
          api.getCardPhotoUrl(primaryPhoto.id).then(({ url }) => {
            if (!cancelled) setPhotoUrl(url);
          }).catch(() => { /* no photo to show */ });
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('loading_card')}</p>
            </div>
          )}

          {!isLoading && notFound && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p>{t('card_not_found')}</p>
            </div>
          )}

          {!isLoading && card && (
            <>
              <div
                className="mtg-card-image-placeholder"
                style={{
                  height: '300px',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
                  ...(photoUrl ? { backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
                }}
              >
                {!photoUrl && <span style={{ color: '#c2b5b5', fontStyle: 'italic' }}>{t('high_res_placeholder')}</span>}
              </div>

              <div style={{ marginTop: '30px', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '5px' }}>{card.title}</h1>
                <p style={{ color: '#c2b5b5', fontSize: '1.1rem', margin: '0' }}>
                  {[card.setName, card.rarity, `Condition: ${card.condition}`].filter(Boolean).join(' • ')}
                </p>

                <div style={{ margin: '25px 0' }}>
                  <p style={{ margin: '0', color: '#c2b5b5', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '2px' }}>{t('current_market_value')}</p>
                  <h2 style={{ fontSize: '3rem', margin: '5px 0', color: 'var(--ion-color-tertiary-tint)' }}>${card.guessedPrice.toFixed(2)}</h2>
                  {/* No Stage 3 (price estimation) endpoint exists anywhere yet — this is
                      the stored guessedPrice set when the card was listed, not a live estimate. */}
                  <p style={{ fontSize: '0.75rem', fontStyle: 'italic', opacity: 0.7 }}>{t('price_estimate_note')}</p>
                </div>

                {card.oracleText && (
                  <div style={{ background: 'rgba(20, 10, 15, 0.4)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(139, 0, 0, 0.2)', textAlign: 'left', marginBottom: '30px' }}>
                    <h4 style={{margin: '0 0 10px 0'}}>{t('oracle_text')}</h4>
                    <p style={{fontFamily: 'Georgia, serif', lineHeight: '1.6', color: '#e0d5d5', margin: '0'}}>
                      {card.oracleText}
                    </p>
                  </div>
                )}

                {card.ownerId === user?.id && (
                  <>
                    <IonButton expand="block" fill="outline" className="mtg-btn" routerLink={`/card/${card.id}/edit`} style={{ marginBottom: '10px' }}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={pencilOutline} />
                        <span>{t('edit_card_button')}</span>
                      </div>
                    </IonButton>
                    <IonButton expand="block" className="mtg-btn" routerLink="/tab2">
                      <div className="mtg-btn-content">
                        <IonIcon icon={storefrontOutline} />
                        <span>{t('list_market_sell')}</span>
                      </div>
                    </IonButton>
                  </>
                )}

                {/* ROADMAP.md J11 — one buy page (Buy.tsx), two ways to reach it: a
                    scanned QR (Tab2.tsx) or tapping a listing here/in the Bazaar
                    (TabSearch.tsx), same as this row's own "one buy page, two ways
                    to reach it" goal. */}
                {card.ownerId !== user?.id && (
                  <IonButton expand="block" className="mtg-btn" routerLink={`/buy/card/${card.id}`}>
                    <div className="mtg-btn-content">
                      <IonIcon icon={cashOutline} />
                      <span>{t('buy_this_artifact')}</span>
                    </div>
                  </IonButton>
                )}
              </div>
            </>
          )}
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default CardDetails;
