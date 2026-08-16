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
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTextarea,
  IonText,
  useIonViewWillEnter,
  useIonViewWillLeave,
} from '@ionic/react';
import { cameraOutline, saveOutline, sparklesOutline } from 'ionicons/icons';
import { Camera } from '@capacitor/camera';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useIonRouter } from '@ionic/react';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';
import { useLiveCamera } from '../lib/camera/useLiveCamera';
import { GuidedCapture } from '../components/GuidedCapture';
import { runStage1Detection } from '../lib/ml/stage1Detector';
import { runStage3PriceEstimation } from '../lib/ml/stage3PriceEstimator';
import { runStage4ConditionGrading } from '../lib/ml/stage4ConditionGrader';
import { identifyCard, toScryfallFields, type IdentifyCandidate } from '../lib/scan/identifyCard';

// Two capture paths, matching Proyecto/examen/README.md's documented split:
// - "Manual" is the original single-shot @capacitor/camera photo, typed-in
//   fields — unchanged, still the fallback for anyone who doesn't want
//   scanning or whose camera/models aren't available.
// - "Smart Scan" (ROADMAP.md E3b) is the live getUserMedia+canvas camera
//   already used by Tab2.tsx, reusing the exact same GuidedCapture
//   component — capture a canonical crop, run Stage 1 as a content gate,
//   then Stage 2 (via identifyCard.ts's OCR+catalog+Stage2 pipeline), Stage
//   3 (price) and Stage 4 (condition) against it, and prefill this same
//   form instead of leaving it manual. Nothing here auto-submits — the
//   prefilled fields stay fully editable, same "review before you commit"
//   shape the rest of the app already uses (E5's price-edit-before-QR step).
const CONDITIONS: api.CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

type CaptureMode = 'manual' | 'scan';
type ScanPhase = 'idle' | 'identifying' | 'estimating' | 'matched' | 'no-match' | 'error';

const ListCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useIonRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [guessedPrice, setGuessedPrice] = useState<number | null>(null);
  const [condition, setCondition] = useState<api.CardCondition>('NM');
  // ROADMAP.md G4e (sleeve follow-up, layer 3) — true when Stage 4 returned
  // 'likely-no-card-content' (opaque sleeve, its colored back facing the
  // camera, or a blank/miscropped photo): `condition` was NOT auto-set from
  // this scan, still whatever it was before — surfaced explicitly rather
  // than silently leaving the user to wonder why the field didn't fill in.
  const [conditionWarning, setConditionWarning] = useState(false);

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidden Scryfall-metadata fields (same shape EditCard.tsx already exposes
  // for editing after creation) — silently carried through to api.createCard
  // when a scan identifies a real catalog card, so CardDetails.tsx's
  // setName/rarity/oracleText rendering has real data from the start
  // instead of only ever being backfillable via EditCard afterward.
  const [scryfallId, setScryfallId] = useState('');
  const [setName, setSetName] = useState('');
  const [rarity, setRarity] = useState('');
  const [oracleText, setOracleText] = useState('');

  const [captureMode, setCaptureMode] = useState<CaptureMode>('manual');
  const camera = useLiveCamera();
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle');
  const [scanErrorMessage, setScanErrorMessage] = useState<string | null>(null);
  const [scanCanvas, setScanCanvas] = useState<HTMLCanvasElement | null>(null);
  const [candidates, setCandidates] = useState<IdentifyCandidate[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState<number | null>(null);

  useEffect(() => {
    if (captureMode === 'scan') {
      camera.start();
    } else {
      camera.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/stop are stable refs from useLiveCamera
  }, [captureMode]);

  // Ionic's IonRouterOutlet keeps page components mounted across navigation
  // (same reasoning Tab3.tsx's own useIonViewWillEnter comment documents) —
  // a plain useState initializer only ever runs on the component's FIRST
  // mount, not on every re-entry. Without this, leaving via the back button
  // (or the "list a card" FAB) and coming back showed the previous visit's
  // scanned title/price/condition/photo/matched-candidate state, since the
  // component instance — and its state — never actually went away. Reset on
  // every real (re-)entry instead, same fix Tab3.tsx already established
  // for its own "stale after navigating away and back" gap.
  useIonViewWillEnter(() => {
    setTitle('');
    setDescription('');
    setGuessedPrice(null);
    setCondition('NM');
    setPhotoPreviewUrl(null);
    setPhotoBlob(null);
    setIsSubmitting(false);
    setError(null);
    setScryfallId('');
    setSetName('');
    setRarity('');
    setOracleText('');
    setCaptureMode('manual'); // also stops the camera via the effect above, if it was left running
    setScanPhase('idle');
    setScanErrorMessage(null);
    setScanCanvas(null);
    setCandidates([]);
    setSelectedCandidateIdx(null);
  });

  // Release the camera the instant the view leaves, not just on the next
  // useIonViewWillEnter reset above — since the component stays mounted
  // (see that hook's comment), leaving mid-scan would otherwise keep the
  // getUserMedia stream open in the background until the page is revisited.
  useIonViewWillLeave(() => {
    camera.stop();
  });

  const applyCandidateMetadata = (candidate: IdentifyCandidate) => {
    const { card } = candidate;
    setTitle(card.name);
    setScryfallId(card.id);
    setSetName(card.setName);
    setRarity(card.rarity ?? '');
    setOracleText(card.oracleText ?? '');
  };

  const estimatePriceFor = async (canvas: HTMLCanvasElement, candidate: IdentifyCandidate) => {
    const stage3 = await runStage3PriceEstimation(canvas, toScryfallFields(candidate.card));
    if (stage3.status === 'ok') {
      setGuessedPrice(Math.round(stage3.result.priceUsd * 100) / 100);
    }
  };

  const handleSelectCandidate = async (idx: number) => {
    const candidate = candidates[idx];
    if (!candidate) return;
    setSelectedCandidateIdx(idx);
    applyCandidateMetadata(candidate);
    if (scanCanvas) await estimatePriceFor(scanCanvas, candidate);
  };

  const handleClearMatch = () => {
    setSelectedCandidateIdx(null);
    setCandidates([]);
    setScryfallId('');
    setSetName('');
    setRarity('');
    setOracleText('');
    setScanPhase('idle');
  };

  // Runs after GuidedCapture accepts a card-shaped, Stage-1-confirmed
  // capture: identify the printing (OCR + catalog search + Stage 2 rerank,
  // see identifyCard.ts), then price (Stage 3, needs the winning
  // candidate's real metadata) and condition (Stage 4, photo-only,
  // independent of identification) against the same canonical canvas.
  const runScanPipeline = async (canvas: HTMLCanvasElement) => {
    setScanCanvas(canvas);
    setScanPhase('identifying');
    setScanErrorMessage(null);

    const [identifyResult, stage4] = await Promise.all([
      identifyCard(canvas),
      runStage4ConditionGrading(canvas),
    ]);

    setConditionWarning(stage4.status === 'likely-no-card-content');
    if (stage4.status === 'ok') setCondition(stage4.result.condition);

    canvas.toBlob((blob) => {
      if (blob) {
        setPhotoBlob(blob);
        setPhotoPreviewUrl(canvas.toDataURL('image/jpeg', 0.9));
      }
    }, 'image/jpeg', 0.9);

    if (identifyResult.status === 'ok' && identifyResult.result.candidates.length > 0) {
      const ranked = identifyResult.result.candidates;
      setCandidates(ranked);
      setSelectedCandidateIdx(0);
      applyCandidateMetadata(ranked[0]);
      setScanPhase('estimating');
      await estimatePriceFor(canvas, ranked[0]);
      setScanPhase('matched');
    } else if (identifyResult.status === 'error') {
      setScanErrorMessage(identifyResult.message);
      setScanPhase('error');
    } else {
      setCandidates([]);
      setScanPhase('no-match');
    }

    setCaptureMode('manual'); // release the live camera, show the (now prefilled) review form
  };

  // Stage 1 gate — same reasoning/comment as Tab2.tsx's handleGuidedCapture:
  // GuidedCapture's own localizer is geometric-only (tracks faces almost as
  // readily as cards), so a confident "not a card" from the real trained
  // classifier rejects the capture instead of accepting it. A missing/
  // errored model does not block the flow.
  const handleGuidedCapture = async (canvas: HTMLCanvasElement): Promise<boolean> => {
    const stage1 = await runStage1Detection(canvas);
    if (stage1.status === 'ok' && !stage1.result.isMtgCard) return false;
    void runScanPipeline(canvas);
    return true;
  };

  const handleTakePhoto = async () => {
    try {
      const photo = await Camera.takePhoto({ quality: 85, correctOrientation: true });
      if (!photo.webPath) return;
      const blob = await fetch(photo.webPath).then((res) => res.blob());
      setPhotoPreviewUrl(photo.webPath);
      setPhotoBlob(blob);
    } catch {
      // User cancelled the camera / permission denied — nothing to do, the
      // form stays usable without a photo (it's optional).
    }
  };

  const isValid = title.trim().length > 0 && guessedPrice !== null && guessedPrice >= 0 && user;

  const handleSubmit = async () => {
    if (!isValid || !user || guessedPrice === null) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const card = await api.createCard({
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

      router.push(`/card/${card.id}`, 'forward', 'replace');
    } catch {
      setError(t('listing_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCandidate = selectedCandidateIdx !== null ? candidates[selectedCandidateIdx] : null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/tab3" /></IonButtons>
          <IonTitle>{t('list_card_title')}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <motion.div className="mtg-container" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          <IonSegment
            value={captureMode}
            onIonChange={(e) => setCaptureMode(e.detail.value as CaptureMode)}
            style={{ marginBottom: '15px' }}
          >
            <IonSegmentButton value="manual">
              <IonLabel><IonIcon icon={cameraOutline} style={{ verticalAlign: 'middle', marginRight: '5px' }} /> {t('capture_mode_manual')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="scan">
              <IonLabel><IonIcon icon={sparklesOutline} style={{ verticalAlign: 'middle', marginRight: '5px' }} /> {t('capture_mode_scan')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>

          {captureMode === 'manual' && (
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              {photoPreviewUrl ? (
                <img
                  src={photoPreviewUrl}
                  alt=""
                  style={{ maxHeight: '220px', maxWidth: '100%', borderRadius: '8px', border: '1px solid rgba(139,0,0,0.3)' }}
                />
              ) : (
                <div className="mtg-card-image-placeholder" style={{ height: '160px' }}>
                  <span style={{ color: '#c2b5b5', fontSize: '0.8rem', opacity: 0.5 }}>[Image]</span>
                </div>
              )}
              <IonButton fill="outline" className="mtg-btn" style={{ marginTop: '10px' }} onClick={handleTakePhoto}>
                <div className="mtg-btn-content">
                  <IonIcon icon={cameraOutline} />
                  <span>{photoPreviewUrl ? t('retake_photo') : t('take_photo')}</span>
                </div>
              </IonButton>
              <p style={{ fontSize: '0.8rem', fontStyle: 'italic', marginTop: '8px' }}>{t('photo_optional_note')}</p>

              {selectedCandidate && (
                <div style={{ margin: '15px 0', border: '1px solid rgba(139,0,0,0.3)', borderRadius: '8px', background: 'rgba(10,5,8,0.7)', padding: '12px', textAlign: 'left' }}>
                  <p style={{ margin: '0 0 4px', color: '#f2e3cd', fontWeight: 'bold' }}>
                    {t('scan_matched_banner', { name: selectedCandidate.card.name })}
                  </p>
                  <p style={{ margin: '0 0 10px', color: '#c2b5b5', fontSize: '0.85rem' }}>
                    {t('scan_matched_meta', {
                      setName: selectedCandidate.card.setName,
                      rarity: selectedCandidate.card.rarity ?? '—',
                      confidence: Math.round(selectedCandidate.confidence * 100),
                    })}
                  </p>
                  {candidates.length > 1 && (
                    <>
                      <p style={{ margin: '0 0 6px', color: '#c2b5b5', fontSize: '0.8rem' }}>{t('scan_pick_different')}</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        {candidates.map((c, idx) => (
                          <IonButton
                            key={c.card.id}
                            size="small"
                            fill={idx === selectedCandidateIdx ? 'solid' : 'outline'}
                            onClick={() => void handleSelectCandidate(idx)}
                          >
                            {c.card.name} ({Math.round(c.confidence * 100)}%)
                          </IonButton>
                        ))}
                      </div>
                    </>
                  )}
                  <IonButton size="small" fill="clear" style={{ '--color': '#5c1b1b' }} onClick={handleClearMatch}>
                    {t('scan_clear_match')}
                  </IonButton>
                </div>
              )}

              {scanPhase === 'no-match' && (
                <p style={{ fontSize: '0.85rem', fontStyle: 'italic', marginTop: '10px', color: '#c2b5b5' }}>
                  {t('scan_no_match_banner')}
                </p>
              )}
              {scanPhase === 'error' && scanErrorMessage && (
                <p style={{ fontSize: '0.85rem', fontStyle: 'italic', marginTop: '10px', color: '#ff8080' }}>
                  {t('model_error', { message: scanErrorMessage })}
                </p>
              )}
            </div>
          )}

          {captureMode === 'scan' && (
            <div style={{ margin: '0 0 20px', border: '1px solid rgba(0,0,0,0.2)', borderRadius: '4px', background: 'rgba(255,255,255,0.4)', padding: '15px' }}>
              <p style={{ textAlign: 'center', fontSize: '0.85rem', marginTop: 0 }}>{t('scan_intro')}</p>
              <div style={{ height: '280px', backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.5)', marginBottom: '10px', overflow: 'hidden', position: 'relative' }}>
                <video
                  ref={camera.videoRef}
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: camera.status === 'streaming' ? 'block' : 'none' }}
                />
                {camera.status === 'streaming' && (
                  <GuidedCapture camera={camera} onCaptured={handleGuidedCapture} />
                )}
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
              {(scanPhase === 'identifying' || scanPhase === 'estimating') && (
                <h3 style={{ fontSize: '0.9rem', margin: 0, fontStyle: 'italic', textAlign: 'center' }}>
                  {scanPhase === 'identifying' ? t('scan_status_identifying') : t('scan_status_estimating')}
                </h3>
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

          <IonItem className="mtg-list-item-row" style={{ marginBottom: '20px', borderRadius: '8px' }}>
            <IonLabel style={{ color: '#c2b5b5' }}>{t('field_condition')}</IonLabel>
            <IonSelect
              value={condition}
              onIonChange={(e) => setCondition(e.detail.value)}
              interface="popover"
              interfaceOptions={{ cssClass: 'mtg-popover' }}
              style={{ color: '#f2e3cd' }}
            >
              {CONDITIONS.map((c) => (
                <IonSelectOption key={c} value={c}>{t(`condition_${c.toLowerCase()}`)}</IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>

          {conditionWarning && (
            <IonText color="warning">
              <p style={{ marginTop: '-12px', marginBottom: '16px', fontSize: '0.85rem' }}>
                {t('condition_no_card_content_warning')}
              </p>
            </IonText>
          )}

          <IonButton expand="block" className="mtg-btn" disabled={!isValid || isSubmitting} onClick={handleSubmit}>
            <div className="mtg-btn-content">
              <IonIcon icon={saveOutline} />
              <span>{isSubmitting ? t('listing_in_progress') : t('submit_list_card')}</span>
            </div>
          </IonButton>

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

export default ListCard;
