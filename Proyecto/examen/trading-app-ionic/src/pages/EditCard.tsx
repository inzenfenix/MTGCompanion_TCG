import React, { useEffect, useState } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonText,
  IonSpinner,
  IonSegment,
  IonSegmentButton,
} from '@ionic/react';
import { cameraOutline, saveOutline, scanOutline } from 'ionicons/icons';
import { Camera } from '@capacitor/camera';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useParams, useHistory } from 'react-router';
import { useAuth } from '../lib/auth/AuthContext';
import { useLiveCamera } from '../lib/camera/useLiveCamera';
import { runStage1Detection, type Stage1Status } from '../lib/ml/stage1Detector';
import * as api from '../lib/api';

const CONDITIONS: api.CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

// Two ways to add/replace a photo, same underlying upload flow either way
// (api.uploadCardPhoto) — only how the Blob gets produced differs:
//  - manual: @capacitor/camera single-shot capture, same as ListCard.tsx.
//  - auto: live getUserMedia feed + Stage 1 (MTG/no-MTG) detection confirms
//    a card is actually in frame before letting you capture it. Stage 1
//    only answers "is this a Magic card", not "which one" — there's no
//    real per-card identification model wired client-side yet (see
//    src/lib/ml/stage1Detector.ts) — this is "computer-vision-assisted
//    capture", not full auto-fill of the card's fields.
const EditCard: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const history = useHistory();
  const { user } = useAuth();

  const [card, setCard] = useState<api.Card | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [guessedPrice, setGuessedPrice] = useState<number | null>(null);
  const [condition, setCondition] = useState<api.CardCondition>('NM');
  const [scryfallId, setScryfallId] = useState('');
  const [setName, setSetName] = useState('');
  const [rarity, setRarity] = useState('');
  const [oracleText, setOracleText] = useState('');

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoMode, setPhotoMode] = useState<'manual' | 'auto'>('manual');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live camera + Stage 1, only actually running while the "auto" tab is open.
  const camera = useLiveCamera();
  const [stage1Status, setStage1Status] = useState<Stage1Status | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);
    api
      .getCard(id)
      .then((fetched) => {
        if (cancelled) return;
        setCard(fetched);
        setTitle(fetched.title);
        setDescription(fetched.description ?? '');
        setGuessedPrice(fetched.guessedPrice);
        setCondition(fetched.condition);
        setScryfallId(fetched.scryfallId ?? '');
        setSetName(fetched.setName ?? '');
        setRarity(fetched.rarity ?? '');
        setOracleText(fetched.oracleText ?? '');

        const primaryPhoto = fetched.photos.find((p) => p.isPrimary) ?? fetched.photos[0];
        if (primaryPhoto) {
          api
            .getCardPhotoUrl(primaryPhoto.id)
            .then(({ url }) => {
              if (!cancelled) setPhotoPreviewUrl(url);
            })
            .catch(() => {
              /* no photo to show */
            });
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Camera only runs while the "auto" tab is actually selected — released
  // as soon as you switch to "manual" or leave the page.
  useEffect(() => {
    if (photoMode === 'auto') {
      camera.start();
    } else {
      camera.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/stop are stable refs from useLiveCamera
  }, [photoMode]);

  const isOwner = !!user && !!card && card.ownerId === user.id;

  const handleTakePhoto = async () => {
    try {
      const photo = await Camera.takePhoto({ quality: 85, correctOrientation: true });
      if (!photo.webPath) return;
      const blob = await fetch(photo.webPath).then((res) => res.blob());
      setPhotoPreviewUrl(photo.webPath);
      setPhotoBlob(blob);
    } catch {
      // Cancelled / permission denied — form stays usable without a new photo.
    }
  };

  const handleDetect = async () => {
    const frame = camera.captureFrame();
    if (!frame) return;
    setIsDetecting(true);
    const result = await runStage1Detection(frame);
    setStage1Status(result);
    setIsDetecting(false);
  };

  const handleUseDetectedFrame = () => {
    const frame = camera.captureFrame();
    if (!frame) return;
    frame.toBlob((blob) => {
      if (!blob) return;
      setPhotoBlob(blob);
      setPhotoPreviewUrl(URL.createObjectURL(blob));
      camera.stop();
    }, 'image/jpeg', 0.9);
  };

  const isValid = title.trim().length > 0 && guessedPrice !== null && guessedPrice >= 0;

  const handleSubmit = async () => {
    if (!isValid || !card || guessedPrice === null) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.updateCard(card.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        guessedPrice,
        condition,
        scryfallId: scryfallId.trim() || undefined,
        setName: setName.trim() || undefined,
        rarity: rarity.trim() || undefined,
        oracleText: oracleText.trim() || undefined,
      });

      if (photoBlob) {
        const contentType = photoBlob.type || 'image/jpeg';
        const filename = `card-${card.id}.${contentType.split('/')[1] ?? 'jpg'}`;
        await api.uploadCardPhoto(card.id, photoBlob, filename, contentType);
      }

      history.push(`/card/${card.id}`);
    } catch {
      setError(t('edit_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={`/card/${id}`} />
          </IonButtons>
          <IonTitle>{t('edit_card_title')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <IonSpinner name="crescent" />
              <p>{t('loading_card')}</p>
            </div>
          )}

          {!isLoading && (notFound || !isOwner) && (
            <div style={{ textAlign: 'center', padding: '60px 0' }}>
              <p>{notFound ? t('card_not_found') : t('not_your_card')}</p>
            </div>
          )}

          {!isLoading && card && isOwner && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '10px' }}>
                {photoPreviewUrl && photoMode === 'manual' ? (
                  <img
                    src={photoPreviewUrl}
                    alt=""
                    style={{ maxHeight: '220px', maxWidth: '100%', borderRadius: '8px', border: '1px solid rgba(139,0,0,0.3)' }}
                  />
                ) : photoMode === 'manual' ? (
                  <div className="mtg-card-image-placeholder" style={{ height: '160px' }}>
                    <span style={{ color: '#c2b5b5', fontSize: '0.8rem', opacity: 0.5 }}>[Image]</span>
                  </div>
                ) : null}
              </div>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel style={{ color: '#c2b5b5' }}>{t('photo_section_title')}</IonLabel>
              </IonItem>
              <IonSegment
                value={photoMode}
                onIonChange={(e) => setPhotoMode(e.detail.value as 'manual' | 'auto')}
                style={{ marginBottom: '15px' }}
              >
                <IonSegmentButton value="manual">
                  <IonLabel>{t('photo_mode_manual')}</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="auto">
                  <IonLabel>{t('photo_mode_auto')}</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              {photoMode === 'manual' ? (
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <IonButton fill="outline" className="mtg-btn" onClick={handleTakePhoto}>
                    <div className="mtg-btn-content">
                      <IonIcon icon={cameraOutline} />
                      <span>{photoPreviewUrl ? t('retake_photo') : t('take_photo')}</span>
                    </div>
                  </IonButton>
                  <p style={{ fontSize: '0.8rem', fontStyle: 'italic', marginTop: '8px' }}>{t('photo_optional_note')}</p>
                </div>
              ) : (
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ fontSize: '0.85rem', marginBottom: '10px' }}>{t('auto_capture_intro')}</p>
                  <div
                    style={{
                      height: '200px',
                      backgroundColor: '#111',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px dashed rgba(255,255,255,0.5)',
                      marginBottom: '15px',
                      overflow: 'hidden',
                      position: 'relative',
                      borderRadius: '8px',
                    }}
                  >
                    <video
                      ref={camera.videoRef}
                      playsInline
                      muted
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: camera.status === 'streaming' ? 'block' : 'none' }}
                    />
                    {camera.status !== 'streaming' && (
                      <p style={{ color: '#aaa', padding: '0 10px', textAlign: 'center' }}>
                        {camera.status === 'starting' && t('camera_starting')}
                        {camera.status === 'denied' && t('camera_permission_denied')}
                        {camera.status === 'unsupported' && t('camera_unsupported')}
                        {camera.status === 'error' && (camera.errorMessage ?? t('camera_unsupported'))}
                        {camera.status === 'idle' && t('camera_feed_placeholder')}
                      </p>
                    )}
                  </div>

                  <IonButton
                    expand="block"
                    fill="outline"
                    className="mtg-btn"
                    disabled={camera.status !== 'streaming' || isDetecting}
                    onClick={handleDetect}
                  >
                    <div className="mtg-btn-content">
                      <IonIcon icon={scanOutline} />
                      <span>{isDetecting ? t('detecting_in_progress') : t('detect_card_button')}</span>
                    </div>
                  </IonButton>

                  {stage1Status?.status === 'unavailable' && (
                    <p style={{ fontSize: '0.85rem', marginTop: '10px', opacity: 0.8 }}>{t('model_not_available')}</p>
                  )}
                  {stage1Status?.status === 'error' && (
                    <p style={{ fontSize: '0.85rem', marginTop: '10px', color: 'var(--ion-color-danger)' }}>
                      {t('model_error', { message: stage1Status.message })}
                    </p>
                  )}
                  {stage1Status?.status === 'ok' && (
                    <div style={{ marginTop: '10px', textAlign: 'center' }}>
                      <p style={{ fontSize: '0.9rem' }}>
                        {stage1Status.result.isMtgCard ? t('detection_result_card') : t('detection_result_no_card')} —{' '}
                        {t('detection_confidence', { value: Math.round(stage1Status.result.confidence * 100) })}
                      </p>
                      {stage1Status.result.isMtgCard && (
                        <IonButton className="mtg-btn" onClick={handleUseDetectedFrame}>
                          <div className="mtg-btn-content">
                            <IonIcon icon={cameraOutline} />
                            <span>{t('use_this_photo')}</span>
                          </div>
                        </IonButton>
                      )}
                    </div>
                  )}

                  {photoPreviewUrl && (
                    <img
                      src={photoPreviewUrl}
                      alt=""
                      style={{ maxHeight: '160px', maxWidth: '100%', borderRadius: '8px', marginTop: '15px', border: '1px solid rgba(139,0,0,0.3)' }}
                    />
                  )}
                </div>
              )}

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_card_title')}</IonLabel>
                <IonInput value={title} onIonInput={(e) => setTitle(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_description')}</IonLabel>
                <IonTextarea value={description} onIonInput={(e) => setDescription(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_price')}</IonLabel>
                <IonInput
                  type="number"
                  value={guessedPrice ?? ''}
                  onIonInput={(e) => setGuessedPrice(e.detail.value ? parseFloat(e.detail.value) : null)}
                  style={{ color: '#f2e3cd' }}
                />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel style={{ color: '#c2b5b5' }}>{t('field_condition')}</IonLabel>
                <IonSelect
                  value={condition}
                  onIonChange={(e) => setCondition(e.detail.value)}
                  interface="popover"
                  interfaceOptions={{ cssClass: 'mtg-popover' }}
                  style={{ color: '#f2e3cd' }}
                >
                  {CONDITIONS.map((c) => (
                    <IonSelectOption key={c} value={c}>
                      {t(`condition_${c.toLowerCase()}`)}
                    </IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_scryfall_id')}</IonLabel>
                <IonInput value={scryfallId} onIonInput={(e) => setScryfallId(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_set_name')}</IonLabel>
                <IonInput value={setName} onIonInput={(e) => setSetName(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '10px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_rarity')}</IonLabel>
                <IonInput value={rarity} onIonInput={(e) => setRarity(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonItem className="mtg-list-item-row" style={{ marginBottom: '20px', borderRadius: '8px' }}>
                <IonLabel position="stacked" style={{ color: '#c2b5b5' }}>{t('field_oracle_text')}</IonLabel>
                <IonTextarea value={oracleText} onIonInput={(e) => setOracleText(e.detail.value ?? '')} style={{ color: '#f2e3cd' }} />
              </IonItem>

              <IonButton expand="block" className="mtg-btn" disabled={!isValid || isSubmitting} onClick={handleSubmit}>
                <div className="mtg-btn-content">
                  <IonIcon icon={saveOutline} />
                  <span>{isSubmitting ? t('saving_in_progress') : t('save_changes')}</span>
                </div>
              </IonButton>

              {error && (
                <IonText color="danger">
                  <p style={{ marginTop: '15px', textAlign: 'center' }}>{error}</p>
                </IonText>
              )}
            </>
          )}
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default EditCard;
