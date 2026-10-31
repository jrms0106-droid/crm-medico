import { AiSettingsSection } from './assistant';
import { type FormEvent, useState } from 'react';
import {
  BRAZIL_STATES,
  type PriceItemDto,
  type ProfessionalDto,
  ROLES,
  ROLE_LABELS,
  type RoleName,
  type ScheduleDto,
  type SessionInfo,
  type SpecialtyDto,
  type UnitDto,
  type UserAccountDto,
  WEEKDAY_LABELS,
  formatCents,
  parseReais,
} from '@crm/shared';
import { api } from '../api';
import { useReauth } from '../reauth';
import { Alert, Badge, Loading, Notice, Page, Panel, useAction, useLoad } from '../ui';

/**
 * Configurações do administrador: usuários, unidades, especialidades, profissionais, agendas e
 * tabela de preços.
 * Mudanças de acesso pedem reautenticação (a API exige; a tela só pergunta a senha).
 */
export function SettingsPage({ session }: { session: SessionInfo }) {
  const reauth = useReauth(session);
  const units = useLoad(() => api.get<UnitDto[]>('/units'), []);
  const users = useLoad(() => api.get<UserAccountDto[]>('/admin/users'), []);
  const specialties = useLoad(() => api.get<SpecialtyDto[]>('/specialties'), []);
  const professionals = useLoad(() => api.get<ProfessionalDto[]>('/professionals'), []);

  return (
    <Page title="Configurações">
      {reauth.dialog}
      <UsersSection
        session={session}
        users={users.data}
        units={units.data ?? []}
        error={users.error}
        guarded={reauth.guarded}
        onChanged={users.reload}
      />
      <UnitsSection units={units.data} error={units.error} onChanged={units.reload} />
      <SpecialtiesSection
        specialties={specialties.data}
        error={specialties.error}
        onChanged={specialties.reload}
      />
      <ProfessionalsSection
        professionals={professionals.data}
        users={users.data ?? []}
        specialties={(specialties.data ?? []).filter((s) => s.active)}
        error={professionals.error}
        onChanged={() => {
          professionals.reload();
          users.reload();
        }}
      />
      <SchedulesSection
        units={(units.data ?? []).filter((u) => u.active)}
        professionals={(professionals.data ?? []).filter((p) => p.active)}
      />
      <PricesSection />
      <AiSettingsSection guarded={reauth.guarded} />
    </Page>
  );
}

type Guarded = <T>(fn: () => Promise<T>) => Promise<T>;

const checked = (data: FormData, name: string) => data.getAll(name).map(String);

function TemporaryPassword({ who, password }: { who: string; password: string }) {
  return (
    <Notice kind="warn">
      Senha temporária de {who}: <code className="secret">{password}</code>. Entregue pessoalmente;
      ela não será mostrada de novo e precisa ser trocada no primeiro acesso.
    </Notice>
  );
}

