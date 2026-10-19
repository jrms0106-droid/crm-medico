import { useCallback, useEffect, useState } from 'react';
import type { SessionInfo } from '@crm/shared';
import { ApiError, api } from './api';
import { Card, DevBanner } from './components';
import {
  ChangePasswordScreen,
  HomeScreen,
  LoginScreen,
  MfaSetupScreen,
  MfaVerifyScreen,
} from './screens';

type View =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'anonymous' }
  | { kind: 'session'; session: SessionInfo };

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const refresh = useCallback(() => {
    api.me().then(
      (session) => setView({ kind: 'session', session }),
      (e) => setView({ kind: e instanceof ApiError && e.status === 401 ? 'anonymous' : 'offline' }),
    );
  }, []);

  useEffect(refresh, [refresh]);

  const onSession = (session: SessionInfo) => setView({ kind: 'session', session });
  const logout = () => {
    api.logout().finally(() => setView({ kind: 'anonymous' }));
  };

  return (
    <div className="page">
      <DevBanner />
      {view.kind === 'loading' && <Card title="CRM Médico" subtitle="Carregando…" />}
      {view.kind === 'offline' && (
        <Card title="Sem conexão" subtitle="Não foi possível falar com o servidor.">
          <button type="button" onClick={refresh}>
            Tentar de novo
          </button>
        </Card>
      )}
      {view.kind === 'anonymous' && <LoginScreen onSession={onSession} />}
      {view.kind === 'session' && (
        <SessionView session={view.session} onSession={onSession} onLogout={logout} />
      )}
    </div>
  );
}

function SessionView({
  session,
  onSession,
  onLogout,
}: {
  session: SessionInfo;
  onSession: (s: SessionInfo) => void;
  onLogout: () => void;
}) {
  switch (session.state) {
    case 'pending_mfa':
      return session.mfaEnabled ? (
        <MfaVerifyScreen onSession={onSession} onCancel={onLogout} />
      ) : (
        <MfaSetupScreen onSession={onSession} onCancel={onLogout} />
      );
    case 'password_change_required':
      return <ChangePasswordScreen session={session} onSession={onSession} />;
    case 'active':
      return <HomeScreen session={session} onLogout={onLogout} />;
  }
}
