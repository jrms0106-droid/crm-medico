import type { ProfessionalDto } from '@crm/shared';
import { api } from '../api';
import { Alert, Loading, Page, Panel, useLoad } from '../ui';

export function ProfessionalsPage() {
  const list = useLoad(() => api.get<ProfessionalDto[]>('/professionals'), []);
  return (
    <Page title="Profissionais">
      <Panel>
        <Alert message={list.error} />
        {!list.data && !list.error && <Loading what="os profissionais" />}
        {list.data && (
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>CRM</th>
                <th>Especialidades</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    {p.crmNumber}/{p.crmState}
                  </td>
                  <td>
                    {p.specialties
                      .map((s) => (s.rqe ? `${s.name} (RQE ${s.rqe})` : s.name))
                      .join(', ') || '—'}
                  </td>
                  <td>{p.active ? 'Ativo' : 'Inativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}
