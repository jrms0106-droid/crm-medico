# 03 — Arquitetura do sistema

Atende às seções 3, 4, 6, 7, 8, 10, 12, 20 e 21 do Prompt Mestre. Status: **proposta, aguardando aprovação**. Os detalhes de cada módulo (estados, regras, endpoints) serão escritos em `docs/api/` antes da implementação de cada um, como pede a seção 21.

## 1. Visão geral

Um **monólito modular**: um único backend e um único banco, divididos internamente em módulos com fronteiras rígidas. Para o porte da clínica, microsserviços só trariam custo e pontos de falha. Se um módulo precisar crescer sozinho no futuro (por exemplo, IA), ele já nasce isolado e pode ser extraído.

```
 Navegador / PWA (React)
        │  HTTPS, cookie de sessão HttpOnly
        ▼
 ┌──────────────────────── API (NestJS) ────────────────────────┐
 │  Autenticação → Contexto da requisição (usuário, unidade)    │
 │  → Motor de autorização (RBAC+ABAC, nega por padrão)         │
 │  → Módulo de domínio → Auditoria (permitido e negado)        │
 │                                                              │
 │  Identidade · Organização/Unidades · Pacientes · Agenda      │
 │  Atendimento/Vínculo · Prontuário · Formulários · Documentos │
 │  Anexos · Financeiro · CRM/Mensagens · Relatórios · IA       │
 └───────┬──────────────────┬──────────────────┬────────────────┘
         ▼                  ▼                  ▼
   PostgreSQL         Armazenamento      Integrações externas
   (schemas por       de objetos         (via adaptadores):
   domínio + fila)    criptografado      WhatsApp, pagamentos,
                                         assinatura, IA, fiscal
```

## 2. Módulos e fronteiras

| Módulo        | Responsabilidade                                                                                    | Classe de dado                              |
| ------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `identity`    | Usuários, senhas, MFA, sessões, bloqueio por tentativas                                             | Administrativo/segurança                    |
| `org`         | Organização, unidades, especialidades, profissionais (CRM/UF, RQE), vínculos profissional↔unidade   | Administrativo                              |
| `policy`      | Decisão de acesso (RBAC+ABAC); sem banco próprio, recebe fatos e devolve permitir/negar + motivo    | —                                           |
| `patients`    | Cadastro, busca, deduplicação, histórico de alterações, preferências de comunicação, consentimentos | Pessoal                                     |
| `scheduling`  | Agendas, regras de horário, bloqueios, encaixes, lista de espera, confirmações                      | Administrativo                              |
| `encounters`  | Atendimentos e **vínculo assistencial** (máquina de estados da seção 4)                             | Clínico-administrativo                      |
| `records`     | Prontuário: registros clínicos versionados, assinatura, adendos/correções                           | **Clínico (sensível)**                      |
| `forms`       | Modelos de formulário por especialidade, versionados                                                | Configuração                                |
| `documents`   | Receitas, atestados, pedidos, encaminhamentos, relatórios; geração de PDF e assinatura              | Clínico                                     |
| `attachments` | Upload, antivírus, armazenamento criptografado, URL temporária                                      | Clínico ou administrativo, conforme vínculo |
| `billing`     | Preços, cobranças, pagamentos, recibos, caixa, conciliação, idempotência                            | Financeiro                                  |
| `crm`         | Mensagens, modelos aprovados, lembretes, histórico de interações, opt-in/opt-out                    | Comunicação                                 |
| `reports`     | Indicadores agregados, sempre filtrados pela política                                               | Agregado                                    |
| `ai`          | Gateway de IA: adaptadores de provedores, redação de dados, registro de uso, rascunhos              | Processamento por IA                        |
| `audit`       | Trilha de auditoria somente-acréscimo, com encadeamento de hash                                     | Auditoria                                   |

Regra técnica: cada módulo tem seu próprio _schema_ no PostgreSQL (`patients.*`, `records.*`, `billing.*`…), e só ele escreve nas suas tabelas. Outros módulos leem por serviços explícitos. Isso materializa a separação lógica pedida na seção 7.

## 3. Contratos de API

- REST com JSON, prefixo `/api/v1`, documentação OpenAPI gerada automaticamente a partir do código.
- Toda entrada validada por esquema Zod; campos desconhecidos são rejeitados.
- Identificadores públicos são UUID v7 (não sequenciais, não adivinháveis).
- Operações que criam cobranças, enviam mensagens ou assinam documentos exigem cabeçalho `Idempotency-Key`; repetir a mesma chave devolve o mesmo resultado, sem duplicar.
- Concorrência: registros editáveis têm `version`; a atualização envia `If-Match` e, se outra pessoa alterou antes, a API responde `409` em vez de sobrescrever silenciosamente.
- Formato único de erro:

