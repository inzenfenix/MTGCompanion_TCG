import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton,
  IonIcon, IonInput, IonItem, IonLabel, IonSegment, IonSegmentButton,
  IonSelect, IonSelectOption, IonSpinner, useIonRouter,
  useIonViewWillEnter, useIonViewWillLeave,
} from '@ionic/react';
import {
  qrCodeOutline, cameraOutline, checkmarkCircleOutline,
  storefrontOutline, walletOutline, archiveOutline
} from 'ionicons/icons';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { useLiveCamera } from '../lib/camera/useLiveCamera';
import { runStage1Detection, type Stage1Status } from '../lib/ml/stage1Detector';
import { runStage3PriceEstimation } from '../lib/ml/stage3PriceEstimator';
import { runStage4ConditionGrading } from '../lib/ml/stage4ConditionGrader';
import { identifyCard, toScryfallFields, type IdentifyCandidate } from '../lib/scan/identifyCard';
import { withTimeout, SCAN_PIPELINE_TIMEOUT_MS } from '../lib/async/withTimeout';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';
import { GuidedCapture } from '../components/GuidedCapture';
import { QrScanner } from '../components/QrScanner';

const TRADE_CODE_PREFIX = 'TRADE:';
/** Real card, price/condition unknown yet — same fallback ListCard.tsx's runScanPipeline implicitly relies on (guessedPrice stays editable in step 2/the review form either way). */
const FALLBACK_SCAN_PRICE = 1;
type ScanIdentifyPhase = 'idle' | 'identifying' | 'matched' | 'no-match' | 'error';

