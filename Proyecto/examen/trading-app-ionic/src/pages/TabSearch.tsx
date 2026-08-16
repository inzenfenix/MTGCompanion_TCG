import React, { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonSpinner,
  IonButton,
  useIonRouter,
} from '@ionic/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

// How long to wait after the user stops typing before hitting the backend —
// matches CatalogService's MIN_QUERY_LENGTH reasoning: a global search over
// every listed card shouldn't fire on every keystroke.
const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

type GeoState =
  | { status: 'idle' }
  | { status: 'granted'; lat: number; lng: number }
  | { status: 'denied' }
  | { status: 'unsupported' };

const TabSearch: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useIonRouter();

  const [searchText, setSearchText] = useState('');
  const [listings, setListings] = useState<api.CardListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  // Bumped by the retry button so the search effect below re-runs even when
  // `trimmed` hasn't changed (setSearchText to its own value wouldn't).
  const [retryToken, setRetryToken] = useState(0);

  // Tinder-style prompt: ask once when the Bazaar opens. Granting is the
  // only consent PATCH /users/me/location needs (see api.ts) — no separate
  // settings toggle exists or is needed.
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ status: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setGeo({ status: 'granted', lat: latitude, lng: longitude });
        if (user) {
          // Fire-and-forget: a failed location save shouldn't block search,
          // it just means other users won't see a distance to this one yet.
          api.updateMyLocation(latitude, longitude).catch(() => {});
        }
      },
      () => setGeo({ status: 'denied' }),
    );
    // Only on mount / when we learn who's logged in — re-running per
    // keystroke would re-prompt constantly.
  }, [user]);

  const trimmed = searchText.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setListings([]);
      setError(false);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(false);
    const timer = window.setTimeout(() => {
      api
        .searchCardListings({
          q: trimmed,
          excludeOwnerId: user?.id,
          limit: 30,
          ...(geo.status === 'granted' ? { lat: geo.lat, lng: geo.lng } : {}),
        })
        .then((results) => {
          if (!cancelled) setListings(results);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, user?.id, geo, retryToken]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0 },
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('bazaar_title')}</IonTitle>
        </IonToolbar>
        <IonToolbar style={{ '--background': 'rgba(10, 5, 8, 0.8)' }}>
          <IonSearchbar
            value={searchText}
            onIonInput={(e) => setSearchText(e.detail.value!)}
            placeholder={t('search_artifacts_example_placeholder')}
            style={{
              '--background': 'rgba(255,255,255,0.1)',
              '--color': '#f2e3cd',
              '--icon-color': '#f2e3cd',
              '--placeholder-color': '#c2b5b5',
            }}
          />
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {geo.status === 'denied' && (
            <p style={{ fontStyle: 'italic', color: '#c2b5b5', fontSize: '0.85rem', marginTop: 0 }}>
              {t('bazaar_location_denied')}
            </p>
          )}

          {trimmed.length < MIN_QUERY_LENGTH && !isLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: '#c2b5b5' }}>{t('bazaar_search_prompt')}</p>
            </div>
          )}

          {isLoading && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('bazaar_searching')}</p>
            </div>
          )}

          {!isLoading && error && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p>{t('vault_error')}</p>
              <IonButton
                fill="outline"
                className="mtg-btn"
                onClick={() => setRetryToken((n) => n + 1)}
              >
                {t('retry')}
              </IonButton>
            </div>
          )}

          {!isLoading &&
            !error &&
            trimmed.length >= MIN_QUERY_LENGTH &&
            listings.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <p style={{ color: '#c2b5b5' }}>
                  {t('bazaar_no_results', { query: trimmed })}
                </p>
              </div>
            )}

          {!isLoading && !error && listings.length > 0 && (
            <AnimatePresence mode="wait">
              <motion.div
                key={trimmed}
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <IonList className="mtg-list">
                  {listings.map((listing) => (
                    <motion.div key={listing.id} variants={itemVariants}>
                      <IonItem
                        className="mtg-list-item-row"
                        lines="full"
                        button
                        onClick={() => router.push(`/card/${listing.id}`, 'forward')}
                      >
                        <div
                          className="mtg-card-image-placeholder"
                          slot="start"
                          style={{ width: '40px', height: '56px', borderRadius: '4px', flexShrink: 0 }}
                        />
                        <IonLabel>
                          <h3 style={{ color: '#f2e3cd', fontWeight: 'bold' }}>{listing.title}</h3>
                          <p style={{ color: '#c2b5b5' }}>
                            {t('bazaar_offered_by')} {listing.ownerDisplayName}
                          </p>
                        </IonLabel>
                        <IonLabel slot="end" style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 'bold', color: 'var(--ion-color-tertiary-tint)' }}>
                            ${listing.guessedPrice.toFixed(2)}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#c2b5b5' }}>
                            {listing.distanceKm !== null
                              ? t('bazaar_distance_away', { km: listing.distanceKm.toFixed(1) })
                              : t('bazaar_distance_unknown')}
                          </div>
                        </IonLabel>
                      </IonItem>
                    </motion.div>
                  ))}
                </IonList>
              </motion.div>
            </AnimatePresence>
          )}
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default TabSearch;