```json
{
  "error": {
    "code": "RECORD_ALREADY_SIGNED",
    "message": "Este registro já foi assinado. Use 'Adicionar adendo' para corrigir.",
    "requestId": "01J…",
    "details": []
  }
}
```

| HTTP | Uso                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 400  | Dados inválidos (`VALIDATION_FAILED`, com campo a campo em `details`)                                                       |
| 401  | Não autenticado ou sessão expirada                                                                                          |
| 403  | Autenticado mas sem permissão (motivo vai para a auditoria, não para a tela em detalhe)                                     |
| 404  | Não existe **ou** o usuário não pode saber que existe (evita confirmar existência de paciente)                              |
| 409  | Conflito: horário ocupado, versão desatualizada, registro já assinado, chave de idempotência reutilizada com outro conteúdo |
| 422  | Regra de negócio violada (ex.: cancelar consulta já realizada)                                                              |
| 429  | Excesso de tentativas                                                                                                       |
| 503  | Serviço externo indisponível (a operação principal não falha por causa disso; fica em fila)                                 |

## 4. Autenticação

- Senha com Argon2id, política de senha forte e verificação contra listas de senhas vazadas.
- **MFA (TOTP) obrigatório** para médicos e administradores; recomendado para secretárias (decisão de política, configurável).
- Sessão no servidor (tabela de sessões), cookie `HttpOnly; Secure; SameSite=Strict`, expiração por inatividade (ex.: 15–30 min) e absoluta (ex.: 12 h), revogação imediata ao desativar usuário. Proteção CSRF por token duplo.
- Bloqueio progressivo após falhas de login; alerta ao administrador.
- Reautenticação (senha ou MFA) para ações críticas: assinar, exportar, acesso emergencial, alterar permissões.

## 5. Autorização: RBAC + ABAC

Toda requisição passa pelo motor `policy`, que recebe **quem** (usuário, papéis, unidade, especialidade), **o quê** (recurso, sensibilidade, unidade do recurso, paciente), **ação** (`view`, `create`, `edit`, `correct`, `sign`, `export`, `share`) e **contexto** (vínculo assistencial vigente, finalidade, acesso emergencial ativo). A resposta padrão é **negar**. Toda decisão, permitida ou negada, é auditada.

### 5.1 Papéis base (RBAC)

| Papel                        | Pode, por padrão                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Médico                       | Dados clínicos **somente** dos pacientes com vínculo assistencial válido, conforme o estado; dados administrativos necessários                                          |
| Secretária                   | Cadastro, agenda, CRM, financeiro operacional; **nenhum** conteúdo clínico, exceto itens expressamente marcados como liberados (ex.: "paciente tem retorno solicitado") |
| Administrador                | Usuários, unidades, configurações, relatórios agregados, auditoria; **sem acesso clínico** por padrão                                                                   |
| Gestor financeiro (opcional) | Financeiro completo e relatórios financeiros                                                                                                                            |

Um administrador que também é médico tem as duas permissões porque tem os dois papéis, nunca porque é administrador.

### 5.2 Estados do vínculo assistencial (ABAC) — proposta inicial para validação médica

| Estado                | O médico vinculado pode                                                                                                                                                                | Não pode                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Agendado              | Ver cadastro básico, motivo da consulta, alergias e lista de problemas ativos (resumo de segurança)                                                                                    | Ver histórico completo, documentos, anexos antigos    |
| Confirmado            | O mesmo do agendado                                                                                                                                                                    | —                                                     |
| Atendimento iniciado  | Ver histórico longitudinal (exceto registros de sensibilidade elevada de outras especialidades), criar e editar rascunhos, anexar, gerar e assinar documentos                          | Ver registros "restritos" sem justificativa adicional |
| Acompanhamento ativo  | Ver histórico, criar evoluções e documentos de seguimento, ver exames chegados                                                                                                         | —                                                     |
| Atendimento encerrado | Ver os próprios registros e o histórico por um **período de cortesia configurável** (proposta: 30 dias) para finalizar laudos e responder exames; criar adendos aos próprios registros | Criar novos atendimentos sem novo agendamento         |
| Vínculo expirado      | Ver e adendar **apenas os registros de sua autoria** (obrigação documental)                                                                                                            | Ver registros de outros profissionais                 |

Sensibilidade dos registros: `normal`, `elevada` (ex.: saúde mental, saúde sexual, genética), `restrita` (marcada pelo autor). Registros `elevada`/`restrita` de outros autores exigem justificativa registrada mesmo com vínculo ativo. Quais especialidades e tipos entram em cada nível **é decisão clínica a validar** com os médicos.

### 5.3 Acesso emergencial ("quebra de vidro")

Botão explícito, exige reautenticação e justificativa escrita, concede leitura por tempo limitado (proposta: 4 horas), notifica o administrador e o responsável de conformidade, e entra em fila de revisão posterior obrigatória. Não permite exportar nem compartilhar.

