import { type FormEvent, useState } from 'react';
import {
  CHARGE_STATUSES,
  CHARGE_STATUS_LABELS,
  type ChargeDto,
  type ChargeStatus,
  type FinancialReportDto,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PatientDto,
  type PatientSummaryDto,
  type PaymentDto,
  type PaymentMethod,
  type PriceItemDto,
  type SessionInfo,
  type UnitDto,
  formatCents,
  parseReais,
} from '@crm/shared';
import { api, query } from '../api';
import { AdminReportPanel } from './assistant';
import { useReauth } from '../reauth';
import { href, navigate, useRoute } from '../router';
import { canSee } from '../shell';
import {
  Alert,
  Badge,
  Loading,
  Notice,
  Page,
  Panel,
  formatDate,
  formatDateTime,
  todayLocal,
  useAction,
  useLoad,
} from '../ui';

type Guarded = <T>(fn: () => Promise<T>) => Promise<T>;

const STATUS_TONE: Record<ChargeStatus, string> = {
  open: 'warn',
  partially_paid: 'info',
  paid: 'ok',
  cancelled: 'neutral',
};

/** Valor em centavos → texto para o campo de reais ("150,00"). */
const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

const firstOfMonth = (date: string) => `${date.slice(0, 8)}01`;

/**
 * Financeiro particular (docs/api/financeiro.md). A secretária cria cobranças e registra
 * pagamentos das suas unidades; o administrador vê tudo e estorna pagamentos.
 */
