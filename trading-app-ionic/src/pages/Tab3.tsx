import React, { useState } from 'react';
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
  useIonRouter
} from '@ionic/react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const Tab3: React.FC = () => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const router = useIonRouter();

  const collection = [
    { id: 1, name: 'Black Lotus', set: 'Alpha', price: 25000.00 },
    { id: 2, name: 'Mox Sapphire', set: 'Beta', price: 8500.00 },
    { id: 3, name: 'Ancestral Recall', set: 'Unlimited', price: 5200.00 },
    { id: 4, name: 'Time Walk', set: 'Beta', price: 7100.00 },
    { id: 5, name: 'Underground Sea', set: 'Revised', price: 850.00 },
    { id: 6, name: 'Force of Will', set: 'Alliances', price: 95.00 },
  ];

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
          <motion.div variants={containerVariants} initial="hidden" animate="visible">
            <IonGrid>
              <IonRow>
                {collection.map(card => (
                  <IonCol size="6" key={card.id} style={{ padding: '8px' }}>
                    <motion.div variants={itemVariants} style={{ height: '100%', cursor: 'pointer' }} onClick={() => router.push(`/card/${card.id}`, 'forward')}>
                      <div className="mtg-card-item" style={{ height: '100%' }}>
                        <div className="mtg-card-image-placeholder">
                          <span style={{color: '#c2b5b5', fontSize: '0.8rem', opacity: 0.5}}>[Image]</span>
                        </div>
                        <div className="mtg-card-details">
                          <div>
                            <h4 style={{ margin: '0 0 5px 0', fontSize: '0.95rem', color: '#f2e3cd', fontWeight: 'bold' }}>{card.name}</h4>
                            <p style={{ margin: '0', fontSize: '0.75rem', color: '#c2b5b5' }}>{card.set}</p>
                          </div>
                          <div style={{ marginTop: '10px', fontWeight: 'bold', color: '#f2e3cd', fontFamily: 'Cinzel', fontSize: '1.1rem' }}>
                            ${card.price.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </IonCol>
                ))}
              </IonRow>
            </IonGrid>
          </motion.div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Tab3;