### 5.4 Onde a política é aplicada

Em todas as rotas da API, no download de anexos (a URL temporária só é emitida após a checagem e expira em minutos), em exportações e relatórios, na busca (resultados filtrados) e no módulo de IA (a IA só recebe dados que o usuário que a acionou poderia ver, e somente os necessários à finalidade).

## 6. Prontuário: integridade, versões e assinatura

- Cada registro clínico guarda: paciente, autor, atendimento de origem, unidade, especialidade, data clínica, data de criação, sensibilidade, versão, status de assinatura e versão do modelo de formulário usado.
- Estados do registro:

| Estado       | Significado                                                                                                         | Pode mudar para                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `rascunho`   | Em edição pelo autor; salvo automaticamente e versionado                                                            | `finalizado`, ou descartado (só se nunca finalizado) |
| `finalizado` | Autor concluiu a redação; aguarda assinatura (pode voltar a rascunho, com registro da volta)                        | `assinado`, `rascunho`                               |
| `assinado`   | Conteúdo congelado com hash e evidências da assinatura                                                              | `retificado`, `arquivado`                            |
| `retificado` | Original continua visível, marcado como substituído por uma retificação vinculada (com autor, data e justificativa) | `arquivado`                                          |
| `arquivado`  | Fora da visão de trabalho do dia a dia, mas preservado pelo prazo de guarda; nunca apagado                          | —                                                    |

- Ao assinar, o conteúdo é congelado: calcula-se um hash SHA-256 do conteúdo canônico, e um gatilho no banco **impede UPDATE e DELETE** do conteúdo de registros assinados (só a mudança de estado para `retificado`/`arquivado` é permitida, e auditada). Correções são feitas por **retificação** (substitui) ou **adendo** (complementa), que referenciam o original, exigem justificativa e também são assinados.
- Conflito de edição: dois usuários abrindo o mesmo rascunho recebem aviso; salvar sobre versão desatualizada devolve `409` e a tela mostra as duas versões para escolha, sem perder texto.
- Assinatura em duas camadas: (1) assinatura eletrônica interna com reautenticação, para registros do prontuário; (2) assinatura digital com certificado ICP-Brasil para documentos que saem da clínica (receitas, atestados), via integração com provedor. O nível exigido para cada tipo de documento é ponto de **validação jurídica** (ver Res. CFM 1.821/2007 e normas posteriores, Lei 14.063/2020); não declaramos conformidade sem essa validação.

## 7. Auditoria

Tabela `audit.events` somente-acréscimo (o papel de banco da aplicação não tem permissão de UPDATE/DELETE nela), cada evento com hash do anterior (encadeamento que torna adulteração detectável). Registra: quem, quando, de onde, ação, recurso, paciente afetado, decisão (permitido/negado), motivo da política, se foi acesso emergencial. **Não** registra o conteúdo clínico em si. Painel de auditoria para o responsável de conformidade, com alertas (ex.: médico consultando muitos prontuários sem vínculo, tentativas negadas repetidas).

## 8. Modelo de dados (visão inicial)

Entidades principais e relações, a detalhar com campos, índices e restrições no documento de banco de dados da etapa de implementação:

```
Organization 1─N Unit 1─N UnitMembership N─1 User N─N Role
User 1─0..1 Professional (CRM, UF, RQE) N─N Specialty
Unit 1─N Schedule (por profissional) 1─N ScheduleRule / Block
Patient 1─N PatientContact / Guardian / EmergencyContact / Consent / CommPreference
Patient 1─N Appointment N─1 Schedule        (restrição: sem sobreposição de horário por agenda)
Appointment 1─0..1 Encounter 1─N CareRelationshipEvent (estados do vínculo)
Encounter 1─N ClinicalRecord 1─N ClinicalRecordVersion; ClinicalRecord 0..1─N Addendum
ClinicalRecord N─1 FormTemplateVersion N─1 FormTemplate N─1 Specialty
Encounter 1─N MedicalDocument (receita, atestado, pedido, encaminhamento, relatório)
ClinicalRecord / MedicalDocument / Patient 1─N Attachment
Patient 1─N Charge 1─N Payment ; CashSession 1─N CashMovement
Patient 1─N Message (com template, canal, status de entrega)
AiRequest N─1 User ; AiRequest 1─N AiDraft (vinculado ao registro que originou)
AuditEvent (independente, referencia tudo por id)
EmergencyAccessGrant N─1 User, N─1 Patient
```

Pontos-chave: toda entidade operacional tem `unit_id`; CPF guardado com índice único por organização e busca por hash para deduplicação; nome com índice sem acento para busca; agenda com restrição de exclusão (`EXCLUDE USING gist`) que impede, no próprio banco, duas consultas sobrepostas na mesma agenda; exclusão lógica em vez de física para registros sujeitos a guarda.

