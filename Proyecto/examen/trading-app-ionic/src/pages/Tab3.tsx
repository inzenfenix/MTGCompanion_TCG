import React, { useCallback, useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonSearchbar,
  IonGrid,
  IonRow,
  IonCol,
  IonFab,
  IonFabButton,
  IonIcon,
  IonSpinner,
  IonButton,
  useIonRouter,
  useIonViewWillEnter,
} from '@ionic/react';
import { addOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

/** Small subcomponent so each card's primary photo can resolve its presigned URL independently. */
const VaultCardThumbnail: React.FC<{ card: api.Card }> = ({ card }) => {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const primaryPhoto = card.photos.find((p) => p.isPrimary) ?? card.photos[0];

  useEffect(() => {
    if (!primaryPhoto) return;
    let cancelled = false;
    api
      .getCardPhotoUrl(primaryPhoto.id)
      .then(({ url }) => {
        if (!cancelled) setPhotoUrl(url);
      })
      .catch(() => {
        /* No photo to show — falls back to the placeholder below. */
      });
    return () => {
      cancelled = true;
    };
  }, [primaryPhoto]);

  if (photoUrl) {
    return (
      <div
        className="mtg-card-image-placeholder"
        style={{ backgroundImage: `url(${photoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
    );
  }

  return (
    <div className="mtg-card-image-placeholder">
      <span style={{ color: '#c2b5b5', fontSize: '0.8rem', opacity: 0.5 }}>[Image]</span>
    </div>
  );
};

const Tab3: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchText, setSearchText] = useState('');
  const router = useIonRouter();

  const [cards, setCards] = useState<api.Card[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchCards = useCallback(() => {
    if (!user) return;
    setIsLoading(true);
    setError(false);
    api
      // ROADMAP.md J1/J3 — the Vault is the permanent collection view only;
      // SCAN_LISTING cards (scanned purely to generate a sell QR) don't
      // belong here even though they're real Card rows under the hood.
      .listCards(user.id, 'VAULT')
      .then(setCards)
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, [user]);

  // Refetch every time the Vault tab comes into view (e.g. after listing a
  // new card) — Ionic keeps tab components mounted across tab switches, so
  // a plain useEffect-on-mount wouldn't pick up cards listed elsewhere.
  useIonViewWillEnter(() => {
    fetchCards();
  });

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  const filteredCards = cards.filter((card) =>
    card.title.toLowerCase().includes(searchText.toLowerCase()),
  );

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: { opacity: 1, scale: 1 }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('vault_title')}</IonTitle>
        </IonToolbar>
        <IonToolbar style={{ '--background': 'rgba(10, 5, 8, 0.8)' }}>
          <IonSearchbar
            value={searchText}
            onIonInput={e => setSearchText(e.detail.value!)}
            placeholder={t('search_artifacts_placeholder')}
            style={{'--background': 'rgba(255,255,255,0.1)', '--color': '#f2e3cd', '--icon-color': '#f2e3cd', '--placeholder-color': '#c2b5b5'}}
          />
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
        >
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('vault_loading')}</p>
            </div>
          )}

          {!isLoading && error && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p>{t('vault_error')}</p>
              <IonButton fill="outline" className="mtg-btn" onClick={fetchCards}>{t('retry')}</IonButton>
            </div>
          )}

          {!isLoading && !error && filteredCards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p>{t('vault_empty')}</p>
            </div>
          )}

          {!isLoading && !error && filteredCards.length > 0 && (
            <motion.div variants={containerVariants} initial="hidden" animate="visible">
              <IonGrid>
                <IonRow>
                  {filteredCards.map(card => (
                    <IonCol size="6" key={card.id} style={{ padding: '8px' }}>
                      <motion.div variants={itemVariants} style={{ height: '100%', cursor: 'pointer' }} onClick={() => router.push(`/card/${card.id}`, 'forward')}>
                        <div className="mtg-card-item" style={{ height: '100%' }}>
                          <VaultCardThumbnail card={card} />
                          <div className="mtg-card-details">
                            <div>
                              <h4 style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#f2e3cd', fontWeight: 'bold' }}>{card.title}</h4>
                              <p style={{ margin: '0', fontSize: '0.75rem', color: '#c2b5b5' }}>{card.setName ?? card.condition}</p>
                            </div>
                            <div style={{ marginTop: '10px', fontWeight: 'bold', color: '#f2e3cd', fontFamily: 'Cinzel', fontSize: '1.1rem' }}>
                              ${card.guessedPrice.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </IonCol>
                  ))}
                </IonRow>
              </IonGrid>
            </motion.div>
          )}
        </motion.div>

        <IonFab vertical="bottom" horizontal="end" slot="fixed" style={{ marginBottom: '20px', marginRight: '10px' }}>
          <IonFabButton className="mtg-btn" routerLink="/list-card" title={t('list_a_card')}>
            <IonIcon icon={addOutline} />
          </IonFabButton>
        </IonFab>
      </IonContent>
    </IonPage>
  );
};

export default Tab3;
