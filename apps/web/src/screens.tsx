import { useEffect, useState } from 'react';
import { type HealthResponse, ROLE_LABELS, type SessionInfo, passwordProblem } from '@crm/shared';
import QRCode from 'qrcode';
import { api } from './api';
import { Card, ErrorMessage, Field } from './components';
import { text, useSubmit } from './useSubmit';

type OnSession = (info: SessionInfo) => void;

export function LoginScreen({ onSession }: { onSession: OnSession }) {
  const { onSubmit, error, busy } = useSubmit(async (data) => {
    onSession(await api.login(text(data, 'email'), text(data, 'password')));
  });
  return (
    <Card title="CRM Médico" subtitle="Entre com seu e-mail e senha">
      <form onSubmit={onSubmit} noValidate={false}>
        <Field label="E-mail" name="email" type="email" autoComplete="username" autoFocus />
        <Field label="Senha" name="password" type="password" autoComplete="current-password" />
        <ErrorMessage message={error} />
        <button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="muted small">
        Esqueceu a senha? Peça ao administrador da clínica para redefinir o acesso.
      </p>
    </Card>
  );
}

const CODE_FIELD = {
  label: 'Código de 6 dígitos',
  name: 'code',
  autoComplete: 'one-time-code',
  inputMode: 'numeric',
  pattern: '[0-9]{6}',
  maxLength: 6,
} as const;

export function MfaVerifyScreen({
  onSession,
  onCancel,
}: {
  onSession: OnSession;
  onCancel: () => void;
}) {
  const { onSubmit, error, busy } = useSubmit(async (data) => {
    onSession(await api.mfaVerify(text(data, 'code')));
  });
  return (
    <Card
      title="Verificação em duas etapas"
      subtitle="Digite o código que aparece no seu aplicativo autenticador"
    >
      <form onSubmit={onSubmit}>
        <Field {...CODE_FIELD} autoFocus />
        <ErrorMessage message={error} />
        <button type="submit" disabled={busy}>
          Confirmar
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Sair
        </button>
      </form>
    </Card>
  );
}

export function MfaSetupScreen({
  onSession,
  onCancel,
}: {
  onSession: OnSession;
  onCancel: () => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .mfaSetup()
      .then(async (s) => {
        const qr = await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 200 });
        if (!cancelled) setSetup({ secret: s.secret, qr });
      })
      .catch(
        () => !cancelled && setLoadError('Não foi possível gerar o código. Recarregue a página.'),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const { onSubmit, error, busy } = useSubmit(async (data) => {
    onSession(await api.mfaActivate(text(data, 'code')));
  });

  return (
    <Card
      title="Ative a verificação em duas etapas"
      subtitle="Obrigatória para o seu perfil. Protege os prontuários mesmo se a senha vazar."
    >
      <ol className="steps">
        <li>
          Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft
          Authenticator ou similar).
        </li>
        <li>No aplicativo, escaneie o código abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>
      {loadError && <ErrorMessage message={loadError} />}
      {setup && (
        <div className="qr">
          <img
            src={setup.qr}
            alt="Código QR para configurar o aplicativo autenticador"
            width={200}
            height={200}
          />
          <p className="muted small">
            Sem câmera? Digite esta chave no aplicativo:{' '}
            <code className="secret">{setup.secret}</code>
          </p>
        </div>
      )}
      <form onSubmit={onSubmit}>
        <Field {...CODE_FIELD} />
        <ErrorMessage message={error} />
        <button type="submit" disabled={busy || !setup}>
          Ativar
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Sair
        </button>
      </form>
    </Card>
  );
}

export function ChangePasswordScreen({
  session,
  onSession,
}: {
  session: SessionInfo;
  onSession: OnSession;
}) {
  const [localError, setLocalError] = useState<string | null>(null);
  const { onSubmit, error, busy } = useSubmit(async (data) => {
    const next = text(data, 'newPassword');
    const problem = passwordProblem(next, session.user.email);
    if (problem) return setLocalError(problem);
    if (next !== text(data, 'confirmPassword')) return setLocalError('As senhas não conferem.');
    setLocalError(null);
    onSession(await api.changePassword(text(data, 'currentPassword'), next));
  });
  return (
    <Card
      title="Crie uma nova senha"
      subtitle="Sua senha atual é temporária e precisa ser trocada."
    >
      <form onSubmit={onSubmit}>
        <input type="hidden" name="username" autoComplete="username" value={session.user.email} />
        <Field
          label="Senha temporária"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          autoFocus
        />
        <Field
          label="Nova senha"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          hint="Pelo menos 12 caracteres. Dica: use uma frase, como três palavras com hífens."
        />
        <Field
          label="Repita a nova senha"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
        />
        <ErrorMessage message={localError ?? error} />
        <button type="submit" disabled={busy}>
          Salvar nova senha
        </button>
      </form>
    </Card>
  );
}

export function HomeScreen({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  useEffect(() => {
    api.health().then(setHealth, () => setHealth(null));
  }, []);

  return (
    <Card
      title={`Olá, ${session.user.name}`}
      subtitle={session.user.roles.map((r) => ROLE_LABELS[r]).join(', ')}
    >
      <ul className="checks" aria-live="polite">
        <li className={health?.status === 'ok' ? 'ok' : 'warn'}>
          Servidor:{' '}
          {health ? (health.status === 'ok' ? 'funcionando' : 'com problemas') : 'verificando…'}
        </li>
        <li className={session.mfaEnabled ? 'ok' : 'warn'}>
          Verificação em duas etapas: {session.mfaEnabled ? 'ativa' : 'não ativada'}
        </li>
        <li className="warn">Uso clínico: ainda não aprovado</li>
      </ul>
      <p className="muted small">Pacientes, agenda e prontuário chegam nas próximas etapas.</p>
      <button type="button" onClick={onLogout}>
        Sair
      </button>
    </Card>
  );
}
