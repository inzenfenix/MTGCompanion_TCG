import React, { useState } from 'react';
import {
  IonContent,
  IonPage,
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonText,
} from '@ionic/react';
import { personAddOutline, keyOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import { ApiError } from '../lib/api';

// The only screen shown before there is a "current user" — see
// src/lib/auth/AuthContext.tsx for why this isn't a real login. It offers
// two paths: register a brand-new account against the real backend, or
// paste in an existing user id (handy for testing on a second device/tab
// without re-registering, since there's no password check to gate it).
const Onboarding: React.FC = () => {
  const { t } = useTranslation();
  const { register, continueWithExistingUserId } = useAuth();
  const [mode, setMode] = useState<'register' | 'existing'>('register');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [existingId, setExistingId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await register({ email, password, displayName });
      // On success, useAuth's `user` flips to non-null and App.tsx swaps
      // this screen out for the tabs — no navigation call needed here.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onboarding_error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseExistingId = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await continueWithExistingUserId(existingId.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('onboarding_error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <IonPage>
      <IonContent fullscreen>
        <motion.div
          className="mtg-container"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{ marginTop: '15vh' }}
        >
          <h1 style={{ textAlign: 'center', marginTop: 0 }}>{t('onboarding_title')}</h1>
          <p style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: '25px' }}>
            {t('onboarding_intro')}
          </p>

          <IonSegment
            value={mode}
            onIonChange={(e) => setMode(e.detail.value as 'register' | 'existing')}
            style={{ marginBottom: '20px' }}
          >
            <IonSegmentButton value="register">
              <IonLabel>{t('create_account')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="existing">
              <IonLabel>{t('field_user_id')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {mode === 'register' ? (
            <>
              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_display_name')}</IonLabel>
                <IonInput
                  value={displayName}
                  onIonInput={(e) => setDisplayName(e.detail.value ?? '')}
                  style={{ color: '#f2e3cd' }}
                />
              </IonItem>
              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_email')}</IonLabel>
                <IonInput
                  type="email"
                  value={email}
                  onIonInput={(e) => setEmail(e.detail.value ?? '')}
                  style={{ color: '#f2e3cd' }}
                />
              </IonItem>
              <IonItem className="mtg-list-item-row" style={{ marginBottom: '20px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_password')}</IonLabel>
                <IonInput
                  type="password"
                  value={password}
                  onIonInput={(e) => setPassword(e.detail.value ?? '')}
                  style={{ color: '#f2e3cd' }}
                />
              </IonItem>

              <IonButton
                expand="block"
                className="mtg-btn"
                disabled={isSubmitting || !displayName || !email || password.length < 8}
                onClick={handleRegister}
              >
                <div className="mtg-btn-content">
                  <IonIcon icon={personAddOutline} />
                  <span>{t('create_account')}</span>
                </div>
              </IonButton>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.9rem' }}>{t('onboarding_or_existing')}</p>
              <IonItem className="mtg-list-item-row" style={{ marginBottom: '20px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_user_id')}</IonLabel>
                <IonInput
                  value={existingId}
                  onIonInput={(e) => setExistingId(e.detail.value ?? '')}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  style={{ color: '#f2e3cd' }}
                />
              </IonItem>

              <IonButton
                expand="block"
                className="mtg-btn"
                disabled={isSubmitting || !existingId.trim()}
                onClick={handleUseExistingId}
              >
                <div className="mtg-btn-content">
                  <IonIcon icon={keyOutline} />
                  <span>{t('continue_with_id')}</span>
                </div>
              </IonButton>
            </>
          )}

          {error && (
            <IonText color="danger">
              <p style={{ marginTop: '15px', textAlign: 'center' }}>{error}</p>
            </IonText>
          )}
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Onboarding;
