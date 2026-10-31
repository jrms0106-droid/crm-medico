# ADR 0023: Lembretes com rotina dentro da API, autorização do cadastro e envio simulado

- **Status:** aceito (2026-10-31, fase CRM e lembretes)
- **Decisão:**
  - A autorização para lembretes é a preferência de comunicação que já existia no cadastro (canal WhatsApp e "lembretes de consulta"), com histórico nas versões do cadastro. Não há tabela separada de consentimento.
  - Os lembretes ficam em `crm.messages`, um por consulta, com texto e número gravados e protegidos por gatilho (não se apaga, não se altera o texto, mensagem finalizada não muda).
  - A rotina roda dentro da API com `setInterval` (`REMINDERS_INTERVAL_SECONDS`, desligada por padrão) e uma trava do PostgreSQL (`pg_try_advisory_xact_lock`), em vez de uma fila como pg-boss.
  - O envio passa por um adaptador (`MessageSender`). O único adaptador é o simulado, que não fala com nenhum serviço externo.
  - Antes de enviar, a rotina confere de novo a consulta e a autorização; até 3 tentativas.
- **Motivo:** Com o volume de uma clínica (dezenas de consultas por dia), uma rotina simples com trava basta e evita uma dependência nova. Reaproveitar a preferência do cadastro evita duas fontes de verdade para a mesma autorização. O envio real depende de contratar um serviço, o que exige autorização do responsável.
- **Alternativas descartadas:**
  - pg-boss: útil quando houver mais tipos de tarefa (anexos, IA); pode substituir o `setInterval` sem mudar a tabela.
  - Tabela própria de consentimento: duplicaria o que o cadastro já guarda com histórico.
  - Integração direta com um fornecedor de WhatsApp: exige contrato e credenciais.
- **Consequências:** Enquanto o envio for simulado, nenhum paciente recebe mensagem. A troca para um fornecedor real é um novo adaptador, com modelos de mensagem aprovados pelo WhatsApp e credenciais fora do código.
- **Revisar quando:** O responsável autorizar um fornecedor de WhatsApp, houver outros tipos de mensagem (retorno, aniversário, campanhas, que exigem consentimento de marketing) ou mais de uma instância da API.
