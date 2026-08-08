import React, { useState } from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonSearchbar, IonSegment, IonSegmentButton, IonLabel, IonIcon, IonList, IonItem } from '@ionic/react';
import { locationOutline, storefrontOutline, personOutline } from 'ionicons/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const TabSearch: React.FC = () => {
  const { t } = useTranslation();
  const [searchType, setSearchType] = useState<'nearby' | 'stores'>('nearby');
  const [searchText, setSearchText] = useState('');

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0 }
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
            onIonInput={e => setSearchText(e.detail.value!)}
            placeholder={t('search_artifacts_example_placeholder')}
            style={{'--background': 'rgba(255,255,255,0.1)', '--color': '#f2e3cd', '--icon-color': '#f2e3cd', '--placeholder-color': '#c2b5b5'}}
          />
        </IonToolbar>
        <IonToolbar style={{ '--background': 'rgba(10, 5, 8, 0.8)' }}>
          <IonSegment value={searchType} onIonChange={e => setSearchType(e.detail.value as 'nearby' | 'stores')}>
            <IonSegmentButton value="nearby">
              <IonLabel><IonIcon icon={personOutline} style={{verticalAlign: 'middle'}}/> {t('players_nearby')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="stores">
              <IonLabel><IonIcon icon={storefrontOutline} style={{verticalAlign: 'middle'}}/> {t('local_stores')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div 
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <AnimatePresence mode="wait">
            <motion.div key={searchType} variants={containerVariants} initial="hidden" animate="visible" exit="hidden">
              <h2 style={{marginTop: '0'}}>{searchType === 'nearby' ? t('wandering_merchants') : t('established_guilds')}</h2>
              <p style={{fontStyle: 'italic', color: '#c2b5b5', marginBottom: '20px'}}>
                {searchType === 'nearby' ? t('nearby_desc') : t('stores_desc')}
              </p>

              <IonList className="mtg-list">
                {searchType === 'nearby' ? (
                  <>
                    <motion.div variants={itemVariants}>
                      <IonItem className="mtg-list-item-row" lines="full" button routerLink="/card/1">
                        <IonIcon icon={locationOutline} slot="start" style={{color: 'var(--ion-color-secondary-tint)'}} />
                        <IonLabel>
                          <h3 style={{color: '#f2e3cd', fontWeight: 'bold'}}>LootGoblin99</h3>
                          <p style={{color: '#c2b5b5'}}>{t('has_card')} Chalice of the Void</p>
                        </IonLabel>
                        <IonLabel slot="end" style={{color: 'var(--ion-color-tertiary-tint)', textAlign: 'right'}}>
                          <div style={{fontWeight: 'bold'}}>0.2 {t('miles')}</div>
                        </IonLabel>
                      </IonItem>
                    </motion.div>
                    <motion.div variants={itemVariants}>
                      <IonItem className="mtg-list-item-row" lines="full" button>
                        <IonIcon icon={locationOutline} slot="start" style={{color: 'var(--ion-color-secondary-tint)'}} />
                        <IonLabel>
                          <h3 style={{color: '#f2e3cd', fontWeight: 'bold'}}>SpellSlinger007</h3>
                          <p style={{color: '#c2b5b5'}}>{t('looking_for')} Tarmogoyf</p>
                        </IonLabel>
                        <IonLabel slot="end" style={{color: 'var(--ion-color-tertiary-tint)', textAlign: 'right'}}>
                          <div style={{fontWeight: 'bold'}}>1.5 {t('miles')}</div>
                        </IonLabel>
                      </IonItem>
                    </motion.div>
                  </>
                ) : (
                  <>
                    <motion.div variants={itemVariants}>
                      <IonItem className="mtg-list-item-row" lines="full" button>
                        <IonIcon icon={storefrontOutline} slot="start" style={{color: '#d4af37'}} />
                        <IonLabel>
                          <h3 style={{color: '#f2e3cd', fontWeight: 'bold'}}>Dragon's Lair Games</h3>
                          <p style={{color: '#c2b5b5'}}>{t('verified_store')}</p>
                        </IonLabel>
                        <IonLabel slot="end" style={{color: 'var(--ion-color-tertiary-tint)', textAlign: 'right'}}>
                          <div style={{fontWeight: 'bold'}}>3.0 {t('miles')}</div>
                        </IonLabel>
                      </IonItem>
                    </motion.div>
                  </>
                )}
              </IonList>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default TabSearch;
