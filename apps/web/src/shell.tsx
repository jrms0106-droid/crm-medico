import { ROLE_LABELS, type RoleName, type SessionInfo } from '@crm/shared';
import { AuditPage } from './pages/admin';
import { AgendaPage } from './pages/agenda';
import { BillingPage } from './pages/billing';
import { HomePage } from './pages/home';
import { ImportPage } from './pages/import';
import { PatientPage, PatientsPage } from './pages/patients';
import { PrivacyPage } from './pages/privacy';
import { RemindersPage } from './pages/crm';
import { ProfessionalsPage } from './pages/professionals';
import { RecordPage } from './pages/record';
import { SettingsPage } from './pages/settings';
import { href, useRoute } from './router';

interface NavItem {
  path: string;
  label: string;
  roles: RoleName[];
}

/**
 * Menus por perfil. É só a navegação: quem decide o acesso é a API, que nega por padrão.
 * O administrador não vê pacientes, agenda nem prontuário; o médico não vê o financeiro.
 */
export const NAV: NavItem[] = [
  { path: '', label: 'Início', roles: ['admin', 'doctor', 'secretary'] },
  { path: 'pacientes', label: 'Pacientes', roles: ['doctor', 'secretary'] },
  { path: 'agenda', label: 'Agenda', roles: ['doctor', 'secretary'] },
  { path: 'financeiro', label: 'Financeiro', roles: ['admin', 'secretary'] },
  { path: 'lembretes', label: 'Lembretes', roles: ['secretary'] },
  { path: 'direitos', label: 'Direitos do paciente', roles: ['secretary'] },
  { path: 'importar', label: 'Importar pacientes', roles: ['secretary'] },
  { path: 'profissionais', label: 'Profissionais', roles: ['admin', 'doctor', 'secretary'] },
  { path: 'auditoria', label: 'Auditoria', roles: ['admin'] },
  { path: 'configuracoes', label: 'Configurações', roles: ['admin'] },
];

export const canSee = (session: SessionInfo, roles: RoleName[]) =>
  session.user.roles.some((r) => roles.includes(r));

export function Shell({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const route = useRoute();
  const section = route.path[0] ?? '';
  const items = NAV.filter((i) => canSee(session, i.roles));
  const allowed =
    items.some((i) => i.path === section) ||
    (section === 'prontuario' && canSee(session, ['doctor']));

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">CRM Médico</span>
        <nav aria-label="Menu principal">
          {items.map((i) => (
            <a
              key={i.path}
              href={href(`/${i.path}`)}
              aria-current={section === i.path ? 'page' : undefined}
            >
              {i.label}
            </a>
          ))}
        </nav>
        <span className="who">
          {session.user.name}
          <small>{session.user.roles.map((r) => ROLE_LABELS[r]).join(', ')}</small>
        </span>
        <button type="button" className="link" onClick={onLogout}>
          Sair
        </button>
      </header>
      <main className="content">
        {allowed ? (
          <Section session={session} path={route.path} params={route.params} />
        ) : (
          <p className="notice warn">Esta área não faz parte do seu perfil.</p>
        )}
      </main>
    </div>
  );
}

function Section({
  session,
  path,
  params,
}: {
  session: SessionInfo;
  path: string[];
  params: URLSearchParams;
}) {
  const [section = '', id] = path;
  switch (section) {
    case 'pacientes':
      return id ? (
        <PatientPage session={session} patientId={id} />
      ) : (
        <PatientsPage session={session} />
      );
    case 'agenda':
      return <AgendaPage session={session} />;
    case 'prontuario':
      return id ? (
        <RecordPage session={session} patientId={id} encounterId={params.get('atendimento')} />
      ) : null;
    case 'financeiro':
      return <BillingPage session={session} />;
    case 'lembretes':
      return <RemindersPage />;
    case 'direitos':
      return <PrivacyPage />;
    case 'importar':
      return <ImportPage />;
    case 'profissionais':
      return <ProfessionalsPage />;
    case 'auditoria':
      return <AuditPage />;
    case 'configuracoes':
      return <SettingsPage session={session} />;
    default:
      return <HomePage session={session} />;
  }
}
