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
  IonChip,
  IonLabel,
  IonAlert,
  useIonRouter,
  useIonViewWillEnter,
} from '@ionic/react';
import { addOutline, pencilOutline, trashOutline } from 'ionicons/icons';
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

  // ROADMAP.md K — deck picker state. 'all' = every Vault card regardless
  // of deck (today's only behavior, kept as the default so this is
  // additive, not a breaking redesign — same posture J3 took keeping
  // Manual mode untouched alongside Smart Scan). 'unsorted' is the query
  // sentinel api.listCards already expects for "no deck".
  const [decks, setDecks] = useState<api.Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<'all' | 'unsorted' | string>('all');
  const [deckError, setDeckError] = useState<string | null>(null);
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [showRenameDeck, setShowRenameDeck] = useState(false);
  const [showDeleteDeck, setShowDeleteDeck] = useState(false);

  const fetchCards = useCallback(() => {
    if (!user) return;
    setIsLoading(true);
    setError(false);
    const deckIdParam = selectedDeck === 'all' ? undefined : selectedDeck;
    api
      // ROADMAP.md J1/J3 — the Vault is the permanent collection view only;
      // SCAN_LISTING cards (scanned purely to generate a sell QR) don't
      // belong here even though they're real Card rows under the hood.
      .listCards(user.id, 'VAULT', deckIdParam)
      .then(setCards)
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, [user, selectedDeck]);

  const fetchDecks = useCallback(() => {
    if (!user) return;
    api
      .listDecks(user.id)
      .then(setDecks)
      .catch(() => {
        /* non-critical — the picker just shows fewer options than it should, cards themselves still load */
      });
  }, [user]);

  // Refetch every time the Vault tab comes into view (e.g. after listing a
  // new card) — Ionic keeps tab components mounted across tab switches, so
  // a plain useEffect-on-mount wouldn't pick up cards listed elsewhere.
  useIonViewWillEnter(() => {
    fetchCards();
    fetchDecks();
  });

  useEffect(() => {
    fetchCards();
  }, [fetchCards]);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  const selectedDeckEntity = decks.find((d) => d.id === selectedDeck) ?? null;

  // ROADMAP.md K6 — deck-level stats. Deliberately summed over `cards` (the
  // full server-fetched, deck-scoped list) rather than `filteredCards`, so
  // an incidental Vault search doesn't make the deck itself look smaller
  // than it really is. Reuses each card's already-computed guessedPrice
  // (Stage 3) — no new estimation, no backend endpoint needed.
  const deckCardCount = cards.length;
  const deckTotalValue = cards.reduce((sum, card) => sum + card.guessedPrice, 0);

  const handleCreateDeck = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDeckError(null);
    try {
      const deck = await api.createDeck(trimmed);
      setDecks((prev) => [...prev, deck]);
      setSelectedDeck(deck.id);
    } catch (err) {
      setDeckError(err instanceof api.ApiError ? err.message : t('deck_create_error'));
    }
  };

  const handleRenameDeck = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !selectedDeckEntity) return;
    setDeckError(null);
    try {
      const renamed = await api.renameDeck(selectedDeckEntity.id, trimmed);
      setDecks((prev) => prev.map((d) => (d.id === renamed.id ? renamed : d)));
    } catch (err) {
      setDeckError(err instanceof api.ApiError ? err.message : t('deck_rename_error'));
    }
  };

  const handleDeleteDeck = async () => {
    if (!selectedDeckEntity) return;
    setDeckError(null);
    try {
      await api.deleteDeck(selectedDeckEntity.id);
      setDecks((prev) => prev.filter((d) => d.id !== selectedDeckEntity.id));
      // Its cards were just un-assigned to Unsorted server-side (the FK's
      // own onDelete: SetNull, ROADMAP.md K2) — jump to "All" rather than
      // "unsorted" specifically, so a card that was ALSO already Unsorted
      // before this delete doesn't look like it "moved" for no reason.
      setSelectedDeck('all');
    } catch (err) {
      setDeckError(err instanceof api.ApiError ? err.message : t('deck_delete_error'));
    }
  };

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
          {/* ROADMAP.md K4 — deck picker. "All" (default, unchanged behavior)
              and "Unsorted" are always shown; real decks follow, then a "+"
              chip to create one. Kept as a plain horizontally-scrolling row
              of IonChip rather than IonSegment — a fixed-width segment strip
              doesn't scale to an arbitrary, user-grown number of decks. */}
          <div style={{ display: 'flex', overflowX: 'auto', gap: '8px', padding: '4px 2px 12px', alignItems: 'center' }}>
            <IonChip
              outline={selectedDeck !== 'all'}
              color={selectedDeck === 'all' ? 'tertiary' : undefined}
              onClick={() => setSelectedDeck('all')}
            >
              <IonLabel>{t('deck_filter_all')}</IonLabel>
            </IonChip>
            <IonChip
              outline={selectedDeck !== 'unsorted'}
              color={selectedDeck === 'unsorted' ? 'tertiary' : undefined}
              onClick={() => setSelectedDeck('unsorted')}
            >
              <IonLabel>{t('deck_filter_unsorted')}</IonLabel>
            </IonChip>
            {decks.map((deck) => (
              <IonChip
                key={deck.id}
                outline={selectedDeck !== deck.id}
                color={selectedDeck === deck.id ? 'tertiary' : undefined}
                onClick={() => setSelectedDeck(deck.id)}
              >
                <IonLabel>{deck.name}</IonLabel>
              </IonChip>
            ))}
            <IonChip onClick={() => setShowCreateDeck(true)}>
              <IonIcon icon={addOutline} />
              <IonLabel>{t('deck_create')}</IonLabel>
            </IonChip>
            {selectedDeckEntity && (
              <>
                <IonIcon
                  icon={pencilOutline}
                  style={{ fontSize: '1.2rem', cursor: 'pointer', color: '#c2b5b5', flexShrink: 0 }}
                  onClick={() => setShowRenameDeck(true)}
                  title={t('deck_rename')}
                />
                <IonIcon
                  icon={trashOutline}
                  style={{ fontSize: '1.2rem', cursor: 'pointer', color: '#c2b5b5', flexShrink: 0 }}
                  onClick={() => setShowDeleteDeck(true)}
                  title={t('deck_delete')}
                />
              </>
            )}
          </div>

          {!isLoading && !error && (
            <p style={{ color: '#c2b5b5', fontSize: '0.85rem', margin: '0 0 10px' }}>
              {t('deck_stats', { count: deckCardCount, value: deckTotalValue.toFixed(2) })}
            </p>
          )}

          {deckError && (
            <p style={{ color: '#ff8080', fontSize: '0.85rem', margin: '0 0 10px' }}>{deckError}</p>
          )}

          <IonAlert
            isOpen={showCreateDeck}
            onDidDismiss={() => setShowCreateDeck(false)}
            header={t('deck_create')}
            inputs={[{ name: 'name', type: 'text', placeholder: t('deck_name_placeholder') }]}
            buttons={[
              { text: t('cancel'), role: 'cancel' },
              { text: t('deck_create'), handler: (data: { name?: string }) => handleCreateDeck(data.name ?? '') },
            ]}
          />
          <IonAlert
            isOpen={showRenameDeck}
            onDidDismiss={() => setShowRenameDeck(false)}
            header={t('deck_rename')}
            inputs={[{ name: 'name', type: 'text', value: selectedDeckEntity?.name ?? '' }]}
            buttons={[
              { text: t('cancel'), role: 'cancel' },
              { text: t('save_changes'), handler: (data: { name?: string }) => handleRenameDeck(data.name ?? '') },
            ]}
          />
          <IonAlert
            isOpen={showDeleteDeck}
            onDidDismiss={() => setShowDeleteDeck(false)}
            header={t('deck_delete')}
            message={t('deck_delete_confirm', { name: selectedDeckEntity?.name ?? '' })}
            buttons={[
              { text: t('cancel'), role: 'cancel' },
              { text: t('deck_delete'), role: 'destructive', handler: () => handleDeleteDeck() },
            ]}
          />

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
              {/* ROADMAP.md K — an empty DECK isn't the same situation as an
                  empty Vault (the user may well have cards, just not in
                  this deck/Unsorted) — "list your first card" would be a
                  wrong, confusing prompt there. */}
              <p>{selectedDeck === 'all' ? t('vault_empty') : t('deck_filter_empty')}</p>
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
