import { Suspense, lazy } from 'react';
import { Redirect, Route } from 'react-router-dom';
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { home, settings, scanOutline, libraryOutline } from 'ionicons/icons';

// Code-split por página: IonRouterOutlet necesita que sus hijos directos sean
// <Route> (los inspecciona para las animaciones de transición entre páginas),
// así que el Suspense va DENTRO de cada Route, envolviendo solo el
// componente lazy — envolver el <Route> mismo rompe esa introspección.
const Tab1 = lazy(() => import('./pages/Tab1'));
const Tab2 = lazy(() => import('./pages/Tab2'));
const Tab3 = lazy(() => import('./pages/Tab3'));
const Tab4 = lazy(() => import('./pages/Tab4'));
const TabSearch = lazy(() => import('./pages/TabSearch'));
const TransactionDetails = lazy(() => import('./pages/TransactionDetails'));
const CardDetails = lazy(() => import('./pages/CardDetails'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const PaymentSettings = lazy(() => import('./pages/PaymentSettings'));
const SecuritySettings = lazy(() => import('./pages/SecuritySettings'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const ListCard = lazy(() => import('./pages/ListCard'));
const EditCard = lazy(() => import('./pages/EditCard'));
const Buy = lazy(() => import('./pages/Buy'));

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */
import '@ionic/react/css/palettes/dark.always.css';

/* Theme variables */
import './theme/variables.css';
import './theme/mtg-theme.css';

/* i18n initialization */
import './i18n';

setupIonicReact();

import DreamyBackground from './components/DreamyBackground';
import { searchOutline } from 'ionicons/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from './lib/auth/AuthContext';

const App: React.FC = () => {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  // Briefly resolving a persisted session from localStorage on first load
  // (see AuthContext) — render nothing rather than flash the onboarding
  // screen for a logged-in user.
  if (isLoading) {
    return (
      <IonApp>
        <DreamyBackground />
      </IonApp>
    );
  }

  // No session (see src/lib/auth/AuthContext.tsx) — only the onboarding
  // route is reachable until the user signs in or registers.
  if (!user) {
    return (
      <IonApp>
        <DreamyBackground />
        <IonReactRouter>
          <IonRouterOutlet>
            <Route exact path="/onboarding">
              <Suspense fallback={null}><Onboarding /></Suspense>
            </Route>
            <Route>
              <Redirect to="/onboarding" />
            </Route>
          </IonRouterOutlet>
        </IonReactRouter>
      </IonApp>
    );
  }

  return (
    <IonApp>
      <DreamyBackground />
      <IonReactRouter>
        <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/tab1">
            <Suspense fallback={null}><Tab1 /></Suspense>
          </Route>
          <Route exact path="/tab2">
            <Suspense fallback={null}><Tab2 /></Suspense>
          </Route>
          {/* ROADMAP.md J15 — CardDetails.tsx's "Vender" button needs to hand
              off a SPECIFIC card, not just dump the seller at Tab2's camera
              step (the old routerLink="/tab2" lost which card entirely).
              Same component, same shape as /buy/card/:cardId + /buy/:token
              above — Tab2 reads the param via useParams and jumps straight
              to the price/QR step for that card. */}
          <Route exact path="/tab2/sell/:cardId">
            <Suspense fallback={null}><Tab2 /></Suspense>
          </Route>
          <Route exact path="/tab3">
            <Suspense fallback={null}><Tab3 /></Suspense>
          </Route>
          <Route exact path="/tab4">
            <Suspense fallback={null}><Tab4 /></Suspense>
          </Route>
          <Route exact path="/search">
            <Suspense fallback={null}><TabSearch /></Suspense>
          </Route>
          <Route path="/transaction/:id">
            <Suspense fallback={null}><TransactionDetails /></Suspense>
          </Route>
          <Route exact path="/card/:id">
            <Suspense fallback={null}><CardDetails /></Suspense>
          </Route>
          <Route exact path="/card/:id/edit">
            <Suspense fallback={null}><EditCard /></Suspense>
          </Route>
          <Route exact path="/list-card">
            <Suspense fallback={null}><ListCard /></Suspense>
          </Route>
          <Route exact path="/buy/card/:cardId">
            <Suspense fallback={null}><Buy /></Suspense>
          </Route>
          <Route exact path="/buy/:token">
            <Suspense fallback={null}><Buy /></Suspense>
          </Route>
          <Route path="/account">
            <Suspense fallback={null}><AccountSettings /></Suspense>
          </Route>
          <Route path="/payment">
            <Suspense fallback={null}><PaymentSettings /></Suspense>
          </Route>
          <Route path="/security">
            <Suspense fallback={null}><SecuritySettings /></Suspense>
          </Route>
          <Route exact path="/">
            <Redirect to="/tab1" />
          </Route>
        </IonRouterOutlet>
        <IonTabBar slot="bottom">
          <IonTabButton tab="tab1" href="/tab1">
            <IonIcon aria-hidden="true" icon={home} />
            <IonLabel>{t('tab_keep')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="tab2" href="/tab2">
            <IonIcon aria-hidden="true" icon={scanOutline} />
            <IonLabel>{t('tab_trade')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="search" href="/search">
            <IonIcon aria-hidden="true" icon={searchOutline} />
            <IonLabel>{t('tab_bazaar')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="tab3" href="/tab3">
            <IonIcon aria-hidden="true" icon={libraryOutline} />
            <IonLabel>{t('tab_vault')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="tab4" href="/tab4">
            <IonIcon aria-hidden="true" icon={settings} />
            <IonLabel>{t('tab_scrolls')}</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>
    </IonReactRouter>
  </IonApp>
  );
};

export default App;
