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
import { personAddOutline, logInOutline } from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth/AuthContext';
import { ApiError } from '../lib/api';

// The only screen shown before there is a session — see
// src/lib/auth/AuthContext.tsx. Two paths: register a new account (which
// logs you in immediately after), or sign in with an existing one — see
// backend/README.md for the test@example.com / password123 account seeded
// for local dev.
const Onboarding: React.FC = () => {
  const { t } = useTranslation();
  const { register, login } = useAuth();
  const [mode, setMode] = useState<'register' | 'login'>('login');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ email, password });
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
            onIonChange={(e) => setMode(e.detail.value as 'register' | 'login')}
            style={{ marginBottom: '20px' }}
          >
            <IonSegmentButton value="login">
              <IonLabel>{t('sign_in')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="register">
              <IonLabel>{t('create_account')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {mode === 'register' && (
            <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_display_name')}</IonLabel>
              <IonInput
                value={displayName}
                onIonInput={(e) => setDisplayName(e.detail.value ?? '')}
                style={{ color: '#f2e3cd' }}
              />
            </IonItem>
          )}

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

          {mode === 'register' ? (
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
          ) : (
            <IonButton
              expand="block"
              className="mtg-btn"
              disabled={isSubmitting || !email || !password}
              onClick={handleLogin}
            >
              <div className="mtg-btn-content">
                <IonIcon icon={logInOutline} />
                <span>{t('sign_in')}</span>
              </div>
            </IonButton>
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
