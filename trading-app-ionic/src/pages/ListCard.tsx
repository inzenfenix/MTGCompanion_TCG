import React, { useState } from 'react';
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
} from '@ionic/react';
import { cameraOutline, saveOutline } from 'ionicons/icons';
import { Camera } from '@capacitor/camera';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useIonRouter } from '@ionic/react';
import { useAuth } from '../lib/auth/AuthContext';
import * as api from '../lib/api';

// Single-photo capture for listing a card uses @capacitor/camera — the
// reserved use case for that plugin per Proyecto/examen/README.md. The
// live continuous-frame capture on Tab2 ("Scan & Appraise") is a different
// concern and uses getUserMedia+canvas instead (see src/lib/camera/useLiveCamera.ts).
const CONDITIONS: api.CardCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

const ListCard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useIonRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [guessedPrice, setGuessedPrice] = useState<number | null>(null);
  const [condition, setCondition] = useState<api.CardCondition>('NM');

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          </div>

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
