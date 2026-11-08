import React, { useCallback, useEffect, useState } from 'react';
import {
  IonAlert,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/react';
import {
  banOutline,
  checkmarkDoneOutline,
  createOutline,
  downloadOutline,
  handLeftOutline,
  pauseCircleOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useHistory } from 'react-router-dom';
import * as api from '../lib/api';
import { useAuth } from '../lib/auth/AuthContext';

/**
 * Privacidad y mis datos (ROADMAP.md O15, docs/security/ACTIVIDAD_5.md).
 *   1. Consentimientos — one toggle per purpose, each with the exact text
 *      and version it applies to; granting one never touches another.
 *   2. Historial — every grant/revocation the backend recorded.
 *   3. Mis derechos — access/portability (JSON download), rectification,
 *      erasure. The risky ones ask for the password again first (step-up);
 *      the server enforces that too, this screen just collects it.
 *   4. Mis solicitudes — status and legal deadline of each request.
 *   O16 (docs/security/ACTIVIDAD_6.md):
 *   5. Oposición — one card per legitimate-interest processing, with the
 *      decision fixed in advance (upheld / denied with grounds).
 *   6. Bloqueo temporal — what it stops and what it doesn't; as an
 *      alternative to erasure, or while a request is pending.
 *   Requests that came in through the public form show "Completar" (step-up).
 */

type PendingAction =
  | { kind: 'access' }
  | { kind: 'rectify'; rectification: api.RightsRequestInput['rectification'] }
  | { kind: 'erase' }
  | { kind: 'complete'; request: api.RightsRequest };

/** Actions that need the holder's grounds first (Ley 19.628, art. 11). */
type StatementAction =
  | { kind: 'object'; purpose: api.ObjectionPurposeCode }
  | { kind: 'block'; basis: api.BlockingBasis; relatedRequestId?: string };

const OPEN = ['AWAITING_CONFIRMATION', 'PENDING_STEP_UP', 'RECEIVED', 'VERIFIED', 'IN_EVALUATION'];

const card: React.CSSProperties = {
  background: 'rgba(20,10,15,0.4)',
  border: '1px solid rgba(139,0,0,0.25)',
  padding: '14px',
  borderRadius: '8px',
  marginBottom: '14px',
};
const muted: React.CSSProperties = { color: '#c2b5b5', fontSize: '0.85em', margin: '6px 0' };
const heading: React.CSSProperties = { color: '#f2e3cd', margin: '18px 0 10px' };
const toggleStyle = { '--handle-background-checked': '#d4af37', '--background-checked': '#8b0000' } as React.CSSProperties;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const Privacy: React.FC = () => {
  const { t } = useTranslation();
  const { user, logout, updateUser } = useAuth();
  const history = useHistory();

  const [purposes, setPurposes] = useState<api.ConsentPurpose[]>([]);
  const [consents, setConsents] = useState<api.ConsentState[]>([]);
  const [events, setEvents] = useState<api.ConsentHistoryEntry[]>([]);
  const [requests, setRequests] = useState<api.RightsRequest[]>([]);
  const [controls, setControls] = useState<api.ProcessingControls | null>(null);
  const [statementFor, setStatementFor] = useState<StatementAction | null>(null);
  const [confirmCompleteErase, setConfirmCompleteErase] = useState<api.RightsRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [language, setLanguage] = useState(user?.settings.language ?? 'es-LA');

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, c, h, r, k] = await Promise.all([
        api.getConsentPurposes(),
        api.getMyConsents(),
        api.getMyConsentHistory(),
        api.listMyRightsRequests(),
        api.getProcessingControls(),
      ]);
      setPurposes(p);
      setConsents(c);
      setEvents(h);
      setRequests(r);
      setControls(k);
    } catch {
      setMessage({ ok: false, text: t('privacy_load_error') });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onToggle = async (purpose: api.ConsentPurpose, checked: boolean) => {
    setBusy(purpose.code);
    setMessage(null);
    try {
      if (checked) await api.grantConsent(purpose.code, purpose.version);
      else await api.revokeConsent(purpose.code);
      await reload();
    } catch {
      setMessage({ ok: false, text: t('privacy_consent_error') });
    } finally {
      setBusy(null);
    }
  };

  const downloadJson = (data: Record<string, unknown>) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mtg-companion-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const run = async (action: PendingAction, stepUpToken?: string) => {
    setBusy(action.kind);
    setMessage(null);
    try {
      let result: { request: api.RightsRequest; export?: Record<string, unknown> };
      if (action.kind === 'complete') {
        // A public-form request: same id and deadline, now with the step-up.
        const r = action.request;
        result = await api.completeRightsRequest(r.id, {
          stepUpToken,
          ...(r.type === 'ERASURE' ? { confirmErasure: true } : {}),
          ...(r.type === 'RECTIFICATION' ? { rectification: currentRectification() } : {}),
        });
      } else {
        const input: api.RightsRequestInput =
          action.kind === 'access'
            ? { type: 'ACCESS', stepUpToken }
            : action.kind === 'erase'
              ? { type: 'ERASURE', stepUpToken, confirmErasure: true }
              : { type: 'RECTIFICATION', stepUpToken, rectification: action.rectification };
        result = await api.submitRightsRequest(input);
      }
      const { request, export: data } = result;
      const done = action.kind === 'complete' ? action.request.type : null;
      if (request.outcome === 'DENIED') {
        setMessage({ ok: false, text: request.message ?? t('privacy_request_denied') });
      } else if ((action.kind === 'access' || done === 'ACCESS') && data) {
        downloadJson(data);
        setMessage({ ok: true, text: t('privacy_access_done') });
      } else if (action.kind === 'erase' || done === 'ERASURE') {
        logout();
        history.replace('/onboarding');
        return;
      } else if (action.kind === 'rectify') {
        if (action.rectification?.email) {
          // Every session was revoked server-side: log in again.
          logout();
          history.replace('/onboarding');
          return;
        }
        updateUser({
          displayName: action.rectification?.displayName ?? user?.displayName,
        });
        setMessage({ ok: true, text: t('privacy_rectify_done') });
      } else if (done === 'RECTIFICATION') {
        setMessage({ ok: true, text: t('privacy_rectify_done') });
      }
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof api.ApiError ? err.message : t('privacy_request_error') });
    } finally {
      setBusy(null);
    }
  };

  const withStepUp = async (password: string, code: string) => {
    const action = pending;
    setPending(null);
    if (!action) return;
    try {
      const { stepUpToken } = await api.stepUp(password, code || undefined);
      await run(action, stepUpToken);
    } catch {
      setMessage({ ok: false, text: t('privacy_stepup_failed') });
    }
  };

  const currentRectification = () => {
    const rectification: NonNullable<api.RightsRequestInput['rectification']> = {};
    if (displayName.trim() && displayName.trim() !== user?.displayName) rectification.displayName = displayName.trim();
    if (language !== user?.settings.language) rectification.language = language;
    if (email.trim() && email.trim() !== user?.email) rectification.email = email.trim();
    return rectification;
  };

  const submitRectification = () => {
    const rectification = currentRectification();
    // Only an email change needs the password again (risk-proportional, same rule as the server).
    if (rectification.email) setPending({ kind: 'rectify', rectification });
    else void run({ kind: 'rectify', rectification });
  };

  const stateOf = (code: api.ConsentPurposeCode) => consents.find((c) => c.purpose === code);

  // ── O16: objection / blocking ──────────────────────────────────────────
  const submitWithStatement = async (action: StatementAction, statement: string) => {
    setStatementFor(null);
    if (statement.trim().length < 10) {
      setMessage({ ok: false, text: t('privacy_statement_short') });
      return;
    }
    setBusy(action.kind);
    setMessage(null);
    try {
      const { request } = await api.submitRightsRequest(
        action.kind === 'object'
          ? { type: 'OBJECTION', purpose: action.purpose, statement: statement.trim() }
          : {
              type: 'BLOCKING',
              blocking: { basis: action.basis, relatedRequestId: action.relatedRequestId },
              statement: statement.trim(),
            },
      );
      setMessage(
        request.outcome === 'DENIED'
          ? { ok: false, text: request.message ?? t('privacy_request_denied') }
          : { ok: true, text: action.kind === 'object' ? t('privacy_object_done') : t('privacy_block_done') },
      );
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof api.ApiError ? err.message : t('privacy_request_error') });
    } finally {
      setBusy(null);
    }
  };

  const undo = async (what: 'block' | api.ObjectionPurposeCode) => {
    setBusy(`undo-${what}`);
    setMessage(null);
    try {
      if (what === 'block') await api.liftBlocking();
      else await api.withdrawObjection(what);
      setMessage({ ok: true, text: what === 'block' ? t('privacy_block_lifted') : t('privacy_object_withdrawn') });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof api.ApiError ? err.message : t('privacy_request_error') });
    } finally {
      setBusy(null);
    }
  };

  const startComplete = (r: api.RightsRequest) => {
    if (r.type === 'ERASURE') setConfirmCompleteErase(r);
    else if (r.type === 'RECTIFICATION' && !currentRectification().email) {
      // name/language only: the session is enough, same rule as the server
      void run({ kind: 'complete', request: r });
    } else setPending({ kind: 'complete', request: r });
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab4" /></IonButtons>
          <IonTitle>{t('privacy_title')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {loading && <div style={{ textAlign: 'center', padding: 30 }}><IonSpinner name="crescent" /></div>}

          {message && (
            <p role="status" style={{ ...card, color: message.ok ? '#9be29b' : '#ff8080' }}>{message.text}</p>
          )}

          {/* 1. Consents */}
          <h3 style={heading}>{t('privacy_consents')}</h3>
          <p style={muted}>{t('privacy_consents_help')}</p>
          {purposes.map((p) => {
            const s = stateOf(p.code);
            return (
              <div key={p.code} style={card} data-testid={`consent-${p.code}`}>
                <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 6 }}>
                  <IonLabel style={{ color: '#f2e3cd', whiteSpace: 'normal' }}>{p.title}</IonLabel>
                  {p.selfService ? (
                    <IonToggle
                      slot="end"
                      checked={!!s?.effective}
                      disabled={busy === p.code}
                      onIonChange={(e) => void onToggle(p, e.detail.checked)}
                      style={toggleStyle}
                      aria-label={p.title}
                    />
                  ) : (
                    <span slot="end" style={{ color: '#c2b5b5', fontSize: '0.8em' }}>
                      {s?.effective ? t('privacy_on') : t('privacy_off')}
                    </span>
                  )}
                </IonItem>
                <p style={muted}>{p.text}</p>
                <p style={muted}>
                  {t('privacy_version', { version: p.version })} · {t('privacy_retention')}: {p.retention}
                </p>
                {!p.selfService && <p style={muted}>{t('privacy_managed_by')}</p>}
                {s?.requiresReconsent && <p style={{ ...muted, color: '#ffcc66' }}>{t('privacy_reconsent')}</p>}
                {s && s.status !== 'NONE' && (
                  <p style={muted}>
                    {s.status === 'GRANTED'
                      ? t('privacy_granted_at', { date: fmt(s.grantedAt) })
                      : t('privacy_revoked_at', { date: fmt(s.revokedAt) })}
                  </p>
                )}
              </div>
            );
          })}

          {/* 2. History */}
          <IonButton fill="clear" size="small" onClick={() => setShowHistory((v) => !v)}>
            <IonIcon icon={timeOutline} slot="start" />
            {t('privacy_history')} ({events.length})
          </IonButton>
          {showHistory && (
            <div style={card}>
              {events.length === 0 && <p style={muted}>{t('privacy_history_empty')}</p>}
              {events.map((e, i) => (
                <p key={i} style={muted}>
                  {fmt(e.createdAt)} — {e.purpose} — {e.action === 'GRANTED' ? t('privacy_on') : t('privacy_off')} (v{e.version}, {e.source})
                </p>
              ))}
            </div>
          )}

          {/* 3. Rights */}
          <h3 style={heading}>{t('privacy_rights')}</h3>

          <div style={card}>
            <h4 style={{ color: '#f2e3cd', margin: '0 0 6px' }}>{t('privacy_access')}</h4>
            <p style={muted}>{t('privacy_access_help')}</p>
            <IonButton expand="block" className="mtg-btn" disabled={!!busy} onClick={() => setPending({ kind: 'access' })}>
              <IonIcon icon={downloadOutline} slot="start" />
              {t('privacy_access_button')}
            </IonButton>
          </div>

          <div style={card}>
            <h4 style={{ color: '#f2e3cd', margin: '0 0 6px' }}>{t('privacy_rectify')}</h4>
            <p style={muted}>{t('privacy_rectify_help')}</p>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('privacy_field_name')}</IonLabel>
              <IonInput value={displayName} maxlength={40} onIonInput={(e) => setDisplayName(String(e.detail.value ?? ''))} style={{ color: '#f2e3cd' }} />
            </IonItem>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('privacy_field_email')}</IonLabel>
              <IonInput type="email" value={email} onIonInput={(e) => setEmail(String(e.detail.value ?? ''))} style={{ color: '#f2e3cd' }} />
            </IonItem>
            <IonItem className="mtg-list-item-row" lines="none" style={{ borderRadius: 4, marginBottom: 8 }}>
              <IonLabel style={{ color: '#c2b5b5' }}>{t('language')}</IonLabel>
              <IonSelect value={language} onIonChange={(e) => setLanguage(String(e.detail.value))} slot="end">
                <IonSelectOption value="en">English</IonSelectOption>
                <IonSelectOption value="es-LA">Español</IonSelectOption>
                <IonSelectOption value="fr">Français</IonSelectOption>
              </IonSelect>
            </IonItem>
            <IonButton expand="block" className="mtg-btn" disabled={!!busy} onClick={submitRectification}>
              <IonIcon icon={createOutline} slot="start" />
              {t('privacy_rectify_button')}
            </IonButton>
          </div>

          <div style={{ ...card, borderColor: 'rgba(255,80,80,0.5)' }}>
            <h4 style={{ color: '#ff9b9b', margin: '0 0 6px' }}>{t('privacy_erase')}</h4>
            <p style={muted}>{t('privacy_erase_help')}</p>
            <IonButton expand="block" color="danger" disabled={!!busy} onClick={() => setConfirmErase(true)}>
              <IonIcon icon={trashOutline} slot="start" />
              {t('privacy_erase_button')}
            </IonButton>
          </div>

          {/* 5. Objection (O16) */}
          <h3 style={heading}>{t('privacy_objection')}</h3>
          <p style={muted}>{t('privacy_objection_help')}</p>
          {controls?.objections.map((o) => (
            <div key={o.code} style={card} data-testid={`objection-${o.code}`}>
              <h4 style={{ color: '#f2e3cd', margin: '0 0 6px' }}>{o.title}</h4>
              <p style={muted}>{o.description}</p>
              <p style={muted}>{o.legalBasis}</p>
              {o.active ? (
                <>
                  <p style={{ ...muted, color: '#9be29b' }}>{t('privacy_object_active', { date: fmt(o.since) })}</p>
                  <IonButton expand="block" fill="outline" disabled={!!busy} onClick={() => void undo(o.code)}>
                    <IonIcon icon={checkmarkDoneOutline} slot="start" />
                    {t('privacy_object_withdraw')}
                  </IonButton>
                </>
              ) : (
                <>
                  {o.decision === 'DENY' && <p style={{ ...muted, color: '#ffcc66' }}>{o.effect}</p>}
                  <IonButton
                    expand="block"
                    className="mtg-btn"
                    disabled={!!busy}
                    onClick={() => setStatementFor({ kind: 'object', purpose: o.code })}
                  >
                    <IonIcon icon={handLeftOutline} slot="start" />
                    {t('privacy_object_button')}
                  </IonButton>
                </>
              )}
            </div>
          ))}

          {/* 6. Blocking (O16) */}
          <h3 style={heading}>{t('privacy_block')}</h3>
          <div style={card} data-testid="blocking">
            <p style={muted}>{t('privacy_block_help')}</p>
            <p style={{ ...muted, color: '#f2e3cd' }}>{t('privacy_block_covers')}</p>
            {controls?.blocking.covers.map((c) => (
              <p key={c.what} style={muted}>• {c.what}</p>
            ))}
            <p style={{ ...muted, color: '#f2e3cd' }}>{t('privacy_block_not_covered')}</p>
            {controls?.blocking.notCovered.map((c) => (
              <p key={c.what} style={muted}>• {c.what}: {c.why}</p>
            ))}
            {controls?.blocking.active ? (
              <>
                <p style={{ ...muted, color: '#ffcc66' }}>
                  {t('privacy_block_active', {
                    date: fmt(controls.blocking.since),
                    basis: t(`privacy_block_basis_${controls.blocking.basis ?? 'ALTERNATIVE_TO_ERASURE'}`),
                  })}
                </p>
                <IonButton expand="block" fill="outline" disabled={!!busy} onClick={() => void undo('block')}>
                  <IonIcon icon={checkmarkDoneOutline} slot="start" />
                  {t('privacy_block_lift')}
                </IonButton>
              </>
            ) : (
              <IonButton
                expand="block"
                className="mtg-btn"
                disabled={!!busy}
                onClick={() => setStatementFor({ kind: 'block', basis: 'ALTERNATIVE_TO_ERASURE' })}
              >
                <IonIcon icon={pauseCircleOutline} slot="start" />
                {t('privacy_block_button')}
              </IonButton>
            )}
          </div>

          {/* 4. Requests */}
          <h3 style={heading}>{t('privacy_requests')}</h3>
          {requests.length === 0 && <p style={muted}>{t('privacy_requests_empty')}</p>}
          {requests.map((r) => (
            <div key={r.id} style={card} data-testid="rights-request">
              <p style={{ color: '#f2e3cd', margin: 0 }}>
                {t(`privacy_type_${r.type}`)} — {r.status === 'CLOSED' ? t(`privacy_outcome_${r.outcome ?? 'DENIED'}`) : t(`privacy_status_${r.status}`)}
              </p>
              <p style={muted}>
                {t('privacy_received', { date: fmt(r.receivedAt) })} · {t('privacy_due', { date: fmt(r.dueAt) })}
              </p>
              {r.closedAt && <p style={muted}>{t('privacy_closed', { date: fmt(r.closedAt) })}</p>}
              {r.channel === 'EMAIL_FORM' && <p style={muted}>{t('privacy_channel_form')}</p>}
              {r.message && <p style={{ ...muted, color: '#ffcc66' }}>{r.message}</p>}
              {r.status === 'PENDING_STEP_UP' && (
                <>
                  <p style={muted}>{t('privacy_complete_help', { date: fmt(r.expiresAt) })}</p>
                  <IonButton expand="block" className="mtg-btn" disabled={!!busy} onClick={() => startComplete(r)}>
                    {t('privacy_complete_button')}
                  </IonButton>
                </>
              )}
              {OPEN.includes(r.status) &&
                r.status !== 'AWAITING_CONFIRMATION' &&
                ['RECTIFICATION', 'ERASURE', 'OBJECTION'].includes(r.type) &&
                !controls?.blocking.active && (
                  <IonButton
                    expand="block"
                    fill="outline"
                    disabled={!!busy}
                    onClick={() => setStatementFor({ kind: 'block', basis: 'PENDING_REQUEST', relatedRequestId: r.id })}
                  >
                    <IonIcon icon={banOutline} slot="start" />
                    {t('privacy_block_while_pending')}
                  </IonButton>
                )}
            </div>
          ))}
        </motion.div>

        <IonAlert
          isOpen={confirmErase}
          onDidDismiss={() => setConfirmErase(false)}
          header={t('privacy_erase')}
          message={t('privacy_erase_confirm')}
          buttons={[
            { text: t('cancel'), role: 'cancel' },
            { text: t('privacy_erase_button'), role: 'destructive', handler: () => setPending({ kind: 'erase' }) },
          ]}
        />
        <IonAlert
          isOpen={statementFor !== null}
          onDidDismiss={() => setStatementFor(null)}
          header={statementFor?.kind === 'object' ? t('privacy_object_button') : t('privacy_block_button')}
          message={t('privacy_statement_help')}
          inputs={[{ name: 'statement', type: 'textarea', placeholder: t('privacy_statement_placeholder') }]}
          buttons={[
            { text: t('cancel'), role: 'cancel' },
            {
              text: t('privacy_stepup_confirm'),
              handler: (data: { statement?: string }) => {
                const action = statementFor;
                if (action) void submitWithStatement(action, data.statement ?? '');
              },
            },
          ]}
        />
        <IonAlert
          isOpen={confirmCompleteErase !== null}
          onDidDismiss={() => setConfirmCompleteErase(null)}
          header={t('privacy_erase')}
          message={t('privacy_erase_confirm')}
          buttons={[
            { text: t('cancel'), role: 'cancel' },
            {
              text: t('privacy_erase_button'),
              role: 'destructive',
              handler: () => {
                const r = confirmCompleteErase;
                if (r) setPending({ kind: 'complete', request: r });
              },
            },
          ]}
        />
        <IonAlert
          isOpen={pending !== null}
          onDidDismiss={() => setPending(null)}
          header={t('privacy_stepup_title')}
          message={t('privacy_stepup_help')}
          inputs={[
            { name: 'password', type: 'password', placeholder: t('privacy_stepup_password') },
            ...(user?.settings.twoFactorEnabled
              ? [{ name: 'code', type: 'text' as const, placeholder: t('privacy_stepup_code') }]
              : []),
          ]}
          buttons={[
            { text: t('cancel'), role: 'cancel' },
            {
              text: t('privacy_stepup_confirm'),
              handler: (data: { password?: string; code?: string }) => {
                void withStepUp(data.password ?? '', data.code ?? '');
              },
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default Privacy;