function UsersSection({
  session,
  users,
  units,
  error,
  guarded,
  onChanged,
}: {
  session: SessionInfo;
  users: UserAccountDto[] | null;
  units: UnitDto[];
  error: string | null;
  guarded: Guarded;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null);
  const action = useAction();
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? '—';

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action.run(async () => {
      const res = await guarded(() =>
        api.post<{ user: UserAccountDto; temporaryPassword: string }>('/admin/users', {
          name: String(data.get('name') ?? ''),
          email: String(data.get('email') ?? ''),
          roles: checked(data, 'roles'),
          unitIds: checked(data, 'unitIds'),
        }),
      );
      setTemp({ who: res.user.name, password: res.temporaryPassword });
      setCreating(false);
      onChanged();
    });
  };

  const resetAccess = (u: UserAccountDto) =>
    action.run(async () => {
      if (
        !window.confirm(`Redefinir o acesso de ${u.name}? A senha e o MFA atuais deixam de valer.`)
      )
        return;
      const res = await guarded(() =>
        api.post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-access`),
      );
      setTemp({ who: u.name, password: res.temporaryPassword });
      onChanged();
    });

  const toggleActive = (u: UserAccountDto) =>
    action.run(async () => {
      await guarded(() =>
        api.post(`/admin/users/${u.id}/${u.active ? 'deactivate' : 'reactivate'}`),
      );
      onChanged();
    });

  const update = (u: UserAccountDto, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action.run(async () => {
      await guarded(() =>
        api.patch(`/admin/users/${u.id}`, {
          name: String(data.get('name') ?? ''),
          roles: checked(data, 'roles'),
          unitIds: checked(data, 'unitIds'),
        }),
      );
      setEditing(null);
      onChanged();
    });
  };

  return (
    <Panel title="Usuários">
      <Alert message={error ?? action.error} />
      {temp && <TemporaryPassword who={temp.who} password={temp.password} />}
      {!creating && (
        <button type="button" onClick={() => setCreating(true)}>
          Novo usuário
        </button>
      )}
      {creating && (
        <form onSubmit={create} aria-label="Novo usuário">
          <UserFields units={units} />
          <label className="field">
            <span>E-mail</span>
            <input name="email" type="email" required autoComplete="off" />
          </label>
          <div className="actions">
            <button type="submit" disabled={action.busy}>
              Criar usuário
            </button>
            <button type="button" className="link" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {!users && !error && <Loading what="os usuários" />}
      {users && (
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Perfis e unidades</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) =>
              editing === u.id ? (
                <tr key={u.id}>
                  <td colSpan={4}>
                    <form onSubmit={(e) => update(u, e)} aria-label={`Editar ${u.name}`}>
                      <UserFields units={units} initial={u} />
                      <div className="actions">
                        <button type="submit" disabled={action.busy}>
                          Salvar
                        </button>
                        <button type="button" className="link" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    <br />
                    <small className="muted">{u.email}</small>
                  </td>
                  <td>
                    {u.roles.map((r) => ROLE_LABELS[r]).join(', ')}
                    <br />
                    <small className="muted">{u.unitIds.map(unitName).join(', ')}</small>
                  </td>
                  <td>
                    <Badge tone={u.active ? 'ok' : 'warn'}>{u.active ? 'Ativo' : 'Inativo'}</Badge>{' '}
                    {u.mustChangePassword && <Badge tone="info">Senha temporária</Badge>}{' '}
                    {u.mfaEnabled && <Badge tone="neutral">Duas etapas</Badge>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="secondary" onClick={() => setEditing(u.id)}>
                        Editar
                      </button>
                      {u.id !== session.user.id && (
                        <>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void resetAccess(u)}
                          >
                            Redefinir acesso
                          </button>
                          <button
                            type="button"
                            className="link"
                            onClick={() => void toggleActive(u)}
                          >
                            {u.active ? 'Desativar' : 'Reativar'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function UserFields({ units, initial }: { units: UnitDto[]; initial?: UserAccountDto }) {
  return (
    <>
      <label className="field">
        <span>Nome</span>
        <input name="name" required minLength={2} defaultValue={initial?.name} autoComplete="off" />
      </label>
      <fieldset>
        <legend>Perfis</legend>
        {ROLES.map((r: RoleName) => (
          <label key={r} className="check">
            <input
              type="checkbox"
              name="roles"
              value={r}
              defaultChecked={initial?.roles.includes(r)}
            />{' '}
            {ROLE_LABELS[r]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Unidades</legend>
        {units.map((u) => (
          <label key={u.id} className="check">
            <input
              type="checkbox"
              name="unitIds"
              value={u.id}
              defaultChecked={initial?.unitIds.includes(u.id)}
            />{' '}
            {u.name}
          </label>
        ))}
      </fieldset>
    </>
  );
}

function UnitsSection({
  units,
  error,
  onChanged,
}: {
  units: UnitDto[] | null;
  error: string | null;
  onChanged: () => void;
}) {
  const action = useAction();
  const [name, setName] = useState('');
  const create = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post('/units', { name });
      setName('');
      onChanged();
    });
  };
  const toggle = (u: UnitDto) =>
    action.run(async () => {
      await api.patch(`/units/${u.id}`, { active: !u.active });
      onChanged();
    });
  return (
    <Panel title="Unidades">
      <Alert message={error ?? action.error} />
      <ul>
        {units?.map((u) => (
          <li key={u.id}>
            {u.name} <small className="muted">({u.timezone})</small>{' '}
            {!u.active && <Badge tone="warn">Inativa</Badge>}{' '}
            <button type="button" className="link" onClick={() => void toggle(u)}>
              {u.active ? 'Desativar' : 'Reativar'}
            </button>
          </li>
        ))}
      </ul>
      <form className="inline" onSubmit={create} aria-label="Nova unidade">
        <label className="field grow">
          <span>Nova unidade</span>
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
        </label>
        <button type="submit" disabled={action.busy}>
          Adicionar unidade
        </button>
      </form>
    </Panel>
  );
}

function SpecialtiesSection({
  specialties,
  error,
  onChanged,
}: {
  specialties: SpecialtyDto[] | null;
  error: string | null;
  onChanged: () => void;
}) {
  const action = useAction();
  const [name, setName] = useState('');
  const create = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post('/specialties', { name });
      setName('');
      onChanged();
    });
  };
  return (
    <Panel title="Especialidades">
      <Alert message={error ?? action.error} />
      <p>
        {specialties?.map((s) => s.name + (s.active ? '' : ' (inativa)')).join(', ') ||
          'Nenhuma especialidade cadastrada.'}
      </p>
      <form className="inline" onSubmit={create} aria-label="Nova especialidade">
        <label className="field grow">
          <span>Nova especialidade</span>
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
        </label>
        <button type="submit" disabled={action.busy}>
          Adicionar especialidade
        </button>
      </form>
    </Panel>
  );
}

function ProfessionalsSection({
  professionals,
  users,
  specialties,
  error,
  onChanged,
}: {
  professionals: ProfessionalDto[] | null;
  users: UserAccountDto[];
  specialties: SpecialtyDto[];
  error: string | null;
  onChanged: () => void;
}) {
  const action = useAction();
  // Só médicos ativos que ainda não têm ficha profissional.
  const candidates = users.filter(
    (u) => u.active && u.roles.includes('doctor') && !u.professionalId,
  );

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const specialtyId = String(data.get('specialtyId') ?? '');
    const rqe = String(data.get('rqe') ?? '').trim();
    void action.run(async () => {
      await api.post('/professionals', {
        userId: String(data.get('userId') ?? ''),
        crmNumber: String(data.get('crmNumber') ?? '').trim(),
        crmState: String(data.get('crmState') ?? ''),
        specialties: specialtyId ? [{ specialtyId, ...(rqe ? { rqe } : {}) }] : [],
      });
      form.reset();
      onChanged();
    });
  };

  const toggle = (p: ProfessionalDto) =>
    action.run(async () => {
      await api.patch(`/professionals/${p.id}`, { active: !p.active });
      onChanged();
    });

  return (
    <Panel title="Fichas profissionais">
      <Alert message={error ?? action.error} />
      <ul>
        {professionals?.map((p) => (
          <li key={p.id}>
            {p.name} · CRM {p.crmNumber}/{p.crmState}
            {p.specialties.length > 0 && ` · ${p.specialties.map((s) => s.name).join(', ')}`}{' '}
            {!p.active && <Badge tone="warn">Inativa</Badge>}{' '}
            <button type="button" className="link" onClick={() => void toggle(p)}>
              {p.active ? 'Desativar' : 'Reativar'}
            </button>
          </li>
        ))}
      </ul>
      {candidates.length === 0 ? (
        <p className="muted small">
          Para criar uma ficha, cadastre antes um usuário com o perfil Médico.
        </p>
      ) : (
        <form className="grid" onSubmit={create} aria-label="Nova ficha profissional">
          <label className="field">
            <span>Médico</span>
            <select name="userId" required>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>CRM</span>
            <input name="crmNumber" inputMode="numeric" required pattern="[0-9]{1,10}" />
          </label>
          <label className="field">
            <span>UF do CRM</span>
            <select name="crmState" required defaultValue="SP">
              {BRAZIL_STATES.map((uf) => (
                <option key={uf}>{uf}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Especialidade (opcional)</span>
            <select name="specialtyId" defaultValue="">
              <option value="">Nenhuma</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>RQE (opcional)</span>
            <input name="rqe" inputMode="numeric" pattern="[0-9]{1,10}" />
          </label>
          <div className="actions">
            <button type="submit" disabled={action.busy}>
              Criar ficha
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function SchedulesSection({
  units,
  professionals,
}: {
  units: UnitDto[];
  professionals: ProfessionalDto[];
}) {
  const [chosen, setUnitId] = useState('');
  const unitId = chosen || units[0]?.id || '';
  return (
    <Panel title="Agendas">
      {units.length === 0 ? (
        <p className="muted">Cadastre uma unidade primeiro.</p>
      ) : (
        <>
          <label className="field">
            <span>Unidade</span>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          {unitId && <UnitSchedules key={unitId} unitId={unitId} professionals={professionals} />}
        </>
      )}
    </Panel>
  );
}

function UnitSchedules({
  unitId,
  professionals,
}: {
  unitId: string;
  professionals: ProfessionalDto[];
}) {
  const schedules = useLoad(() => api.get<ScheduleDto[]>(`/units/${unitId}/schedules`), [unitId]);
  const action = useAction();
  const withSchedule = new Set(schedules.data?.map((s) => s.professionalId));
  const free = professionals.filter((p) => !withSchedule.has(p.id));

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action.run(async () => {
      await api.post(`/units/${unitId}/schedules`, {
        professionalId: String(data.get('professionalId') ?? ''),
        slotMinutes: Number(data.get('slotMinutes') ?? 30),
      });
      schedules.reload();
    });
  };

  if (schedules.error) {
    return (
      <Notice kind="warn">
        {schedules.error} Para configurar as agendas desta unidade, o administrador precisa estar
        vinculado a ela (em Usuários, edite o seu cadastro e marque a unidade).
      </Notice>
    );
  }
  if (!schedules.data) return <Loading what="as agendas" />;
  return (
    <>
      <Alert message={action.error} />
      {schedules.data.length === 0 && <p className="muted">Nenhuma agenda nesta unidade.</p>}
      {schedules.data.map((s) => (
        <ScheduleEditor key={s.id} schedule={s} onChanged={schedules.reload} />
      ))}
      {free.length > 0 && (
        <form className="inline" onSubmit={create} aria-label="Nova agenda">
          <label className="field">
            <span>Profissional</span>
            <select name="professionalId" required>
              {free.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Duração da consulta (min)</span>
            <input
              name="slotMinutes"
              type="number"
              min={5}
              max={240}
              step={5}
              defaultValue={30}
              required
            />
          </label>
          <button type="submit" disabled={action.busy}>
            Criar agenda
          </button>
        </form>
      )}
    </>
  );
}

interface RuleRow {
  weekday: number;
  start: string;
  end: string;
}

/** Faixas de atendimento por dia da semana (podem ser várias no mesmo dia). */
function ScheduleEditor({ schedule, onChanged }: { schedule: ScheduleDto; onChanged: () => void }) {
  const [rules, setRules] = useState<RuleRow[]>(schedule.rules);
  const [saved, setSaved] = useState(false);
  const action = useAction();

  const set = (i: number, patch: Partial<RuleRow>) => {
    setSaved(false);
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const save = () =>
    action.run(async () => {
      await api.put(`/schedules/${schedule.id}/rules`, rules);
      setSaved(true);
      onChanged();
    });

  const toggle = () =>
    action.run(async () => {
      await api.patch(`/schedules/${schedule.id}`, { active: !schedule.active });
      onChanged();
    });

  return (
    <div className="panel nested" aria-label={`Agenda de ${schedule.professionalName}`}>
      <div className="panel-head">
        <h3>
          {schedule.professionalName} · {schedule.slotMinutes} min{' '}
          {!schedule.active && <Badge tone="warn">Inativa</Badge>}
        </h3>
        <button type="button" className="link" onClick={() => void toggle()}>
          {schedule.active ? 'Desativar' : 'Reativar'}
        </button>
      </div>
      {rules.map((r, i) => (
        <div key={i} className="inline">
          <label className="field">
            <span>Dia</span>
            <select value={r.weekday} onChange={(e) => set(i, { weekday: Number(e.target.value) })}>
              {WEEKDAY_LABELS.map((label, d) => (
                <option key={d} value={d}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Início</span>
            <input
              inputMode="numeric"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
              placeholder="HH:MM"
              size={6}
              value={r.start}
              onChange={(e) => set(i, { start: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Fim</span>
            <input
              inputMode="numeric"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
              placeholder="HH:MM"
              size={6}
              value={r.end}
              onChange={(e) => set(i, { end: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSaved(false);
              setRules((rs) => rs.filter((_, j) => j !== i));
            }}
          >
            Remover
          </button>
        </div>
      ))}
      <Alert message={action.error} />
      {saved && <p role="status">Horários salvos.</p>}
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSaved(false);
            setRules((rs) => [...rs, { weekday: 1, start: '08:00', end: '12:00' }]);
          }}
        >
          Adicionar faixa
        </button>
        <button type="button" onClick={() => void save()} disabled={action.busy}>
          Salvar horários
        </button>
      </div>
    </div>
  );
}

/** Tabela de preços do particular. Mudar o valor não altera cobranças já feitas. */
function PricesSection() {
  const prices = useLoad(() => api.get<PriceItemDto[]>('/billing/prices?includeInactive=true'), []);
  const action = useAction();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const cents = (text: string) => {
    const value = parseReais(text);
    if (value === null)
      throw new Error('Valor inválido. Use reais com vírgula, por exemplo 150,00.');
    return value;
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post('/billing/prices', { name, amountCents: cents(amount) });
      setName('');
      setAmount('');
      prices.reload();
    });
  };
  const save = (item: PriceItemDto, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action.run(async () => {
      await api.patch(`/billing/prices/${item.id}`, {
        name: String(data.get('name') ?? ''),
        amountCents: cents(String(data.get('amount') ?? '')),
      });
      setEditing(null);
      prices.reload();
    });
  };
  const toggle = (item: PriceItemDto) =>
    action.run(async () => {
      await api.patch(`/billing/prices/${item.id}`, { active: !item.active });
      prices.reload();
    });

  return (
    <Panel title="Tabela de preços (particular)">
      <Alert message={prices.error ?? action.error} />
      {!prices.data && !prices.error && <Loading what="a tabela de preços" />}
      {prices.data && prices.data.length === 0 && <p className="muted">Nenhum item cadastrado.</p>}
      <ul>
        {prices.data?.map((item) =>
          editing === item.id ? (
            <li key={item.id}>
              <form
                className="inline"
                onSubmit={(e) => save(item, e)}
                aria-label={`Editar ${item.name}`}
              >
                <label className="field grow">
                  <span>Nome</span>
                  <input name="name" defaultValue={item.name} maxLength={120} required />
                </label>
                <label className="field">
                  <span>Valor (R$)</span>
                  <input
                    name="amount"
                    defaultValue={(item.amountCents / 100).toFixed(2).replace('.', ',')}
                    inputMode="decimal"
                    required
                  />
                </label>
                <button type="submit" disabled={action.busy}>
                  Salvar
                </button>
                <button type="button" className="link" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
              </form>
            </li>
          ) : (
            <li key={item.id}>
              {item.name}: <strong>{formatCents(item.amountCents)}</strong>{' '}
              {!item.active && <Badge tone="warn">Inativo</Badge>}{' '}
              <button type="button" className="link" onClick={() => setEditing(item.id)}>
                Editar
              </button>{' '}
              <button type="button" className="link" onClick={() => void toggle(item)}>
                {item.active ? 'Desativar' : 'Reativar'}
              </button>
            </li>
          ),
        )}
      </ul>
      <form className="inline" onSubmit={create} aria-label="Novo item da tabela">
        <label className="field grow">
          <span>Novo item</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Consulta"
            required
          />
        </label>
        <label className="field">
          <span>Valor (R$)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="250,00"
            required
          />
        </label>
        <button type="submit" disabled={action.busy}>
          Adicionar item
        </button>
      </form>
      <p className="muted small">Mudar o valor de um item não muda as cobranças já feitas.</p>
    </Panel>
  );
}