export function BillingPage({ session }: { session: SessionInfo }) {
  const { params } = useRoute();
  const isSecretary = canSee(session, ['secretary']);
  const reauth = useReauth(session, 'Estornar um pagamento exige a senha de novo.');
  const units = useLoad(() => api.get<UnitDto[]>('/units'), []);
  const [chosenUnit, setUnit] = useState('');
  const today = todayLocal();
  const [from, setFrom] = useState(firstOfMonth(today));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<ChargeStatus | ''>('');
  // O resumo recarrega a cada mudança; a lista, só quando entra cobrança nova.
  const [reportVersion, setReportVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const patientId = params.get('paciente');
  const appointmentId = params.get('consulta');

  const activeUnits = (units.data ?? []).filter((u) => u.active);
  const unitId = params.get('unidade') || chosenUnit || activeUnits[0]?.id || '';

  if (units.error)
    return (
      <Page title="Financeiro">
        <Alert message={units.error} />
      </Page>
    );
  if (!units.data)
    return (
      <Page title="Financeiro">
        <Loading what="as unidades" />
      </Page>
    );
  if (activeUnits.length === 0)
    return (
      <Page title="Financeiro">
        <Notice>Nenhuma unidade disponível para você.</Notice>
      </Page>
    );

  const changed = () => setReportVersion((v) => v + 1);
  return (
    <Page title="Financeiro">
      {reauth.dialog}
      <Notice>
        Registro de cobranças e pagamentos recebidos na recepção. O sistema não cobra cartão, não
        gera Pix e não emite nota fiscal nem recibo fiscal.
      </Notice>
      <Panel>
        <div className="inline">
          <label className="field">
            <span>Unidade</span>
            <select
              value={unitId}
              onChange={(e) => {
                setUnit(e.target.value);
                if (params.get('unidade')) navigate('/financeiro');
              }}
            >
              {activeUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>De</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="field">
            <span>Até</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} required />
          </label>
        </div>
      </Panel>
      {from && to && (
        <ReportPanel
          key={`r-${unitId}-${from}-${to}-${reportVersion}`}
          unitId={unitId}
          from={from}
          to={to}
        />
      )}
      {canSee(session, ['admin']) && from && to && (
        <AdminReportPanel key={`ia-${unitId}-${from}-${to}`} unitId={unitId} from={from} to={to} />
      )}
      {isSecretary && patientId && (
        <NewChargePanel
          key={`n-${patientId}-${appointmentId ?? ''}-${unitId}`}
          patientId={patientId}
          appointmentId={appointmentId}
          unitId={unitId}
          onCreated={() => {
            navigate('/financeiro');
            changed();
            setListVersion((v) => v + 1);
          }}
        />
      )}
      {isSecretary && !patientId && <PatientPicker />}
      <ChargesPanel
        key={`c-${unitId}-${from}-${to}-${status}-${listVersion}`}
        session={session}
        unitId={unitId}
        from={from}
        to={to}
        status={status}
        onStatus={setStatus}
        guarded={reauth.guarded}
        onChanged={changed}
      />
    </Page>
  );
}

function ReportPanel({ unitId, from, to }: { unitId: string; from: string; to: string }) {
  const report = useLoad(
    () => api.get<FinancialReportDto>(`/billing/report${query({ unitId, from, to })}`),
    [unitId, from, to],
  );
  const r = report.data;
  return (
    <Panel title={`Resumo de ${formatDate(from)} a ${formatDate(to)}`}>
      <Alert message={report.error} />
      {!r && !report.error && <Loading what="o resumo" />}
      {r && (
        <dl className="facts" aria-label="Resumo financeiro">
          <dt>Cobrado</dt>
          <dd>
            {formatCents(r.charged.netCents)}{' '}
            <small className="muted">
              ({r.charged.count} {r.charged.count === 1 ? 'cobrança' : 'cobranças'}, bruto{' '}
              {formatCents(r.charged.grossCents)}, descontos {formatCents(r.charged.discountCents)})
            </small>
          </dd>
          <dt>Recebido</dt>
          <dd>
            {formatCents(r.received.totalCents)}{' '}
            <small className="muted">
              {PAYMENT_METHODS.filter((m) => r.received.byMethod[m] > 0)
                .map((m) => `${PAYMENT_METHOD_LABELS[m]} ${formatCents(r.received.byMethod[m])}`)
                .join(' · ')}
            </small>
          </dd>
          <dt>Estornado</dt>
          <dd>{formatCents(r.reversedCents)}</dd>
          <dt>Em aberto</dt>
          <dd>
            {formatCents(r.openCents)}{' '}
            <small className="muted">
              ({r.openCount} {r.openCount === 1 ? 'cobrança' : 'cobranças'} até {formatDate(to)})
            </small>
          </dd>
        </dl>
      )}
    </Panel>
  );
}

/** Busca o paciente para começar uma cobrança avulsa (sem consulta da agenda). */
function PatientPicker() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PatientSummaryDto[] | null>(null);
  const action = useAction();
  const search = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      setFound(await api.post<PatientSummaryDto[]>('/patients/search', { q, limit: 10 }));
    });
  };
  return (
    <Panel title="Nova cobrança">
      <p className="muted">
        Para cobrar uma consulta, use <strong>Cobrar</strong> na agenda do dia. Para outro serviço,
        busque o paciente.
      </p>
      <form className="inline" onSubmit={search} aria-label="Buscar paciente para cobrança">
        <label className="field grow">
          <span>Paciente</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
        </label>
        <button type="submit" disabled={action.busy}>
          Buscar paciente
        </button>
      </form>
      <Alert message={action.error} />
      {found && found.length === 0 && <p className="muted">Nenhum paciente encontrado.</p>}
      <ul className="picks">
        {found?.map((p) => (
          <li key={p.id}>
            <a href={href(`/financeiro?paciente=${p.id}`)}>{p.displayName}</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NewChargePanel({
  patientId,
  appointmentId,
  unitId,
  onCreated,
}: {
  patientId: string;
  appointmentId: string | null;
  unitId: string;
  onCreated: () => void;
}) {
  const patient = useLoad(() => api.get<PatientDto>(`/patients/${patientId}`), [patientId]);
  const prices = useLoad(() => api.get<PriceItemDto[]>('/billing/prices'), []);
  const [priceItemId, setPriceItemId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const action = useAction();

  const pick = (id: string) => {
    setPriceItemId(id);
    const item = prices.data?.find((p) => p.id === id);
    if (item) {
      setDescription(item.name);
      setAmount(centsToInput(item.amountCents));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amountCents = parseReais(amount);
    const discountCents = discount.trim() ? parseReais(discount) : 0;
    if (amountCents === null || discountCents === null) {
      action.setError('Valor inválido. Use reais com vírgula, por exemplo 150,00.');
      return;
    }
    void action.run(async () => {
      await api.post<ChargeDto>('/charges', {
        patientId,
        unitId,
        ...(appointmentId ? { appointmentId } : {}),
        ...(priceItemId ? { priceItemId } : {}),
        description,
        amountCents,
        discountCents,
      });
      onCreated();
    });
  };

  return (
    <Panel title="Nova cobrança">
      <Alert message={patient.error ?? prices.error} />
      <p>
        Paciente: <strong>{patient.data?.displayName ?? '…'}</strong>
        {appointmentId && <> · consulta da agenda</>}{' '}
        <a className="small" href={href('/financeiro')}>
          trocar
        </a>
      </p>
      <form className="grid" onSubmit={submit} aria-label="Nova cobrança">
        <label className="field">
          <span>Item da tabela</span>
          <select value={priceItemId} onChange={(e) => pick(e.target.value)}>
            <option value="">Outro (digitar)</option>
            {prices.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatCents(p.amountCents)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Descrição</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label className="field">
          <span>Valor (R$)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="150,00"
            required
          />
        </label>
        <label className="field">
          <span>Desconto (R$, opcional)</span>
          <input
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
          />
        </label>
        <Alert message={action.error} />
        <div className="actions">
          <button type="submit" disabled={action.busy}>
            Criar cobrança
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ChargesPanel({
  session,
  unitId,
  from,
  to,
  status,
  onStatus,
  guarded,
  onChanged,
}: {
  session: SessionInfo;
  unitId: string;
  from: string;
  to: string;
  status: ChargeStatus | '';
  onStatus: (s: ChargeStatus | '') => void;
  guarded: Guarded;
  onChanged: () => void;
}) {
  const list = useLoad(
    () =>
      api.get<ChargeDto[]>(`/charges${query({ unitId, from, to, status: status || undefined })}`),
    [unitId, from, to, status],
  );
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Panel title="Cobranças">
      <div className="inline">
        <label className="field">
          <span>Situação</span>
          <select value={status} onChange={(e) => onStatus(e.target.value as ChargeStatus | '')}>
            <option value="">Todas</option>
            {CHARGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CHARGE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Alert message={list.error} />
      {list.loading && !list.data && <Loading what="as cobranças" />}
      {list.data && list.data.length === 0 && (
        <p className="muted">Nenhuma cobrança neste período.</p>
      )}
      {list.data && list.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Paciente</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>Saldo</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((c) => (
              <ChargeRows
                key={c.id}
                session={session}
                charge={c}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                guarded={guarded}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function ChargeRows({
  session,
  charge: initial,
  open,
  onToggle,
  guarded,
  onChanged,
}: {
  session: SessionInfo;
  charge: ChargeDto;
  open: boolean;
  onToggle: () => void;
  guarded: Guarded;
  onChanged: () => void;
}) {
  // Depois de pagar, cancelar ou estornar, a linha mostra a resposta da API na hora.
  const [changed, setChanged] = useState<ChargeDto | null>(null);
  const charge = changed ?? initial;
  const updated = (c: ChargeDto) => {
    setChanged(c);
    onChanged();
  };
  return (
    <>
      <tr>
        <td>{formatDateTime(charge.createdAt)}</td>
        <td>{charge.patient.name}</td>
        <td>{charge.description}</td>
        <td>
          {formatCents(charge.netCents)}
          {charge.discountCents > 0 && (
            <small className="muted"> (desc. {formatCents(charge.discountCents)})</small>
          )}
        </td>
        <td>{formatCents(charge.balanceCents)}</td>
        <td>
          <Badge tone={STATUS_TONE[charge.status]}>{CHARGE_STATUS_LABELS[charge.status]}</Badge>
        </td>
        <td>
          <button type="button" className="link" onClick={onToggle} aria-expanded={open}>
            {open ? 'Fechar' : 'Abrir'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            <ChargeDetail session={session} charge={charge} guarded={guarded} onUpdated={updated} />
          </td>
        </tr>
      )}
    </>
  );
}

function ChargeDetail({
  session,
  charge,
  guarded,
  onUpdated,
}: {
  session: SessionInfo;
  charge: ChargeDto;
  guarded: Guarded;
  onUpdated: (c: ChargeDto) => void;
}) {
  const isSecretary = canSee(session, ['secretary']);
  const isAdmin = canSee(session, ['admin']);
  const action = useAction();
  const confirmed = charge.payments.filter((p) => !p.reversedAt);

  const cancel = () => {
    const reason = window.prompt('Motivo do cancelamento da cobrança:');
    if (!reason) return;
    void action.run(async () =>
      onUpdated(await api.post<ChargeDto>(`/charges/${charge.id}/cancel`, { reason })),
    );
  };

  const reverse = (p: PaymentDto) => {
    const reason = window.prompt(
      `Motivo do estorno de ${formatCents(p.amountCents)} (${PAYMENT_METHOD_LABELS[p.method]}):`,
    );
    if (!reason) return;
    void action.run(async () =>
      onUpdated(await guarded(() => api.post<ChargeDto>(`/payments/${p.id}/reverse`, { reason }))),
    );
  };

  return (
    <div className="detail" aria-label={`Cobrança de ${charge.patient.name}`}>
      <p className="muted">
        Criada por {charge.createdBy.name} em {formatDateTime(charge.createdAt)}. Valor{' '}
        {formatCents(charge.amountCents)}, desconto {formatCents(charge.discountCents)}, pago{' '}
        {formatCents(charge.paidCents)}.
        {charge.cancelledAt && <> Cancelada: {charge.cancelReason}</>}
      </p>
      <Alert message={action.error} />
      {charge.payments.length > 0 && (
        <ul className="timeline" aria-label="Pagamentos">
          {charge.payments.map((p) => (
            <li key={p.id}>
              {formatDateTime(p.paidAt)} · {PAYMENT_METHOD_LABELS[p.method]} ·{' '}
              <strong>{formatCents(p.amountCents)}</strong> · recebido por {p.receivedBy.name}
              {p.reversedAt ? (
                <>
                  {' '}
                  <Badge tone="warn">Estornado</Badge>{' '}
                  <small className="muted">
                    por {p.reversedBy?.name} em {formatDateTime(p.reversedAt)}: {p.reverseReason}
                  </small>
                </>
              ) : (
                isAdmin && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => reverse(p)}
                      disabled={action.busy}
                    >
                      Estornar
                    </button>
                  </>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {isSecretary && charge.status !== 'cancelled' && charge.balanceCents > 0 && (
        <PaymentForm charge={charge} onPaid={onUpdated} />
      )}
      {isSecretary && charge.status !== 'cancelled' && confirmed.length === 0 && (
        <button type="button" className="link" onClick={cancel} disabled={action.busy}>
          Cancelar cobrança
        </button>
      )}
      {isSecretary && charge.status !== 'cancelled' && confirmed.length > 0 && (
        <p className="muted small">
          Para cancelar esta cobrança, o administrador precisa estornar os pagamentos antes.
        </p>
      )}
    </div>
  );
}

/**
 * Registro de pagamento. A chave de idempotência nasce com o formulário e só muda depois de um
 * registro confirmado: se a resposta se perder e a recepção clicar de novo, a API devolve o
 * mesmo pagamento em vez de registrar outro. Mudar forma ou valor é outro pedido e ganha chave
 * nova (a mesma chave com outros dados dá conflito).
 */
function PaymentForm({ charge, onPaid }: { charge: ChargeDto; onPaid: (c: ChargeDto) => void }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [amount, setAmount] = useState(centsToInput(charge.balanceCents));
  const [done, setDone] = useState<string | null>(null);
  const action = useAction();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amountCents = parseReais(amount);
    if (amountCents === null) {
      action.setError('Valor inválido. Use reais com vírgula, por exemplo 150,00.');
      return;
    }
    setDone(null);
    void action.run(async () => {
      const updated = await api.post<ChargeDto>(
        `/charges/${charge.id}/payments`,
        { method, amountCents },
        { 'idempotency-key': key },
      );
      setKey(crypto.randomUUID());
      setDone(`Pagamento de ${formatCents(amountCents)} registrado.`);
      setAmount(centsToInput(updated.balanceCents));
      onPaid(updated);
    });
  };

  return (
    <form className="inline" onSubmit={submit} aria-label="Registrar pagamento">
      <label className="field">
        <span>Forma</span>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as PaymentMethod);
            setKey(crypto.randomUUID());
          }}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Valor recebido (R$)</span>
        <input
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setKey(crypto.randomUUID());
          }}
          inputMode="decimal"
          required
        />
      </label>
      <button type="submit" disabled={action.busy}>
        Registrar pagamento
      </button>
      {done && <span role="status">{done}</span>}
      <Alert message={action.error} />
    </form>
  );
}
