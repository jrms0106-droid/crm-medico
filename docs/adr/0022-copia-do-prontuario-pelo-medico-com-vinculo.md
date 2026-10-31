# ADR 0022: Cópia do prontuário gerada pelo médico com vínculo

- **Status:** aceito (2026-10-31), seguindo a opção recomendada enquanto o responsável não escolhe outra
- **Decisão:**
  - A cópia do prontuário pedida pelo paciente é `export` de `clinical_record`, concedido ao médico só com vínculo `started`, `follow_up` ou `closed`. Agendamento, vínculo expirado e acesso emergencial não geram a cópia.
  - A cópia leva os registros e documentos assinados que esse médico lê sem justificativa. Registros sensíveis de outros autores ficam de fora e são contados no arquivo.
  - Exige reautenticação recente, sai em JSON (versão 1) e fica auditada.
- **Motivo:** Usa as regras de acesso que já existem e não cria um perfil com acesso a todo o prontuário. Quem atende o paciente é quem pode responder por aquela cópia.
- **Alternativas descartadas:**
  - Perfil de diretor técnico com cópia completa: cria acesso amplo a dado clínico, com risco maior; pode vir depois, com motivo e auditoria próprios.
  - Sem cópia clínica no sistema: deixaria o pedido do paciente fora da trilha de auditoria.
  - Secretária gerar a cópia: ela não tem acesso clínico.
- **Consequências:** Um paciente sem vínculo ativo com nenhum médico precisa marcar consulta, ou ter a cópia feita fora do sistema, até existir o perfil de diretor técnico. Registros sensíveis de outros autores são pedidos ao autor. Formato e prazo de entrega a validar com o encarregado de dados e o CRM.
- **Revisar quando:** O responsável escolher outra opção, houver diretor técnico no sistema ou a cópia precisar sair em PDF assinado.
