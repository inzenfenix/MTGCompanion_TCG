import React, { useEffect, useState } from 'react';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import * as api from '../lib/api';

/**
 * Ejercer mis derechos sin iniciar sesión (ROADMAP.md O16,
 * docs/security/ACTIVIDAD_6.md §1). The contact form art. 11 asks for:
 *   1. Form — address, right, grounds where the law asks for them. The
 *      answer is always the same, whether the address has an account or not.
 *   2. Confirm — the single-use code emailed to that address (or the link,
 *      which lands here with ?code=). Nothing is processed before that.
 * Requests that need more than the mailbox (access, rectification,
 * erasure) are then finished in the app with the password: this screen
 * says so instead of pretending they're done.
 */

const card: React.CSSProperties = {
  background: 'rgba(20,10,15,0.4)',
  border: '1px solid rgba(139,0,0,0.25)',
  padding: '14px',
  borderRadius: '8px',
  marginBottom: '14px',
};
const muted: React.CSSProperties = { color: '#c2b5b5', fontSize: '0.85em', margin: '6px 0' };
const heading: React.CSSProperties = { color: '#f2e3cd', margin: '18px 0 10px' };

type FormType = api.PublicRightsInput['type'];

const RightsPublic: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [type, setType] = useState<FormType>('ACCESS');
  const [purpose, setPurpose] = useState<api.ObjectionPurposeCode>('SALES_STATISTICS');
  const [statement, setStatement] = useState('');
  const [requestBlocking, setRequestBlocking] = useState(false);
  const [purposes, setPurposes] = useState<api.ObjectionPurpose[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getObjectionPurposes()
      .then(setPurposes)
      .catch(() => setPurposes([]));
  }, []);

  // Arriving from the emailed link: prefill the code.
  useEffect(() => {
    const fromLink = new URLSearchParams(location.search).get('code');
    if (fromLink) setCode(fromLink);
  }, [location.search]);

  const needsStatement = type === 'OBJECTION';
  const canBlock = type !== 'ACCESS';

  const send = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.submitPublicRightsRequest({
        email: email.trim(),
        type,
        ...(type === 'OBJECTION' ? { purpose } : {}),
        ...(statement.trim() ? { statement: statement.trim() } : {}),
        ...(canBlock && requestBlocking ? { requestBlocking: true } : {}),
      });
      setMessage({ ok: true, text: res.message });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof api.ApiError ? err.message : t('privacy_request_error') });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.confirmPublicRightsRequest(code.trim());
      if (res.request.outcome === 'DENIED') {
        setMessage({ ok: false, text: res.request.message ?? t('privacy_request_denied') });
      } else if (res.next === 'COMPLETE_IN_APP') {
        setMessage({
          ok: true,
          text: t('rights_public_complete_in_app') + (res.blocking ? ` ${t('rights_public_blocked_meanwhile')}` : ''),
        });
      } else {
        setMessage({ ok: true, text: t('rights_public_done') });
      }
      setCode('');
    } catch {
      setMessage({ ok: false, text: t('rights_public_bad_code') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/onboarding" /></IonButtons>
          <IonTitle>{t('rights_public_title')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {message && (
            <p role="status" style={{ ...card, color: message.ok ? '#9be29b' : '#ff8080' }}>{message.text}</p>
          )}

          <h3 style={heading}>1. {t('rights_public_step_send')}</h3>
          <div style={card}>
            <p style={muted}>{t('rights_public_help')}</p>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('privacy_field_email')}</IonLabel>
              <IonInput type="email" value={email} onIonInput={(e) => setEmail(String(e.detail.value ?? ''))} style={{ color: '#f2e3cd' }} />
            </IonItem>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel style={{ color: '#c2b5b5' }}>{t('rights_public_right')}</IonLabel>
              <IonSelect value={type} onIonChange={(e) => setType(e.detail.value as FormType)} slot="end">
                <IonSelectOption value="ACCESS">{t('privacy_type_ACCESS')}</IonSelectOption>
                <IonSelectOption value="RECTIFICATION">{t('privacy_type_RECTIFICATION')}</IonSelectOption>
                <IonSelectOption value="ERASURE">{t('privacy_type_ERASURE')}</IonSelectOption>
                <IonSelectOption value="OBJECTION">{t('privacy_type_OBJECTION')}</IonSelectOption>
              </IonSelect>
            </IonItem>
            {type === 'OBJECTION' && (
              <>
                <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
                  <IonLabel style={{ color: '#c2b5b5' }}>{t('rights_public_purpose')}</IonLabel>
                  <IonSelect value={purpose} onIonChange={(e) => setPurpose(e.detail.value as api.ObjectionPurposeCode)} slot="end">
                    {purposes.map((p) => (
                      <IonSelectOption key={p.code} value={p.code}>{p.title}</IonSelectOption>
                    ))}
                  </IonSelect>
                </IonItem>
                <p style={muted}>{purposes.find((p) => p.code === purpose)?.description}</p>
              </>
            )}
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>
                {needsStatement ? t('rights_public_statement_required') : t('rights_public_statement_optional')}
              </IonLabel>
              <IonTextarea value={statement} maxlength={500} autoGrow onIonInput={(e) => setStatement(String(e.detail.value ?? ''))} style={{ color: '#f2e3cd' }} />
            </IonItem>
            {canBlock && (
              <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
                <IonCheckbox
                  slot="start"
                  checked={requestBlocking}
                  onIonChange={(e) => setRequestBlocking(e.detail.checked)}
                  aria-label={t('rights_public_block')}
                />
                <span style={{ color: '#c2b5b5', whiteSpace: 'normal', fontSize: '0.9em' }}>{t('rights_public_block')}</span>
              </IonItem>
            )}
            <IonButton
              expand="block"
              className="mtg-btn"
              disabled={busy || !email.trim() || (needsStatement && statement.trim().length < 10)}
              onClick={() => void send()}
            >
              {t('rights_public_send')}
            </IonButton>
          </div>

          <h3 style={heading}>2. {t('rights_public_step_confirm')}</h3>
          <div style={card}>
            <p style={muted}>{t('rights_public_confirm_help')}</p>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('rights_public_code')}</IonLabel>
              <IonInput value={code} onIonInput={(e) => setCode(String(e.detail.value ?? ''))} style={{ color: '#f2e3cd' }} />
            </IonItem>
            <IonButton expand="block" className="mtg-btn" disabled={busy || code.trim().length < 20} onClick={() => void confirm()}>
              {t('rights_public_confirm')}
            </IonButton>
          </div>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default RightsPublic;
