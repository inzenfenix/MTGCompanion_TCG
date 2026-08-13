import React, { useEffect, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton,
  IonIcon, IonInput, IonItem, IonLabel, IonSegment, IonSegmentButton
} from '@ionic/react';
import {
  qrCodeOutline, cameraOutline, checkmarkCircleOutline,
  storefrontOutline, walletOutline, scanOutline
} from 'ionicons/icons';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { useLiveCamera } from '../lib/camera/useLiveCamera';
import { runStage1Detection, type Stage1Status } from '../lib/ml/stage1Detector';

const Tab2: React.FC = () => {
  const { t } = useTranslation();
  const [role, setRole] = useState<'merchant' | 'buyer'>('merchant');

  // Merchant state
  const [merchantStep, setMerchantStep] = useState<1 | 2 | 3>(1);
  const [price, setPrice] = useState<number>(45.00);

  // Buyer state
  const [buyerStep, setBuyerStep] = useState<1 | 2 | 3>(1);

  // Stage 1 (MTG / no-MTG detector) scaffold — live camera via
  // getUserMedia+canvas (see useLiveCamera's header comment for why not
  // @capacitor-community/camera-preview) feeding onnxruntime-web. Stage 2
  // (OCR) and Stage 3 (price) are explicitly out of scope here — see
  // src/lib/ml/stage1Detector.ts.
  const camera = useLiveCamera();
  const [stage1Status, setStage1Status] = useState<Stage1Status | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  // Camera only needs to run while the merchant is on the capture step —
  // release the device as soon as they move on or switch roles.
  useEffect(() => {
    if (role === 'merchant' && merchantStep === 1) {
      camera.start();
    } else {
      camera.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/stop are stable refs from useLiveCamera
  }, [role, merchantStep]);

  const handleDetect = async () => {
    const frame = camera.captureFrame();
    if (!frame) return;
    setIsDetecting(true);
    const result = await runStage1Detection(frame);
    setStage1Status(result);
    setIsDetecting(false);
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
              setMerchantStep(1);
              setBuyerStep(1);
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
                      <div style={{ height: '200px', backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(255,255,255,0.5)', marginBottom: '15px', overflow: 'hidden', position: 'relative' }}>
                        {/* Real getUserMedia feed — replaces the old static placeholder.
                            OpenCV.js perspective-correction (see Proyecto/examen/README.md)
                            is not implemented yet; this shows the raw camera frame. */}
                        <video
                          ref={camera.videoRef}
                          playsInline
                          muted
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: camera.status === 'streaming' ? 'block' : 'none' }}
                        />
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

                      <IonButton
                        expand="block"
                        fill="outline"
                        className="mtg-btn"
                        disabled={camera.status !== 'streaming' || isDetecting}
                        onClick={handleDetect}
                        style={{ marginBottom: '10px' }}
                      >
                        <div className="mtg-btn-content">
                          <IonIcon icon={scanOutline} />
                          <span>{isDetecting ? t('detecting_in_progress') : t('detect_card_button')}</span>
                        </div>
                      </IonButton>

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
                    </div>

                    <IonButton expand="block" className="mtg-btn" onClick={() => setMerchantStep(2)}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={cameraOutline} />
                        <span>{t('scan_appraise')}</span>
                      </div>
                    </IonButton>
                  </div>
                )}

                {merchantStep === 2 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2 style={{color: '#f2e3cd'}}>{t('appraisal_complete')}</h2>

                    <div style={{ margin: '20px 0', border: '1px solid rgba(139,0,0,0.3)', borderRadius: '8px', background: 'rgba(10,5,8,0.7)', padding: '20px' }}>
                      <h3 style={{ margin: '0 0 5px 0', color: '#f2e3cd' }}>Chalice of the Void</h3>
                      <p style={{ margin: '0', color: '#c2b5b5' }}>Mirrodin • Rare • Condition: Near Mint</p>

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
                    </div>

                    <IonButton expand="block" className="mtg-btn" onClick={() => setMerchantStep(3)} style={{marginTop: '20px'}}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={qrCodeOutline} />
                        <span>{t('generate_trade_qr')}</span>
                      </div>
                    </IonButton>
                    <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b', marginTop: '10px'}} onClick={() => setMerchantStep(1)}>
                      {t('cancel')}
                    </IonButton>
                  </div>
                )}

                {merchantStep === 3 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2>{t('awaiting_buyer')}</h2>
                    <p>{t('have_buyer_scan', { price: `$${price.toFixed(2)}` })}</p>

                    <div style={{ margin: '40px auto', width: '250px', height: '250px', backgroundColor: '#fff', border: '4px solid #111', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <QRCode value={`https://trade.mtg.companion/pay?item=chalice_void&price=${price}`} size={200} />
                    </div>

                    <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '4px', fontSize: '0.9rem', fontStyle: 'italic' }}>
                      {t('listening_webhook')}
                    </div>

                    <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b'}} onClick={() => setMerchantStep(1)}>
                      {t('cancel_trade')}
                    </IonButton>
                  </div>
                )}
              </motion.div>
            )}

            {role === 'buyer' && (
              <motion.div key="buyer-flow" variants={slideVariants} initial="hidden" animate="visible" exit="exit">
                
                {buyerStep === 1 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2>{t('connect_merchant')}</h2>
                    <p>{t('scan_merchant_qr_desc')}</p>

                    <div style={{ margin: '20px 0', border: '1px solid rgba(0,0,0,0.2)', borderRadius: '4px', background: 'rgba(255,255,255,0.4)', padding: '15px' }}>
                      <div style={{ height: '250px', backgroundColor: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}>
                        <IonIcon icon={qrCodeOutline} style={{ fontSize: '80px', color: '#d4af37' }} />
                      </div>
                    </div>

                    <IonButton expand="block" className="mtg-btn" onClick={() => setBuyerStep(2)}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={cameraOutline} />
                        <span>{t('scan_merchant_qr')}</span>
                      </div>
                    </IonButton>
                  </div>
                )}

                {buyerStep === 2 && (
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <h2 style={{color: '#f2e3cd'}}>{t('confirm_trade')}</h2>

                    <div style={{ margin: '20px 0', border: '1px solid rgba(139,0,0,0.3)', borderRadius: '8px', background: 'rgba(10,5,8,0.7)', padding: '20px' }}>
                      <p style={{color: '#c2b5b5', margin: '0 0 10px 0'}}>{t('purchasing_from')} <strong style={{color: '#f2e3cd'}}>Grand Magus</strong></p>
                      <h3 style={{ margin: '0', color: '#f2e3cd' }}>Chalice of the Void</h3>

                      <div style={{ fontSize: '3.5rem', color: 'var(--ion-color-tertiary-tint)', margin: '15px 0', fontFamily: 'Cinzel', fontWeight: 'bold' }}>
                        $45.00
                      </div>
                    </div>

                    <IonButton expand="block" onClick={() => setBuyerStep(3)} style={{'--background': '#00733e', '--color': '#fff', marginTop: '20px'}}>
                      <div className="mtg-btn-content">
                        <IonIcon icon={checkmarkCircleOutline} />
                        <span>{t('pay_webpay')}</span>
                      </div>
                    </IonButton>

                    <IonButton expand="block" fill="clear" style={{'--color': '#5c1b1b', marginTop: '10px'}} onClick={() => setBuyerStep(1)}>
                      {t('cancel_trade')}
                    </IonButton>
                  </div>
                )}

                {buyerStep === 3 && (
                  <div style={{ textAlign: 'center', marginTop: '40px' }}>
                    <IonIcon icon={checkmarkCircleOutline} style={{ fontSize: '120px', color: '#00733e' }} />
                    <h2 style={{marginTop: '20px'}}>{t('transaction_successful')}</h2>
                    <p>{t('artifact_added_vault')}</p>

                    <IonButton expand="block" className="mtg-btn" onClick={() => setBuyerStep(1)} style={{marginTop: '40px'}}>
                      {t('return_nexus')}
                    </IonButton>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </IonContent>
    </IonPage>
  );
};

export default Tab2;
