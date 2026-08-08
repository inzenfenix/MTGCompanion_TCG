import { 
  IonContent, 
  IonHeader, 
  IonPage, 
  IonTitle, 
  IonToolbar, 
  IonIcon, 
  useIonRouter,
  IonButton
} from '@ionic/react';
import { trendingUp, trendingDown, timeOutline, scanOutline, libraryOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';

const Tab1: React.FC = () => {
  const router = useIonRouter();

  const transactions = [
    { id: 1, type: 'buy', amount: 45.00, card: 'Chalice of the Void', date: '2026-07-28' },
    { id: 2, type: 'sell', amount: 12.50, card: 'Lightning Bolt', date: '2026-07-27' },
    { id: 3, type: 'buy', amount: 8.00, card: 'Counterspell', date: '2026-07-25' },
    { id: 4, type: 'sell', amount: 120.00, card: 'Tarmogoyf', date: '2026-07-21' },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 100 } }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>The Keep</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div 
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div 
            initial={{ opacity: 0, y: -20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.6, type: 'spring' }}
            style={{ textAlign: 'center', marginBottom: '25px', marginTop: '10px' }}
          >
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 5px 0', letterSpacing: '2px', color: '#f2e3cd' }}>TREASURY BALANCE</h2>
            <h1 style={{ fontSize: '3.5rem', margin: '0', color: '#f2e3cd', fontFamily: 'Cinzel', fontWeight: 'bold' }}>
              $1,250.00
            </h1>
            <p style={{ margin: '5px 0', fontStyle: 'italic', color: '#c2b5b5' }}>Available for trade</p>
          </motion.div>

          <motion.div 
            style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <IonButton className="mtg-btn" style={{flex: 1}} onClick={() => router.push('/tab2', 'forward')}>
              <div className="mtg-btn-content">
                <IonIcon icon={scanOutline} style={{ fontSize: '1.2rem' }} />
                <span>New Trade</span>
              </div>
            </IonButton>
            
            <IonButton className="mtg-btn" style={{flex: 1}} onClick={() => router.push('/tab3', 'forward')}>
              <div className="mtg-btn-content">
                <IonIcon icon={libraryOutline} style={{ fontSize: '1.2rem' }} />
                <span>Open Vault</span>
              </div>
            </IonButton>
          </motion.div>

          <h2 style={{ paddingLeft: '5px', fontSize: '1.4rem', color: '#f2e3cd', margin: '0' }}>
            Ledger of Trades
          </h2>
          
          <motion.div variants={containerVariants} initial="hidden" animate="visible">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '15px', borderTop: '1px solid var(--border-color)', paddingTop: '15px' }}>
              {transactions.map((tx) => (
                <motion.div key={tx.id} variants={itemVariants} 
                  className="mtg-list-item-row"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px', borderRadius: '4px', cursor: 'pointer' }}
                  onClick={() => router.push(`/transaction/${tx.id}`, 'forward')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(128, 128, 128, 0.1)' }}>
                      <IonIcon
                        icon={tx.type === 'buy' ? trendingDown : trendingUp}
                        style={{ color: tx.type === 'buy' ? 'var(--ion-color-secondary-tint)' : 'var(--ion-color-tertiary-tint)', fontSize: '20px' }}
                      />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: '0 0 4px 0' }}>{tx.card}</h3>
                      <p style={{ fontSize: '0.85rem', margin: '0', display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.7 }}>
                        <IonIcon icon={timeOutline} /> {tx.date}
                      </p>
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: '1.2rem', fontFamily: 'Inter', color: tx.type === 'buy' ? 'var(--ion-color-secondary-tint)' : 'var(--ion-color-tertiary-tint)' }}>
                    {tx.type === 'buy' ? '-' : '+'}${tx.amount.toFixed(2)}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Tab1;