## 9. Várias unidades (seção 8)

- Desde o início existe **uma organização** e **uma unidade**, e todo dado operacional carrega `unit_id`.
- Usuários são vinculados a uma ou mais unidades; a política considera a unidade do usuário e a do recurso.
- O **prontuário é do paciente na organização**, não da unidade: um médico de outra unidade da mesma organização com vínculo assistencial válido pode ver o histórico, conforme a política. Agenda, caixa e configurações são por unidade.
- Organizações juridicamente independentes (outra clínica, outro CNPJ controlador) **não** compartilham banco nesta arquitetura; seriam instalações separadas ou exigiriam um projeto multi-tenant específico, a decidir só se houver necessidade real.

## 10. Classificação e ciclo de vida dos dados (seção 7) — proposta

| Classe                       | Exemplos                       | Retenção proposta                                                                      | Exclusão a pedido do titular                                                |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cadastral                    | Nome, CPF, contato             | Enquanto houver prontuário vinculado                                                   | Atualização/anonimização do que não for exigido pela guarda                 |
| Clínica                      | Prontuário, documentos, anexos | Mínimo legal de guarda (Lei 13.787/2018: 20 anos a partir do último registro; validar) | **Não** se aplica exclusão genérica; registra-se o pedido e a justificativa |
| Financeira                   | Cobranças, recibos             | Prazo fiscal/contábil (validar com contador)                                           | Não durante o prazo                                                         |
| Mensagens                    | WhatsApp, lembretes            | Proposta: 2 anos                                                                       | Sim, após o prazo                                                           |
| Gravações de consulta        | Áudio para transcrição         | Proposta: apagar após a revisão médica da transcrição (máx. 30 dias)                   | Sim                                                                         |
| Transcrições/rascunhos de IA | Texto gerado                   | Rascunho não aprovado: 30 dias; o aprovado vira registro clínico                       | Sim para rascunhos                                                          |
| Auditoria                    | Acessos                        | Proposta: 20 anos para acessos a prontuário (alinhado à guarda); validar               | Não                                                                         |

Prazos marcados como "validar" exigem confirmação jurídica atualizada antes da produção.

## 11. Arquitetura de IA (seções 5 e 6)

- **Gateway único** (`ai`): nenhum outro módulo chama provedor de IA diretamente. O gateway tem adaptadores intercambiáveis (LLM, transcrição, OCR/extração), escolhidos por configuração, e cada funcionalidade de IA tem um interruptor próprio que pode ser desligado sem afetar o resto do sistema.
- Antes de enviar: checagem de permissão do usuário, seleção mínima de dados para a finalidade, remoção de identificadores diretos quando a tarefa não precisa deles (nome, CPF, telefone substituídos por marcadores).
- Contra _prompt injection_: o texto de documentos e mensagens é tratado como dado, nunca como instrução; a IA não executa ações (não grava, não envia, não assina); respostas são validadas por esquema; tudo que a IA produz entra como **rascunho identificado** e só vira registro com revisão e assinatura do médico.
- Fontes: resumos e extrações apontam para o trecho original do prontuário/exame de onde vieram.
- Registro de uso: modelo, versão, finalidade, usuário, registros-fonte (por id, não o conteúdo), decisão humana (aceito/editado/descartado).
- Ordem: Nível 1 (administrativo) → Nível 2 (documental) → Nível 3 (apoio clínico, só após avaliação de risco e enquadramento regulatório, incluindo a RDC Anvisa sobre software como dispositivo médico quando aplicável).
- A escolha entre IA local, nuvem privada e provedores externos será feita em comparativo próprio antes do Nível 1, avaliando contrato, retenção, uso para treinamento e transferência internacional. Nenhum provedor pago será contratado sem sua autorização.

## 12. Fluxo clínico (seção 20)

Abrir paciente → iniciar atendimento (vínculo passa a "iniciado") → preencher formulário da especialidade com salvamento automático → gerar documentos (rascunho) → revisar → assinar registros e documentos (reautenticação) → encerrar atendimento (vínculo passa a "encerrado") → documentos disponíveis para impressão/envio. Se a sessão expirar ou a conexão cair, o rascunho salvo é recuperado ao entrar de novo, com aviso claro do que foi e do que não foi salvo.

## 13. Integrações externas

Todas por adaptadores com interface própria, para trocar fornecedor sem reescrever: WhatsApp (Business Platform oficial ou BSP autorizado), pagamentos (Pix e cartão por provedor tokenizado; o sistema nunca vê número completo de cartão), assinatura ICP-Brasil, emissão fiscal (NFS-e), IA. Falha de integração nunca bloqueia agenda nem prontuário: a operação entra em fila com novas tentativas e alerta.
