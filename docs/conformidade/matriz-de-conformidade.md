# Matriz de conformidade (preparação para produção)

> **Isto não é parecer jurídico nem declaração de conformidade.** É um levantamento técnico de
> requisitos que costumam valer para um prontuário eletrônico de clínica particular no Brasil,
> do que o sistema já faz e do que falta. Cada linha marcada "validar" precisa da confirmação de
> advogado, encarregado de dados (DPO) ou contador antes da produção. Nenhuma certificação
> (SBIS/CFM, ICP-Brasil, ISO) foi feita.

Situação: **feito** (implementado e testado), **parcial** (existe, mas falta algo para produção),
**falta** (não existe) ou **fora do sistema** (depende de contrato, processo ou pessoa).

## LGPD (Lei 13.709/2018)

| Requisito                                                                                      | Situação        | Onde está ou o que falta                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base legal para dado de saúde (art. 11, II, "f": tutela da saúde por profissional de saúde)    | fora do sistema | Definir e registrar por finalidade. Lembretes, marketing e IA podem exigir outra base ou consentimento. **Validar.**                                                                                                         |
| Segurança técnica (art. 46)                                                                    | parcial         | Senha Argon2id, MFA, sessão no servidor, autorização negada por padrão, CPF e MFA cifrados, auditoria encadeada, papel de banco sem poderes de dono. Falta o que está em [modelagem-de-ameacas.md](modelagem-de-ameacas.md). |
| Registro das operações (art. 37)                                                               | feito           | Toda decisão de acesso vai para `audit.events`, encadeada por hash ([auditoria.md](../api/auditoria.md)).                                                                                                                    |
| Minimização e acesso por necessidade                                                           | feito           | Vínculo assistencial calculado; administrador sem acesso clínico; secretária sem prontuário ([organizacao-e-permissoes.md](../api/organizacao-e-permissoes.md)).                                                             |
| Direitos do titular (art. 18): acesso, correção, portabilidade, informação de compartilhamento | parcial         | Registro dos pedidos com prazo, relatório de quem acessou e exportação em JSON ([direitos-do-titular.md](../api/direitos-do-titular.md)). Falta a cópia clínica (decisão do responsável) e a anonimização.                   |
| Eliminação a pedido x guarda obrigatória                                                       | parcial         | Nada clínico é apagado (correto para a guarda). Falta registrar o pedido de eliminação e anonimizar o que não for de guarda obrigatória.                                                                                     |
| Encarregado (art. 41)                                                                          | fora do sistema | Nomear e publicar o contato do encarregado.                                                                                                                                                                                  |
| Relatório de impacto (RIPD, art. 38)                                                           | falta           | Recomendado para dado sensível em larga escala de tratamento. Elaborar com o encarregado, usando esta matriz e a modelagem de ameaças.                                                                                       |
| Comunicação de incidente (art. 48 e Resolução CD/ANPD nº 15/2024)                              | parcial         | Plano em [resposta-a-incidentes.md](../operacao/resposta-a-incidentes.md). Prazo e conteúdo da comunicação: **validar**.                                                                                                     |
| Operadores (hospedagem, WhatsApp, IA) com contrato e cláusulas de proteção de dados            | fora do sistema | Nenhum operador contratado. Requisitos em [requisitos-de-hospedagem.md](../operacao/requisitos-de-hospedagem.md).                                                                                                            |
| Transferência internacional (art. 33)                                                          | fora do sistema | Preferir hospedagem no Brasil. IA ou serviços fora do país exigem avaliação própria.                                                                                                                                         |

## Prontuário e documentos médicos

| Requisito                                                                                                   | Situação        | Onde está ou o que falta                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guarda do prontuário por no mínimo 20 anos a partir do último registro (Lei 13.787/2018)                    | parcial         | Nada é apagado; registro assinado é imutável no banco. Falta política de retenção do backup que cubra o prazo (ver [backup-e-restauracao.md](../operacao/backup-e-restauracao.md)). **Validar.** |
| Integridade, autoria e registro de alterações do prontuário (Res. CFM 1.821/2007)                           | parcial         | Assinatura interna com reautenticação, SHA-256, gatilho que congela o assinado, retificação e adendo com histórico ([prontuario.md](../api/prontuario.md)).                                      |
| Prontuário só eletrônico, sem papel (Res. CFM 1.821/2007 com certificação SBIS/CFM nível NGS2 e ICP-Brasil) | falta           | **Não certificado.** Sem a certificação, não declarar que dispensa o papel. **Validar.**                                                                                                         |
| Documentos médicos eletrônicos com assinatura ICP-Brasil (Res. CFM 2.299/2021; Lei 14.063/2020)             | falta           | Hoje a assinatura é interna e o PDF avisa isso ([documentos.md](../api/documentos.md)). ICP-Brasil exige contratar provedor. **Validar.**                                                        |
| Receituário de controle especial e antimicrobianos (Portaria SVS/MS 344/1998, RDC 471/2021)                 | fora do sistema | O sistema não emite; a tela avisa. Continua em papel ou sistema próprio.                                                                                                                         |
| Sigilo e acesso só de quem atende (Código de Ética Médica)                                                  | feito           | Vínculo assistencial, acesso emergencial com justificativa, prazo e revisão ([atendimento-e-vinculo.md](../api/atendimento-e-vinculo.md)).                                                       |
| Campos clínicos por especialidade                                                                           | parcial         | Formulário genérico até validação médica.                                                                                                                                                        |

## Financeiro

| Requisito                                         | Situação        | Onde está ou o que falta                                                                                      |
| ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| Guarda de registros financeiros pelo prazo fiscal | parcial         | Nada é apagado. Prazo: **validar com contador**.                                                              |
| Recibo e nota fiscal de serviço                   | fora do sistema | O sistema não emite ([financeiro.md](../api/financeiro.md)). Emissão segue no sistema da prefeitura/contador. |

## Operação

| Requisito                                        | Situação | Onde está ou o que falta                                                                                                                      |
| ------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup cifrado e restauração testada             | parcial  | Scripts e ensaio automático no CI ([backup-e-restauracao.md](../operacao/backup-e-restauracao.md)). Falta agendar e guardar fora do servidor. |
| Papel de banco da aplicação com menor privilégio | feito    | [banco-e-papeis.md](../operacao/banco-e-papeis.md); testado no CI.                                                                            |
| Plano de resposta a incidentes                   | parcial  | [resposta-a-incidentes.md](../operacao/resposta-a-incidentes.md). Falta nomear responsáveis e treinar.                                        |
| Teste de invasão independente                    | falta    | Fazer antes da produção, com empresa contratada (exige autorização).                                                                          |
| Monitoramento e alertas                          | falta    | Depende da hospedagem.                                                                                                                        |

## Próximos passos que dependem do responsável

1. Nomear o encarregado de dados e o responsável técnico pelo sistema.
2. Levar esta matriz a um advogado com experiência em saúde digital para validar as linhas marcadas.
3. Decidir sobre ICP-Brasil e certificação SBIS/CFM (ambas pagas).
4. Autorizar a escolha e a contratação de hospedagem com os requisitos levantados.
5. Contratar teste de invasão antes de usar com pacientes reais.
