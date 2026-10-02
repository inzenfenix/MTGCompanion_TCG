import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonIcon,
  useIonRouter,
  IonButton,
  IonButtons
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { timeOutline, scanOutline, libraryOutline, giftOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import { SpinWheelModal } from '../components/SpinWheelModal';

// ROADMAP.md L4 — one auto-popup per calendar day per account, tracked
// locally so it doesn't need its own "have I been shown this" endpoint.
// This is independent of (and looser than) the backend's own rolling 24h
// spin cooldown (CouponsService.spin()) — a mismatch just means the modal
// opens but the actual spin 400s, which SpinWheelModal already shows as its
// 'cooldown' state, not a bug.
const SPIN_WHEEL_SHOWN_KEY_PREFIX = 'mtg_spin_wheel_last_shown_';

const Tab1: React.FC = () => {
  const router = useIonRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [wheelOpen, setWheelOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = `${SPIN_WHEEL_SHOWN_KEY_PREFIX}${user.id}`;
    const today = new Date().toDateString();
    if (localStorage.getItem(key) !== today) {
      localStorage.setItem(key, today);
      setWheelOpen(true);
    }
  }, [user]);

  // This transaction list is still mock data — GET /transactions?userId=...
  // doesn't include card titles/images, so rendering the real ledger here
  // would need an extra fetch per row. Tab3 (Vault) is the tab actually
  // wired to the backend's card data — see src/lib/api.ts. (There is no
  // in-app balance/wallet concept — payment settlement happens through
  // MercadoPago or cash, per F2 in ROADMAP.md, not a stored balance.)
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
          <IonTitle>{t('keep_title')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setWheelOpen(true)} aria-label={t('spin_wheel_open')}>
              <IonIcon icon={giftOutline} slot="icon-only" />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <SpinWheelModal isOpen={wheelOpen} onClose={() => setWheelOpen(false)} />
      <IonContent fullscreen>
        <motion.div 
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <motion.div
            style={{ display: 'flex', gap: '15px', marginBottom: '25px' }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <IonButton className="mtg-btn" style={{flex: 1}} onClick={() => router.push('/tab2', 'forward')}>
              <div className="mtg-btn-content">
                <IonIcon icon={scanOutline} style={{ fontSize: '1.2rem' }} />
                <span>{t('new_trade')}</span>
              </div>
            </IonButton>

            <IonButton className="mtg-btn" style={{flex: 1}} onClick={() => router.push('/tab3', 'forward')}>
              <div className="mtg-btn-content">
                <IonIcon icon={libraryOutline} style={{ fontSize: '1.2rem' }} />
                <span>{t('open_vault')}</span>
              </div>
            </IonButton>
          </motion.div>

          <h2 style={{ paddingLeft: '5px', fontSize: '1.4rem', color: '#f2e3cd', margin: '0' }}>
            {t('ledger')}
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
                    {/* Mock ledger rows have no real photo (unlike Tab3's VaultCardThumbnail,
                        which resolves a presigned URL per card) — this placeholder just adopts
                        the same card-thumbnail look instead of the old buy/sell trend icon. */}
                    <div
                      className="mtg-card-image-placeholder"
                      style={{ width: '40px', height: '56px', borderRadius: '4px', border: 'none', flexShrink: 0 }}
                    />
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