const Tab2: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useIonRouter();
  // ROADMAP.md J15 — set only when arrived via /tab2/sell/:cardId
  // (CardDetails.tsx's "Vender" button), never via the plain /tab2 tab
  // route (that param simply doesn't exist there, matching /buy/:token vs
  // /buy/card/:cardId's own dual-route precedent).
  const { cardId: sellCardId } = useParams<{ cardId?: string }>();
  const [role, setRole] = useState<'merchant' | 'buyer'>('merchant');
  // Bumped on every real useIonViewWillEnter — see the camera start/stop
  // effect below for why this exists (real bug, live-reported: Trade's
  // camera not restarting after navigating away and back).
  const [viewEntryTick, setViewEntryTick] = useState(0);

  // Merchant state
  const [merchantStep, setMerchantStep] = useState<1 | 2 | 3>(1);
  const [price, setPrice] = useState<number>(45.00);
  // null = not fetched yet, [] = fetched, no cards. Real inventory (api.listCards),
  // not the old hardcoded "Chalice of the Void" — see ROADMAP.md E5.
  const [myCards, setMyCards] = useState<api.Card[] | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isSavingPrice, setIsSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  // Set once polling (below) finds a real transaction matching the listed card.
  const [soldTransaction, setSoldTransaction] = useState<api.Transaction | null>(null);
  const selectedCard = myCards?.find(c => c.id === selectedCardId) ?? null;

  // Buyer state (J4/J5) — scanning a QR is now the buyer's ONLY step here;
  // the actual purchase flow (payment method, create the transaction) lives
  // in Buy.tsx (/buy/:token) now, not duplicated inline in this page.
  // `decodedToken` is set the instant a QR decodes and immediately
  // navigates away — kept around only to gate the camera-release effect
  // above (no reason to keep streaming once a code is found).
  const [decodedToken, setDecodedToken] = useState<string | null>(null);

  // Merchant QR state (J4) — the QR now encodes a short-lived signed
  // listing token (backend, CardsService.createListingToken), not a bare
  // `TRADE:<cardId>` — minted once when the merchant reaches step 3.
  const [listingToken, setListingToken] = useState<string | null>(null);
  const [listingTokenError, setListingTokenError] = useState<string | null>(null);

  // Stage 1 (MTG / no-MTG detector) — live camera via getUserMedia+canvas
  // (see useLiveCamera's header comment for why not
  // @capacitor-community/camera-preview) feeding onnxruntime-web. The
  // capture itself is now guided (ROADMAP.md G4c, `GuidedCapture.tsx`) —
  // OpenCV.js localizes+perspective-corrects the card client-side before
  // Stage 1 ever sees it, instead of a blind full-frame shot. Past this
  // gate, the FULL identify pipeline (Stage 2 OCR+catalog via
  // identifyCard.ts, Stage 3 price, Stage 4 condition) now runs too —
  // ROADMAP.md J15: this used to stop at Stage 1, so a successful scan did
  // nothing beyond "yes that's a card", real user complaint.
  const camera = useLiveCamera();
  const [stage1Status, setStage1Status] = useState<Stage1Status | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  // ROADMAP.md J15 — the actual "what did we find, what do you want to do
  // with it" state, driven by runScanIdentify() below. Independent of
  // stage1Status/isDetecting above (that's purely the content-gate verdict);
  // this is what actually surfaces to the merchant once a real card-shaped
  // capture clears that gate.
  const [scanIdentifyPhase, setScanIdentifyPhase] = useState<ScanIdentifyPhase>('idle');
  const [scanCandidate, setScanCandidate] = useState<IdentifyCandidate | null>(null);
  const [scanGuessedPrice, setScanGuessedPrice] = useState<number>(FALLBACK_SCAN_PRICE);
  const [scanCondition, setScanCondition] = useState<api.CardCondition>('NM');
  const [scanPhotoBlob, setScanPhotoBlob] = useState<Blob | null>(null);
  const [scanIdentifyError, setScanIdentifyError] = useState<string | null>(null);
  // Set when the identified card's scryfallId matches one already in the
  // merchant's own inventory — selling it should reuse THAT card, not
  // create a duplicate Vault entry every time they scan something they
  // already own.
  const [existingOwnedCard, setExistingOwnedCard] = useState<api.Card | null>(null);
  const [isSavingScan, setIsSavingScan] = useState(false);

  // Camera runs while the merchant is on the capture step, OR while the
  // buyer is on the QR-scan screen (J4) — released as soon as either moves
  // on or the role switches.
  //
  // `viewEntryTick` is in the dependency array purely to force this effect
  // to re-run on every real (re-)entry to the tab, even when
  // role/merchantStep/decodedToken all come back to exactly the values they
  // already had (the overwhelmingly common case: leaving from the default
  // merchant/step-1 screen and returning to it). Real bug this closes:
  // useIonViewWillEnter's resetMerchantFlow()/resetBuyerFlow() below call
  // setMerchantStep(1)/setRole('merchant'), but React treats a setState to
  // an UNCHANGED value as a no-op — it does NOT re-run effects keyed on
  // that state. So on a plain "leave Tab2 while on step 1, come back",
  // nothing in [role, merchantStep, decodedToken] actually changes, this
  // effect never re-fires, and the camera (already stopped by
  // useIonViewWillLeave) never restarts — a permanently black/frozen feed
  // that only "worked" if you happened to leave from step 2/3 or the buyer
  // role, where the reset IS a real value change. ListCard.tsx's Smart Scan
  // camera never hit this because it starts on an explicit user action
  // (toggling into scan mode), never on a state reset that can coincide
  // with the current value.
  useEffect(() => {
    if ((role === 'merchant' && merchantStep === 1) || (role === 'buyer' && !decodedToken)) {
      camera.start();
    } else {
      camera.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/stop are stable refs from useLiveCamera
  }, [role, merchantStep, decodedToken, viewEntryTick]);

  // Fetch the merchant's real inventory once they reach the appraisal step.
  useEffect(() => {
    if (role !== 'merchant' || merchantStep !== 2 || !user || myCards !== null) return;
    let cancelled = false;
    api.listCards(user.id)
      .then(cards => {
        if (cancelled) return;
        setMyCards(cards);
        // ROADMAP.md J15 — prefer an explicitly-requested card (the
        // /tab2/sell/:cardId route param, or the one a Trade-tab scan just
        // created/matched) over defaulting to cards[0]. Without this, a
        // specific card handed off from CardDetails.tsx or a fresh scan got
        // silently overridden by whatever the FIRST card in the list
        // happened to be.
        setSelectedCardId(prevId => {
          const requested = prevId ? cards.find(c => c.id === prevId) : undefined;
          const chosen = requested ?? cards[0];
          if (chosen) setPrice(chosen.guessedPrice);
          return chosen?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setMyCards([]);
      });
    return () => { cancelled = true; };
  }, [role, merchantStep, user, myCards]);

  // While the merchant waits on step 3, poll for a real transaction created
  // by a buyer against the listed card (POST /transactions has no webhook
  // back to the seller, so this is the seller-side way to notice it landed).
  useEffect(() => {
    if (role !== 'merchant' || merchantStep !== 3 || !user || !selectedCard || soldTransaction) return;
    let cancelled = false;
    const checkForSale = () => {
      api.listTransactions(user.id)
        .then(txs => {
          if (cancelled) return;
          const match = txs.find(tx => tx.cardId === selectedCard.id && tx.sellerId === user.id);
          if (match) setSoldTransaction(match);
        })
        .catch(() => { /* transient — next poll retries */ });
    };
    checkForSale();
    const interval = setInterval(checkForSale, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [role, merchantStep, user, selectedCard, soldTransaction]);

  const handleSelectCard = (cardId: string) => {
    setSelectedCardId(cardId);
    const card = myCards?.find(c => c.id === cardId);
    if (card) setPrice(card.guessedPrice);
    setPriceError(null);
  };

  const handleGenerateQr = async () => {
    if (!selectedCard) return;
    setPriceError(null);
    setIsSavingPrice(true);
    try {
      // The backend derives the transaction amount from card.guessedPrice,
      // not from whatever the client sends — so an edited price here has to
      // actually persist, or "Set Final Price" would just be lying.
      if (price !== selectedCard.guessedPrice) {
        const updated = await api.updateCard(selectedCard.id, { guessedPrice: price });
        setMyCards(prev => (prev ? prev.map(c => (c.id === updated.id ? updated : c)) : prev));
      }
      // ROADMAP.md J4 — mint the signed listing token the QR encodes, one
      // seller-owned card at a time (findOwned on the backend rejects
      // anything else).
      setListingTokenError(null);
      try {
        const { token } = await api.createListingToken(selectedCard.id);
        setListingToken(token);
      } catch (err) {
        setListingTokenError(err instanceof api.ApiError ? err.message : t('trade_price_update_error'));
      }
      setMerchantStep(3);
    } catch (err) {
      setPriceError(err instanceof api.ApiError ? err.message : t('trade_price_update_error'));
    } finally {
      setIsSavingPrice(false);
    }
  };

  const resetMerchantFlow = () => {
    setMerchantStep(1);
    setMyCards(null);
    setSelectedCardId(null);
    setSoldTransaction(null);
    setPriceError(null);
    setListingToken(null);
    setListingTokenError(null);
  };

  const resetScanState = () => {
    setScanIdentifyPhase('idle');
    setScanCandidate(null);
    setScanGuessedPrice(FALLBACK_SCAN_PRICE);
    setScanCondition('NM');
    setScanPhotoBlob(null);
    setScanIdentifyError(null);
    setExistingOwnedCard(null);
    setIsSavingScan(false);
  };

  const resetBuyerFlow = () => {
    setDecodedToken(null);
  };

  // Ionic's IonRouterOutlet keeps page components mounted across navigation
  // (same reasoning ListCard.tsx's own useIonViewWillEnter comment
  // documents, and Tab3.tsx's before that) — this page never had the fix,
  // unlike ListCard's Smart Scan camera which shares the exact same
  // useLiveCamera/GuidedCapture stack. Two real, live-reported symptoms this
  // closes: (1) leaving Tab2 mid-scan (e.g. the buyer navigating to
  // /buy/:token, or just switching tabs) left getUserMedia streaming in the
  // background indefinitely, since the start/stop effect below only reacts
  // to [role, merchantStep, decodedToken] — none of which change on a tab
  // switch; (2) returning to Tab2 later resumed with whatever
  // role/merchantStep/soldTransaction/decodedToken the PREVIOUS visit left
  // behind (a stale QR, a stale "sale complete" screen, a stale buyer token)
  // instead of a fresh Trade Nexus. Reset on every real (re-)entry, stop on
  // every real exit — identical shape to ListCard.tsx's fix.
  useIonViewWillEnter(() => {
    setRole('merchant');
    resetMerchantFlow();
    resetBuyerFlow();
    resetScanState();
    setPrice(45.00);
    setIsSavingPrice(false);
    setStage1Status(null);
    setIsDetecting(false);
    // See the camera effect's comment above — this is what actually
    // guarantees the camera restarts on every real re-entry.
    setViewEntryTick(t => t + 1);
    // ROADMAP.md J15 — arrived via /tab2/sell/:cardId (CardDetails.tsx's
    // "Vender" button): skip the camera step entirely, jump straight to
    // price/QR with THIS card. Runs AFTER resetMerchantFlow() above, in the
    // same batch, so its own setMerchantStep(1)/setSelectedCardId(null)
    // don't win — React applies same-state setters in call order.
    if (sellCardId) {
      setSelectedCardId(sellCardId);
      setMerchantStep(2);
    }
  });

  useIonViewWillLeave(() => {
    camera.stop();
  });

  // ROADMAP.md J4 — a real camera QR decode, replacing the old manual
  // "paste the code" flow. Lands the buyer on Buy.tsx (/buy/:token), which
  // owns the rest of the purchase (payment method, create the transaction).
  const handleQrDecoded = (raw: string) => {
    if (decodedToken) return; // already navigating — ignore any further decodes
    const token = raw.startsWith(TRADE_CODE_PREFIX) ? raw.slice(TRADE_CODE_PREFIX.length) : raw;
    if (!token) return;
    setDecodedToken(token);
    router.push(`/buy/${encodeURIComponent(token)}`, 'forward');
  };

  // GuidedCapture (G4c) already localized+perspective-corrected the card
  // client-side before calling this — `canvas` is the canonical 750x1050
  // crop, not a raw frame, so Stage 1 sees a properly-framed card the same
  // way `04_evaluate.py`'s curated eval set does, instead of a full photo
  // with background (ROADMAP.md G4b's exact fix, now ported client-side).
  //
  // Also doubles as the real content gate on top of GuidedCapture's
  // geometric/color-only localizer: live-tested, that localizer tracks
  // faces almost as readily as cards (rectangular, roughly card-shaped,
  // uniform-ish tone at some angles) since it has no notion of card
  // content. Returning `false` here on a confident non-card rejects the
  // capture and sends GuidedCapture back to searching instead of accepting
  // it — see ROADMAP.md G4c. A missing/errored model does NOT block the
  // flow (returns `true`) — only a confident "not a card" from a model that
  // actually loaded and ran does.
  const handleGuidedCapture = async (canvas: HTMLCanvasElement): Promise<boolean> => {
    setIsDetecting(true);
    const result = await runStage1Detection(canvas);
    setStage1Status(result);
    setIsDetecting(false);
    // Breadcrumb every real verdict (same console.debug pattern I27's blur
    // logging already established) — a false-positive "accepted a non-card"
    // is otherwise only diagnosable by guessing (ROADMAP.md I31: Stage 1 has
    // never seen a "nothing at all" negative, so it can confidently accept
    // real-world clutter that the geometric localizer legitimately found a
    // card-shaped, textured region in). Real confidence numbers here are
    // what turns "it thought a hand was a card" into an actual, gradeable
    // bug report instead of an anecdote.
    // Plain string interpolation, not an object arg — this WebView's
    // console-to-`adb logcat` forwarding stringifies object args as bare
    // "[object Object]" (found live — this line was silently useless in
    // practice until this fix), same real bug as GuidedCapture.tsx's
    // corner logging had.
    // Same gap fixed on ListCard.tsx's copy of this log — 'error' carries a
    // real `.message` that was being dropped, leaving no way to tell WHAT
    // threw.
    console.debug(`[Tab2] Stage 1 verdict: ${
      result.status === 'ok' ? `isMtgCard=${result.result.isMtgCard} confidence=${result.result.confidence.toFixed(3)}`
        : result.status === 'error' ? `error: ${result.message}` : result.status
    }`);
    if (result.status === 'ok' && !result.result.isMtgCard) return false;
    void runScanIdentify(canvas);
    return true;
  };

  // ROADMAP.md J15 — this is the piece that was actually missing: past
  // Stage 1's gate, run the SAME identify pipeline ListCard.tsx's Smart
  // Scan already uses (OCR+catalog+Stage 2 rerank via identifyCard.ts) plus
  // Stage 3 (price) and Stage 4 (condition), instead of just discarding a
  // successful capture. Mirrors runScanPipeline() there closely (same
  // withTimeout guard, same reasoning — ROADMAP.md I17: a hung OCR worker
  // promise needs a hard ceiling, try/catch alone won't see it) — kept as
  // Tab2's own copy rather than a shared hook since the two screens do
  // different things with the result (ListCard prefills an editable
  // creation form; this decides "sell" vs "save" and drives step 2/3
  // directly), not because the fetch logic itself needs to differ.
  const runScanIdentify = async (canvas: HTMLCanvasElement) => {
    setScanIdentifyPhase('identifying');
    setScanIdentifyError(null);
    canvas.toBlob((blob) => { if (blob) setScanPhotoBlob(blob); }, 'image/jpeg', 0.9);

    try {
      const [identifyResult, stage4] = await withTimeout(
        Promise.all([identifyCard(canvas), runStage4ConditionGrading(canvas)]),
        SCAN_PIPELINE_TIMEOUT_MS,
        'identifyCard()/runStage4ConditionGrading()',
      );
      setScanCondition(stage4.status === 'ok' ? stage4.result.condition : 'NM');

      if (identifyResult.status !== 'ok' || identifyResult.result.candidates.length === 0) {
        setScanCandidate(null);
        setScanIdentifyPhase(identifyResult.status === 'error' ? 'error' : 'no-match');
        if (identifyResult.status === 'error') setScanIdentifyError(identifyResult.message);
        return;
      }

      const top = identifyResult.result.candidates[0];
      setScanCandidate(top);

      const stage3 = await withTimeout(
        runStage3PriceEstimation(canvas, toScryfallFields(top.card)),
        SCAN_PIPELINE_TIMEOUT_MS,
        'runStage3PriceEstimation()',
      );
      setScanGuessedPrice(stage3.status === 'ok' ? Math.round(stage3.result.priceUsd * 100) / 100 : FALLBACK_SCAN_PRICE);

      // Don't sell a duplicate of a card the merchant already has in their
      // Vault — check by scryfallId against their real inventory (a fresh
      // fetch, not the `myCards` state above, since that's only ever
      // populated once step 2 is actually reached).
      const owned = user ? await api.listCards(user.id) : [];
      const match = owned.find((c) => c.scryfallId === top.card.id) ?? null;
      setExistingOwnedCard(match);

      setScanIdentifyPhase('matched');
    } catch (err) {
      console.error('[Tab2] runScanIdentify() failed:', err);
      setScanIdentifyError(err instanceof Error ? err.message : String(err));
      setScanIdentifyPhase('error');
    }
  };

  /** "Vender" from the scan result — an already-owned match jumps straight to step 2 with that card; a new one is created (origin SCAN_LISTING, kept out of Tab3.tsx's Vault view) first. */
  const handleSellFromScan = async () => {
    if (existingOwnedCard) {
      setSelectedCardId(existingOwnedCard.id);
      setPrice(existingOwnedCard.guessedPrice);
      setMyCards(null); // re-fetched by step 2's own effect, cheap and keeps this the single source of truth for the dropdown
      resetScanState();
      setMerchantStep(2);
      return;
    }
    if (!scanCandidate) return;
    setIsSavingScan(true);
    try {
      const card = await api.createCard({
        title: scanCandidate.card.name,
        guessedPrice: scanGuessedPrice,
        condition: scanCondition,
        origin: 'SCAN_LISTING',
        scryfallId: scanCandidate.card.id,
        setName: scanCandidate.card.setName,
        rarity: scanCandidate.card.rarity ?? undefined,
        oracleText: scanCandidate.card.oracleText ?? undefined,
      });
      if (scanPhotoBlob) {
        const filename = `card-${card.id}.jpg`;
        await api.uploadCardPhoto(card.id, scanPhotoBlob, filename, 'image/jpeg');
      }
      setSelectedCardId(card.id);
      setPrice(card.guessedPrice);
      setMyCards(null);
      resetScanState();
      setMerchantStep(2);
    } catch (err) {
      setScanIdentifyError(err instanceof api.ApiError ? err.message : t('listing_error'));
      setScanIdentifyPhase('error');
    } finally {
      setIsSavingScan(false);
    }
  };

  /** "Guardar en Vault" — only offered when the scan found a genuinely new card (an already-owned match has nothing to save, it's already there). Same origin: 'VAULT' shape as ListCard.tsx's own manual/Smart Scan save. */
  const handleSaveToVaultFromScan = async () => {
    if (!scanCandidate) return;
    setIsSavingScan(true);
    try {
      const card = await api.createCard({
        title: scanCandidate.card.name,
        guessedPrice: scanGuessedPrice,
        condition: scanCondition,
        origin: 'VAULT',
        scryfallId: scanCandidate.card.id,
        setName: scanCandidate.card.setName,
        rarity: scanCandidate.card.rarity ?? undefined,
        oracleText: scanCandidate.card.oracleText ?? undefined,
      });
      if (scanPhotoBlob) {
        const filename = `card-${card.id}.jpg`;
        await api.uploadCardPhoto(card.id, scanPhotoBlob, filename, 'image/jpeg');
      }
      router.push(`/card/${card.id}`, 'forward');
    } catch (err) {
      setScanIdentifyError(err instanceof api.ApiError ? err.message : t('listing_error'));
      setScanIdentifyPhase('error');
    } finally {
      setIsSavingScan(false);
    }
  };

  const slideVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -20, transition: { duration: 0.2 } }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('trade_nexus_title')}</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment
            value={role}
            onIonChange={e => {
              setRole(e.detail.value as 'merchant' | 'buyer');
              resetMerchantFlow();
              resetBuyerFlow();
            }}
          >
            <IonSegmentButton value="merchant">
              <IonLabel><IonIcon icon={storefrontOutline} style={{verticalAlign: 'middle', marginRight: '5px'}}/> {t('role_merchant')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="buyer">
              <IonLabel><IonIcon icon={walletOutline} style={{verticalAlign: 'middle', marginRight: '5px'}}/> {t('role_buyer')}</IonLabel>
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
            {role === 'merchant' && (
              <motion.div key="merchant-flow" variants={slideVariants} initial="hidden" animate="visible" exit="exit">

                {merchantStep === 1 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2>{t('identify_artifact')}</h2>
                    <p>{t('show_card_camera')}</p>

                    <div style={{ margin: '20px 0', border: '1px solid rgba(0,0,0,0.2)', borderRadius: '4px', background: 'rgba(255,255,255,0.4)', padding: '15px' }}>
                      <div style={{ height: '280px', backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.5)', marginBottom: '15px', overflow: 'hidden', position: 'relative' }}>
                        {/* object-fit: contain, not cover — GuidedCapture's overlay math
                            (frameGeometry.ts) assumes the full native video frame is
                            visible, uncropped, same frame OpenCV.js actually localizes on. */}
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
                          <p style={{color: '#aaa', padding: '0 10px', textAlign: 'center'}}>
                            {camera.status === 'starting' && t('camera_starting')}
                            {camera.status === 'denied' && t('camera_permission_denied')}
                            {camera.status === 'unsupported' && t('camera_unsupported')}
                            {camera.status === 'error' && (camera.errorMessage ?? t('camera_unsupported'))}
                            {camera.status === 'idle' && t('camera_feed_placeholder')}
                          </p>
                        )}
                      </div>

                      {isDetecting && (
                        <h3 style={{fontSize: '0.9rem', marginBottom: '10px', fontStyle: 'italic', textAlign: 'center'}}>{t('detecting_in_progress')}</h3>
                      )}

                      {stage1Status?.status === 'unavailable' && (
                        <h3 style={{fontSize: '0.9rem', marginBottom: '0', fontStyle: 'italic'}}>{t('model_not_available')}</h3>
                      )}
                      {stage1Status?.status === 'error' && (
                        <h3 style={{fontSize: '0.9rem', marginBottom: '0', fontStyle: 'italic'}}>{t('model_error', { message: stage1Status.message })}</h3>
                      )}
                      {stage1Status?.status === 'ok' && (
                        <h3 style={{fontSize: '1rem', marginBottom: '0'}}>
                          {stage1Status.result.isMtgCard ? t('detection_result_card') : t('detection_result_no_card')}
                          {' — '}{t('detection_confidence', { value: Math.round(stage1Status.result.confidence * 100) })}
                        </h3>
                      )}

                      {/* ROADMAP.md J15 — the actual "what did we find, what
                          do you want to do with it" panel. Separate from
                          stage1Status above (that's just the content gate). */}
                      {scanIdentifyPhase === 'identifying' && (
                        <h3 style={{fontSize: '0.9rem', marginTop: '10px', fontStyle: 'italic', textAlign: 'center'}}>{t('scan_status_identifying')}</h3>
                      )}

                      {scanIdentifyPhase === 'no-match' && (
                        <p style={{fontSize: '0.85rem', marginTop: '10px', color: '#c2b5b5'}}>{t('scan_no_match_banner')}</p>
                      )}

                      {scanIdentifyPhase === 'error' && scanIdentifyError && (
                        <p style={{fontSize: '0.85rem', marginTop: '10px', color: '#ff8080'}}>{t('trade_scan_error', { message: scanIdentifyError })}</p>
                      )}

                      {scanIdentifyPhase === 'matched' && scanCandidate && (
                        <div style={{ marginTop: '15px', padding: '15px', border: '1px solid rgba(212,175,55,0.4)', borderRadius: '8px', background: 'rgba(10,5,8,0.6)', textAlign: 'left' }}>
                          <h3 style={{ margin: '0 0 6px', color: '#f2e3cd' }}>{t('trade_scan_matched_title')}</h3>
                          <p style={{ margin: '0 0 10px', color: '#c2b5b5', fontSize: '0.9rem' }}>
                            {t('trade_scan_matched_detail', {
                              name: scanCandidate.card.name,
                              set: scanCandidate.card.setName,
                              rarity: scanCandidate.card.rarity ?? '—',
                              confidence: Math.round(scanCandidate.confidence * 100),
                            })}
                          </p>
                          <p style={{ margin: '0 0 12px', color: 'var(--ion-color-tertiary-tint)', fontWeight: 'bold' }}>
                            ${scanGuessedPrice.toFixed(2)} · {scanCondition}
                          </p>

                          {existingOwnedCard && (
                            <p style={{ margin: '0 0 12px', fontSize: '0.85rem', fontStyle: 'italic', color: '#c2b5b5' }}>{t('trade_scan_already_owned')}</p>
                          )}

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <IonButton
                              expand="block"
                              className="mtg-btn"
                              style={{ flex: 1 }}
                              disabled={isSavingScan}
                              onClick={handleSellFromScan}
                            >
                              <div className="mtg-btn-content">
                                {isSavingScan ? <IonSpinner name="crescent" /> : <IonIcon icon={storefrontOutline} />}
                                <span>{t('trade_scan_sell_button')}</span>
                              </div>
                            </IonButton>
                            {!existingOwnedCard && (
                              <IonButton
                                expand="block"
                                fill="outline"
                                className="mtg-btn"
                                style={{ flex: 1 }}
                                disabled={isSavingScan}
                                onClick={handleSaveToVaultFromScan}
                              >
                                <div className="mtg-btn-content">
                                  <IonIcon icon={archiveOutline} />
                                  <span>{t('trade_scan_save_vault_button')}</span>
                                </div>
                              </IonButton>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Manual fallback — always available, not gated on a
                        successful scan (never was: this button unconditionally
                        advanced to step 2 even before J15). Relabeled so it no
                        longer implies it depends on/replaces the scan above. */}
                    <IonButton expand="block" fill="clear" className="mtg-btn" onClick={() => setMerchantStep(2)}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={cameraOutline} />
                        <span>{t('trade_manual_select_button')}</span>
                      </div>
                    </IonButton>
                  </div>
                )}

                {merchantStep === 2 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2 style={{color: '#f2e3cd'}}>{t('appraisal_complete')}</h2>

                    {myCards === null && (
                      <div style={{ padding: '40px 0' }}>
                        <IonSpinner name="crescent" />
                      </div>
                    )}

                    {myCards !== null && myCards.length === 0 && (
                      <div style={{ margin: '20px 0' }}>
                        <p>{t('trade_no_cards')}</p>
                        <IonButton fill="outline" className="mtg-btn" routerLink="/list-card">{t('list_a_card')}</IonButton>
                      </div>
                    )}

                    {selectedCard && (
                      <>
                        <div style={{ margin: '20px 0', border: '1px solid rgba(139,0,0,0.3)', borderRadius: '8px', background: 'rgba(10,5,8,0.7)', padding: '20px' }}>
                          {myCards && myCards.length > 1 && (
                            <IonItem color="transparent" style={{ marginBottom: '15px', '--border-color': 'rgba(139,0,0,0.3)' }}>
                              <IonLabel position="stacked" style={{color: '#f2e3cd'}}>{t('trade_select_artifact')}</IonLabel>
                              <IonSelect
                                value={selectedCardId}
                                interface="popover"
                                onIonChange={e => handleSelectCard(e.detail.value as string)}
                              >
                                {myCards.map(c => (
                                  <IonSelectOption key={c.id} value={c.id}>{c.title}</IonSelectOption>
                                ))}
                              </IonSelect>
                            </IonItem>
                          )}

                          <h3 style={{ margin: '0 0 5px 0', color: '#f2e3cd' }}>{selectedCard.title}</h3>
                          <p style={{ margin: '0', color: '#c2b5b5' }}>
                            {[selectedCard.setName, selectedCard.rarity, `Condition: ${selectedCard.condition}`].filter(Boolean).join(' • ')}
                          </p>

                          <div style={{ fontSize: '3rem', color: 'var(--ion-color-tertiary-tint)', margin: '15px 0', fontFamily: 'Cinzel', fontWeight: 'bold' }}>
                            ${price.toFixed(2)}
                          </div>

                          <IonItem color="transparent" style={{marginTop: '20px', '--border-color': 'rgba(139,0,0,0.3)'}}>
                            <IonLabel position="stacked" style={{color: '#f2e3cd'}}>{t('set_final_price')}</IonLabel>
                            <IonInput
                              type="number"
                              value={price}
                              onIonChange={e => setPrice(parseFloat(e.detail.value!) || 0)}
                              style={{color: '#f2e3cd', fontSize: '1.2rem'}}
                            />
                          </IonItem>

                          {priceError && <p style={{color: '#ff8080', fontSize: '0.85rem', marginTop: '10px'}}>{priceError}</p>}
                        </div>

                        <IonButton expand="block" className="mtg-btn" onClick={handleGenerateQr} disabled={isSavingPrice} style={{marginTop: '20px'}}>
                          <div className="mtg-btn-content">
                            <IonIcon icon={qrCodeOutline} />
                            <span>{isSavingPrice ? t('trade_saving') : t('generate_trade_qr')}</span>
                          </div>
                        </IonButton>
                      </>
                    )}

                    <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b', marginTop: '10px'}} onClick={() => setMerchantStep(1)}>
                      {t('cancel')}
                    </IonButton>
                  </div>
                )}

                {merchantStep === 3 && selectedCard && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {!soldTransaction && (
                      <>
                        <h2>{t('awaiting_buyer')}</h2>
                        <p>{t('have_buyer_scan', { price: `$${price.toFixed(2)}` })}</p>

                        <div style={{ margin: '30px auto 10px', width: '250px', height: '250px', backgroundColor: '#fff', border: '4px solid #111', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {listingToken
                            ? <QRCode value={`${TRADE_CODE_PREFIX}${listingToken}`} size={200} />
                            : <IonSpinner name="crescent" />}
                        </div>
                        {listingTokenError && (
                          <p style={{color: '#ff8080', fontSize: '0.85rem', margin: '0 0 20px'}}>{listingTokenError}</p>
                        )}

                        <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', fontSize: '0.9rem', fontStyle: 'italic' }}>
                          {t('listening_webhook')}
                        </div>

                        <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b'}} onClick={resetMerchantFlow}>
                          {t('cancel_trade')}
                        </IonButton>
                      </>
                    )}

                    {soldTransaction && (
                      <>
                        <IonIcon icon={checkmarkCircleOutline} style={{ fontSize: '100px', color: '#00733e' }} />
                        <h2 style={{marginTop: '20px'}}>{t('trade_sale_complete')}</h2>
                        <p>{t('trade_sold_notice')}</p>

                        <IonButton
                          expand="block"
                          className="mtg-btn"
                          onClick={() => router.push(`/transaction/${soldTransaction.id}`, 'forward')}
                          style={{marginTop: '30px'}}
                        >
                          {t('view_trade_record')}
                        </IonButton>
                        <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b', marginTop: '10px'}} onClick={resetMerchantFlow}>
                          {t('return_nexus')}
                        </IonButton>
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {role === 'buyer' && (
              <motion.div key="buyer-flow" variants={slideVariants} initial="hidden" animate="visible" exit="exit">
                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                  <h2>{t('connect_merchant')}</h2>
                  <p>{t('scan_merchant_qr_desc')}</p>

                  <div style={{ margin: '20px 0', border: '1px solid rgba(0,0,0,0.2)', borderRadius: '4px', background: 'rgba(255,255,255,0.4)', padding: '15px' }}>
                    <div style={{ height: '280px', backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.5)', overflow: 'hidden', position: 'relative' }}>
                      <video
                        ref={camera.videoRef}
                        playsInline
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'contain', display: camera.status === 'streaming' ? 'block' : 'none' }}
                      />
                      {camera.status === 'streaming' && (
                        <QrScanner camera={camera} onDecoded={handleQrDecoded} paused={!!decodedToken} />
                      )}
                      {camera.status !== 'streaming' && (
                        <p style={{color: '#aaa', padding: '0 10px', textAlign: 'center'}}>
                          {camera.status === 'starting' && t('camera_starting')}
                          {camera.status === 'denied' && t('camera_permission_denied')}
                          {camera.status === 'unsupported' && t('camera_unsupported')}
                          {camera.status === 'error' && (camera.errorMessage ?? t('camera_unsupported'))}
                          {camera.status === 'idle' && t('camera_feed_placeholder')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Tab2;
